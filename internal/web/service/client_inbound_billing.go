package service

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/logger"
	"github.com/mhsanaei/3x-ui/v3/internal/xray"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const clientInboundStatEmailPrefix = model.ClientInboundStatEmailPrefix

var clientInboundStatEmailRe = regexp.MustCompile(`^hmstat_([0-9]+)_([a-z2-7]{16})$`)

// clientInboundStatEmail returns the runtime-only Xray stats identity for a
// logical client attached to one inbound.
//
// It intentionally does NOT use the database numeric client id here because
// model.Client carries protocol credentials (ID/UUID/etc.) rather than the
// clients.id primary key. The resolver uses client_inbound_traffics.stat_email,
// so a deterministic privacy-safe hash is enough for runtime attribution.
func clientInboundStatEmail(logicalEmail string, inboundID int) string {
	return model.ClientInboundStatEmail(logicalEmail, inboundID)
}

// parseClientInboundStatEmail resolves the inbound id from a Heimdall runtime
// stat email. The logical client is resolved through the stat_email mapping table;
// this parser intentionally does not expose or derive the human-facing email.
func parseClientInboundStatEmail(email string) (clientID int, inboundID int, ok bool) {
	m := clientInboundStatEmailRe.FindStringSubmatch(email)
	if len(m) != 3 {
		return 0, 0, false
	}

	iid, err := strconv.Atoi(m[1])
	if err != nil || iid <= 0 {
		return 0, 0, false
	}

	return 0, iid, true
}

func isClientInboundStatEmail(email string) bool {
	return strings.HasPrefix(strings.TrimSpace(email), clientInboundStatEmailPrefix+"_")
}

func normalizeInboundUsageMultiplier(v float64) float64 {
	if v < 1 {
		return 1
	}
	if v > 10 {
		return 10
	}
	return v
}

func billableClientInboundBytes(raw int64, multiplier float64) int64 {
	if raw <= 0 {
		return raw
	}
	multiplier = normalizeInboundUsageMultiplier(multiplier)
	if multiplier == 1 {
		return raw
	}
	return int64(math.Round(float64(raw) * multiplier))
}

// EnsureClientInboundTrafficMappingsForInbound refreshes runtime-stat mappings
// for one inbound. It is intentionally scoped to a single inbound so config
// generation and client writes do not scan the full client table on every
// traffic poll.
func (s *InboundService) EnsureClientInboundTrafficMappingsForInbound(inboundID int) error {
	return s.syncClientInboundTrafficMappingsForInbound(database.GetDB(), inboundID)
}

func (s *InboundService) syncClientInboundTrafficMappingsForInbound(tx *gorm.DB, inboundID int) error {
	if tx == nil || inboundID <= 0 {
		return nil
	}

	var ib model.Inbound
	if err := tx.Model(&model.Inbound{}).
		Select("id, protocol").
		Where("id = ?", inboundID).
		First(&ib).Error; err != nil {
		return err
	}

	if ib.Protocol == model.WireGuard {
		return tx.Where("inbound_id = ?", inboundID).Delete(&model.ClientInboundTraffic{}).Error
	}

	var rows []struct {
		ClientID  int    `gorm:"column:client_id"`
		InboundID int    `gorm:"column:inbound_id"`
		Email     string `gorm:"column:email"`
	}

	if err := tx.Table("clients").
		Select("clients.id AS client_id, client_inbounds.inbound_id AS inbound_id, clients.email AS email").
		Joins("JOIN client_inbounds ON client_inbounds.client_id = clients.id").
		Where("client_inbounds.inbound_id = ?", inboundID).
		Where("clients.email <> ?", "").
		Scan(&rows).Error; err != nil {
		return err
	}

	now := time.Now().UnixMilli()
	for _, r := range rows {
		statEmail := clientInboundStatEmail(r.Email, r.InboundID)
		if statEmail == "" {
			continue
		}

		row := model.ClientInboundTraffic{
			ClientID:  r.ClientID,
			InboundID: r.InboundID,
			Email:     r.Email,
			StatEmail: statEmail,
			CreatedAt: now,
			UpdatedAt: now,
		}

		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "client_id"}, {Name: "inbound_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"email":      r.Email,
				"stat_email": statEmail,
				"updated_at": now,
			}),
		}).Create(&row).Error; err != nil {
			return err
		}
	}

	// Delete mappings for clients no longer attached to this inbound. Keep this
	// scoped to inbound_id to avoid table-wide churn on large panels.
	return tx.Exec(`
		DELETE FROM client_inbound_traffics
		WHERE inbound_id = ?
		  AND NOT EXISTS (
		    SELECT 1
		    FROM client_inbounds ci
		    JOIN clients c ON c.id = ci.client_id
		    WHERE ci.client_id = client_inbound_traffics.client_id
		      AND ci.inbound_id = client_inbound_traffics.inbound_id
		      AND c.email = client_inbound_traffics.email
		  )
	`, inboundID).Error
}

func (s *InboundService) upsertClientInboundTrafficMapping(tx *gorm.DB, inboundID int, client *model.Client) error {
	if tx == nil || inboundID <= 0 || client == nil || strings.TrimSpace(client.Email) == "" {
		return nil
	}

	var row struct {
		ClientID int            `gorm:"column:client_id"`
		Protocol model.Protocol `gorm:"column:protocol"`
	}

	if err := tx.Table("clients").
		Select("clients.id AS client_id, inbounds.protocol AS protocol").
		Joins("JOIN client_inbounds ON client_inbounds.client_id = clients.id").
		Joins("JOIN inbounds ON inbounds.id = client_inbounds.inbound_id").
		Where("clients.email = ? AND client_inbounds.inbound_id = ?", client.Email, inboundID).
		Limit(1).
		Scan(&row).Error; err != nil {
		return err
	}

	if row.ClientID <= 0 || row.Protocol == model.WireGuard {
		return nil
	}

	now := time.Now().UnixMilli()
	statEmail := clientInboundStatEmail(client.Email, inboundID)
	if statEmail == "" {
		return nil
	}

	mapping := model.ClientInboundTraffic{
		ClientID:  row.ClientID,
		InboundID: inboundID,
		Email:     client.Email,
		StatEmail: statEmail,
		CreatedAt: now,
		UpdatedAt: now,
	}

	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "client_id"}, {Name: "inbound_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"email":      client.Email,
			"stat_email": statEmail,
			"updated_at": now,
		}),
	}).Create(&mapping).Error
}

type runtimeClientTrafficMapping struct {
	StatEmail       string  `gorm:"column:stat_email"`
	Email           string  `gorm:"column:email"`
	InboundID       int     `gorm:"column:inbound_id"`
	UsageMultiplier float64 `gorm:"column:usage_multiplier"`
	Enable          bool    `gorm:"column:enable"`
	Total           int64   `gorm:"column:total"`
	ExpiryTime      int64   `gorm:"column:expiry_time"`
	Reset           int     `gorm:"column:reset"`
}

// addAccurateClientInboundTraffic consumes Heimdall runtime stat emails and
// returns the legacy/non-runtime rows for the existing email-keyed path.
//
// Exact accounting path:
//
//	hmstat_* raw delta
//	→ client_inbound_traffics actual delta
//	→ multiplier-weighted billable delta
//	→ client_traffics logical email rollup for existing quota/disable paths
func (s *InboundService) addAccurateClientInboundTraffic(tx *gorm.DB, traffics []*xray.ClientTraffic) ([]*xray.ClientTraffic, error) {
	if len(traffics) == 0 {
		return traffics, nil
	}

	legacy := make([]*xray.ClientTraffic, 0, len(traffics))
	statTraffics := make([]*xray.ClientTraffic, 0)
	statEmails := make([]string, 0)

	for _, t := range traffics {
		if t == nil || strings.TrimSpace(t.Email) == "" {
			continue
		}
		if isClientInboundStatEmail(t.Email) {
			statTraffics = append(statTraffics, t)
			statEmails = append(statEmails, t.Email)
			continue
		}
		legacy = append(legacy, t)
	}

	if len(statTraffics) == 0 {
		return legacy, nil
	}

	mappings := make(map[string]runtimeClientTrafficMapping, len(statEmails))
	for _, batch := range chunkStrings(uniqueNonEmptyStrings(statEmails), sqlInChunk) {
		var rows []runtimeClientTrafficMapping
		if err := tx.Table("client_inbound_traffics AS cit").
			Select(`cit.stat_email, cit.email, cit.inbound_id,
			        COALESCE(NULLIF(i.usage_multiplier, 0), 1) AS usage_multiplier,
			        c.enable AS enable, c.total_gb AS total, c.expiry_time AS expiry_time, c.reset AS reset`).
			Joins("JOIN inbounds i ON i.id = cit.inbound_id").
			Joins("JOIN clients c ON c.id = cit.client_id").
			Where("cit.stat_email IN ?", batch).
			Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			mappings[r.StatEmail] = r
		}
	}

	now := time.Now().UnixMilli()
	for _, t := range statTraffics {
		if t.Up == 0 && t.Down == 0 {
			continue
		}

		mapping, ok := mappings[t.Email]
		if !ok {
			logger.Warning("accurate billing: missing stat_email mapping for", t.Email)
			continue
		}

		multiplier := normalizeInboundUsageMultiplier(mapping.UsageMultiplier)
		billableUp := billableClientInboundBytes(t.Up, multiplier)
		billableDown := billableClientInboundBytes(t.Down, multiplier)

		if err := tx.Exec(
			fmt.Sprintf(
				`UPDATE client_inbound_traffics
				 SET actual_up = actual_up + ?,
				     actual_down = actual_down + ?,
				     billable_up = billable_up + ?,
				     billable_down = billable_down + ?,
				     last_online = %s,
				     updated_at = ?
				 WHERE stat_email = ?`,
				database.GreatestExpr("last_online", "?"),
			),
			t.Up, t.Down, billableUp, billableDown, now, now, t.Email,
		).Error; err != nil {
			return nil, err
		}

		res := tx.Exec(
			fmt.Sprintf(
				`UPDATE client_traffics
				 SET up = up + ?, down = down + ?, last_online = %s
				 WHERE email = ?`,
				database.GreatestExpr("last_online", "?"),
			),
			billableUp, billableDown, now, mapping.Email,
		)
		if res.Error != nil {
			return nil, res.Error
		}
		if res.RowsAffected == 0 {
			row := xray.ClientTraffic{
				InboundId:  mapping.InboundID,
				Email:      mapping.Email,
				Enable:     mapping.Enable,
				Up:         billableUp,
				Down:       billableDown,
				Total:      mapping.Total,
				ExpiryTime: mapping.ExpiryTime,
				Reset:      mapping.Reset,
				LastOnline: now,
			}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "email"}}, DoNothing: true}).
				Create(&row).Error; err != nil {
				return nil, err
			}
		}
	}

	return legacy, nil
}

func resetClientInboundTrafficByEmail(tx *gorm.DB, email string) error {
	if tx == nil || strings.TrimSpace(email) == "" {
		return nil
	}
	return tx.Model(&model.ClientInboundTraffic{}).
		Where("email = ?", email).
		Updates(map[string]any{
			"actual_up":     0,
			"actual_down":   0,
			"billable_up":   0,
			"billable_down": 0,
			"last_online":   0,
			"updated_at":    time.Now().UnixMilli(),
		}).Error
}

func resetClientInboundTrafficByEmails(tx *gorm.DB, emails []string) error {
	uniq := uniqueNonEmptyStrings(emails)
	if tx == nil || len(uniq) == 0 {
		return nil
	}
	for _, batch := range chunkStrings(uniq, sqlInChunk) {
		if err := tx.Model(&model.ClientInboundTraffic{}).
			Where("email IN ?", batch).
			Updates(map[string]any{
				"actual_up":     0,
				"actual_down":   0,
				"billable_up":   0,
				"billable_down": 0,
				"last_online":   0,
				"updated_at":    time.Now().UnixMilli(),
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

func resetClientInboundTrafficByInbound(tx *gorm.DB, inboundID int) error {
	if tx == nil || inboundID <= 0 {
		return nil
	}
	return tx.Model(&model.ClientInboundTraffic{}).
		Where("inbound_id = ?", inboundID).
		Updates(map[string]any{
			"actual_up":     0,
			"actual_down":   0,
			"billable_up":   0,
			"billable_down": 0,
			"last_online":   0,
			"updated_at":    time.Now().UnixMilli(),
		}).Error
}

func resetAllClientInboundTraffic(tx *gorm.DB) error {
	if tx == nil {
		return nil
	}
	return tx.Model(&model.ClientInboundTraffic{}).
		Where("1 = 1").
		Updates(map[string]any{
			"actual_up":     0,
			"actual_down":   0,
			"billable_up":   0,
			"billable_down": 0,
			"last_online":   0,
			"updated_at":    time.Now().UnixMilli(),
		}).Error
}

func runtimeClientEmailForInbound(inbound *model.Inbound, logicalEmail string) string {
	return model.RuntimeClientEmailForInbound(inbound, logicalEmail)
}

func runtimeUserMapForInbound(inbound *model.Inbound, userMap map[string]any) map[string]any {
	if userMap == nil {
		return nil
	}
	out := make(map[string]any, len(userMap))
	for k, v := range userMap {
		out[k] = v
	}
	if email, ok := out["email"].(string); ok {
		out["email"] = runtimeClientEmailForInbound(inbound, email)
	}
	return out
}

func (s *InboundService) runtimeInboundByTag(tag string) *model.Inbound {
	if strings.TrimSpace(tag) == "" {
		return nil
	}
	var inbound model.Inbound
	if err := database.GetDB().Model(&model.Inbound{}).
		Select("id, protocol, tag").
		Where("tag = ?", tag).
		First(&inbound).Error; err != nil {
		return nil
	}
	return &inbound
}

func (s *InboundService) runtimeEmailForInboundTag(tag string, logicalEmail string) string {
	return runtimeClientEmailForInbound(s.runtimeInboundByTag(tag), logicalEmail)
}

func (s *InboundService) runtimeUserMapForInboundTag(tag string, userMap map[string]any) map[string]any {
	return runtimeUserMapForInbound(s.runtimeInboundByTag(tag), userMap)
}

func (s *InboundService) resolveRuntimeEmailsForLastOnline(tx *gorm.DB, emails []string, now int64) ([]string, error) {
	uniq := uniqueNonEmptyStrings(emails)
	if len(uniq) == 0 {
		return nil, nil
	}

	logical := make([]string, 0, len(uniq))
	statEmails := make([]string, 0)

	for _, email := range uniq {
		if isClientInboundStatEmail(email) {
			statEmails = append(statEmails, email)
		} else {
			logical = append(logical, email)
		}
	}

	if len(statEmails) == 0 {
		return uniqueNonEmptyStrings(logical), nil
	}

	for _, batch := range chunkStrings(statEmails, sqlInChunk) {
		var rows []struct {
			StatEmail string `gorm:"column:stat_email"`
			Email     string `gorm:"column:email"`
		}

		if err := tx.Model(&model.ClientInboundTraffic{}).
			Select("stat_email, email").
			Where("stat_email IN ?", batch).
			Find(&rows).Error; err != nil {
			return nil, err
		}

		for _, r := range rows {
			if r.Email == "" {
				continue
			}
			logical = append(logical, r.Email)

			if err := tx.Model(&model.ClientInboundTraffic{}).
				Where("stat_email = ?", r.StatEmail).
				Updates(map[string]any{
					"last_online": now,
					"updated_at":  now,
				}).Error; err != nil {
				return nil, err
			}
		}
	}

	return uniqueNonEmptyStrings(logical), nil
}
