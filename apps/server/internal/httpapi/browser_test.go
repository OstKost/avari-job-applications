package httpapi

import (
	"github.com/OstKost/avari-job-applications/apps/server/assets"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"io/fs"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Browser fixtures live only in a test binary; production has no approval backdoor.
func TestBrowser(t *testing.T) {
	if os.Getenv("AVARI_E2E") != "1" {
		t.Skip("run with AVARI_E2E=1")
	}
	store, e := core.Open(filepath.Join(t.TempDir(), "avari.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	for _, email := range []string{"browser@example.com", "extension@example.com"} {
		u, e := store.Register(email, "browser-test-password", "Europe/Moscow")
		if e != nil {
			t.Fatal(e)
		}
		if e = store.Admin("approve", u.ID, ""); e != nil {
			t.Fatal(e)
		}
	}
	web, e := fs.Sub(assets.Files, "dist")
	if e != nil {
		t.Fatal(e)
	}
	api := &Server{Store: store, Assets: web}
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	api.Origin = server.URL
	root, e := filepath.Abs("../../../..")
	if e != nil {
		t.Fatal(e)
	}
	localStore, e := core.Open(filepath.Join(t.TempDir(), "personal.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer localStore.Close()
	localAPI := &Server{Store: localStore, Assets: web, Personal: true, SetupToken: "browser-setup-secret"}
	localServer := httptest.NewServer(localAPI.Handler())
	defer localServer.Close()
	localAPI.Origin = localServer.URL
	cmd := exec.Command("npx", "playwright", "test")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "AVARI_TEST_URL="+server.URL, "AVARI_LOCAL_TEST_URL="+localServer.URL)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if e = cmd.Run(); e != nil {
		t.Fatal(e)
	}
}
