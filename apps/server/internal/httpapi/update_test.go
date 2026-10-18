package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDesktopUpdateBridgeAuthorization(t *testing.T) {
	store, api, server := setup(t)
	api.Personal = true
	api.LauncherToken = "never-expose-native-secret"
	owner, err := store.RegisterOwner("update@example.com", "secure-test-password", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	headers := ownerHeaders(t, server, owner.Email)
	var calls atomic.Int32
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-Avari-Launcher-Token") != api.LauncherToken {
			t.Error("missing native secret")
		}
		if r.URL.Path == "/update/install" {
			w.WriteHeader(409)
			_, _ = w.Write([]byte(`{"error":"Сначала скачайте обновление"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"stage": "available", "availableVersion": "1.4.0"})
	}))
	defer native.Close()
	api.LauncherURL = native.URL
	for _, action := range []string{"check", "download", "snooze"} {
		code, body, _ := call(t, server, "POST", "/api/v1/local/update/"+action, map[string]any{}, headers)
		if code != 200 || body["availableVersion"] != "1.4.0" {
			t.Fatal(action, code, body)
		}
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), api.LauncherToken) {
			t.Fatal("native secret exposed")
		}
	}
	code, _, _ := call(t, server, "POST", "/api/v1/local/update/install", map[string]any{}, headers)
	if code != 409 {
		t.Fatal("lost launcher conflict", code)
	}
	previous := calls.Load()
	code, _, _ = call(t, server, "POST", "/api/v1/local/update/download", map[string]any{"url": "https://evil.example"}, headers)
	if code != 400 {
		t.Fatal("accepted caller-controlled URL", code)
	}
	badCSRF := ownerHeaders(t, server, owner.Email)
	badCSRF["X-CSRF-Token"] = "invalid"
	code, _, _ = call(t, server, "POST", "/api/v1/local/update/install", map[string]any{}, badCSRF)
	if code != 403 {
		t.Fatal("missing CSRF protection", code)
	}
	_, _, token, err := store.Login(owner.Email, "secure-test-password", "extension", "Chrome")
	if err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, server, "POST", "/api/v1/local/update/install", map[string]any{}, map[string]string{"Authorization": "Bearer " + token})
	if code != 403 {
		t.Fatal("extension controlled updater", code)
	}
	code, _, _ = call(t, server, "GET", "/api/v1/local/update", nil, nil)
	if code != 401 {
		t.Fatal("anonymous update status", code)
	}
	if calls.Load() != previous {
		t.Fatal("unauthorized request reached launcher")
	}
	api.Personal = false
	code, _, _ = call(t, server, "GET", "/api/v1/local/update", nil, headers)
	if code != 404 {
		t.Fatal("update exposed in server mode", code)
	}
}

func TestDesktopUpdateRejectsInvalidBridge(t *testing.T) {
	store, api, server := setup(t)
	api.Personal = true
	api.LauncherToken = "secret"
	owner, _ := store.RegisterOwner("update@example.com", "secure-test-password", "UTC")
	headers := ownerHeaders(t, server, owner.Email)
	for _, target := range []string{"https://example.com", "http://localhost:1000", "http://127.0.0.1:1000/other", "http://user@127.0.0.1:1000"} {
		api.LauncherURL = target
		code, _, _ := call(t, server, "GET", "/api/v1/local/update", nil, headers)
		if code != 503 {
			t.Fatal(target, code)
		}
	}
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("not json")) }))
	defer native.Close()
	api.LauncherURL = native.URL
	code, _, _ := call(t, server, "GET", "/api/v1/local/update", nil, headers)
	if code != 503 {
		t.Fatal("invalid launcher response accepted", code)
	}
}
