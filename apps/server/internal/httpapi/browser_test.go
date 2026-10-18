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
	"time"
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
	for _, email := range []string{"browser@example.com", "extension@example.com", "features@example.com", "statistics@example.com"} {
		u, e := store.Register(email, "browser-test-password", "Europe/Moscow")
		if e != nil {
			t.Fatal(e)
		}
		if e = store.Admin("approve", u.ID, ""); e != nil {
			t.Fatal(e)
		}
		if email == "features@example.com" {
			// Seed two special apps ONLY for that account:
			// 1. Old active stale > 240h
			staleApp, err := store.SaveApplication(u.ID, core.Application{
				Company:  "Stale Corp 250h",
				Position: "Senior Stale Engineer",
				Stage:    "saved",
				State:    "active",
			}, "", "manual")
			if err != nil {
				t.Fatal(err)
			}
			staleTime := time.Now().UTC().Add(-250 * time.Hour).Truncate(time.Second)
			staleStr := staleTime.Format("2006-01-02T15:04:05.000000000Z07:00")
			if _, err := store.DB.Exec("UPDATE documents SET payload = json_set(payload, '$.createdAt', ?) WHERE id=?", staleStr, staleApp.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := store.DB.Exec("UPDATE documents SET payload = json_set(payload, '$.createdAt', ?) WHERE kind='event' AND json_extract(payload, '$.applicationId')=? AND json_extract(payload, '$.kind')='created'", staleStr, staleApp.ID); err != nil {
				t.Fatal(err)
			}

			// This record represents a historical application predating reminder rollout.
			if _, err := store.DB.Exec("DELETE FROM reminder_eligibility WHERE application_id=?", staleApp.ID); err != nil {
				t.Fatal(err)
			}

			// 2. Saved eligible 49h-no-action (eligible for automatic task)
			eligibleApp, err := store.SaveApplication(u.ID, core.Application{
				Company:  "Auto Reminder Inc 49h",
				Position: "Frontend Lead",
				Stage:    "saved",
				State:    "active",
			}, "", "manual")
			if err != nil {
				t.Fatal(err)
			}
			eligibleTime := time.Now().UTC().Add(-49 * time.Hour).Truncate(time.Second)
			eligibleStr := eligibleTime.Format("2006-01-02T15:04:05.000000000Z07:00")
			if _, err := store.DB.Exec("UPDATE documents SET payload = json_set(payload, '$.createdAt', ?) WHERE id=?", eligibleStr, eligibleApp.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := store.DB.Exec("UPDATE documents SET payload = json_set(payload, '$.createdAt', ?) WHERE kind='event' AND json_extract(payload, '$.applicationId')=? AND json_extract(payload, '$.kind')='created'", eligibleStr, eligibleApp.ID); err != nil {
				t.Fatal(err)
			}
			// Update reminder_eligibility created_at as well
			if _, err := store.DB.Exec("UPDATE reminder_eligibility SET created_at=? WHERE application_id=?", eligibleStr, eligibleApp.ID); err != nil {
				t.Fatal(err)
			}

			// Reconcile Store once before serving for automatic task
			if err := store.ReconcileReminders(t.Context(), time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
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
