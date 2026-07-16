package job

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/logger"
	"github.com/mhsanaei/3x-ui/v3/internal/web/service"

	"gorm.io/gorm"
)

// IPWithTimestamp tracks an IP address with its last seen timestamp
type IPWithTimestamp struct {
	IP        string `json:"ip"`
	Timestamp int64  `json:"timestamp"`
}

// CheckClientIpJob monitors client IP addresses and manages IP blocking based
// on configured limits. The per-client IPs come from the core's online-stats
// API; no access log is involved. On a core too old to expose that API the job
// simply skips the run (the bundled core always supports it).
type CheckClientIpJob struct {
	xrayService service.XrayService
}

var job *CheckClientIpJob

const defaultXrayAPIPort = 62789

const ipStaleAfterSeconds = int64(30 * 60)

// NewCheckClientIpJob creates a new client IP monitoring job instance.
func NewCheckClientIpJob() *CheckClientIpJob {
	job = new(CheckClientIpJob)
	return job
}

func (j *CheckClientIpJob) Run() {
	observed, apiMode := j.collectFromOnlineAPI()
	if !apiMode {
		logger.Debug("[LimitIP] online-stats API unavailable this run; skipping")
		return
	}

	// Heimdall's custom Xray Core enforces simultaneous-IP limits directly
	// from client-ip-limits.json. This compatibility job only records online
	// IPs for panel display and node attribution.
	j.processObserved(observed, true)
}

// collectFromOnlineAPI builds per-email IP observations (email -> ip ->
// last-seen unix seconds) from the core's online-stats API. ok=false means the
// API is unavailable — xray not running, an older core, or a transient gRPC
// failure — and the caller skips the run (there is no access-log fallback).
func (j *CheckClientIpJob) collectFromOnlineAPI() (map[string]map[string]int64, bool) {
	onlineUsers, ok, err := j.xrayService.GetOnlineUsers()
	if err != nil {
		logger.Debug("[LimitIP] online-stats API unavailable this run:", err)
		return nil, false
	}
	if !ok {
		return nil, false
	}
	now := time.Now().Unix()
	observed := make(map[string]map[string]int64, len(onlineUsers))
	for _, user := range onlineUsers {
		for _, entry := range user.IPs {
			// No localhost guard needed here: the core's OnlineMap.AddIP drops
			// 127.0.0.1/[::1] itself, so they never reach this list.
			ts := entry.LastSeen
			if ts <= 0 {
				ts = now
			}
			if _, exists := observed[user.Email]; !exists {
				observed[user.Email] = make(map[string]int64)
			}
			if existing, seen := observed[user.Email][entry.IP]; !seen || ts > existing {
				observed[user.Email][entry.IP] = ts
			}
		}
	}
	return observed, true
}

func (j *CheckClientIpJob) resolveObservedRuntimeEmails(observed map[string]map[string]int64) map[string]map[string]int64 {
	if len(observed) == 0 {
		return observed
	}

	emails := make([]string, 0, len(observed))
	for email := range observed {
		emails = append(emails, email)
	}

	var rows []struct {
		StatEmail string `gorm:"column:stat_email"`
		Email     string `gorm:"column:email"`
	}
	if err := database.GetDB().
		Model(&model.ClientInboundTraffic{}).
		Select("stat_email, email").
		Where("stat_email IN ?", emails).
		Find(&rows).
		Error; err != nil {
		logger.Debug("[LimitIP] resolve runtime observed emails failed:", err)
		return observed
	}

	logicalByRuntime := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.StatEmail == "" || row.Email == "" {
			continue
		}
		logicalByRuntime[row.StatEmail] = row.Email
	}

	if len(logicalByRuntime) == 0 {
		return observed
	}

	resolved := make(map[string]map[string]int64, len(observed))
	for email, ipTimestamps := range observed {
		logicalEmail := email
		if mapped, ok := logicalByRuntime[email]; ok {
			logicalEmail = mapped
		}

		if _, exists := resolved[logicalEmail]; !exists {
			resolved[logicalEmail] = make(map[string]int64, len(ipTimestamps))
		}

		for ip, timestamp := range ipTimestamps {
			if existing, seen := resolved[logicalEmail][ip]; !seen || timestamp > existing {
				resolved[logicalEmail][ip] = timestamp
			}
		}
	}

	return resolved
}

// processObserved runs collection + enforcement for one scan's observations
// (email -> ip -> last-seen unix seconds). observedAreLive marks the
// observations as live connections, which bypass the stale cutoff: a connection
// that opened hours ago is still live even though its timestamp is old. The
// online-stats API always reports live connections, so the job passes true.
func (j *CheckClientIpJob) processObserved(observed map[string]map[string]int64, observedAreLive bool) bool {
	now := time.Now().Unix()
	observed = j.resolveObservedRuntimeEmails(observed)

	// attribution accumulates this scan's local observations per email so they can
	// be recorded under this panel's own guid for cross-node IP attribution.
	attribution := make(map[string][]model.ClientIpEntry, len(observed))
	for email, ipTimestamps := range observed {

		// The observations can still reference a client that was just renamed
		// or deleted; its email no longer matches any inbound. Skip it (and
		// drop any orphaned tracking row) instead of recreating a row and
		// logging an ERROR every run (#4963).
		_, err := j.getInboundByEmail(email)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				logger.Debugf("[LimitIP] skipping stale observed email %q (renamed or deleted)", email)
				j.delInboundClientIps(email)
			} else {
				j.checkError(err)
			}
			continue
		}

		// Convert to IPWithTimestamp slice
		ipsWithTime := make([]IPWithTimestamp, 0, len(ipTimestamps))
		attrEntries := make([]model.ClientIpEntry, 0, len(ipTimestamps))
		for ip, timestamp := range ipTimestamps {
			ipsWithTime = append(ipsWithTime, IPWithTimestamp{IP: ip, Timestamp: timestamp})
			// Live API observations may carry an old lastSeen (connection start),
			// so stamp attribution with now; otherwise the stale cutoff would evict
			// an IP that is connected right now.
			attrTs := timestamp
			if observedAreLive {
				attrTs = now
			}
			attrEntries = append(attrEntries, model.ClientIpEntry{IP: ip, Timestamp: attrTs})
		}
		if len(attrEntries) > 0 {
			attribution[email] = attrEntries
		}

		clientIpsRecord, err := j.getInboundClientIps(email)
		if err != nil {
			_ = j.addInboundClientIps(email, ipsWithTime)
			continue
		}

		j.updateInboundClientIps(clientIpsRecord, ipsWithTime)
	}

	j.recordLocalAttribution(attribution)

	return false
}

// recordLocalAttribution stores this scan's local observations under this panel's
// own guid so a parent panel can attribute each IP to the node it is on.
// Best-effort: attribution is advisory and must never block IP-limit enforcement.
func (j *CheckClientIpJob) recordLocalAttribution(attribution map[string][]model.ClientIpEntry) {
	if len(attribution) == 0 {
		return
	}
	guid, err := (&service.SettingService{}).GetPanelGuid()
	if err != nil || guid == "" {
		return
	}
	if err := (&service.InboundService{}).RecordLocalClientIps(guid, attribution); err != nil {
		logger.Debug("[LimitIP] record local ip attribution failed:", err)
	}
}

func (j *CheckClientIpJob) checkError(e error) {
	if e != nil {
		logger.Warning("client ip job err:", e)
	}
}

func (j *CheckClientIpJob) getInboundClientIps(clientEmail string) (*model.InboundClientIps, error) {
	db := database.GetDB()
	InboundClientIps := &model.InboundClientIps{}
	err := db.Model(model.InboundClientIps{}).Where("client_email = ?", clientEmail).First(InboundClientIps).Error
	if err != nil {
		return nil, err
	}
	return InboundClientIps, nil
}

func (j *CheckClientIpJob) addInboundClientIps(clientEmail string, ipsWithTime []IPWithTimestamp) error {
	inboundClientIps := &model.InboundClientIps{}
	jsonIps, err := json.Marshal(ipsWithTime)
	j.checkError(err)

	inboundClientIps.ClientEmail = clientEmail
	inboundClientIps.Ips = string(jsonIps)

	db := database.GetDB()
	tx := db.Begin()

	defer func() {
		if err == nil {
			tx.Commit()
		} else {
			tx.Rollback()
		}
	}()

	err = tx.Save(inboundClientIps).Error
	if err != nil {
		return err
	}
	return nil
}

// delInboundClientIps drops the inbound_client_ips tracking row for an email
// that no longer maps to any inbound (a renamed or deleted client), so stale
// access-log entries don't keep a ghost row alive (#4963).
func (j *CheckClientIpJob) delInboundClientIps(clientEmail string) {
	db := database.GetDB()
	if err := db.Where("client_email = ?", clientEmail).Delete(&model.InboundClientIps{}).Error; err != nil {
		j.checkError(err)
	}
}

func (j *CheckClientIpJob) updateInboundClientIps(
	inboundClientIps *model.InboundClientIps,
	newIpsWithTime []IPWithTimestamp,
) {
	jsonIps, err := json.Marshal(newIpsWithTime)
	if err != nil {
		logger.Warningf("[LimitIP] failed to encode online IPs: %v", err)
		return
	}

	inboundClientIps.Ips = string(jsonIps)
	if err := database.GetDB().Save(inboundClientIps).Error; err != nil {
		logger.Warningf("[LimitIP] failed to save online IPs: %v", err)
	}
}

// getInboundByEmail resolves the inbound that owns a client email. It prefers
// the exact clients/client_inbounds relation; a substring "settings LIKE
// %email%" can match the wrong inbound (an email that is a substring of another,
// or text that merely appears elsewhere in the settings JSON). The LIKE + JSON
// scan stays only as a fallback for clients not yet present in the relation, so
// nothing regresses when the join finds no row.
func (j *CheckClientIpJob) getInboundByEmail(clientEmail string) (*model.Inbound, error) {
	db := database.GetDB()
	inbound := &model.Inbound{}

	err := db.Model(&model.Inbound{}).
		Joins("JOIN client_inbounds ON client_inbounds.inbound_id = inbounds.id").
		Joins("JOIN clients ON clients.id = client_inbounds.client_id").
		Where("clients.email = ?", clientEmail).
		First(inbound).Error
	if err == nil {
		return inbound, nil
	}

	var candidates []model.Inbound
	if listErr := db.Model(&model.Inbound{}).Where("settings LIKE ?", "%"+clientEmail+"%").Find(&candidates).Error; listErr != nil {
		return nil, listErr
	}
	for i := range candidates {
		settings := map[string][]model.Client{}
		if jsonErr := json.Unmarshal([]byte(candidates[i].Settings), &settings); jsonErr != nil {
			continue
		}
		for _, client := range settings["clients"] {
			if client.Email == clientEmail {
				return &candidates[i], nil
			}
		}
	}

	return nil, err
}
