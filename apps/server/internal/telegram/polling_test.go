package telegram

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func TestPollingDurableAcknowledgementAndIdleReset(t *testing.T) {
	store, e := core.Open(filepath.Join(t.TempDir(), "poll.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	offsets := []int64{}
	round := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Offset int64 `json:"offset"`
		}
		if e := json.NewDecoder(r.Body).Decode(&b); e != nil {
			t.Error(e)
		}
		offsets = append(offsets, b.Offset)
		switch round {
		case 0:
			_, _ = w.Write([]byte(`{"ok":true,"result":[{"update_id":41},{"update_id":40}]}`))
		case 1:
			_, _ = w.Write([]byte(`{"ok":true,"result":[]}`))
		default:
			_, _ = w.Write([]byte(`{"ok":true,"result":[{"update_id":2}]}`))
		}
		round++
	}))
	defer server.Close()
	s := &Service{Store: store, Client: &Client{Token: "fake", BaseURL: server.URL}}
	for i := 0; i < 3; i++ {
		if _, e = s.PollOnce(t.Context()); e != nil {
			t.Fatal(e)
		}
	}
	if len(offsets) != 3 || offsets[0] != 0 || offsets[1] != 42 || offsets[2] != 0 {
		t.Fatal("remote ACK or idle reset", offsets)
	}
	var count int
	if e = store.DB.QueryRow("SELECT count(*) FROM telegram_inbox").Scan(&count); e != nil || count != 3 {
		t.Fatal("batch lost updates", count, e)
	}
}
func TestPollingFailureDoesNotAdvanceCursor(t *testing.T) {
	store, e := core.Open(filepath.Join(t.TempDir(), "poll.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	if _, e = store.DB.Exec("CREATE TRIGGER fail_poll BEFORE INSERT ON telegram_inbox BEGIN SELECT RAISE(ABORT,'storage unavailable'); END"); e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"result":[{"update_id":9}]}`))
	}))
	defer server.Close()
	s := &Service{Store: store, Client: &Client{Token: "fake", BaseURL: server.URL}}
	if _, e = s.PollOnce(t.Context()); e == nil {
		t.Fatal("expected persistence failure")
	}
	offset, e := store.TelegramPollOffset()
	if e != nil || offset != 0 {
		t.Fatal(offset, e)
	}
}
func TestPollingSetupPreservesPendingUpdates(t *testing.T) {
	methods := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.URL.Path)
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		if r.URL.Path == "/botfake/deleteWebhook" && b["drop_pending_updates"] != false {
			t.Error("pending updates discarded")
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	c := &Client{Token: "fake", BaseURL: server.URL}
	if e := c.Configure(t.Context(), "https://jobs.avari.dev", "secret", "polling"); e != nil {
		t.Fatal(e)
	}
	if len(methods) != 2 || methods[0] != "/botfake/deleteWebhook" || methods[1] != "/botfake/setMyCommands" {
		t.Fatal(methods)
	}
}
