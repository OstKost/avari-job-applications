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
		if status != 200 || result["enabled"] != false || result["extensionLogin"] != false {
			t.Fatal(fmt.Sprint(status, result))
		}
		status, _, _ = call(t, server, "POST", "/api/v1/auth/telegram/extension/requests", nil, nil)
		if status != 503 {
			t.Fatal("extension login enabled on disabled/personal server", status)
		}
		status, _, _ = call(t, server, "POST", "/api/v1/telegram/webhook", map[string]any{"update_id": 1}, map[string]string{"X-Telegram-Bot-Api-Secret-Token": "secret"})
		if status != 404 {
			t.Fatal(status)
		}
	}
}

func TestTelegramHTTPExtensionLogin(t *testing.T) {
	store, api, server := setup(t)
	api.TelegramEnabled, api.TelegramSecret, api.TelegramUsername = true, "secret", "test_bot"
	const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	base := "/api/v1/auth/telegram/extension/requests"
	status, _, _ := call(t, server, "POST", base, nil, map[string]string{"Origin": server.URL})
	if status != 403 {
		t.Fatal("website created extension challenge", status)
	}
	status, result, cookies := call(t, server, "POST", base, nil, map[string]string{"Origin": origin})
	if status != 201 || len(cookies) != 0 {
		t.Fatal(status, result, cookies)
	}
	secret := result["secret"].(string)
	id := result["challenge"].(map[string]any)["id"].(string)
	botToken := strings.Split(result["url"].(string), "?start=")[1]
	headers := map[string]string{"Origin": origin, "X-Telegram-Login-Secret": secret}
	path := base + "/" + id
	status, _, _ = call(t, server, "GET", path, nil, nil)
	if status != 404 {
		t.Fatal("poll without secret", status)
	}
	status, _, _ = call(t, server, "POST", path+"/complete", nil, headers)
	if status != 409 {
		t.Fatal("pending login accepted", status)
	}
	u, e := store.Register("tg-extension-http@example.com", "secure-test-password", "UTC")
	if e != nil {
		t.Fatal(e)
	}
	registration, tok, _, e := store.NewTelegramChallenge(u.ID, "registration", "Browser")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.TelegramStart(tok, 8100, 8100, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	if e = store.TelegramDecide(registration.ID, 8100, true); e != nil {
		t.Fatal(e)
	}
	if _, e = store.TelegramStart(botToken, 8100, 8100, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	if e = store.TelegramDecide(id, 8100, true); e != nil {
		t.Fatal(e)
	}
	status, poll, cookies := call(t, server, "GET", path, nil, headers)
	if status != 200 || poll["status"] != "approved" || poll["token"] != nil || len(cookies) != 0 {
		t.Fatal(status, poll, cookies)
	}
	status, _, _ = call(t, server, "POST", "/api/v1/auth/telegram/requests/"+id+"/complete", nil, map[string]string{"Origin": server.URL, "Cookie": "avari_telegram=" + secret})
	if status != 409 {
		t.Fatal("extension consumed through web endpoint", status)
	}
	status, result, cookies = call(t, server, "POST", path+"/complete", nil, headers)
	if status != 200 || len(cookies) != 0 || result["csrf"] != nil {
		t.Fatal(status, result, cookies)
	}
	token := result["token"].(string)
	status, result, _ = call(t, server, "GET", "/api/v1/me", nil, map[string]string{"Authorization": "Bearer " + token})
	if status != 200 || result["id"] != u.ID {
		t.Fatal(status, result)
	}
	status, _, _ = call(t, server, "GET", "/api/v1/me", nil, map[string]string{"Cookie": "avari_session=" + token})
	if status != 401 {
		t.Fatal("extension token accepted as cookie", status)
	}
	status, _, _ = call(t, server, "POST", path+"/complete", nil, headers)
	if status != 409 {
		t.Fatal("replayed completion", status)
	}
}

func TestTelegramHTTPRejectWebChallengeInExtension(t *testing.T) {
	store, api, server := setup(t)
	api.TelegramEnabled, api.TelegramSecret, api.TelegramUsername = true, "secret", "bot"
	c, _, secret, e := store.NewTelegramChallenge("", "login", "Browser")
	if e != nil {
		t.Fatal(e)
	}
	headers := map[string]string{"Origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "X-Telegram-Login-Secret": secret}
	path := "/api/v1/auth/telegram/extension/requests/" + c.ID
	for _, method := range []string{"GET", "POST"} {
		url := path
		if method == "POST" {
			url += "/complete"
		}
		status, _, _ := call(t, server, method, url, nil, headers)
		if status != 403 {
			t.Fatal("web challenge accepted by extension API", method, status)
		}
	}
	req, _ := http.NewRequest("OPTIONS", server.URL+path, nil)
	req.Header.Set("Origin", headers["Origin"])
	req.Header.Set("Access-Control-Request-Headers", "X-Telegram-Login-Secret")
	response, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer response.Body.Close()
	if response.StatusCode != 204 || !strings.Contains(response.Header.Get("Access-Control-Allow-Headers"), "X-Telegram-Login-Secret") {
		t.Fatal(response.StatusCode, response.Header)
	}
}
