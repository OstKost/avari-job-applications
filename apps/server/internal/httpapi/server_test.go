package httpapi

import (
	"bytes"
	"encoding/json"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func setup(t *testing.T) (*core.Store, *Server, *httptest.Server) {
	t.Helper()
	store, e := core.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	api := &Server{Store: store}
	server := httptest.NewServer(api.Handler())
	api.Origin = server.URL
	t.Cleanup(func() { server.Close(); store.Close() })
	return store, api, server
}
func call(t *testing.T, server *httptest.Server, method, path string, body any, headers map[string]string) (int, map[string]any, []*http.Cookie) {
	t.Helper()
	raw, _ := json.Marshal(body)
	r, e := http.NewRequest(method, server.URL+path, bytes.NewReader(raw))
	if e != nil {
		t.Fatal(e)
	}
	r.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	res, e := server.Client().Do(r)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	payload, _ := io.ReadAll(res.Body)
	var data map[string]any
	_ = json.Unmarshal(payload, &data)
	return res.StatusCode, data, res.Cookies()
}
func TestHTTPAuthCSRFAndIsolation(t *testing.T) {
	store, _, server := setup(t)
	status, u, _ := call(t, server, "POST", "/api/v1/auth/register", map[string]string{"email": "user@example.com", "password": "secure-test-password", "timezone": "Europe/Moscow"}, nil)
	if status != 201 {
		t.Fatal(status, u)
	}
	id := u["id"].(string)
	status, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": "user@example.com", "password": "secure-test-password"}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	headers := map[string]string{"Cookie": cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value, "Origin": server.URL}
	status, _, _ = call(t, server, "GET", "/api/v1/applications", nil, headers)
	if status != 403 {
		t.Fatal("pending access", status)
	}
	if e := store.Admin("approve", id, ""); e != nil {
		t.Fatal(e)
	}
	body := map[string]any{"company": "Компания", "position": "Go", "stage": "saved", "state": "active", "savedDate": "2026-10-09", "salary": map[string]any{"min": nil, "max": nil, "currency": "RUB", "period": "month", "tax": ""}}
	status, _, _ = call(t, server, "POST", "/api/v1/applications", body, headers)
	if status != 403 {
		t.Fatal("missing csrf", status)
	}
	headers["X-CSRF-Token"] = login["csrf"].(string)
	status, a, _ := call(t, server, "POST", "/api/v1/applications", body, headers)
	if status != 200 {
		t.Fatal(status, a)
	}
	// The detail page sends the full application when editing tags or vacancy fields.
	a["tags"] = []string{"React", "Гибрид"}
	a["position"] = "Senior Go"
	status, updated, _ := call(t, server, "PUT", "/api/v1/applications/"+a["id"].(string), a, headers)
	if status != 200 {
		t.Fatal("save vacancy with tags", status, updated)
	}
	if updated["position"] != "Senior Go" || len(updated["tags"].([]any)) != 2 {
		t.Fatal("vacancy fields or tags were not saved", updated)
	}
	status, detail, _ := call(t, server, "GET", "/api/v1/applications/"+a["id"].(string), nil, headers)
	if status != 200 {
		t.Fatal("read updated vacancy", status, detail)
	}
	persisted := detail["application"].(map[string]any)
	if persisted["position"] != "Senior Go" || len(persisted["tags"].([]any)) != 2 {
		t.Fatal("vacancy update was not persisted", persisted)
	}
	headers["Origin"] = "https://evil.example"
	status, _, _ = call(t, server, "POST", "/api/v1/applications", body, headers)
	if status != 403 {
		t.Fatal("cross-origin write", status)
	}
	headers["Origin"] = server.URL
	status, _, _ = call(t, server, "POST", "/api/v1/observations", map[string]string{"hhId": "123", "status": "rejected", "url": "https://hh.ru/applicant/negotiations"}, headers)
	if status != 403 {
		t.Fatal("web observation", status)
	}
	status, ext, _ := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": "user@example.com", "password": "secure-test-password", "kind": "extension"}, nil)
	if status != 200 {
		t.Fatal(status, ext)
	}
	extensionHeaders := map[string]string{"Authorization": "Bearer " + ext["token"].(string), "Origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	status, _, _ = call(t, server, "GET", "/api/v1/applications", nil, extensionHeaders)
	if status != 200 {
		t.Fatal("extension read", status)
	}
	u2, e := store.Register("other@example.com", "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	_ = store.Admin("approve", u2.ID, "")
	_, _, token, e := store.Login(u2.Email, "secure-test-password", "extension", "")
	if e != nil {
		t.Fatal(e)
	}
	status, _, _ = call(t, server, "GET", "/api/v1/applications/"+a["id"].(string), nil, map[string]string{"Authorization": "Bearer " + token})
	if status != 404 {
		t.Fatal("cross-user leak", status)
	}
	if e = store.Admin("block", id, ""); e != nil {
		t.Fatal(e)
	}
	status, _, _ = call(t, server, "GET", "/api/v1/me", nil, extensionHeaders)
	if status != 401 {
		t.Fatal("blocked session", status)
	}
}
func TestHTTPValidationAndRateLimit(t *testing.T) {
	_, _, server := setup(t)
	status, _, _ := call(t, server, "POST", "/api/v1/auth/register", map[string]string{"email": "bad", "password": "short", "timezone": "UTC"}, nil)
	if status != 400 {
		t.Fatal(status)
	}
	status, _, _ = call(t, server, "OPTIONS", "/api/v1/me", nil, map[string]string{"Origin": "https://evil.example"})
	if status != 403 {
		t.Fatal(status)
	}
	for i := 0; i < 16; i++ {
		status, _, _ = call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": "unknown", "password": "x"}, nil)
	}
	if status != 429 {
		t.Fatal("rate limit", status)
	}
}

func TestHTTPPasswordChangeAndRecovery(t *testing.T) {
	store, _, server := setup(t)
	status, u, _ := call(t, server, "POST", "/api/v1/auth/register", map[string]string{"email": "pwd@example.com", "password": "password-12345", "timezone": "Europe/Moscow"}, nil)
	if status != 201 {
		t.Fatal(status, u)
	}
	id := u["id"].(string)
	if e := store.Admin("approve", id, ""); e != nil {
		t.Fatal(e)
	}

	status, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": "pwd@example.com", "password": "password-12345"}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	csrf := login["csrf"].(string)
	headers := map[string]string{
		"Cookie":       cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value,
		"Origin":       server.URL,
		"X-CSRF-Token": csrf,
	}

	// 1. Password change via authenticated API
	// Wrong current password
	status, res, _ := call(t, server, "POST", "/api/v1/auth/password", map[string]string{"currentPassword": "wrong-password", "newPassword": "new-password-123"}, headers)
	if status != 400 {
		t.Fatalf("expected 400 for wrong password, got %d: %v", status, res)
	}

	// Successful password change
	status, res, _ = call(t, server, "POST", "/api/v1/auth/password", map[string]string{"currentPassword": "password-12345", "newPassword": "new-password-123"}, headers)
	if status != 200 {
		t.Fatalf("expected 200, got %d: %v", status, res)
	}

	// 2. Password recovery request via public API
	status, res, _ = call(t, server, "POST", "/api/v1/auth/recovery", map[string]string{"email": "pwd@example.com", "password": "admin-recovery-pass"}, nil)
	if status != 200 {
		t.Fatalf("expected 200 for recovery request, got %d: %v", status, res)
	}

	resets, e := store.PendingPasswordResets()
	if e != nil || len(resets) != 1 {
		t.Fatalf("expected 1 pending reset, got: %v", resets)
	}

	// Approve in store
	if e := store.ApprovePasswordReset(resets[0].ID); e != nil {
		t.Fatal(e)
	}

	// Can login with recovered password
	status, _, _ = call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": "pwd@example.com", "password": "admin-recovery-pass"}, nil)
	if status != 200 {
		t.Fatal("failed to login with approved reset password")
	}
}
