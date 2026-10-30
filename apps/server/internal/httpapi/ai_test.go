package httpapi

import (
	"testing"
)

func TestAISettingsHTTPAuthorizationAndCSRF(t *testing.T) {
	store, _, server := setup(t)
	status, u, _ := call(t, server, "POST", "/api/v1/auth/register", map[string]string{"email": "ai-http@example.com", "password": "secure-test-password", "timezone": "Europe/Moscow"}, nil)
	if status != 201 {
		t.Fatal(status, u)
	}
	if e := store.Admin("approve", u["id"].(string), ""); e != nil {
		t.Fatal(e)
	}
	status, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": "ai-http@example.com", "password": "secure-test-password"}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	headers := map[string]string{"Cookie": cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value, "Origin": server.URL}
	settings := map[string]string{"provider": "openai", "model": "test-model", "apiKey": "never-return-this-key"}
	status, _, _ = call(t, server, "PUT", "/api/v1/ai/settings", settings, headers)
	if status != 403 {
		t.Fatal("missing CSRF", status)
	}
	headers["X-CSRF-Token"] = login["csrf"].(string)
	status, data, _ := call(t, server, "PUT", "/api/v1/ai/settings", settings, headers)
	if status != 200 || data["hasKey"] != true || data["apiKey"] != nil {
		t.Fatal(status, data)
	}
	status, data, _ = call(t, server, "GET", "/api/v1/ai/settings", nil, headers)
	if status != 200 || data["apiKey"] != nil {
		t.Fatal(status, data)
	}
	status, data, _ = call(t, server, "POST", "/api/v1/ai/jobs", map[string]string{"kind": "extract", "targetId": "other-account-app"}, headers)
	if status != 404 {
		t.Fatal("foreign vacancy", status, data)
	}
	status, data, _ = call(t, server, "PUT", "/api/v1/ai/profiles", map[string]any{"title": "Direction", "applicationIds": []string{"other-account-app"}}, headers)
	if status != 404 {
		t.Fatal("foreign selection", status, data)
	}
	status, _, _ = call(t, server, "GET", "/api/v1/ai/settings", nil, nil)
	if status != 401 {
		t.Fatal("anonymous settings", status)
	}
}
