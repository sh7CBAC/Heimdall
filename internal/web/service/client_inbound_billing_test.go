package service

import (
	"path/filepath"
	"testing"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/xray"
)

func initAccurateBillingTestDB(t *testing.T) {
	t.Helper()
	if err := database.InitDB(filepath.Join(t.TempDir(), "x-ui.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
}

func seedAccurateBillingClient(t *testing.T, svc *InboundService, email string, multiplier float64) *model.Inbound {
	t.Helper()

	db := database.GetDB()
	ib := &model.Inbound{
		UserId:          1,
		Tag:             "accurate-" + email,
		Enable:          true,
		Port:            45001,
		Protocol:        model.VLESS,
		Settings:        `{"clients":[]}`,
		UsageMultiplier: multiplier,
	}
	if err := db.Create(ib).Error; err != nil {
		t.Fatalf("create inbound: %v", err)
	}

	client := model.Client{
		Email:      email,
		ID:         "11111111-1111-4111-8111-111111111111",
		SubID:      "sub-" + email,
		Enable:     true,
		TotalGB:    10 * 1024 * 1024 * 1024,
		ExpiryTime: 0,
	}

	if err := svc.clientService.SyncInbound(nil, ib.Id, []model.Client{client}); err != nil {
		t.Fatalf("SyncInbound: %v", err)
	}
	if err := svc.AddClientStat(db, ib.Id, &client); err != nil {
		t.Fatalf("AddClientStat: %v", err)
	}
	if err := svc.EnsureClientInboundTrafficMappingsForInbound(ib.Id); err != nil {
		t.Fatalf("EnsureClientInboundTrafficMappingsForInbound: %v", err)
	}

	return ib
}

func TestAccurateClientInboundBillingRuntimeStatEmail(t *testing.T) {
	initAccurateBillingTestDB(t)

	svc := &InboundService{}
	email := "accurate@x"
	ib := seedAccurateBillingClient(t, svc, email, 3)

	statEmail := clientInboundStatEmail(email, ib.Id)
	if statEmail == "" || statEmail == email {
		t.Fatalf("bad stat email: %q", statEmail)
	}

	if _, _, _, err := svc.addTrafficLocked(nil, []*xray.ClientTraffic{{
		Email: statEmail,
		Up:    100,
		Down:  50,
	}}); err != nil {
		t.Fatalf("addTrafficLocked: %v", err)
	}

	db := database.GetDB()

	var rollup xray.ClientTraffic
	if err := db.Model(xray.ClientTraffic{}).Where("email = ?", email).First(&rollup).Error; err != nil {
		t.Fatalf("read rollup: %v", err)
	}
	if rollup.Up != 300 || rollup.Down != 150 {
		t.Fatalf("rollup usage = up:%d down:%d, want up:300 down:150", rollup.Up, rollup.Down)
	}
	if rollup.LastOnline == 0 {
		t.Fatalf("rollup last_online was not bumped")
	}

	var detail model.ClientInboundTraffic
	if err := db.Model(&model.ClientInboundTraffic{}).Where("stat_email = ?", statEmail).First(&detail).Error; err != nil {
		t.Fatalf("read detail: %v", err)
	}
	if detail.Email != email || detail.InboundID != ib.Id {
		t.Fatalf("wrong mapping: %#v", detail)
	}
	if detail.ActualUp != 100 || detail.ActualDown != 50 || detail.BillableUp != 300 || detail.BillableDown != 150 {
		t.Fatalf("detail usage = actual:%d/%d billable:%d/%d, want actual:100/50 billable:300/150",
			detail.ActualUp, detail.ActualDown, detail.BillableUp, detail.BillableDown)
	}
}

func TestAccurateBillingKeepsLegacyEmailFallbackRaw(t *testing.T) {
	initAccurateBillingTestDB(t)

	svc := &InboundService{}
	email := "legacy@x"
	seedAccurateBillingClient(t, svc, email, 3)

	if _, _, _, err := svc.addTrafficLocked(nil, []*xray.ClientTraffic{{
		Email: email,
		Up:    100,
		Down:  50,
	}}); err != nil {
		t.Fatalf("addTrafficLocked legacy: %v", err)
	}

	var rollup xray.ClientTraffic
	if err := database.GetDB().Model(xray.ClientTraffic{}).Where("email = ?", email).First(&rollup).Error; err != nil {
		t.Fatalf("read rollup: %v", err)
	}
	if rollup.Up != 100 || rollup.Down != 50 {
		t.Fatalf("legacy rollup usage = up:%d down:%d, want raw up:100 down:50", rollup.Up, rollup.Down)
	}
}

func TestAccurateBillingBumpLastOnlineResolvesRuntimeEmail(t *testing.T) {
	initAccurateBillingTestDB(t)

	svc := &InboundService{}
	email := "online@x"
	ib := seedAccurateBillingClient(t, svc, email, 2)
	statEmail := clientInboundStatEmail(email, ib.Id)

	if err := svc.BumpClientsLastOnline([]string{statEmail}); err != nil {
		t.Fatalf("BumpClientsLastOnline: %v", err)
	}

	var rollup xray.ClientTraffic
	if err := database.GetDB().Model(xray.ClientTraffic{}).Where("email = ?", email).First(&rollup).Error; err != nil {
		t.Fatalf("read rollup: %v", err)
	}
	if rollup.LastOnline == 0 {
		t.Fatal("rollup last_online not bumped")
	}

	var detail model.ClientInboundTraffic
	if err := database.GetDB().Model(&model.ClientInboundTraffic{}).Where("stat_email = ?", statEmail).First(&detail).Error; err != nil {
		t.Fatalf("read detail: %v", err)
	}
	if detail.LastOnline == 0 {
		t.Fatal("detail last_online not bumped")
	}
}

func TestRuntimeUserMapForInboundTagRewritesStandardInbound(t *testing.T) {
	initAccurateBillingTestDB(t)

	db := database.GetDB()
	svc := &InboundService{}
	ib := &model.Inbound{
		UserId:          1,
		Tag:             "tag-runtime-helper",
		Enable:          true,
		Port:            45003,
		Protocol:        model.VLESS,
		Settings:        `{"clients":[]}`,
		UsageMultiplier: 2,
	}
	if err := db.Create(ib).Error; err != nil {
		t.Fatalf("create inbound: %v", err)
	}

	raw := map[string]any{"email": "helper@x", "id": "11111111-1111-4111-8111-111111111111"}
	got := svc.runtimeUserMapForInboundTag(ib.Tag, raw)
	email, _ := got["email"].(string)

	if email == "helper@x" {
		t.Fatalf("expected runtime stat email, got logical email")
	}
	if want := clientInboundStatEmail("helper@x", ib.Id); email != want {
		t.Fatalf("runtime email = %q, want %q", email, want)
	}
	if raw["email"] != "helper@x" {
		t.Fatalf("input map was mutated: %#v", raw)
	}
}

func TestRuntimeUserMapForInboundTagKeepsWireGuard(t *testing.T) {
	initAccurateBillingTestDB(t)

	db := database.GetDB()
	svc := &InboundService{}
	ib := &model.Inbound{
		UserId:   1,
		Tag:      "tag-runtime-wg",
		Enable:   true,
		Port:     45004,
		Protocol: model.WireGuard,
		Settings: `{"peers":[]}`,
	}
	if err := db.Create(ib).Error; err != nil {
		t.Fatalf("create inbound: %v", err)
	}

	got := svc.runtimeUserMapForInboundTag(ib.Tag, map[string]any{"email": "wg@x"})
	if got["email"] != "wg@x" {
		t.Fatalf("wireguard email must stay logical, got %#v", got["email"])
	}
}
