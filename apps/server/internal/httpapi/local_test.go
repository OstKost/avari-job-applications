package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func ownerHeaders(t *testing.T, server *httptest.Server, email string) map[string]string {
	t.Helper()
	code, body, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": email, "password": "secure-test-password"}, nil)
	if code != 200 {
		t.Fatal(code, body)
	}
	parts := []string{}
	for _, cookie := range cookies {
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	return map[string]string{"Cookie": strings.Join(parts, "; "), "X-CSRF-Token": body["csrf"].(string), "Origin": server.URL}
}
func TestPersonalSetupSecretHostAndRegistration(t *testing.T) {
	store, api, server := setup(t)
	api.Personal = true
	api.SetupToken = "private-one-time-token"
	body := map[string]string{"email": "owner@example.com", "password": "secure-test-password", "timezone": "UTC", "token": "wrong"}
	code, _, _ := call(t, server, "POST", "/api/v1/local/setup", body, nil)
	if code != 403 {
		t.Fatal("setup without capability", code)
	}
	code, _, _ = call(t, server, "POST", "/api/v1/auth/register", body, nil)
	if code != 403 {
		t.Fatal("registration exposed", code)
	}
	body["token"] = api.SetupToken
	code, result, _ := call(t, server, "POST", "/api/v1/local/setup", body, map[string]string{"Origin": "https://evil.example"})
	if code != 403 {
		t.Fatal("cross-origin setup", code)
	}
	code, result, _ = call(t, server, "POST", "/api/v1/local/setup", body, nil)
	if code != 201 || result["status"] != "active" {
		t.Fatal(code, result)
	}
	code, _, _ = call(t, server, "POST", "/api/v1/local/setup", body, nil)
	if code != 409 {
		t.Fatal("second owner", code)
	}
	users, _ := store.Users()
	if len(users) != 1 {
		t.Fatal(users)
	}
	request, _ := http.NewRequest("GET", server.URL+"/api/v1/local/status", nil)
	request.Host = "evil.example"
	res, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("DNS rebinding", res.StatusCode)
	}
}
func TestJournalHTTPAuthCSRFIsolationAndPreview(t *testing.T) {
	store, _, server := setup(t)
	first, err := store.Register("first@example.com", "secure-test-password", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	_ = store.Admin("approve", first.ID, "")
	other, _ := store.Register("other@example.com", "secure-test-password", "UTC")
	_ = store.Admin("approve", other.ID, "")
	if _, err = store.SaveApplication(first.ID, core.Application{Company: "Source", Position: "Developer"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	code, _, _ := call(t, server, "GET", "/api/v1/journal/export", nil, nil)
	if code != 401 {
		t.Fatal("anonymous export", code)
	}
	headers := ownerHeaders(t, server, "first@example.com")
	code, data, _ := call(t, server, "GET", "/api/v1/journal/export", nil, headers)
	if code != 200 {
		t.Fatal(code, data)
	}
	raw, _ := json.Marshal(data)
	var journal core.Journal
	if err = json.Unmarshal(raw, &journal); err != nil {
		t.Fatal(err)
	}
	if len(journal.Applications) != 1 {
		t.Fatal(journal)
	}
	target := ownerHeaders(t, server, "other@example.com")
	req := core.ImportRequest{Journal: journal}
	target["X-CSRF-Token"] = "wrong"
	code, _, _ = call(t, server, "POST", "/api/v1/journal/import/preview", req, target)
	if code != 403 {
		t.Fatal("import CSRF", code)
	}
	target = ownerHeaders(t, server, "other@example.com")
	code, preview, _ := call(t, server, "POST", "/api/v1/journal/import/preview", req, target)
	if code != 200 || preview["ready"] != true {
		t.Fatal(code, preview)
	}
	req.Revision = preview["revision"].(string)
	code, _, _ = call(t, server, "POST", "/api/v1/journal/import", req, target)
	if code != 200 {
		t.Fatal(code)
	}
	sourceApps, _ := store.Applications(first.ID)
	targetApps, _ := store.Applications(other.ID)
	if len(sourceApps) != 1 || len(targetApps) != 1 || sourceApps[0].ID == targetApps[0].ID {
		t.Fatal("import crossed account ownership")
	}
}
func TestLocalSettingsProtectedNativeBridge(t *testing.T) {
	store, api, server := setup(t)
	api.Personal = true
	api.LauncherToken = "native-only-secret"
	var autostart bool
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Avari-Launcher-Token") != api.LauncherToken {
			t.Error("native secret not supplied")
			w.WriteHeader(403)
			return
		}
		if r.Method == "PUT" {
			var b struct {
				Autostart bool `json:"autostart"`
			}
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				t.Error(err)
			}
			autostart = b.Autostart
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"autostart": autostart})
	}))
	defer native.Close()
	api.LauncherURL = native.URL
	u, err := store.RegisterOwner("owner@example.com", "secure-test-password", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	headers := ownerHeaders(t, server, u.Email)
	code, result, _ := call(t, server, "PUT", "/api/v1/local/settings", map[string]bool{"autostart": true}, headers)
	if code != 200 || result["autostart"] != true {
		t.Fatal(code, result)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), api.LauncherToken) {
		t.Fatal("native secret leaked")
	}
	_, _, token, err := store.Login(u.Email, "secure-test-password", "extension", "Chrome")
	if err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, server, "PUT", "/api/v1/local/settings", map[string]bool{"autostart": false}, map[string]string{"Authorization": "Bearer " + token})
	if code != 403 || !autostart {
		t.Fatal("extension changed OS setting", code)
	}
	api.Personal = false
	code, _, _ = call(t, server, "GET", "/api/v1/local/settings", nil, headers)
	if code != 404 {
		t.Fatal("native settings exposed in server mode", code)
	}
	// Public mode discovery never includes native credentials.
	res, err := server.Client().Get(server.URL + "/api/v1/local/status")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	payload, _ := io.ReadAll(res.Body)
	if strings.Contains(string(payload), api.LauncherToken) {
		t.Fatal("native secret in status")
	}
}
