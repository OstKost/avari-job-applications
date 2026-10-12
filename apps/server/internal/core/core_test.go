package core

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := Open(filepath.Join(t.TempDir(), "avari.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
func testUser(t *testing.T, s *Store, email string) User {
	t.Helper()
	u, e := s.Register(email, "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Admin("approve", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	u, e = s.User(u.ID)
	if e != nil {
		t.Fatal(e)
	}
	return u
}
func testApp(t *testing.T, s *Store, u User, id string) Application {
	t.Helper()
	a, e := s.SaveApplication(u.ID, Application{Company: "Альфа", Position: "Go developer", URL: "https://spb.hh.ru/vacancy/" + id + "?from=search", Stage: "saved", State: "active"}, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func requireStatus(t *testing.T, e error, status int) {
	t.Helper()
	var ce *Error
	if !errors.As(e, &ce) || ce.Status != status {
		t.Fatalf("want status %d, got %v", status, e)
	}
}
func TestIsolationDuplicatesVersions(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "first@example.com")
	other := testUser(t, s, "second@example.com")
	a := testApp(t, s, u, "123")
	if a.URL != "https://hh.ru/vacancy/123" {
		t.Fatal(a.URL)
	}
	_, e := s.Application(other.ID, a.ID)
	requireStatus(t, e, 404)
	again := testApp(t, s, u, "123")
	if again.ID != a.ID {
		t.Fatal("duplicate created")
	}
	v := testApp(t, s, other, "123")
	if v.ID == a.ID {
		t.Fatal("users share application")
	}
	events, _ := s.Events(u.ID)
	if len(events) != 1 {
		t.Fatal("duplicate history")
	}
	a.Company = "Изменено"
	updated, e := s.SaveApplication(u.ID, a, "", "manual")
	if e != nil || updated.Version != 2 {
		t.Fatal(updated, e)
	}
	_, e = s.SaveApplication(u.ID, a, "", "manual")
	requireStatus(t, e, 409)
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := s.SaveApplication(u.ID, Application{Company: "Race", Position: "Developer", URL: "https://hh.ru/vacancy/456", Stage: "saved", State: "active"}, "same-request", "extension")
			if e != nil {
				t.Error(e)
				return
			}
			ids <- v.ID
		}()
	}
	wg.Wait()
	close(ids)
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatal("race duplicate")
		}
	}
}
func TestSessionRevocationAndPasswords(t *testing.T) {
	s := testStore(t)
	u, e := s.Register("session@example.com", "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	pending, _, token, e := s.Login(u.Email, "secure-test-password", "web", "")
	if e != nil || pending.Status != "pending" {
		t.Fatal(e, pending)
	}
	if e = s.Admin("approve", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	active, _, e := s.Authenticate(token)
	if e != nil || active.Status != "active" {
		t.Fatal(e)
	}
	_, _, ext, e := s.Login(u.Email, "secure-test-password", "extension", "Chrome")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Admin("block", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	_, _, e = s.Authenticate(ext)
	requireStatus(t, e, 401)
	_, _, e = s.Authenticate(token)
	requireStatus(t, e, 401)
	if e = s.Admin("unblock", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	if e = s.Admin("reset_password", u.ID, "new-secure-password"); e != nil {
		t.Fatal(e)
	}
	_, _, _, e = s.Login(u.Email, "secure-test-password", "web", "")
	requireStatus(t, e, 401)
	_, _, _, e = s.Login(u.Email, "new-secure-password", "web", "")
	if e != nil {
		t.Fatal(e)
	}
	audits, e := s.Audits()
	if e != nil || len(audits) != 4 {
		t.Fatal(audits, e)
	}
}

func TestPasswordChangeAndAdminResetFlow(t *testing.T) {
	s := testStore(t)
	u, e := s.Register("recovery@example.com", "password-12345", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Admin("approve", u.ID, ""); e != nil {
		t.Fatal(e)
	}

	// 1. Change password by user themselves
	_, s1, tok1, e := s.Login(u.Email, "password-12345", "web", "Device 1")
	if e != nil {
		t.Fatal(e)
	}
	_, _, tok2, e := s.Login(u.Email, "password-12345", "extension", "Chrome")
	if e != nil {
		t.Fatal(e)
	}

	// Wrong current password fails
	e = s.ChangePassword(u.ID, "wrong-current-password", "brand-new-password", s1.ID)
	requireStatus(t, e, 400)

	// Short password fails
	e = s.ChangePassword(u.ID, "password-12345", "short", s1.ID)
	requireStatus(t, e, 400)

	// Successful password change
	if e = s.ChangePassword(u.ID, "password-12345", "brand-new-password", s1.ID); e != nil {
		t.Fatal(e)
	}

	// Current session survives, other session revoked
	if _, _, e = s.Authenticate(tok1); e != nil {
		t.Fatal("current session was revoked:", e)
	}
	if _, _, e = s.Authenticate(tok2); e == nil {
		t.Fatal("secondary session should have been revoked")
	}

	// Old password cannot log in, new password works
	if _, _, _, e = s.Login(u.Email, "password-12345", "web", ""); e == nil {
		t.Fatal("old password succeeded")
	}
	if _, _, _, e = s.Login(u.Email, "brand-new-password", "web", ""); e != nil {
		t.Fatal("new password failed:", e)
	}

	// 2. Password recovery request via administrator approval
	// Non-existent email succeeds silently (no enumeration)
	if e = s.RequestPasswordReset("nonexistent@example.com", "dummy-new-password"); e != nil {
		t.Fatal(e)
	}
	resets, e := s.PendingPasswordResets()
	if e != nil || len(resets) != 0 {
		t.Fatal("resets for nonexistent user:", resets)
	}

	// Valid user requests password reset
	if e = s.RequestPasswordReset(u.Email, "recovered-pass-999"); e != nil {
		t.Fatal(e)
	}
	resets, e = s.PendingPasswordResets()
	if e != nil || len(resets) != 1 {
		t.Fatal("pending reset not found:", resets)
	}
	reqID := resets[0].ID
	if resets[0].UserEmail != u.Email || resets[0].UserID != u.ID {
		t.Fatalf("unexpected reset request payload: %+v", resets[0])
	}

	// Reject test
	if e = s.RejectPasswordReset(reqID); e != nil {
		t.Fatal(e)
	}
	resets, e = s.PendingPasswordResets()
	if e != nil || len(resets) != 0 {
		t.Fatal("rejected reset still pending:", resets)
	}
	// Password is still brand-new-password
	if _, _, _, e = s.Login(u.Email, "recovered-pass-999", "web", ""); e == nil {
		t.Fatal("recovered pass should not be active after rejection")
	}

	// Request again and approve
	if e = s.RequestPasswordReset(u.Email, "recovered-pass-999"); e != nil {
		t.Fatal(e)
	}
	resets, _ = s.PendingPasswordResets()
	reqID = resets[0].ID

	if e = s.ApprovePasswordReset(reqID); e != nil {
		t.Fatal(e)
	}

	// After approval: sessions revoked, new password works
	if _, _, e = s.Authenticate(tok1); e == nil {
		t.Fatal("session should be revoked after reset approval")
	}
	if _, _, _, e = s.Login(u.Email, "brand-new-password", "web", ""); e == nil {
		t.Fatal("old password succeeded after admin approved reset")
	}
	if _, _, _, e = s.Login(u.Email, "recovered-pass-999", "web", ""); e != nil {
		t.Fatal("approved new password failed to login:", e)
	}
}

func TestProposalsConfirmationDedupAndConflict(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "proposal@example.com")
	a := testApp(t, s, u, "123")
	observe := func(status string) *Proposal {
		t.Helper()
		p, e := s.Observe(u.ID, Observation{HHID: "123", Status: status, URL: "https://hh.ru/applicant/negotiations"})
		if e != nil {
			t.Fatal(e)
		}
		return p
	}
	p := observe("invited")
	if p == nil || p.Changes["stage"] != "hr" {
		t.Fatal(p)
	}
	current, _ := s.Application(u.ID, a.ID)
	if current.Stage != "saved" || current.ExternalStatus != "" {
		t.Fatal("unconfirmed overwrite")
	}
	if observe("invited") != nil {
		t.Fatal("duplicate proposal")
	}
	if _, e := s.ResolveProposal(u.ID, p.ID, "dismiss", 0, nil); e != nil {
		t.Fatal(e)
	}
	if observe("invited") != nil {
		t.Fatal("dismissed proposal repeated")
	}
	p = observe("interview")
	a.Recruiter = "Рекрутер"
	updated, e := s.SaveApplication(u.ID, a, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.ResolveProposal(u.ID, p.ID, "apply", p.Current.Version, nil)
	requireStatus(t, e, 409)
	ps, _ := s.Proposals(u.ID)
	var fresh Proposal
	for _, v := range ps {
		if v.ID == p.ID {
			fresh = v
		}
	}
	if fresh.Current.Version != updated.Version {
		t.Fatal("comparison not refreshed")
	}
	if _, e = s.ResolveProposal(u.ID, p.ID, "apply", fresh.Current.Version, nil); e != nil {
		t.Fatal(e)
	}
	events, _ := s.Events(u.ID)
	n := len(events)
	if _, e = s.ResolveProposal(u.ID, p.ID, "apply", fresh.Current.Version, nil); e != nil {
		t.Fatal(e)
	}
	events, _ = s.Events(u.ID)
	if len(events) != n {
		t.Fatal("duplicate apply event")
	}
	current, _ = s.Application(u.ID, a.ID)
	if current.Stage != "interview" || current.Recruiter != "Рекрутер" {
		t.Fatal(current)
	}
	p = observe("waiting")
	if _, ok := p.Changes["stage"]; ok {
		t.Fatal("stage regression")
	}
	p = observe("unknown:новый статус")
	if _, ok := p.Changes["stage"]; ok {
		t.Fatal("unknown mapping")
	}
	_, e = s.Observe(u.ID, Observation{HHID: "123", Status: "rejected", URL: "https://evil.example/hh.ru/"})
	requireStatus(t, e, 400)
}
func TestCustomFieldsLimitsAndDeletion(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "fields@example.com")
	a := testApp(t, s, u, "123")
	fields, _ := s.Fields(u.ID)
	var f Field
	for _, v := range fields {
		if v.Role == "priority" {
			f = v
		}
	}
	a.Custom = map[string]any{f.ID: "Высокий"}
	a, e := s.SaveApplication(u.ID, a, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	changed := append([]Field{}, fields...)
	for i := range changed {
		if changed[i].ID == f.ID {
			changed[i].Type = "text"
		}
	}
	_, e = s.SaveFields(u.ID, changed, false)
	requireStatus(t, e, 400)
	kept := []Field{}
	for _, v := range fields {
		if v.ID != f.ID {
			kept = append(kept, v)
		}
	}
	_, e = s.SaveFields(u.ID, kept, false)
	requireStatus(t, e, 409)
	_, e = s.SaveFields(u.ID, kept, true)
	if e != nil {
		t.Fatal(e)
	}
	a, _ = s.Application(u.ID, a.ID)
	if _, ok := a.Custom[f.ID]; ok {
		t.Fatal("field not removed")
	}
	_, e = s.SaveFields(u.ID, append(fields, Field{Name: "Extra", Type: "text"}), false)
	requireStatus(t, e, 400)
	// Fill directly to exercise the boundary without 999 redundant events.
	if e = s.transaction(func(tx *sql.Tx) error {
		for i := 0; i < 999; i++ {
			v := Application{ID: ID(), Company: "X", Position: "Y", HHID: "", Custom: map[string]any{}}
			if e := put(tx, u.ID, "application", v.ID, v); e != nil {
				return e
			}
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	_, e = s.SaveApplication(u.ID, Application{Company: "Limit", Position: "Developer"}, "", "manual")
	requireStatus(t, e, 400)
}
func TestTasksNotesAndBackupRestore(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "backup@example.com")
	a := testApp(t, s, u, "123")
	other := testUser(t, s, "outsider@example.com")
	task, e := s.SaveTask(u.ID, Task{Title: "Интервью", Kind: "interview", Date: "2026-10-10", Time: "10:30", ApplicationID: a.ID}, "task-key", "manual")
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.SaveTask(u.ID, Task{Title: "Интервью", Kind: "interview", Date: "2026-10-10", Time: "10:30", ApplicationID: a.ID}, "task-key", "manual")
	if e != nil || task.ID != again.ID {
		t.Fatal(e)
	}
	_, e = s.SaveTask(other.ID, Task{Title: "Hijack", Kind: "task", Date: "2026-10-10", ApplicationID: a.ID}, "", "manual")
	requireStatus(t, e, 404)
	n, e := s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "Заметка"}, "note-key", "manual")
	if e != nil {
		t.Fatal(e)
	}
	n2, e := s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "Заметка"}, "note-key", "manual")
	if e != nil || n.ID != n2.ID {
		t.Fatal(e)
	}
	_, _, token, e := s.Login(u.Email, "secure-test-password", "extension", "Chrome")
	if e != nil {
		t.Fatal(e)
	}
	calendarToken, e := s.EnableCalendar(u.ID, false)
	if e != nil {
		t.Fatal(e)
	}
	dir := filepath.Join(filepath.Dir(s.Path), "backups")
	backup, e := s.Backup(dir)
	if e != nil {
		t.Fatal(e)
	}
	a.Company = "После копии"
	if _, e = s.SaveApplication(u.ID, a, "", "manual"); e != nil {
		t.Fatal(e)
	}
	another, e := Open(s.Path)
	if e != nil {
		t.Fatal(e)
	}
	e = another.Restore(backup, dir)
	if e == nil {
		t.Fatal("restore allowed while live")
	}
	_ = another.Close()
	if e = s.Restore(backup, dir); e != nil {
		t.Fatal(e)
	}
	reopened, e := Open(s.Path)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	restored, e := reopened.Application(u.ID, a.ID)
	if e != nil || restored.Company != "Альфа" {
		t.Fatal(restored, e)
	}
	_, _, e = reopened.Authenticate(token)
	requireStatus(t, e, 401)
	_, e = reopened.CalendarFeed(calendarToken, "https://avari.example")
	requireStatus(t, e, 404)
	tasks, _ := reopened.Tasks(u.ID)
	if len(tasks) != 1 {
		t.Fatal("tasks lost")
	}
	bad := filepath.Join(dir, "corrupt.db")
	_ = os.WriteFile(bad, []byte("corrupt"), 0600)
	if CheckBackup(bad) == nil {
		t.Fatal("accepted invalid backup")
	}
}

func TestNoteEditingConflictAndIsolation(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "notes@example.com")
	other := testUser(t, s, "note-outsider@example.com")
	a := testApp(t, s, u, "123")
	n, e := s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "Первая версия"}, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	draft := n
	draft.Text = "После встречи"
	edited, e := s.UpdateNote(u.ID, draft, "manual")
	if e != nil || edited.Version != 2 {
		t.Fatal(edited, e)
	}
	_, e = s.UpdateNote(u.ID, draft, "manual")
	requireStatus(t, e, 409)
	_, e = s.UpdateNote(other.ID, edited, "manual")
	requireStatus(t, e, 404)
	events, e := s.Events(u.ID)
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, event := range events {
		if event.Kind == "note_updated" {
			found = true
		}
	}
	if !found {
		t.Fatal("note edit missing from history")
	}
}

func TestSchemaUpgradeAndFutureVersionGuard(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "migration@example.com")
	a := testApp(t, s, u, "123")
	path := s.Path
	if _, e := s.DB.Exec("DROP INDEX documents_application; DROP INDEX documents_status; DROP TABLE calendar_subscriptions; DROP TABLE password_resets; DROP TABLE extension_download_tokens; DELETE FROM schema_migrations WHERE version>=2"); e != nil {
		t.Fatal(e)
	}
	backup, e := s.Backup(filepath.Join(filepath.Dir(path), "backups"))
	if e != nil {
		t.Fatal("old schema backup", e)
	}
	s.Close()
	upgraded, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	detail, e := upgraded.Detail(u.ID, a.ID)
	if e != nil || detail.Application.Company != "Альфа" {
		t.Fatal(detail, e)
	}
	var version int
	if e = upgraded.DB.QueryRow("SELECT max(version) FROM schema_migrations").Scan(&version); e != nil || version != SchemaVersion {
		t.Fatal(version, e)
	}
	if e = CheckBackup(backup); e != nil {
		t.Fatal("old backup rejected", e)
	}
	if _, e = upgraded.DB.Exec("INSERT INTO schema_migrations(version) VALUES(?)", SchemaVersion+1); e != nil {
		t.Fatal(e)
	}
	upgraded.Close()
	if newer, e := Open(path); e == nil {
		newer.Close()
		t.Fatal("future database accepted")
	}
}

func TestRestoreCannotBypassLockThroughSymlink(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "symlink@example.com")
	a := testApp(t, s, u, "123")
	backup, e := s.Backup(filepath.Join(filepath.Dir(s.Path), "backups"))
	if e != nil {
		t.Fatal(e)
	}
	alias := filepath.Join(filepath.Dir(s.Path), "alias.db")
	if e = os.Symlink(s.Path, alias); e != nil {
		t.Fatal(e)
	}
	aliased, e := Open(alias)
	if e != nil {
		t.Fatal(e)
	}
	defer aliased.Close()
	if e = aliased.Restore(backup, filepath.Dir(backup)); e == nil {
		t.Fatal("live lock bypassed through symlink")
	}
	unchanged, e := s.Application(u.ID, a.ID)
	if e != nil || unchanged.Company != "Альфа" {
		t.Fatal(unchanged, e)
	}
}
