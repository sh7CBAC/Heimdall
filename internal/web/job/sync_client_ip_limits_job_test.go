package job

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestBuildClientIPLimitsJSON(t *testing.T) {
	data, err := buildClientIPLimitsJSON([]clientIPLimitRow{
		{Email: " beta@example.com ", LimitIP: 2},
		{Email: "alpha@example.com", LimitIP: 1},
		{Email: "disabled@example.com", LimitIP: 0},
		{Email: "alpha@example.com", LimitIP: 3},
		{Email: "", LimitIP: 9},
	}, 75)
	if err != nil {
		t.Fatal(err)
	}

	var got clientIPLimitsFile
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, data)
	}

	wantClients := map[string]int{
		"alpha@example.com": 3,
		"beta@example.com":  2,
	}
	if got.Version != 1 {
		t.Fatalf("version = %d, want 1", got.Version)
	}
	if got.ReleaseSeconds != 75 {
		t.Fatalf("releaseSeconds = %d, want 75", got.ReleaseSeconds)
	}
	if !reflect.DeepEqual(got.Clients, wantClients) {
		t.Fatalf("clients = %#v, want %#v", got.Clients, wantClients)
	}
}

func TestBuildClientIPLimitsJSONUsesDefaultReleaseSeconds(t *testing.T) {
	data, err := buildClientIPLimitsJSON(nil, 0)
	if err != nil {
		t.Fatal(err)
	}

	var got clientIPLimitsFile
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.ReleaseSeconds != defaultClientIPLimitReleaseSeconds {
		t.Fatalf("releaseSeconds = %d, want %d", got.ReleaseSeconds, defaultClientIPLimitReleaseSeconds)
	}
	if got.Clients == nil {
		t.Fatal("clients must be encoded as an empty object, not null")
	}
}

func TestWriteFileAtomicallyIfChanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", clientIPLimitsFileName)
	first := []byte("first\n")
	second := []byte("second\n")

	changed, err := writeFileAtomicallyIfChanged(path, first, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("first write must report changed")
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o, want 600", info.Mode().Perm())
	}

	changed, err = writeFileAtomicallyIfChanged(path, first, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("identical data must not rewrite the file")
	}

	changed, err = writeFileAtomicallyIfChanged(path, second, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("different data must report changed")
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(second) {
		t.Fatalf("content = %q, want %q", got, second)
	}
}
