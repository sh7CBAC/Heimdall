package sub

import (
	"encoding/json"
	"math"
	"strings"
)

// subscriptionEndpoint is the client-facing endpoint produced from one
// streamSettings.externalProxy entry. The name is kept for wire compatibility,
// but SECX treats each entry as a complete subscription profile: address/port
// plus optional transport, security and client-side stream overrides.
type subscriptionEndpoint struct {
	Address        string
	Port           int
	Remark         string
	Stream         map[string]any
	MuxOverride    any
	HasMuxOverride bool
}

var subscriptionTransportKeys = []string{
	"tcpSettings",
	"kcpSettings",
	"wsSettings",
	"grpcSettings",
	"httpupgradeSettings",
	"xhttpSettings",
	"hysteriaSettings",
}

// expandSubscriptionEndpoints returns exactly one default endpoint when no
// profile list is configured. Once a profile list exists, only enabled entries
// are returned. Therefore an explicitly configured list with every profile
// disabled intentionally contributes zero subscription configurations.
func expandSubscriptionEndpoints(baseStream map[string]any, defaultAddress string, defaultPort int) []subscriptionEndpoint {
	raw, exists := baseStream["externalProxy"]
	profiles, ok := raw.([]any)
	if !exists || !ok || len(profiles) == 0 {
		return []subscriptionEndpoint{{
			Address: defaultAddress,
			Port:    defaultPort,
			Stream:  cloneJSONMapWithoutExternalProxy(baseStream),
		}}
	}

	out := make([]subscriptionEndpoint, 0, len(profiles))
	for _, rawProfile := range profiles {
		profile, ok := rawProfile.(map[string]any)
		if !ok || profile == nil {
			continue
		}
		if enabled, present := profile["enabled"].(bool); present && !enabled {
			continue
		}

		address := strings.TrimSpace(stringValue(profile["dest"]))
		if address == "" {
			address = defaultAddress
		}
		port := intValue(profile["port"])
		if port < 1 || port > 65535 {
			port = defaultPort
		}

		endpoint := subscriptionEndpoint{
			Address: address,
			Port:    port,
			Remark:  stringValue(profile["remark"]),
			Stream:  effectiveSubscriptionProfileStream(baseStream, profile),
		}
		if mux, exists := profile["mux"]; exists {
			endpoint.HasMuxOverride = true
			endpoint.MuxOverride = deepCloneJSON(mux)
		}
		out = append(out, endpoint)
	}
	return out
}

func effectiveSubscriptionProfileStream(baseStream, profile map[string]any) map[string]any {
	stream := cloneJSONMapWithoutExternalProxy(baseStream)

	applyProfileTransport(stream, profile)
	applyProfileSecurity(stream, profile)

	if finalMask, ok := profile["finalmask"].(map[string]any); ok {
		stream["finalmask"] = deepCloneJSON(finalMask)
	}
	return stream
}

func applyProfileTransport(stream, profile map[string]any) {
	baseNetwork := stringValue(stream["network"])
	profileNetwork := strings.ToLower(strings.TrimSpace(stringValue(profile["network"])))
	if profileNetwork == "" || profileNetwork == "same" {
		profileNetwork = baseNetwork
	}
	if profileNetwork == "" {
		return
	}

	settingsKey := transportSettingsKey(profileNetwork)
	if settingsKey == "" {
		return
	}

	if profileNetwork != baseNetwork {
		for _, key := range subscriptionTransportKeys {
			delete(stream, key)
		}
		stream["network"] = profileNetwork
		stream[settingsKey] = defaultTransportSettings(profileNetwork)
	}

	if settings, ok := profile[settingsKey].(map[string]any); ok {
		stream[settingsKey] = deepCloneJSON(settings)
	} else if _, ok := stream[settingsKey].(map[string]any); !ok {
		stream[settingsKey] = defaultTransportSettings(profileNetwork)
	}
}

func applyProfileSecurity(stream, profile map[string]any) {
	security := strings.ToLower(strings.TrimSpace(stringValue(profile["security"])))
	if security == "" || security == "same" {
		// Backward compatibility with the original externalProxy.forceTls field.
		security = strings.ToLower(strings.TrimSpace(stringValue(profile["forceTls"])))
	}
	if security == "" || security == "same" {
		security = strings.ToLower(strings.TrimSpace(stringValue(stream["security"])))
	}
	if security == "" {
		security = "none"
	}

	switch security {
	case "none":
		stream["security"] = "none"
		delete(stream, "tlsSettings")
		delete(stream, "realitySettings")
	case "tls":
		stream["security"] = "tls"
		delete(stream, "realitySettings")
		if settings, ok := profile["tlsSettings"].(map[string]any); ok {
			stream["tlsSettings"] = deepCloneJSON(settings)
		} else if _, ok := stream["tlsSettings"].(map[string]any); !ok {
			stream["tlsSettings"] = defaultProfileTLSSettings()
		}
		applyLegacyExternalProxyTLSFields(profile, stream)
	case "reality":
		stream["security"] = "reality"
		delete(stream, "tlsSettings")
		if settings, ok := profile["realitySettings"].(map[string]any); ok {
			stream["realitySettings"] = deepCloneJSON(settings)
		} else if _, ok := stream["realitySettings"].(map[string]any); !ok {
			stream["realitySettings"] = defaultProfileRealitySettings()
		}
	default:
		// Unknown profile values must never corrupt the parent stream.
		return
	}
}

func applyLegacyExternalProxyTLSFields(profile, stream map[string]any) {
	tlsSettings, _ := stream["tlsSettings"].(map[string]any)
	if tlsSettings == nil {
		tlsSettings = defaultProfileTLSSettings()
		stream["tlsSettings"] = tlsSettings
	}

	if sni := strings.TrimSpace(stringValue(profile["sni"])); sni != "" {
		tlsSettings["serverName"] = sni
	}
	if alpn, ok := stringSliceValue(profile["alpn"]); ok {
		tlsSettings["alpn"] = alpn
	}

	clientSettings, _ := tlsSettings["settings"].(map[string]any)
	if clientSettings == nil {
		clientSettings = map[string]any{}
		tlsSettings["settings"] = clientSettings
	}
	if fp := strings.TrimSpace(stringValue(profile["fingerprint"])); fp != "" {
		clientSettings["fingerprint"] = fp
	}
	if pins, ok := stringSliceValue(profile["pinnedPeerCertSha256"]); ok {
		clientSettings["pinnedPeerCertSha256"] = pins
	}
	if ech := strings.TrimSpace(stringValue(profile["echConfigList"])); ech != "" {
		clientSettings["echConfigList"] = ech
	}
	if allowInsecure, ok := profile["allowInsecure"].(bool); ok {
		clientSettings["allowInsecure"] = allowInsecure
	}
}

func cloneJSONMapWithoutExternalProxy(src map[string]any) map[string]any {
	cloned, _ := deepCloneJSON(src).(map[string]any)
	if cloned == nil {
		cloned = map[string]any{}
	}
	delete(cloned, "externalProxy")
	return cloned
}

func deepCloneJSON(value any) any {
	data, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		return value
	}
	return out
}

func transportSettingsKey(network string) string {
	switch network {
	case "tcp":
		return "tcpSettings"
	case "kcp":
		return "kcpSettings"
	case "ws":
		return "wsSettings"
	case "grpc":
		return "grpcSettings"
	case "httpupgrade":
		return "httpupgradeSettings"
	case "xhttp":
		return "xhttpSettings"
	case "hysteria":
		return "hysteriaSettings"
	default:
		return ""
	}
}

func defaultTransportSettings(network string) map[string]any {
	switch network {
	case "tcp":
		return map[string]any{"acceptProxyProtocol": false, "header": map[string]any{"type": "none"}}
	case "ws":
		return map[string]any{"acceptProxyProtocol": false, "path": "/", "host": "", "headers": map[string]any{}, "heartbeatPeriod": float64(0)}
	case "grpc":
		return map[string]any{"serviceName": "", "authority": "", "multiMode": false}
	case "httpupgrade":
		return map[string]any{"acceptProxyProtocol": false, "path": "/", "host": "", "headers": map[string]any{}}
	case "xhttp":
		return map[string]any{"path": "/", "host": "", "mode": "auto", "headers": map[string]any{}}
	case "kcp":
		return map[string]any{}
	case "hysteria":
		return map[string]any{}
	default:
		return map[string]any{}
	}
}

func defaultProfileTLSSettings() map[string]any {
	return map[string]any{
		"serverName": "",
		"alpn":       []any{},
		"settings": map[string]any{
			"fingerprint":          "chrome",
			"echConfigList":        "",
			"pinnedPeerCertSha256": []any{},
			"allowInsecure":        false,
		},
	}
}

func defaultProfileRealitySettings() map[string]any {
	return map[string]any{
		"serverNames": []any{},
		"shortIds":    []any{},
		"settings": map[string]any{
			"publicKey":     "",
			"fingerprint":   "chrome",
			"serverName":    "",
			"spiderX":       "/",
			"mldsa65Verify": "",
		},
	}
}

func stringValue(value any) string {
	valueString, _ := value.(string)
	return valueString
}

func intValue(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return int(v)
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}

func stringSliceValue(value any) ([]any, bool) {
	switch values := value.(type) {
	case []any:
		out := make([]any, 0, len(values))
		for _, item := range values {
			if itemString, ok := item.(string); ok && strings.TrimSpace(itemString) != "" {
				out = append(out, itemString)
			}
		}
		return out, len(out) > 0
	case []string:
		out := make([]any, 0, len(values))
		for _, item := range values {
			if strings.TrimSpace(item) != "" {
				out = append(out, item)
			}
		}
		return out, len(out) > 0
	default:
		return nil, false
	}
}
