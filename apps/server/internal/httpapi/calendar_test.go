package httpapi

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func TestHTTPCalendarSubscription(t *testing.T) {
	store, _, server := setup(t)
	u, e := store.Register("calendar@example.com", "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Admin("approve", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	_, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": u.Email, "password": "secure-test-password"}, nil)
	headers := map[string]string{"Cookie": cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value, "Origin": server.URL}
	path := "/api/v1/calendar/subscription"
	status, _, _ := call(t, server, "POST", path, nil, nil)
	if status != 401 {
		t.Fatal("unauthenticated management", status)
	}
	status, initial, _ := call(t, server, "GET", path, nil, headers)
	if status != 200 || initial["url"] != "" {
		t.Fatal(initial, status)
	}
	status, _, _ = call(t, server, "POST", path, nil, headers)
	if status != 403 {
		t.Fatal("create without csrf", status)
	}
	headers["X-CSRF-Token"] = login["csrf"].(string)
	status, subscription, _ := call(t, server, "POST", path, nil, headers)
	if status != 200 {
		t.Fatal(subscription, status)
	}
	url := subscription["url"].(string)
	task, e := store.SaveTask(u.ID, core.Task{Title: "Встреча", Date: "2026-10-20", Time: "10:30"}, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	fetch := func(method, url, etag string) (int, http.Header, string) {
		t.Helper()
		r, e := http.NewRequest(method, url, nil)
		if e != nil {
			t.Fatal(e)
		}
		r.Header.Set("If-None-Match", etag)
		res, e := server.Client().Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		body, e := io.ReadAll(res.Body)
		if e != nil {
			t.Fatal(e)
		}
		return res.StatusCode, res.Header, string(body)
	}
	status, responseHeaders, body := fetch("GET", url, "")
	if status != 200 || !strings.HasPrefix(responseHeaders.Get("Content-Type"), "text/calendar") || !strings.Contains(body, "SUMMARY:Встреча") {
		t.Fatal(status, responseHeaders, body)
	}
	etag := responseHeaders.Get("ETag")
	if etag == "" || responseHeaders.Get("Cache-Control") != "private, no-cache" {
		t.Fatal(responseHeaders)
	}
	status, _, body = fetch("GET", url, "W/"+etag)
	if status != 304 || body != "" {
		t.Fatal("conditional request", status, body)
	}
	status, responseHeaders, body = fetch("HEAD", url, "")
	if status != 200 || body != "" || responseHeaders.Get("ETag") != etag {
		t.Fatal("head", status, responseHeaders, body)
	}
	task.Title = "Перенесённая встреча"
	if _, e = store.SaveTask(u.ID, task, "", "manual"); e != nil {
		t.Fatal(e)
	}
	status, responseHeaders, body = fetch("GET", url, etag)
	if status != 200 || responseHeaders.Get("ETag") == etag || !strings.Contains(body, "Перенесённая встреча") {
		t.Fatal("updated feed", status, responseHeaders, body)
	}
	feedPath := strings.TrimPrefix(url, server.URL)
	status, _, _ = call(t, server, "GET", "/api/v1/me", nil, map[string]string{"Authorization": "Bearer " + strings.TrimSuffix(strings.TrimPrefix(feedPath, "/api/v1/calendar/feed/"), ".ics")})
	if status != 401 {
		t.Fatal("calendar capability grants API access", status)
	}
	status, _, _ = call(t, server, "POST", feedPath, nil, nil)
	if status != 401 {
		t.Fatal("calendar feed mutation allowed", status)
	}
	status, subscription, _ = call(t, server, "PUT", path, nil, headers)
	if status != 200 || subscription["url"] == url {
		t.Fatal("rotation", status, subscription)
	}
	status, _, _ = fetch("GET", url, etag)
	if status != 404 {
		t.Fatal("revoked url used with old ETag", status)
	}
	url = subscription["url"].(string)
	status, _, _ = call(t, server, "DELETE", path, nil, headers)
	if status != 200 {
		t.Fatal("disable", status)
	}
	status, _, _ = fetch("GET", url, "")
	if status != 404 {
		t.Fatal("disabled feed accessible", status)
	}
}
