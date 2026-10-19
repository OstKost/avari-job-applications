package core

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func linkTelegram(t *testing.T, s *Store, u User, tg int64) {
	t.Helper()
	c, token, secret, e := s.NewTelegramChallenge(u.ID, "link", "browser")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramStart(token, tg, tg, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	if e = s.TelegramDecide(c.ID, tg, true); e != nil {
		t.Fatal(e)
	}
	if l, e := s.TelegramLink(u.ID); e != nil || l != nil {
		t.Fatal("link must require website confirmation", l, e)
	}
	if e = s.CompleteTelegramLink(c.ID, secret, u.ID); e != nil {
		t.Fatal(e)
	}
	// Tests below start after the onboarding message has been delivered.
	if _, e = s.DB.Exec("UPDATE telegram_outbox SET status='delivered' WHERE dedupe=?", "welcome:"+c.ID); e != nil {
		t.Fatal(e)
	}
}
func TestTelegramRegistrationAndBrowserBoundLogin(t *testing.T) {
	s := testStore(t)
	u, e := s.Register("tg@example.com", "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	c, token, secret, e := s.NewTelegramChallenge(u.ID, "registration", "Firefox")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramStart(token, 42, 42, "first", "Первый"); e != nil {
		t.Fatal(e)
	}
	requireStatus(t, s.TelegramDecide(c.ID, 43, true), 409)
	if e = s.TelegramDecide(c.ID, 42, true); e != nil {
		t.Fatal(e)
	}
	u, e = s.User(u.ID)
	if e != nil || u.Status != "active" {
		t.Fatal(u, e)
	}
	requireStatus(t, s.TelegramDecide(c.ID, 42, true), 409)
	if _, e = s.TelegramChallenge(c.ID, "wrong"); e == nil {
		t.Fatal("foreign browser")
	}
	if c, e = s.TelegramChallenge(c.ID, secret); e != nil || c.Status != "completed" {
		t.Fatal(c, e)
	}
	login, token, secret, e := s.NewTelegramChallenge("", "login", "Firefox")
	if e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteTelegramLogin(login.ID, secret); e == nil {
		t.Fatal("opening link must not authorize login")
	}
	if _, e = s.TelegramStart(token, 42, 42, "renamed", "Новый username"); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteTelegramLogin(login.ID, secret); e == nil {
		t.Fatal("start must not authorize login")
	}
	if e = s.TelegramDecide(login.ID, 42, true); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteTelegramLogin(login.ID, "wrong"); e == nil {
		t.Fatal("foreign browser login")
	}
	got, ss, sessionToken, e := s.CompleteTelegramLogin(login.ID, secret)
	if e != nil || got.ID != u.ID || ss.Kind != "web" {
		t.Fatal(got, ss, e)
	}
	if _, _, e = s.Authenticate(sessionToken); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteTelegramLogin(login.ID, secret); e == nil {
		t.Fatal("replayed login")
	}
	if e = s.DisconnectTelegram(u.ID); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.Authenticate(sessionToken); e != nil {
		t.Fatal("disconnect revoked existing web session", e)
	}
}
func TestTelegramExpiryReissueUniquenessAndRevocation(t *testing.T) {
	s := testStore(t)
	at := time.Date(2026, 10, 19, 6, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return at }
	u := testUser(t, s, "first@example.com")
	linkTelegram(t, s, u, 101)
	other := testUser(t, s, "other@example.com")
	c, token, _, e := s.NewTelegramChallenge(other.ID, "link", "Safari")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramStart(token, 101, 101, "", "Name"); e != nil {
		t.Fatal(e)
	}
	requireStatus(t, s.TelegramDecide(c.ID, 101, true), 409)
	for _, action := range []string{"revoke_sessions", "block", "disconnect"} {
		c, token, secret, e := s.NewTelegramChallenge("", "login", "browser")
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.TelegramStart(token, 101, 101, "", ""); e != nil {
			t.Fatal(e)
		}
		if e = s.TelegramDecide(c.ID, 101, true); e != nil {
			t.Fatal(e)
		}
		// Administrative revocation cancels authorizations even if the user had no sessions.
		if action == "disconnect" {
			e = s.DisconnectTelegram(u.ID)
		} else {
			e = s.Admin(action, u.ID, "")
		}
		if e != nil {
			t.Fatal(e)
		}
		if _, _, _, e = s.CompleteTelegramLogin(c.ID, secret); e == nil {
			t.Fatal("revoked login", action)
		}
		if action == "block" {
			if e = s.Admin("unblock", u.ID, ""); e != nil {
				t.Fatal(e)
			}
		}
	}
	c, token, _, e = s.NewTelegramChallenge(other.ID, "link", "")
	if e != nil {
		t.Fatal(e)
	}
	_, _, _, e = s.NewTelegramChallenge(other.ID, "link", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramStart(token, 202, 202, "", ""); e == nil {
		t.Fatal("old challenge was not replaced", c)
	}
	_, token, _, e = s.NewTelegramChallenge(other.ID, "link", "")
	if e != nil {
		t.Fatal(e)
	}
	at = at.Add(11 * time.Minute)
	if _, e = s.TelegramStart(token, 202, 202, "", ""); e == nil {
		t.Fatal("expired link accepted")
	}
}
func TestTelegramConcurrentConfirmation(t *testing.T) {
	s := testStore(t)
	var ids []string
	for i := 0; i < 2; i++ {
		u, e := s.Register(fmt.Sprintf("race%d@example.com", i), "secure-test-password", "UTC")
		if e != nil {
			t.Fatal(e)
		}
		c, tok, _, e := s.NewTelegramChallenge(u.ID, "registration", "")
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.TelegramStart(tok, 303, 303, "", ""); e != nil {
			t.Fatal(e)
		}
		ids = append(ids, c.ID)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range ids {
		wg.Add(1)
		go func(id string) { defer wg.Done(); results <- s.TelegramDecide(id, 303, true) }(id)
	}
	wg.Wait()
	close(results)
	successes := 0
	for e := range results {
		if e == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatal("expected exactly one binding", successes)
	}
}
func tgMessage(id int64, text string) TelegramUpdate {
	m := &TelegramMessage{From: TelegramActor{ID: 505}, Text: text}
	m.Chat.ID = 505
	m.Chat.Type = "private"
	return TelegramUpdate{ID: id, Message: m}
}
func tgCallback(id int64, data string) TelegramUpdate {
	u := tgMessage(id, "")
	raw := fmt.Sprintf(`{"update_id":%d,"callback_query":{"id":"cb%d","from":{"id":505},"message":{"chat":{"id":505,"type":"private"}},"data":%q}}`, id, id, data)
	_ = json.Unmarshal([]byte(raw), &u)
	u.Message = nil
	return u
}
func runTelegram(t *testing.T, s *Store, u TelegramUpdate) {
	t.Helper()
	raw, _ := json.Marshal(u)
	if e := s.EnqueueTelegramUpdate(u.ID, raw); e != nil {
		t.Fatal(e)
	}
	if e := s.ProcessTelegramUpdate(u, "https://jobs.avari.dev", nil); e != nil {
		t.Fatal(e)
	}
}
func draftTelegram(t *testing.T, s *Store) telegramDraft {
	t.Helper()
	var d telegramDraft
	if e := s.TelegramDraft(505, &d); e != nil {
		t.Fatal(e)
	}
	return d
}
func TestTelegramDialogsAtomicityDeduplicationAndConflict(t *testing.T) {
	s := testStore(t)
	user := testUser(t, s, "dialog@example.com")
	linkTelegram(t, s, user, 505)
	runTelegram(t, s, tgMessage(1, "Текст пересланной вакансии"))
	d := draftTelegram(t, s)
	if d.Step != "company" {
		t.Fatal(d)
	}
	runTelegram(t, s, tgMessage(2, "Компания"))
	runTelegram(t, s, tgMessage(3, "Разработчик"))
	d = draftTelegram(t, s)
	if d.Step != "preview" {
		t.Fatal(d)
	}
	apps, _ := list[Application](s.DB, user.ID, "application")
	if len(apps) != 0 {
		t.Fatal("saved without confirmation")
	}
	save := tgCallback(4, d.Nonce+":save")
	runTelegram(t, s, save)
	runTelegram(t, s, save)
	apps, _ = list[Application](s.DB, user.ID, "application")
	notes, _ := list[Note](s.DB, user.ID, "note")
	if len(apps) != 1 || len(notes) != 1 {
		t.Fatal("duplicate domain writes", len(apps), len(notes))
	}
	if notes[0].Text != "Текст пересланной вакансии" {
		t.Fatal(notes)
	}
	d = draftTelegram(t, s)
	oldNonce := d.Nonce
	runTelegram(t, s, tgCallback(5, d.Nonce+":stage"))
	d = draftTelegram(t, s)
	edited := apps[0]
	edited.Company = "Изменено на сайте"
	edited, e := s.SaveApplication(user.ID, edited, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	runTelegram(t, s, tgCallback(6, d.Nonce+":stage:offer"))
	current, e := get[Application](s.DB, user.ID, "application", edited.ID)
	if e != nil || current.Stage != "saved" || current.Company != edited.Company {
		t.Fatal(current, e)
	}
	runTelegram(t, s, tgCallback(7, oldNonce+":save"))
	apps, _ = list[Application](s.DB, user.ID, "application")
	if len(apps) != 1 {
		t.Fatal("stale button created vacancy")
	}
	summary, e := s.DailySummary(user.ID)
	if e != nil || summary.Added != 1 {
		t.Fatal(summary, e)
	}
	events, _ := list[Event](s.DB, user.ID, "event")
	found := false
	for _, ev := range events {
		if ev.Source == "telegram" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing telegram source")
	}
	// Notes and the initial vacancy roll back together if writing a note fails.
	if _, e = s.DB.Exec("CREATE TRIGGER fail_tg_note BEFORE INSERT ON documents WHEN NEW.kind='note' BEGIN SELECT RAISE(ABORT,'test note failure'); END"); e != nil {
		t.Fatal(e)
	}
	runTelegram(t, s, tgMessage(8, "Ещё текст"))
	runTelegram(t, s, tgMessage(9, "Другая"))
	runTelegram(t, s, tgMessage(10, "Роль"))
	d = draftTelegram(t, s)
	u := tgCallback(11, d.Nonce+":save")
	raw, _ := json.Marshal(u)
	if e = s.EnqueueTelegramUpdate(u.ID, raw); e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessTelegramUpdate(u, "https://jobs.avari.dev", nil); e == nil {
		t.Fatal("expected rollback")
	}
	apps, _ = list[Application](s.DB, user.ID, "application")
	if len(apps) != 1 {
		t.Fatal("partial initial vacancy committed")
	}
}
func TestTelegramGroupAndForeignButtons(t *testing.T) {
	s := testStore(t)
	user := testUser(t, s, "groups@example.com")
	linkTelegram(t, s, user, 505)
	before := draftTelegram(t, s)
	u := tgMessage(1, "private text")
	u.Message.Chat.Type = "group"
	runTelegram(t, s, u)
	after := draftTelegram(t, s)
	if after.Nonce != before.Nonce || after.Step != before.Step {
		t.Fatal("group processed", before, after)
	}
	runTelegram(t, s, tgMessage(2, "/settings"))
	d := draftTelegram(t, s)
	u = tgCallback(3, d.Nonce+":morning")
	u.Callback.From.ID = 999
	runTelegram(t, s, u)
	l, e := s.TelegramLink(user.ID)
	if e != nil || l.Morning {
		t.Fatal(l, e)
	}
}
func TestTelegramDigestsScheduleAndDelivery(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "digest@example.com")
	linkTelegram(t, s, u, 505)
	at := time.Date(2026, 10, 19, 6, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return at }
	if e := s.ReconcileTelegramDigests(at, "https://jobs.avari.dev"); e != nil {
		t.Fatal(e)
	}
	out, _ := s.TelegramPending(at)
	if len(out) != 0 {
		t.Fatal("default digests enabled")
	}
	if e := s.TelegramPreferences(u.ID, true, true); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if e := s.ReconcileTelegramDigests(at, "https://jobs.avari.dev"); e != nil {
			t.Fatal(e)
		}
	}
	out, e := s.TelegramPending(at)
	if e != nil || len(out) != 1 {
		t.Fatal(out, e)
	}
	if ok, e := s.TelegramDeliveryAllowed(out[0].ID); e != nil || !ok {
		t.Fatal(ok, e)
	}
	if e = s.TelegramDelivery(out[0], 429, 120, at); e != nil {
		t.Fatal(e)
	}
	pending, _ := s.TelegramPending(at.Add(time.Minute))
	if len(pending) != 0 {
		t.Fatal("ignored retry_after")
	}
	pending, _ = s.TelegramPending(at.Add(2 * time.Minute))
	if len(pending) != 1 {
		t.Fatal("missing retry")
	}
	pending, _ = s.TelegramPending(at.Add(15 * time.Minute))
	if len(pending) != 0 {
		t.Fatal("delivered late digest")
	}
	for _, date := range []time.Time{time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC), time.Date(2026, 10, 20, 6, 15, 0, 0, time.UTC)} {
		if e = s.ReconcileTelegramDigests(date, "https://jobs.avari.dev"); e != nil {
			t.Fatal(e)
		}
	}
	var countForTest int
	_ = s.DB.QueryRow("SELECT count(*) FROM telegram_outbox WHERE dedupe LIKE 'digest:%'").Scan(&countForTest)
	if countForTest != 1 {
		t.Fatal("weekend or stale digest", countForTest)
	}
	at = time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)
	if e = s.ReconcileTelegramDigests(at, "https://jobs.avari.dev"); e != nil {
		t.Fatal(e)
	}
	out, _ = s.TelegramPending(at)
	if len(out) != 1 {
		t.Fatal(out)
	}
	if e = s.TelegramDelivery(out[0], 403, 0, at); e != nil {
		t.Fatal(e)
	}
	l, e := s.TelegramLink(u.ID)
	if e != nil || l == nil || l.Morning || l.Evening || l.DeliveryEnabled {
		t.Fatal(l, e)
	}
	if e = s.TelegramPreferences(u.ID, true, false); e != nil {
		t.Fatal(e)
	}
	l, _ = s.TelegramLink(u.ID)
	if !l.DeliveryEnabled {
		t.Fatal("explicit reenabling failed")
	}
	if e = s.Admin("block", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramUser(505); e == nil {
		t.Fatal("blocked bot action")
	}
}

func TestTelegramLongTextIsSplitWithoutLoss(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "long@example.com")
	linkTelegram(t, s, u, 505)
	runTelegram(t, s, tgMessage(1, "/add"))
	text := strings.Repeat("А", 4000)
	runTelegram(t, s, tgMessage(2, text))
	runTelegram(t, s, tgMessage(3, "Компания"))
	runTelegram(t, s, tgMessage(4, "Роль"))
	rows, e := s.DB.Query("SELECT payload FROM telegram_outbox WHERE dedupe LIKE 'update:4:%'")
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	combined := ""
	for rows.Next() {
		var raw string
		_ = rows.Scan(&raw)
		var p struct {
			Text string `json:"text"`
		}
		if e = json.Unmarshal([]byte(raw), &p); e != nil {
			t.Fatal(e)
		}
		if len([]rune(p.Text)) > 1900 {
			t.Fatal("oversized Telegram message")
		}
		combined += p.Text
	}
	if !strings.Contains(combined, text) {
		t.Fatal("text truncated")
	}
}

func TestTelegramDuplicateRequiresSeparateNoteConfirmation(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "duplicate@example.com")
	linkTelegram(t, s, u, 505)
	a := testApp(t, s, u, "777")
	runTelegram(t, s, tgMessage(1, "Посмотри вакансию https://hh.ru/vacancy/777?from=telegram"))
	d := draftTelegram(t, s)
	if d.Step != "card" || d.Application.ID != a.ID || !d.Duplicate {
		t.Fatal("duplicate did not open card", d)
	}
	notes, _ := list[Note](s.DB, u.ID, "note")
	if len(notes) != 0 {
		t.Fatal("note saved without consent")
	}
	runTelegram(t, s, tgCallback(2, d.Nonce+":duplicate-note"))
	runTelegram(t, s, tgCallback(3, d.Nonce+":duplicate-note"))
	notes, _ = list[Note](s.DB, u.ID, "note")
	apps, _ := list[Application](s.DB, u.ID, "application")
	if len(notes) != 1 || len(apps) != 1 {
		t.Fatal("duplicate confirmation", len(notes), len(apps))
	}
}
func TestTelegramTimezoneSchedulingAtDateAndDSTBoundaries(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "timezones@example.com")
	linkTelegram(t, s, u, 505)
	if e := s.TelegramPreferences(u.ID, true, true); e != nil {
		t.Fatal(e)
	}
	cases := []struct {
		tz       string
		utc      string
		expected string
	}{
		{"Pacific/Kiritimati", "2026-10-18T19:00:00Z", "2026-10-19"},
		{"America/New_York", "2026-03-09T13:00:00Z", "2026-03-09"},
		{"America/New_York", "2026-11-02T14:00:00Z", "2026-11-02"},
	}
	for _, tc := range cases {
		t.Run(tc.utc, func(t *testing.T) {
			if e := s.SetTimezone(u.ID, tc.tz); e != nil {
				t.Fatal(e)
			}
			at, e := time.Parse(time.RFC3339, tc.utc)
			if e != nil {
				t.Fatal(e)
			}
			s.Now = func() time.Time { return at }
			if e = s.ReconcileTelegramDigests(at, "https://jobs.avari.dev"); e != nil {
				t.Fatal(e)
			}
			var expires string
			if e = s.DB.QueryRow("SELECT expires_at FROM telegram_outbox WHERE dedupe=?", "digest:"+u.ID+":"+tc.expected+":morning").Scan(&expires); e != nil {
				t.Fatal(e)
			}
			if expires != at.Add(15*time.Minute).UTC().Format(timestampLayout) {
				t.Fatal("wrong timezone deadline", expires)
			}
		})
	}
}
func TestTelegramAgendaUsesAccountDateAndIncludesOverdue(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "agenda@example.com")
	linkTelegram(t, s, u, 505)
	a := testApp(t, s, u, "2001")
	at := time.Date(2026, 10, 19, 21, 30, 0, 0, time.UTC)
	s.Now = func() time.Time { return at }
	for _, tc := range []struct{ title, date, state string }{{"Просроченная", "2026-10-19", "open"}, {"Местное сегодня", "2026-10-20", "open"}, {"Последний день недели", "2026-10-26", "open"}, {"За пределами недели", "2026-10-27", "open"}, {"Завершена", "2026-10-20", "done"}} {
		if _, e := s.SaveTask(u.ID, Task{ApplicationID: a.ID, Title: tc.title, Date: tc.date, Kind: "interview", State: tc.state}, "", "manual"); e != nil {
			t.Fatal(e)
		}
	}
	runTelegram(t, s, tgMessage(1, "/today"))
	runTelegram(t, s, tgMessage(2, "/week"))
	for _, tc := range []struct {
		key                string
		includes, excludes []string
	}{{"update:1:1", []string{"Просрочено: 2026-10-19", "Местное сегодня"}, []string{"Последний день недели", "За пределами недели", "Завершена"}}, {"update:2:1", []string{"Просроченная", "Местное сегодня", "Последний день недели"}, []string{"За пределами недели", "Завершена"}}} {
		var raw string
		if e := s.DB.QueryRow("SELECT payload FROM telegram_outbox WHERE dedupe=?", tc.key).Scan(&raw); e != nil {
			t.Fatal(e)
		}
		for _, v := range tc.includes {
			if !strings.Contains(raw, v) {
				t.Fatal("missing agenda item", v, raw)
			}
		}
		for _, v := range tc.excludes {
			if strings.Contains(raw, v) {
				t.Fatal("unexpected agenda item", v, raw)
			}
		}
	}
}
func TestTelegramDraftAndReceiptsSurviveRestart(t *testing.T) {
	path := t.TempDir() + "/restart.db"
	s, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	u := testUser(t, s, "restart@example.com")
	linkTelegram(t, s, u, 505)
	runTelegram(t, s, tgMessage(1, "Пересланный текст"))
	runTelegram(t, s, tgMessage(2, "Компания"))
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s, e = Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	d := draftTelegram(t, s)
	if d.Step != "position" || d.Application.Company != "Компания" || d.Text != "Пересланный текст" {
		t.Fatal(d)
	}
	// A repeated webhook after restart must not advance the dialog.
	runTelegram(t, s, tgMessage(2, "Компания"))
	d = draftTelegram(t, s)
	if d.Step != "position" {
		t.Fatal("replayed webhook", d)
	}
	runTelegram(t, s, tgMessage(3, "Роль"))
	d = draftTelegram(t, s)
	if d.Step != "preview" {
		t.Fatal(d)
	}
	s.Now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	runTelegram(t, s, tgCallback(4, d.Nonce+":save"))
	apps, _ := list[Application](s.DB, u.ID, "application")
	if len(apps) != 0 {
		t.Fatal("expired draft was saved")
	}
}
func TestTelegramDeliveryCancelsInvalidHeadAndHonorsPreferences(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "queue@example.com")
	linkTelegram(t, s, u, 505)
	at := time.Date(2026, 10, 19, 6, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return at }
	if e := s.TelegramPreferences(u.ID, true, false); e != nil {
		t.Fatal(e)
	}
	if e := s.ReconcileTelegramDigests(at, "https://jobs.avari.dev"); e != nil {
		t.Fatal(e)
	}
	if e := s.TelegramPreferences(u.ID, false, false); e != nil {
		t.Fatal(e)
	}
	runTelegram(t, s, tgMessage(1, "/settings"))
	out, e := s.TelegramPending(at)
	if e != nil || len(out) != 1 {
		t.Fatal("disabled digest blocks explicit reply", out, e)
	}
	if !strings.Contains(out[0].Payload, "Сводки по будням") {
		t.Fatal(out)
	}
	if e = s.TelegramDelivery(out[0], 403, 0, at); e != nil {
		t.Fatal(e)
	}
	runTelegram(t, s, tgMessage(2, "/settings"))
	out, e = s.TelegramPending(at)
	if e != nil || len(out) != 1 {
		t.Fatal("automatic-delivery preference blocks explicit replies", out, e)
	}
}
func TestTelegramUnboundLoginCanBeRejected(t *testing.T) {
	s := testStore(t)
	c, tok, secret, e := s.NewTelegramChallenge("", "login", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramStart(tok, 123, 123, "", ""); e != nil {
		t.Fatal(e)
	}
	if e = s.TelegramDecide(c.ID, 123, false); e != nil {
		t.Fatal(e)
	}
	c, e = s.TelegramChallenge(c.ID, secret)
	if e != nil || c.Status != "cancelled" {
		t.Fatal(c, e)
	}
}

func TestTelegramRegistrationThroughQueuedBotUpdates(t *testing.T) {
	s := testStore(t)
	u, e := s.Register("queue-registration@example.com", "secure-test-password", "UTC")
	if e != nil {
		t.Fatal(e)
	}
	c, token, _, e := s.NewTelegramChallenge(u.ID, "registration", "Browser")
	if e != nil {
		t.Fatal(e)
	}
	runTelegram(t, s, tgMessage(1, "/start "+token))
	current, e := s.User(u.ID)
	if e != nil || current.Status != "pending" {
		t.Fatal(current, e)
	}
	runTelegram(t, s, tgCallback(2, "auth:"+c.ID))
	runTelegram(t, s, tgCallback(3, "auth:"+c.ID))
	current, e = s.User(u.ID)
	if e != nil || current.Status != "active" {
		t.Fatal(current, e)
	}
	link, e := s.TelegramLink(u.ID)
	if e != nil || link == nil || link.TelegramID != 505 || link.Morning || link.Evening {
		t.Fatal(link, e)
	}
	d := draftTelegram(t, s)
	if d.Step != "settings" {
		t.Fatal("missing explicit opt-in offer", d)
	}
	runTelegram(t, s, tgCallback(4, d.Nonce+":morning"))
	link, e = s.TelegramLink(u.ID)
	if e != nil || !link.Morning || link.Evening {
		t.Fatal(link, e)
	}
}
func TestTelegramMultipleAndHiddenLinks(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "urls@example.com")
	linkTelegram(t, s, u, 505)
	text := "Переслано: https://hh.ru/vacancy/100 https://hh.ru/vacancy/200"
	runTelegram(t, s, tgMessage(1, text))
	d := draftTelegram(t, s)
	if d.Step != "urls" || len(d.URLs) != 2 {
		t.Fatal(d)
	}
	runTelegram(t, s, tgCallback(2, d.Nonce+":url:1"))
	d = draftTelegram(t, s)
	if d.Application.URL != "https://hh.ru/vacancy/200" || d.Text != text {
		t.Fatal("lost selection or forwarded text", d)
	}
	runTelegram(t, s, tgMessage(3, "/cancel"))
	hidden := tgMessage(4, "Посмотреть вакансию")
	hidden.Message.Entities = []TelegramEntity{{Type: "text_link", URL: "https://hh.ru/vacancy/300"}}
	runTelegram(t, s, hidden)
	d = draftTelegram(t, s)
	if d.Application.URL != "https://hh.ru/vacancy/300" || d.Text != "Посмотреть вакансию" {
		t.Fatal("hidden forwarded link lost", d)
	}
}

func TestTelegramPendingLoginRevokedBeforeApproval(t *testing.T) {
	for _, action := range []string{"revoke_sessions", "block", "disconnect"} {
		t.Run(action, func(t *testing.T) {
			s := testStore(t)
			u := testUser(t, s, "pending-login@example.com")
			linkTelegram(t, s, u, 505)
			c, tok, secret, e := s.NewTelegramChallenge("", "login", "Browser")
			if e != nil {
				t.Fatal(e)
			}
			runTelegram(t, s, tgMessage(1, "/start "+tok))
			polled, e := s.TelegramChallenge(c.ID, secret)
			if e != nil || polled.Status != "pending" || polled.Email != "" {
				t.Fatal("opening login leaked identity or approved", polled, e)
			}
			if action == "disconnect" {
				e = s.DisconnectTelegram(u.ID)
			} else {
				e = s.Admin(action, u.ID, "")
			}
			if e != nil {
				t.Fatal(e)
			}
			if action == "block" {
				if e = s.Admin("unblock", u.ID, ""); e != nil {
					t.Fatal(e)
				}
			}
			if e = s.TelegramDecide(c.ID, 505, true); e == nil {
				t.Fatal("pending authorization survived revocation")
			}
		})
	}
}

func TestTelegramAnonymousLoginReissueRequiresOriginalBrowserSecret(t *testing.T) {
	s := testStore(t)
	first, _, secret, e := s.NewTelegramChallenge("", "login", "Browser")
	if e != nil {
		t.Fatal(e)
	}
	_, _, _, e = s.NewTelegramChallenge("", "login", "Foreign browser", first.ID, "wrong")
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.TelegramChallenge(first.ID, secret)
	if e != nil || c.Status != "pending" {
		t.Fatal("foreign browser cancelled request", c, e)
	}
	_, _, _, e = s.NewTelegramChallenge("", "login", "Browser", first.ID, secret)
	if e != nil {
		t.Fatal(e)
	}
	c, e = s.TelegramChallenge(first.ID, secret)
	if e != nil || c.Status != "cancelled" {
		t.Fatal("original browser failed to replace request", c, e)
	}
}

func TestExtensionTelegramLoginIsolationAndSingleUse(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "extension-telegram@example.com")
	linkTelegram(t, s, u, 8001)
	c, botToken, secret, e := s.NewExtensionTelegramLogin("Расширение · Chromium")
	if e != nil {
		t.Fatal(e)
	}
	if c.ClientKind != "extension" {
		t.Fatal(c)
	}
	if _, e = s.TelegramStart(botToken, 8001, 8001, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteExtensionTelegramLogin(c.ID, secret); e == nil {
		t.Fatal("start issued session")
	}
	if e = s.TelegramDecide(c.ID, 8001, true); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteTelegramLogin(c.ID, secret); e == nil {
		t.Fatal("extension challenge completed as web")
	}
	if _, _, _, e = s.CompleteExtensionTelegramLogin(c.ID, "wrong"); e == nil {
		t.Fatal("foreign secret")
	}
	var wg sync.WaitGroup
	results := make(chan string, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			user, session, token, err := s.CompleteExtensionTelegramLogin(c.ID, secret)
			if err == nil {
				if user.ID != u.ID || session.Kind != "extension" {
					t.Error(user, session)
				}
				results <- token
			}
		}()
	}
	wg.Wait()
	close(results)
	var tokens []string
	for token := range results {
		tokens = append(tokens, token)
	}
	if len(tokens) != 1 {
		t.Fatal("expected exactly one issued session", len(tokens))
	}
	if _, session, e := s.Authenticate(tokens[0]); e != nil || session.Kind != "extension" {
		t.Fatal(session, e)
	}
	web, token, webSecret, e := s.NewTelegramChallenge("", "login", "Browser")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.TelegramStart(token, 8001, 8001, "tester", "Tester"); e != nil {
		t.Fatal(e)
	}
	if e = s.TelegramDecide(web.ID, 8001, true); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.CompleteExtensionTelegramLogin(web.ID, webSecret); e == nil {
		t.Fatal("web challenge completed as extension")
	}
	if _, session, _, e := s.CompleteTelegramLogin(web.ID, webSecret); e != nil || session.Kind != "web" {
		t.Fatal(session, e)
	}
}

func TestExtensionTelegramLoginInvalidation(t *testing.T) {
	for _, reason := range []string{"expired", "cancelled", "blocked", "disconnected", "unlinked"} {
		t.Run(reason, func(t *testing.T) {
			s := testStore(t)
			u := testUser(t, s, "extension-invalid@example.com")
			if reason != "unlinked" {
				linkTelegram(t, s, u, 8002)
			}
			c, token, secret, e := s.NewExtensionTelegramLogin("Extension")
			if e != nil {
				t.Fatal(e)
			}
			if _, e = s.TelegramStart(token, 8002, 8002, "tester", "Tester"); e != nil {
				t.Fatal(e)
			}
			if reason == "unlinked" {
				if e = s.TelegramDecide(c.ID, 8002, true); e == nil {
					t.Fatal("unlinked login approved")
				}
			} else if reason == "cancelled" {
				if e = s.TelegramDecide(c.ID, 8002, false); e != nil {
					t.Fatal(e)
				}
			} else {
				if e = s.TelegramDecide(c.ID, 8002, true); e != nil {
					t.Fatal(e)
				}
				switch reason {
				case "expired":
					s.Now = func() time.Time { return time.Now().Add(6 * time.Minute) }
				case "blocked":
					_, e = s.DB.Exec("UPDATE users SET status='blocked' WHERE id=?", u.ID)
				case "disconnected":
					e = s.DisconnectTelegram(u.ID)
				}
				if e != nil {
					t.Fatal(e)
				}
			}
			if _, _, _, e = s.CompleteExtensionTelegramLogin(c.ID, secret); e == nil {
				t.Fatal("invalidated request issued session")
			}
		})
	}
}

func TestTelegramClientKindUpgrade(t *testing.T) {
	s := testStore(t)
	c, _, secret, e := s.NewTelegramChallenge("", "login", "Existing browser")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec("ALTER TABLE telegram_challenges DROP COLUMN client_kind; DELETE FROM schema_migrations WHERE version=13"); e != nil {
		t.Fatal(e)
	}
	path := s.Path
	s.Close()
	upgraded, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer upgraded.Close()
	migrated, e := upgraded.TelegramChallenge(c.ID, secret)
	if e != nil || migrated.ClientKind != "web" {
		t.Fatal(migrated, e)
	}
	if _, _, _, e = upgraded.NewExtensionTelegramLogin("Extension"); e != nil {
		t.Fatal(e)
	}
}
