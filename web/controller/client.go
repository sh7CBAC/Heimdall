package controller

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v3/database/model"
	"github.com/mhsanaei/3x-ui/v3/web/service"
	"github.com/mhsanaei/3x-ui/v3/web/websocket"

	"github.com/gin-gonic/gin"
)

func notifyClientsChanged() {
	websocket.BroadcastInvalidate(websocket.MessageTypeClients)
}

func parseInboundIdsQuery(raw string) []int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	ids := make([]int, 0, len(parts))
	for _, p := range parts {
		if id, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

type ClientController struct {
	clientService  service.ClientService
	inboundService service.InboundService
	xrayService    service.XrayService
	settingService service.SettingService
}

func (a *ClientController) requireVisibleClient(c *gin.Context, email string) (*model.ClientRecord, bool) {
	rec, err := a.clientService.RequireVisibleClientByEmail(email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "get"), err)
		return nil, false
	}

	return rec, true
}

func NewClientController(g *gin.RouterGroup) *ClientController {
	a := &ClientController{}
	a.initRouter(g)
	return a
}

func (a *ClientController) initRouter(g *gin.RouterGroup) {
	g.GET("/list", a.list)
	g.GET("/list/paged", a.listPaged)
	g.GET("/get/:email", a.get)
	g.GET("/traffic/:email", a.getTrafficByEmail)
	g.GET("/subLinks/:subId", a.getSubLinks)
	g.GET("/links/:email", a.getClientLinks)

	g.POST("/add", a.create)
	g.POST("/update/:email", a.update)
	g.POST("/del/:email", a.delete)
	g.POST("/:email/attach", a.attach)
	g.POST("/:email/detach", a.detach)
	g.POST("/resetAllTraffics", a.resetAllTraffics)
	g.POST("/delDepleted", a.delDepleted)
	g.POST("/bulkAdjust", a.bulkAdjust)
	g.POST("/bulkDel", a.bulkDelete)
	g.POST("/bulkCreate", a.bulkCreate)
	g.POST("/bulkAttach", a.bulkAttach)
	g.POST("/bulkDetach", a.bulkDetach)
	g.POST("/bulkResetTraffic", a.bulkResetTraffic)
	g.POST("/resetTraffic/:email", a.resetTrafficByEmail)
	g.POST("/updateTraffic/:email", a.updateTrafficByEmail)
	g.POST("/ips/:email", a.getIps)
	g.POST("/clearIps/:email", a.clearIps)
	g.POST("/onlines", a.onlines)
	g.POST("/onlinesByGuid", a.onlinesByGuid)
	g.POST("/activeInbounds", a.activeInbounds)
	g.POST("/lastOnline", a.lastOnline)
}

func (a *ClientController) list(c *gin.Context) {
	rows, err := a.clientService.List()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}
	jsonObj(c, rows, nil)
}

func (a *ClientController) listPaged(c *gin.Context) {
	var params service.ClientPageParams
	if err := c.ShouldBindQuery(&params); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}
	resp, err := a.clientService.ListPaged(&a.inboundService, &a.settingService, params)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}
	jsonObj(c, resp, nil)
}

func (a *ClientController) get(c *gin.Context) {
	email := c.Param("email")

	rec, ok := a.requireVisibleClient(c, email)
	if !ok {
		return
	}

	inboundIds, err := a.clientService.GetInboundIdsForRecord(rec.Id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "get"), err)
		return
	}

	flow, err := a.clientService.EffectiveFlow(nil, rec.Id)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "get"), err)
		return
	}

	rec.Flow = flow
	jsonObj(c, gin.H{"client": rec, "inboundIds": inboundIds}, nil)
}

func (a *ClientController) create(c *gin.Context) {
	var payload service.ClientCreatePayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if service.IsHiddenClientEmail(payload.Client.Email) {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("client not found"))
		return
	}
	needRestart, err := a.clientService.Create(&a.inboundService, &payload)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientAddSuccess"), pendingNodeObj(a.inboundService.AnyNodePending(payload.InboundIds)), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

func (a *ClientController) update(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	var updated model.Client
	if err := c.ShouldBindJSON(&updated); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if service.IsHiddenClientEmail(updated.Email) {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), fmt.Errorf("client not found"))
		return
	}
	inboundFilter := parseInboundIdsQuery(c.Query("inboundIds"))
	needRestart, err := a.clientService.UpdateByEmail(&a.inboundService, email, updated, inboundFilter...)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), pendingNodeObj(a.clientService.HasPendingNode(&a.inboundService, email)), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

func (a *ClientController) delete(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	keepTraffic := c.Query("keepTraffic") == "1"
	needRestart, err := a.clientService.DeleteByEmail(&a.inboundService, email, keepTraffic)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientDeleteSuccess"), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

type attachDetachBody struct {
	InboundIds []int `json:"inboundIds"`
}

func (a *ClientController) attach(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	var body attachDetachBody
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	needRestart, err := a.clientService.AttachByEmail(&a.inboundService, email, body.InboundIds)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientAddSuccess"), pendingNodeObj(a.inboundService.AnyNodePending(body.InboundIds)), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

func (a *ClientController) resetAllTraffics(c *gin.Context) {
	needRestart, err := a.clientService.ResetAllTraffics()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.resetAllClientTrafficSuccess"), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

type bulkAdjustRequest struct {
	Emails   []string `json:"emails"`
	AddDays  int      `json:"addDays"`
	AddBytes int64    `json:"addBytes"`
}

func (a *ClientController) bulkAdjust(c *gin.Context) {
	var req bulkAdjustRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	req.Emails = service.FilterVisibleClientEmails(req.Emails)
	result, needRestart, err := a.clientService.BulkAdjust(&a.inboundService, req.Emails, req.AddDays, req.AddBytes)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, result, nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

type bulkDeleteRequest struct {
	Emails      []string `json:"emails"`
	KeepTraffic bool     `json:"keepTraffic"`
}

type bulkAttachRequest struct {
	Emails     []string `json:"emails"`
	InboundIds []int    `json:"inboundIds"`
}

func (a *ClientController) bulkAttach(c *gin.Context) {
	var req bulkAttachRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	req.Emails = service.FilterVisibleClientEmails(req.Emails)
	result, needRestart, err := a.clientService.BulkAttach(&a.inboundService, req.Emails, req.InboundIds)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, result, nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

type bulkDetachRequest struct {
	Emails     []string `json:"emails"`
	InboundIds []int    `json:"inboundIds"`
}

func (a *ClientController) bulkDetach(c *gin.Context) {
	var req bulkDetachRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	req.Emails = service.FilterVisibleClientEmails(req.Emails)
	result, needRestart, err := a.clientService.BulkDetach(&a.inboundService, req.Emails, req.InboundIds)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, result, nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

func (a *ClientController) bulkDelete(c *gin.Context) {
	var req bulkDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	req.Emails = service.FilterVisibleClientEmails(req.Emails)
	result, needRestart, err := a.clientService.BulkDelete(&a.inboundService, req.Emails, req.KeepTraffic)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, result, nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

func (a *ClientController) bulkCreate(c *gin.Context) {
	var payloads []service.ClientCreatePayload
	if err := c.ShouldBindJSON(&payloads); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	visiblePayloads := make([]service.ClientCreatePayload, 0, len(payloads))
	for _, payload := range payloads {
		if service.IsHiddenClientEmail(payload.Client.Email) {
			continue
		}

		visiblePayloads = append(visiblePayloads, payload)
	}
	payloads = visiblePayloads

	result, needRestart, err := a.clientService.BulkCreate(&a.inboundService, payloads)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	jsonObj(c, result, nil)

	if needRestart {
		a.xrayService.SetToNeedRestart()
	}

	notifyClientsChanged()
}

func (a *ClientController) delDepleted(c *gin.Context) {
	deleted, needRestart, err := a.clientService.DelDepleted(&a.inboundService)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, gin.H{"deleted": deleted}, nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

func (a *ClientController) resetTrafficByEmail(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	needRestart, err := a.clientService.ResetTrafficByEmail(&a.inboundService, email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.resetInboundClientTrafficSuccess"), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

type trafficUpdateRequest struct {
	Upload   int64 `json:"upload"`
	Download int64 `json:"download"`
}

func (a *ClientController) updateTrafficByEmail(c *gin.Context) {
	email := c.Param("email")

	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}

	var req trafficUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	if err := a.inboundService.UpdateClientTrafficByEmail(email, req.Upload, req.Download); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}

	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), nil)
	notifyClientsChanged()
}

func (a *ClientController) getIps(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	ips, err := a.inboundService.GetInboundClientIps(email)
	if err != nil || ips == "" {
		jsonObj(c, "No IP Record", nil)
		return
	}
	type ipWithTimestamp struct {
		IP        string `json:"ip"`
		Timestamp int64  `json:"timestamp"`
	}
	var ipsWithTime []ipWithTimestamp
	if err := json.Unmarshal([]byte(ips), &ipsWithTime); err == nil && len(ipsWithTime) > 0 {
		formatted := make([]string, 0, len(ipsWithTime))
		for _, item := range ipsWithTime {
			if item.IP == "" {
				continue
			}
			if item.Timestamp > 0 {
				ts := time.Unix(item.Timestamp, 0).Local().Format("2006-01-02 15:04:05")
				formatted = append(formatted, fmt.Sprintf("%s (%s)", item.IP, ts))
				continue
			}
			formatted = append(formatted, item.IP)
		}
		jsonObj(c, formatted, nil)
		return
	}
	var oldIps []string
	if err := json.Unmarshal([]byte(ips), &oldIps); err == nil && len(oldIps) > 0 {
		jsonObj(c, oldIps, nil)
		return
	}
	jsonObj(c, ips, nil)
}

func (a *ClientController) clearIps(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	if err := a.inboundService.ClearClientIps(email); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.updateSuccess"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.logCleanSuccess"), nil)
}

func (a *ClientController) onlines(c *gin.Context) {
	emails := a.inboundService.GetOnlineClients()
	jsonObj(c, service.FilterVisibleClientEmails(emails), nil)
}

func (a *ClientController) onlinesByGuid(c *gin.Context) {
	data := a.inboundService.GetOnlineClientsByGuid()

	for guid, emails := range data {
		visible := service.FilterVisibleClientEmails(emails)

		if len(visible) == 0 {
			delete(data, guid)
			continue
		}

		data[guid] = visible
	}

	jsonObj(c, data, nil)
}

func (a *ClientController) activeInbounds(c *gin.Context) {
	jsonObj(c, a.inboundService.GetActiveInboundsByGuid(), nil)
}

func (a *ClientController) lastOnline(c *gin.Context) {
	data, err := a.inboundService.GetClientsLastOnline()
	if err != nil {
		jsonObj(c, nil, err)
		return
	}

	for email := range data {
		if service.IsHiddenClientEmail(email) {
			delete(data, email)
		}
	}

	jsonObj(c, data, nil)
}

func (a *ClientController) getTrafficByEmail(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	traffic, err := a.inboundService.GetClientTrafficByEmail(email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.trafficGetError"), err)
		return
	}
	jsonObj(c, traffic, nil)
}

func (a *ClientController) getSubLinks(c *gin.Context) {
	subID := c.Param("subId")

	if _, err := a.clientService.RequireVisibleClientBySubID(subID); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}

	links, err := a.inboundService.GetSubLinks(resolveHost(c), subID)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}

	jsonObj(c, links, nil)
}

func (a *ClientController) getClientLinks(c *gin.Context) {
	email := c.Param("email")

	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}

	links, err := a.inboundService.GetAllClientLinks(resolveHost(c), email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.obtain"), err)
		return
	}

	jsonObj(c, links, nil)
}

func (a *ClientController) detach(c *gin.Context) {
	email := c.Param("email")
	if _, ok := a.requireVisibleClient(c, email); !ok {
		return
	}
	var body attachDetachBody
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	needRestart, err := a.clientService.DetachByEmailMany(&a.inboundService, email, body.InboundIds)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsgObj(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientDeleteSuccess"), pendingNodeObj(a.inboundService.AnyNodePending(body.InboundIds)), nil)
	if needRestart {
		a.xrayService.SetToNeedRestart()
	}
	notifyClientsChanged()
}

type bulkResetRequest struct {
	Emails []string `json:"emails"`
}

func (a *ClientController) bulkResetTraffic(c *gin.Context) {
	var req bulkResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	req.Emails = service.FilterVisibleClientEmails(req.Emails)
	affected, err := a.clientService.BulkResetTraffic(&a.inboundService, req.Emails)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, gin.H{"affected": affected}, nil)
	a.xrayService.SetToNeedRestart()
	notifyClientsChanged()
}
