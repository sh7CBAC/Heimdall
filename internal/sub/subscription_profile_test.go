package sub

import "testing"

func TestExpandSubscriptionEndpoints_DefaultWhenProfilesAbsent(t *testing.T) {
	base := map[string]any{
		"network":  "tcp",
		"security": "none",
		"tcpSettings": map[string]any{
			"header": map[string]any{"type": "none"},
		},
	}

	endpoints := expandSubscriptionEndpoints(base, "node.example.com", 443)
	if len(endpoints) != 1 {
		t.Fatalf("len(endpoints) = %d, want 1", len(endpoints))
	}
	if endpoints[0].Address != "node.example.com" || endpoints[0].Port != 443 {
		t.Fatalf("unexpected default endpoint: %#v", endpoints[0])
	}
	if _, leaked := endpoints[0].Stream["externalProxy"]; leaked {
		t.Fatal("externalProxy must not leak into the effective client stream")
	}
}

func TestExpandSubscriptionEndpoints_BlankAddressInheritsResolvedDefault(t *testing.T) {
	base := map[string]any{
		"network":  "tcp",
		"security": "none",
		"tcpSettings": map[string]any{
			"header": map[string]any{"type": "none"},
		},
		"externalProxy": []any{
			map[string]any{
				"enabled": true,
				"remark":  "empty",
				"dest":    "",
				"port":    float64(443),
			},
			map[string]any{
				"enabled": true,
				"remark":  "whitespace",
				"dest":    "   ",
				"port":    float64(8443),
			},
			map[string]any{
				"enabled": true,
				"remark":  "override",
				"dest":    "cdn.example.com",
				"port":    float64(9443),
			},
		},
	}

	endpoints := expandSubscriptionEndpoints(base, "resolved-node.example.com", 27543)
	if len(endpoints) != 3 {
		t.Fatalf("len(endpoints) = %d, want 3", len(endpoints))
	}

	wantAddresses := []string{
		"resolved-node.example.com",
		"resolved-node.example.com",
		"cdn.example.com",
	}
	for i, want := range wantAddresses {
		if endpoints[i].Address != want {
			t.Errorf("endpoints[%d].Address = %q, want %q", i, endpoints[i].Address, want)
		}
	}
}

func TestResolveExternalProxyDefaults_InheritsWithoutMutatingSource(t *testing.T) {
	original := map[string]any{
		"dest":     "   ",
		"port":     float64(0),
		"remark":   "inherit",
		"forceTls": "same",
	}
	override := map[string]any{
		"dest":     "  cdn.example.com  ",
		"port":     float64(8443),
		"remark":   "override",
		"forceTls": "same",
	}

	resolved := resolveExternalProxyDefaults(
		[]any{original, override},
		"node7.example.com",
		443,
	)
	if len(resolved) != 2 {
		t.Fatalf("len(resolved) = %d, want 2", len(resolved))
	}

	inherited := resolved[0].(map[string]any)
	explicit := resolved[1].(map[string]any)

	if inherited["dest"] != "node7.example.com" || inherited["port"] != float64(443) {
		t.Fatalf("inherited endpoint = %#v", inherited)
	}
	if explicit["dest"] != "cdn.example.com" || explicit["port"] != float64(8443) {
		t.Fatalf("explicit endpoint = %#v", explicit)
	}

	if original["dest"] != "   " || original["port"] != float64(0) {
		t.Fatalf("source profile was mutated: %#v", original)
	}
	inherited["remark"] = "changed"
	if original["remark"] != "inherit" {
		t.Fatalf("resolved profile aliases source map: %#v", original)
	}
}

func TestExpandSubscriptionEndpoints_FiltersDisabledAndOverridesStream(t *testing.T) {
	base := map[string]any{
		"network":  "tcp",
		"security": "none",
		"tcpSettings": map[string]any{
			"header": map[string]any{"type": "none"},
		},
		"externalProxy": []any{
			map[string]any{
				"enabled": false,
				"remark":  "disabled",
				"dest":    "disabled.example.com",
				"port":    float64(443),
			},
			map[string]any{
				"enabled":  true,
				"remark":   "ws-tls",
				"dest":     "cdn.example.com",
				"port":     float64(8443),
				"network":  "ws",
				"security": "tls",
				"wsSettings": map[string]any{
					"path":            "/secx",
					"host":            "origin.example.com",
					"headers":         map[string]any{},
					"heartbeatPeriod": float64(0),
				},
				"tlsSettings": map[string]any{
					"serverName": "sni.example.com",
					"alpn":       []any{"h2"},
					"settings": map[string]any{
						"fingerprint":   "chrome",
						"allowInsecure": true,
					},
				},
			},
		},
	}

	endpoints := expandSubscriptionEndpoints(base, "node.example.com", 27543)
	if len(endpoints) != 1 {
		t.Fatalf("len(endpoints) = %d, want 1 active profile", len(endpoints))
	}
	endpoint := endpoints[0]
	if endpoint.Address != "cdn.example.com" || endpoint.Port != 8443 || endpoint.Remark != "ws-tls" {
		t.Fatalf("unexpected endpoint: %#v", endpoint)
	}
	if endpoint.Stream["network"] != "ws" || endpoint.Stream["security"] != "tls" {
		t.Fatalf("effective stream did not apply network/security: %#v", endpoint.Stream)
	}
	if _, stillPresent := endpoint.Stream["tcpSettings"]; stillPresent {
		t.Fatal("old transport settings must be removed when network changes")
	}
	ws, _ := endpoint.Stream["wsSettings"].(map[string]any)
	if ws["path"] != "/secx" || ws["host"] != "origin.example.com" {
		t.Fatalf("unexpected ws settings: %#v", ws)
	}
	tlsSettings, _ := endpoint.Stream["tlsSettings"].(map[string]any)
	if tlsSettings["serverName"] != "sni.example.com" {
		t.Fatalf("unexpected TLS settings: %#v", tlsSettings)
	}
}

func TestExpandSubscriptionEndpoints_AllDisabledMeansNoConfiguration(t *testing.T) {
	base := map[string]any{
		"network":  "tcp",
		"security": "none",
		"tcpSettings": map[string]any{
			"header": map[string]any{"type": "none"},
		},
		"externalProxy": []any{
			map[string]any{"enabled": false, "dest": "one.example.com", "port": float64(443)},
			map[string]any{"enabled": false, "dest": "two.example.com", "port": float64(8443)},
		},
	}

	if endpoints := expandSubscriptionEndpoints(base, "node.example.com", 443); len(endpoints) != 0 {
		t.Fatalf("len(endpoints) = %d, want 0", len(endpoints))
	}
}

func TestExpandSubscriptionEndpoints_LegacyTLSFieldsRemainCompatible(t *testing.T) {
	base := map[string]any{
		"network":  "tcp",
		"security": "none",
		"tcpSettings": map[string]any{
			"header": map[string]any{"type": "none"},
		},
		"externalProxy": []any{
			map[string]any{
				"forceTls":    "tls",
				"dest":        "legacy.example.com",
				"port":        float64(443),
				"remark":      "legacy",
				"sni":         "sni.example.com",
				"fingerprint": "firefox",
				"alpn":        []any{"h2", "http/1.1"},
			},
		},
	}

	endpoints := expandSubscriptionEndpoints(base, "node.example.com", 27543)
	if len(endpoints) != 1 {
		t.Fatalf("len(endpoints) = %d, want 1", len(endpoints))
	}
	stream := endpoints[0].Stream
	if stream["security"] != "tls" {
		t.Fatalf("security = %v, want tls", stream["security"])
	}
	tlsSettings, _ := stream["tlsSettings"].(map[string]any)
	if tlsSettings["serverName"] != "sni.example.com" {
		t.Fatalf("serverName = %v, want sni.example.com", tlsSettings["serverName"])
	}
	clientSettings, _ := tlsSettings["settings"].(map[string]any)
	if clientSettings["fingerprint"] != "firefox" {
		t.Fatalf("fingerprint = %v, want firefox", clientSettings["fingerprint"])
	}
}

func TestExpandSubscriptionEndpoints_CarriesPerProfileMuxOverride(t *testing.T) {
	base := map[string]any{
		"network":  "tcp",
		"security": "none",
		"tcpSettings": map[string]any{
			"header": map[string]any{"type": "none"},
		},
		"externalProxy": []any{
			map[string]any{
				"enabled": true,
				"dest":    "mux.example.com",
				"port":    float64(443),
				"mux": map[string]any{
					"enabled":         true,
					"concurrency":     float64(4),
					"xudpConcurrency": float64(8),
					"xudpProxyUDP443": "allow",
				},
			},
		},
	}

	endpoints := expandSubscriptionEndpoints(base, "node.example.com", 27543)
	if len(endpoints) != 1 || !endpoints[0].HasMuxOverride {
		t.Fatalf("unexpected endpoints/mux override: %#v", endpoints)
	}
	mux, ok := endpoints[0].MuxOverride.(map[string]any)
	if !ok || mux["enabled"] != true || mux["concurrency"] != float64(4) {
		t.Fatalf("unexpected mux override: %#v", endpoints[0].MuxOverride)
	}
}

func TestExpandSubscriptionEndpoints_TwoInboundsWithThreeProfilesProduceSixConfigurations(t *testing.T) {
	makeStream := func(prefix string) map[string]any {
		profiles := make([]any, 0, 3)
		for i := 1; i <= 3; i++ {
			profiles = append(profiles, map[string]any{
				"enabled": true,
				"remark":  prefix + string(rune('0'+i)),
				"dest":    prefix + string(rune('0'+i)) + ".example.com",
				"port":    float64(443),
			})
		}
		return map[string]any{
			"network":       "tcp",
			"security":      "none",
			"tcpSettings":   map[string]any{"header": map[string]any{"type": "none"}},
			"externalProxy": profiles,
		}
	}

	total := 0
	for _, stream := range []map[string]any{makeStream("a"), makeStream("b")} {
		total += len(expandSubscriptionEndpoints(stream, "node.example.com", 27543))
	}
	if total != 6 {
		t.Fatalf("total configurations = %d, want exactly 6", total)
	}
}
