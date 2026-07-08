package service

import (
	"crypto/sha256"
	"encoding/base32"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const clientInboundStatEmailPrefix = "hmstat"

var clientInboundStatEmailRe = regexp.MustCompile(`^hmstat_([0-9]+)_([a-z2-7]{16})$`)

// clientInboundStatEmail returns the runtime-only Xray stats identity for a
// logical client attached to one inbound.
//
// It intentionally does NOT use the database numeric client id here because
// model.Client carries protocol credentials (ID/UUID/etc.) rather than the
// clients.id primary key. The resolver uses client_inbound_traffics.stat_email,
// so a deterministic privacy-safe hash is enough for runtime attribution.
func clientInboundStatEmail(logicalEmail string, inboundID int) string {
	logicalEmail = strings.ToLower(strings.TrimSpace(logicalEmail))
	if logicalEmail == "" || inboundID <= 0 {
		return ""
	}

	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", inboundID, logicalEmail)))
	encoded := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:]))
	if len(encoded) > 16 {
		encoded = encoded[:16]
	}

	return fmt.Sprintf("%s_%d_%s", clientInboundStatEmailPrefix, inboundID, encoded)
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

func normalizeInboundUsageMultiplier(v float64) float64 {
	if v < 1 {
		return 1
	}
	if v > 10 {
		return 10
	}
	return v
}
