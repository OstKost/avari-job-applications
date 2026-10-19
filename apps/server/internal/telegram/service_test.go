package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/vacancy"
)

func TestClientRetryAndRedaction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"ok":false,"error_code":429,"parameters":{"retry_after":17}}`))
	}))
	defer server.Close()
	c := &Client{Token: "secret", BaseURL: server.URL}
	code, retry, e := c.Call(t.Context(), "sendMessage", map[string]string{"text": "private"})
	if e != nil || code != 429 || retry != 17 {
		t.Fatal(code, retry, e)
	}
	server.Close()
	_, _, e = c.Call(t.Context(), "sendMessage", nil)
	if e == nil || strings.Contains(e.Error(), "secret") {
		t.Fatal("leaked bot token", e)
	}
}
func TestWorkerWithFakeAPIAndUnavailablePreview(t *testing.T) {
	store, e := core.Open(filepath.Join(t.TempDir(), "test.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	u, e := store.Register("fake@example.com", "secure-test-password", "UTC")
	if e != nil {
		t.Fatal(e)
	}
	c, token, _, e := store.NewTelegramChallenge(u.ID, "registration", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.TelegramStart(token, 99, 99, "test", "Тест"); e != nil {
		t.Fatal(e)
	}
	if e = store.TelegramDecide(c.ID, 99, true); e != nil {
		t.Fatal(e)
	}
	messages := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		messages = append(messages, body.Text)
		_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
	}))
	defer server.Close()
	service := &Service{Store: store, Client: &Client{BaseURL: server.URL, Token: "test"}, Origin: "https://jobs.avari.dev", Preview: func(context.Context, string) (vacancy.Preview, error) {
		return vacancy.Preview{}, vacancy.ErrUnavailable
	}}
	if e = service.Tick(t.Context()); e != nil {
		t.Fatal(e)
	}
	messages = nil
	raw := []byte(`{"update_id":1,"message":{"from":{"id":99},"chat":{"id":99,"type":"private"},"text":"https://hh.ru/vacancy/123"}}`)
	for i := 0; i < 2; i++ {
		if e = store.EnqueueTelegramUpdate(1, raw); e != nil {
			t.Fatal(e)
		}
		if e = service.Tick(t.Context()); e != nil {
			t.Fatal(e)
		}
	}
	if len(messages) != 1 || !strings.Contains(messages[0], "компанию") {
		t.Fatal("fallback or receipt failed", messages)
	}
}
func TestConfigureAndLocalGuard(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	c := &Client{BaseURL: server.URL, Token: "test"}
	if e := c.Configure(t.Context(), "https://jobs.avari.dev", "secret"); e != nil {
		t.Fatal(e)
	}
	if len(calls) != 2 || !strings.HasSuffix(calls[0], "/setWebhook") || !strings.HasSuffix(calls[1], "/setMyCommands") {
		t.Fatal(calls)
	}
	if e := Validate(true, false, "http://localhost:47831", "token", "test_bot", strings.Repeat("s", 32)); e == nil {
		t.Fatal("local production bot permitted")
	}
	if e := Validate(true, true, "https://jobs.avari.dev", "token", "test_bot", strings.Repeat("s", 32)); e == nil {
		t.Fatal("personal mode permitted")
	}
	if e := Validate(false, true, "http://localhost:47831", "", "", ""); e != nil {
		t.Fatal(e)
	}
}
