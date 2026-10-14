package core

import (
	"encoding/json"
	"strings"
	"testing"
)

func transferFixture(t *testing.T) (*Store, User, Journal) {
	t.Helper()
	s := testStore(t)
	u := testUser(t, s, "source@example.com")
	a := testApp(t, s, u, "7654")
	fields, _ := s.Fields(u.ID)
	a.Custom[fields[0].ID] = "Высокий"
	var err error
	if a, err = s.SaveApplication(u.ID, a, "", "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveTask(u.ID, Task{ApplicationID: a.ID, Title: "Созвон", Kind: "interview", Date: "2026-10-20", Time: "10:00", State: "open"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "Заметка"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	j, err := s.ExportJournal(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	return s, u, j
}
func importChecked(t *testing.T, s *Store, user string, req ImportRequest) ImportReport {
	t.Helper()
	preview, err := s.ImportJournal(user, req, false)
	if err != nil || !preview.Ready {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	req.Revision = preview.Revision
	report, err := s.ImportJournal(user, req, true)
	if err != nil {
		t.Fatal(err)
	}
	return report
}
func TestJournalRoundtripMergeAndIdempotency(t *testing.T) {
	_, _, j := transferFixture(t)
	target := testStore(t)
	u := testUser(t, target, "target@example.com")
	report := importChecked(t, target, u.ID, ImportRequest{Journal: j})
	if report.NewApplications != 1 || report.NewTasks != 1 || report.NewNotes != 1 || report.NewEvents != len(j.Events) {
		t.Fatalf("report: %+v", report)
	}
	apps, _ := target.Applications(u.ID)
	tasks, _ := target.Tasks(u.ID)
	notes, _ := target.Notes(u.ID)
	fields, _ := target.Fields(u.ID)
	if apps[0].ID == j.Applications[0].ID || tasks[0].ApplicationID != apps[0].ID || notes[0].ApplicationID != apps[0].ID {
		t.Fatal("foreign ids were not remapped")
	}
	if err := validateCustom(apps[0].Custom, fields); err != nil {
		t.Fatal(err)
	}
	repeated := importChecked(t, target, u.ID, ImportRequest{Journal: j})
	if repeated.NewApplications+repeated.NewTasks+repeated.NewNotes+repeated.NewEvents != 0 || len(repeated.Conflicts) != 0 {
		t.Fatalf("duplicate import: %+v", repeated)
	}
	edited := notes[0]
	edited.Text = "Текущая заметка"
	if _, err := target.UpdateNote(u.ID, edited, "manual"); err != nil {
		t.Fatal(err)
	}
	tasks[0].State = "done"
	if _, err := target.SaveTask(u.ID, tasks[0], "", "manual"); err != nil {
		t.Fatal(err)
	}
	apps[0].Company = "Текущая компания"
	if _, err := target.SaveApplication(u.ID, apps[0], "", "manual"); err != nil {
		t.Fatal(err)
	}
	repeated = importChecked(t, target, u.ID, ImportRequest{Journal: j})
	if len(repeated.Conflicts) != 2 {
		t.Fatalf("conflicts: %+v", repeated)
	}
	after, _ := target.Notes(u.ID)
	afterTasks, _ := target.Tasks(u.ID)
	afterApps, _ := target.Applications(u.ID)
	if after[0].Text != "Текущая заметка" || afterTasks[0].State != "done" || afterApps[0].Company != "Текущая компания" {
		t.Fatal("current records overwritten")
	}
	// Re-exporting on another server retains provenance, so returning it merges.
	exported, err := target.ExportJournal(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	third := testStore(t)
	thirdUser := testUser(t, third, "third@example.com")
	importChecked(t, third, thirdUser.ID, ImportRequest{Journal: exported})
	back, _ := third.ExportJournal(thirdUser.ID)
	again := importChecked(t, target, u.ID, ImportRequest{Journal: back})
	if again.NewApplications+again.NewNotes+again.NewTasks+again.NewEvents != 0 {
		t.Fatalf("multi-hop duplicated records: %+v", again)
	}
}
func TestJournalMatchesURLAndKeepsUnlinkedDistinct(t *testing.T) {
	source, user, j := transferFixture(t)
	if _, err := source.SaveApplication(user.ID, Application{Company: "Same", Position: "Role"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	j, _ = source.ExportJournal(user.ID)
	target := testStore(t)
	u := testUser(t, target, "target@example.com")
	existing := testApp(t, target, u, "7654")
	if _, err := target.SaveApplication(u.ID, Application{Company: "Same", Position: "Role"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	r := importChecked(t, target, u.ID, ImportRequest{Journal: j})
	if r.MatchedApplications != 1 || r.NewApplications != 1 {
		t.Fatalf("matches: %+v", r)
	}
	tasks, _ := target.Tasks(u.ID)
	if tasks[0].ApplicationID != existing.ID {
		t.Fatal("URL match lost children")
	}
	self := importChecked(t, source, user.ID, ImportRequest{Journal: j})
	if self.NewApplications+self.NewTasks+self.NewNotes+self.NewEvents != 0 {
		t.Fatalf("same instance duplicated %+v", self)
	}
}
func TestJournalStalePreviewIsolationAndSecrets(t *testing.T) {
	s, u, j := transferFixture(t)
	other := testUser(t, s, "other@example.com")
	exported, _ := s.ExportJournal(other.ID)
	if len(exported.Applications) != 0 {
		t.Fatal("export leaked another account")
	}
	raw, _ := json.Marshal(j)
	for _, secret := range []string{"secure-test-password", "token_hash", "password", "calendar_subscriptions"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("export contains secret", secret)
		}
	}
	req := ImportRequest{Journal: j}
	preview, err := s.ImportJournal(other.ID, req, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddNote(u.ID, Note{ApplicationID: j.Applications[0].ID, Text: "Other user's changes"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	// Another account changing its journal does not invalidate this account's preview.
	req.Revision = preview.Revision
	if _, err = s.ImportJournal(other.ID, req, true); err != nil {
		t.Fatal(err)
	}
	req.Revision = ""
	preview, _ = s.ImportJournal(other.ID, req, false)
	if _, err = s.SaveApplication(other.ID, Application{Company: "New", Position: "New"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	req.Revision = preview.Revision
	_, err = s.ImportJournal(other.ID, req, true)
	requireStatus(t, err, 409)
	req.Revision = ""
	_, err = s.ImportJournal(other.ID, req, true)
	requireStatus(t, err, 409)
}
func TestJournalFieldMappingAndInvalidFileAtomicity(t *testing.T) {
	_, _, j := transferFixture(t)
	target := testStore(t)
	u := testUser(t, target, "target@example.com")
	j.Fields[0].Name = "Новый приоритет"
	req := ImportRequest{Journal: j}
	preview, err := target.ImportJournal(u.ID, req, false)
	if err != nil || preview.Ready || len(preview.FieldConflicts) != 1 {
		t.Fatalf("unresolved fields: %+v %v", preview, err)
	}
	apps, _ := target.Applications(u.ID)
	if len(apps) != 0 {
		t.Fatal("preview wrote data")
	}
	fields, _ := target.Fields(u.ID)
	req.FieldMapping = map[string]string{j.Fields[0].ID: fields[0].ID}
	importChecked(t, target, u.ID, req)
	before, _ := target.ExportJournal(u.ID)
	rawRequest, _ := json.Marshal(req)
	var copiedRequest ImportRequest
	_ = json.Unmarshal(rawRequest, &copiedRequest)
	req = copiedRequest
	req.Journal.Notes[0].ApplicationID = "missing"
	_, err = target.ImportJournal(u.ID, req, false)
	requireStatus(t, err, 400)
	after, _ := target.ExportJournal(u.ID)
	before.ExportedAt = ""
	after.ExportedAt = ""
	if digest(before) != digest(after) {
		t.Fatal("invalid file changed data")
	}
	req.Journal = j
	req.Journal.Version = 9
	_, err = target.ImportJournal(u.ID, req, false)
	requireStatus(t, err, 400)
	req.Journal = j
	req.FieldMapping = map[string]string{j.Fields[0].ID: "_skip"}
	fresh := testUser(t, target, "fresh@example.com")
	importChecked(t, target, fresh.ID, req)
	freshApps, _ := target.Applications(fresh.ID)
	if len(freshApps[0].Custom) != 0 {
		t.Fatal("explicitly skipped field imported")
	}
}
func TestJournalLimitAndSettings(t *testing.T) {
	_, _, j := transferFixture(t)
	s := testStore(t)
	u := testUser(t, s, "target@example.com")
	// Create the full limit without paying for 1000 history writes.
	a := j.Applications[0]
	for i := 0; i < 1000; i++ {
		a.ID = ID()
		a.URL = ""
		a.HHID = ""
		a.Custom = map[string]any{}
		if err := put(s.DB, u.ID, "application", a.ID, a); err != nil {
			t.Fatal(err)
		}
	}
	_, err := s.ImportJournal(u.ID, ImportRequest{Journal: j}, false)
	requireStatus(t, err, 400)
	count, _ := s.Applications(u.ID)
	if len(count) != 1000 {
		t.Fatal("limit failure wrote data")
	}
	fresh := testUser(t, s, "fresh@example.com")
	j.Settings.Timezone = "UTC"
	importChecked(t, s, fresh.ID, ImportRequest{Journal: j})
	got, _ := s.User(fresh.ID)
	if got.Timezone != "Europe/Moscow" {
		t.Fatal("settings unexpectedly replaced")
	}
	importChecked(t, s, fresh.ID, ImportRequest{Journal: j, ApplySettings: true})
	got, _ = s.User(fresh.ID)
	if got.Timezone != "UTC" {
		t.Fatal("settings not applied")
	}
}
func TestPersonalOwnerIsAtomicAndActive(t *testing.T) {
	s := testStore(t)
	u, err := s.RegisterOwner("owner@example.com", "secure-test-password", "UTC")
	if err != nil || u.Status != "active" {
		t.Fatal(u, err)
	}
	_, err = s.RegisterOwner("second@example.com", "secure-test-password", "UTC")
	requireStatus(t, err, 409)
}
