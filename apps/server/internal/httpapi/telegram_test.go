package httpapi

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func telegramCookies(cookies []*http.Cookie) string {
	parts := []string{}
	for _, c := range cookies {
		parts = append(parts, c.Name+"="+c.Value)
	}
	return strings.Join(parts, "; ")
}
func TestTelegramHTTPWebhookBrowserBindingAndOrigin(t *testing.T) {
	store, api, server := setup(t)
	api.TelegramEnabled = true
	api.TelegramSecret = "test-secret"
	api.TelegramUsername = "test_bot"
	status, _, _ := call(t, server, "POST", "/api/v1/telegram/webhook", map[string]any{"update_id": 1}, nil)
	if status != 403 {
		t.Fatal(status)
	}
	for i := 0; i < 2; i++ {
		status, body, _ := call(t, server, "POST", "/api/v1/telegram/webhook", map[string]any{"update_id": 1, "unknown_telegram_field": true}, map[string]string{"X-Telegram-Bot-Api-Secret-Token": "test-secret"})
		if status != 200 {
			t.Fatal(status, body)
		}
	}
	var n int
	if e := store.DB.QueryRow("SELECT count(*) FROM telegram_inbox").Scan(&n); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/auth/telegram/requests", map[string]any{}, nil)
	if status != 403 {
		t.Fatal("missing Origin", status)
	}
	status, result, cookies := call(t, server, "POST", "/api/v1/auth/telegram/requests", map[string]any{}, map[string]string{"Origin": server.URL})
	if status != 201 {
		t.Fatal(status, result)
	}
	challenge := result["challenge"].(map[string]any)
	id := challenge["id"].(string)
	token := strings.Split(result["url"].(string), "?start=")[1]
	headers := map[string]string{"Cookie": telegramCookies(cookies), "Origin": server.URL}
	status, _, _ = call(t, server, "GET", "/api/v1/auth/telegram/requests/"+id, nil, nil)
	if status != 404 {
		t.Fatal("foreign poll", status)
	}
	status, _, pollCookies := call(t, server, "GET", "/api/v1/auth/telegram/requests/"+id, nil, headers)
	if status != 200 || len(pollCookies) > 0 {
		t.Fatal("poll issued session", status, pollCookies)
	}
	u, e := store.Register("http-tg@example.com", "secure-test-password", "UTC")
	if e != nil {
		t.Fatal(e)
	}
	c, tok, _, e := store.NewTelegramChallenge(u.ID, "registration", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.TelegramStart(tok, 100, 100, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	if e = store.TelegramDecide(c.ID, 100, true); e != nil {
		t.Fatal(e)
	}
	if _, e = store.TelegramStart(token, 100, 100, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/auth/telegram/requests/"+id+"/complete", map[string]any{}, headers)
	if status != 409 {
		t.Fatal("login authorized by /start", status)
	}
	if e = store.TelegramDecide(id, 100, true); e != nil {
		t.Fatal(e)
	}
	status, _, sessionCookies := call(t, server, "GET", "/api/v1/auth/telegram/requests/"+id, nil, headers)
	if status != 200 || len(sessionCookies) > 0 {
		t.Fatal("approved poll issued session", status)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/auth/telegram/requests/"+id+"/complete", map[string]any{}, map[string]string{"Origin": server.URL})
	if status != 404 {
		t.Fatal("foreign completion", status)
	}
	status, body, sessionCookies := call(t, server, "POST", "/api/v1/auth/telegram/requests/"+id+"/complete", map[string]any{}, headers)
	if status != 200 {
		t.Fatal(status, body)
	}
	for _, c := range sessionCookies {
		if c.Name == "avari_session" && !c.HttpOnly {
			t.Fatal("session cookie not HttpOnly")
		}
		if c.SameSite != http.SameSiteLaxMode {
			t.Fatal(c)
		}
	}
	status, body, _ = call(t, server, "GET", "/api/v1/me", nil, map[string]string{"Cookie": telegramCookies(sessionCookies)})
	if status != 200 || body["id"] != u.ID {
		t.Fatal(status, body)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/auth/telegram/requests/"+id+"/complete", map[string]any{}, headers)
	if status != 409 {
		t.Fatal("replayed completion", status)
	}
}
func TestTelegramHTTPPendingAndBlockedAccess(t *testing.T) {
	store, api, server := setup(t)
	api.TelegramEnabled = true
	api.TelegramSecret = "secret"
	api.TelegramUsername = "test_bot"
	u, e := store.Register("pending-tg@example.com", "secure-test-password", "UTC")
	if e != nil {
		t.Fatal(e)
	}
	status, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": u.Email, "password": "secure-test-password"}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	headers := map[string]string{"Cookie": telegramCookies(cookies), "Origin": server.URL, "X-CSRF-Token": login["csrf"].(string)}
	status, result, _ := call(t, server, "POST", "/api/v1/telegram/challenges", map[string]string{"purpose": "registration"}, headers)
	if status != 201 {
		t.Fatal(status, result)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/telegram/challenges", map[string]string{"purpose": "link"}, headers)
	if status != 403 {
		t.Fatal(status)
	}
	status, _, _ = call(t, server, "PATCH", "/api/v1/telegram/preferences", map[string]bool{"morning": true, "evening": true}, headers)
	if status != 403 {
		t.Fatal(status)
	}
	// Block without revoking the test cookie to verify middleware status enforcement itself.
	if _, e = store.DB.Exec("UPDATE users SET status='blocked' WHERE id=?", u.ID); e != nil {
		t.Fatal(e)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/telegram/challenges", map[string]string{"purpose": "registration"}, headers)
	if status != 403 {
		t.Fatal(status)
	}
}
func TestTelegramDisabledAndPersonalMode(t *testing.T) {
	_, api, server := setup(t)
	for _, personal := range []bool{false, true} {
		api.Personal = personal
		api.TelegramEnabled = personal
		api.TelegramSecret = "secret"
		api.TelegramUsername = "test_bot"
		status, result, _ := call(t, server, "GET", "/api/v1/auth/telegram/config", nil, nil)
		if status != 200 || result["enabled"] != false {
			t.Fatal(fmt.Sprint(status, result))
		}
		status, _, _ = call(t, server, "POST", "/api/v1/telegram/webhook", map[string]any{"update_id": 1}, map[string]string{"X-Telegram-Bot-Api-Secret-Token": "secret"})
		if status != 404 {
			t.Fatal(status)
		}
	}
}
