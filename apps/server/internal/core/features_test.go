package core

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestActivityAndStaleBoundaries(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "activity@example.com")

	app, err := s.SaveApplication(u.ID, Application{
		Company:  "ТестКомпани",
		Position: "Бэкенд",
		Stage:    "saved",
		State:    "active",
	}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// 1. Initial creation
	appCreatedTime, err := time.Parse(time.RFC3339Nano, app.CreatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if app.LastActivityAt == "" {
		t.Fatal("expected LastActivityAt to be set on creation")
	}

	// Check enriched app right after creation: not stale
	stored, err := s.Application(u.ID, app.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Stale {
		t.Fatal("new application should not be stale")
	}

	// 2. Test 240h boundary
	// Exactly at 240h: not stale (> 240h required)
	enriched240 := EnrichApplication(app, nil, appCreatedTime.Add(240*time.Hour))
	if enriched240.Stale {
		t.Fatal("application at exactly 240h should not be stale")
	}

	// At 240h + 1 minute: stale
	enriched240Plus := EnrichApplication(app, nil, appCreatedTime.Add(240*time.Hour+1*time.Minute))
	if !enriched240Plus.Stale {
		t.Fatal("application past 240h should be stale")
	}

	// If closed or paused: not stale even if > 240h
	appPaused := app
	appPaused.State = "paused"
	if EnrichApplication(appPaused, nil, appCreatedTime.Add(300*time.Hour)).Stale {
		t.Fatal("paused application should never be stale")
	}

	appClosed := app
	appClosed.State = "closed"
	appClosed.Outcome = "other"
	if EnrichApplication(appClosed, nil, appCreatedTime.Add(300*time.Hour)).Stale {
		t.Fatal("closed application should never be stale")
	}

	// 3. Meaningful activity resets timestamp
	// Non-meaningful update (e.g. favorite toggle)
	app.Favorite = true
	appFav, err := s.SaveApplication(u.ID, app, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	events, err := s.Events(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Meaningful activity should still point to original creation, not favorite toggle
	actAfterFav := ComputeLastActivity(appFav, events)
	if actAfterFav.Sub(appCreatedTime).Abs() > time.Second {
		t.Fatalf("expected last activity to remain close to creation %v, got %v", appCreatedTime, actAfterFav)
	}

	// Meaningful update: stage change
	time.Sleep(10 * time.Millisecond)
	appFav.Stage = "applied"
	appApplied, err := s.SaveApplication(u.ID, appFav, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	events, err = s.Events(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	actAfterStage := ComputeLastActivity(appApplied, events)
	if !actAfterStage.After(appCreatedTime) {
		t.Fatalf("stage change should advance activity timestamp: was %v, now %v", appCreatedTime, actAfterStage)
	}

	// Note creation advances activity
	time.Sleep(10 * time.Millisecond)
	note, err := s.AddNote(u.ID, Note{ApplicationID: app.ID, Text: "Позвонили рекрутеру"}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	events, err = s.Events(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	actAfterNote := ComputeLastActivity(appApplied, events)
	noteTime, _ := time.Parse(time.RFC3339Nano, note.CreatedAt)
	if !actAfterNote.Equal(noteTime) && !actAfterNote.After(actAfterStage) {
		t.Fatalf("note creation should update activity: %v vs %v", actAfterNote, noteTime)
	}
}

func TestAutomatedRemindersScheduleAndTimezones(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "reminder@example.com")

	// Set rollout cutoff in the past
	pastTime := time.Now().UTC().Add(-100 * time.Hour)
	_, err := s.DB.Exec("INSERT OR REPLACE INTO instance_metadata(key, value) VALUES('rollout_cutoff', ?)", pastTime.Format(timestampLayout))
	if err != nil {
		t.Fatal(err)
	}

	// Historic app created before rollout: ineligible
	historicApp, err := s.SaveApplication(u.ID, Application{
		Company:  "СтараяКомпания",
		Position: "Dev",
		Stage:    "saved",
		State:    "active",
	}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	// Backdate historic app
	historicStamp := pastTime.Add(-10 * time.Hour).Format(timestampLayout)
	_, err = s.DB.Exec("UPDATE documents SET payload = json_set(payload, '$.createdAt', ?) WHERE id=?", historicStamp, historicApp.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Reconcile reminders now - historic app should NOT get reminder
	ctx := context.Background()
	now := time.Now().UTC()
	if err := s.ReconcileReminders(ctx, now); err != nil {
		t.Fatal(err)
	}
	tasks, err := s.Tasks(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, tk := range tasks {
		if tk.ApplicationID == historicApp.ID {
			t.Fatal("historic app must not receive automatic reminder")
		}
	}

	// Eligible application created after rollout
	app, err := s.SaveApplication(u.ID, Application{
		Company:  "НоваяКомпания",
		Position: "Dev",
		Stage:    "saved",
		State:    "active",
	}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Test boundary: exactly 48h since creation
	appCreated, _ := time.Parse(time.RFC3339Nano, app.CreatedAt)
	if err := s.ReconcileReminders(ctx, appCreated.Add(47*time.Hour+59*time.Minute)); err != nil {
		t.Fatal(err)
	}
	tasks, _ = s.Tasks(u.ID)
	if len(tasks) != 0 {
		t.Fatal("reminder should not trigger before 48h")
	}

	// 48h reached on a Saturday -> should schedule for Monday
	saturday := time.Date(2026, 10, 24, 14, 0, 0, 0, time.UTC) // Saturday
	loc, _ := time.LoadLocation("Europe/Moscow")
	nextWk := NextWeekdayInLocation(saturday, loc)
	if nextWk != "2026-10-26" { // Monday
		t.Fatalf("expected Monday 2026-10-26, got %s", nextWk)
	}

	// Sunday -> Monday
	sunday := time.Date(2026, 10, 25, 14, 0, 0, 0, time.UTC)
	if NextWeekdayInLocation(sunday, loc) != "2026-10-26" {
		t.Fatalf("expected Monday 2026-10-26 from Sunday")
	}

	// Friday -> Friday (same day)
	friday := time.Date(2026, 10, 23, 14, 0, 0, 0, time.UTC)
	if NextWeekdayInLocation(friday, loc) != "2026-10-23" {
		t.Fatalf("expected Friday 2026-10-23 from Friday")
	}

	// Trigger reminder at 48h + 1 minute
	triggerTime := appCreated.Add(48*time.Hour + 1*time.Minute)
	if err := s.ReconcileReminders(ctx, triggerTime); err != nil {
		t.Fatal(err)
	}

	tasks, err = s.Tasks(u.ID)
	if err != nil || len(tasks) != 1 {
		t.Fatalf("expected 1 reminder task, got %d", len(tasks))
	}
	remTask := tasks[0]
	if remTask.Title != ReminderTaskTitle || remTask.State != "open" || remTask.Time != "" {
		t.Fatalf("unexpected reminder task: %+v", remTask)
	}

	// Verify idempotency: running reconcile again doesn't create duplicate
	if err := s.ReconcileReminders(ctx, triggerTime.Add(1*time.Hour)); err != nil {
		t.Fatal(err)
	}
	tasks, _ = s.Tasks(u.ID)
	if len(tasks) != 1 {
		t.Fatalf("reconcile created duplicate task: %d", len(tasks))
	}

	// User deletes the automatic task
	_, err = s.DB.Exec("DELETE FROM documents WHERE id=? AND kind='task'", remTask.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Running reconcile again must NOT recreate it (max 1 lifetime per application)
	if err := s.ReconcileReminders(ctx, triggerTime.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	tasks, _ = s.Tasks(u.ID)
	if len(tasks) != 0 {
		t.Fatalf("deleted reminder was recreated!")
	}
}

func TestAutomatedReminderCompletedOnApplyPauseClose(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "reminder_complete@example.com")

	now := time.Now().UTC()
	_, err := s.DB.Exec("INSERT OR REPLACE INTO instance_metadata(key, value) VALUES('rollout_cutoff', ?)", now.Add(-100*time.Hour).Format(timestampLayout))
	if err != nil {
		t.Fatal(err)
	}

	app, err := s.SaveApplication(u.ID, Application{
		Company:  "КомпанияЗакрытия",
		Position: "Dev",
		Stage:    "saved",
		State:    "active",
	}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Trigger reminder
	appCreated, _ := time.Parse(time.RFC3339Nano, app.CreatedAt)
	ctx := context.Background()
	if err := s.ReconcileReminders(ctx, appCreated.Add(50*time.Hour)); err != nil {
		t.Fatal(err)
	}

	tasks, _ := s.Tasks(u.ID)
	if len(tasks) != 1 || tasks[0].State != "open" {
		t.Fatalf("expected 1 open task, got %+v", tasks)
	}

	// Now apply the vacancy
	app.Stage = "applied"
	app.AppliedDate = "2026-10-20"
	if _, err := s.SaveApplication(u.ID, app, "", "manual"); err != nil {
		t.Fatal(err)
	}

	tasks, _ = s.Tasks(u.ID)
	if len(tasks) != 1 || tasks[0].State != "done" {
		t.Fatalf("expected task to be marked done on apply, got %+v", tasks)
	}
}

func TestResumeLifecycleAndBlobStorage(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "resumes@example.com")
	other := testUser(t, s, "other_resumes@example.com")

	pdfContent := []byte("%PDF-1.4 test resume pdf content")
	txtContent := []byte("plain text resume")
	invalidContent := []byte("corrupted non pdf")

	// 1. Validation errors
	_, err := s.CreateResume(u.ID, "Мое резюме", "resume.pdf", invalidContent)
	requireStatus(t, err, 400)

	_, err = s.CreateResume(u.ID, "Мое резюме", "resume.exe", []byte("MZ binary"))
	requireStatus(t, err, 400)

	// 2. Successful creation
	res, err := s.CreateResume(u.ID, "Резюме разработчика", "developer.pdf", pdfContent)
	if err != nil {
		t.Fatal(err)
	}
	if res.Title != "Резюме разработчика" || len(res.Versions) != 1 {
		t.Fatalf("unexpected created resume: %+v", res)
	}
	v1 := res.Versions[0]
	if v1.VersionNumber != 1 || v1.Format != "PDF" || v1.Filename != "developer.pdf" || v1.Size != int64(len(pdfContent)) {
		t.Fatalf("unexpected version 1: %+v", v1)
	}

	// Isolation: other user cannot see it
	_, err = s.Resume(other.ID, res.ID)
	requireStatus(t, err, 404)

	otherList, err := s.Resumes(other.ID)
	if err != nil || len(otherList) != 0 {
		t.Fatalf("user isolation failed: %+v", otherList)
	}

	// 3. Add version 2
	v2, err := s.AddResumeVersion(u.ID, res.ID, "developer-v2.txt", txtContent)
	if err != nil {
		t.Fatal(err)
	}
	if v2.VersionNumber != 2 || v2.Format != "TXT" {
		t.Fatalf("unexpected version 2: %+v", v2)
	}

	// List resumes
	list, err := s.Resumes(u.ID)
	if err != nil || len(list) != 1 || len(list[0].Versions) != 2 {
		t.Fatalf("expected 1 resume with 2 versions, got %+v", list)
	}

	// 4. Download version 1 and 2
	fn, fmt, sz, content, err := s.ResumeVersionDownload(u.ID, res.ID, v1.ID)
	if err != nil || fn != "developer.pdf" || fmt != "PDF" || sz != int64(len(pdfContent)) {
		t.Fatalf("download v1 failed: %v, %s, %s, %d", err, fn, fmt, sz)
	}
	data := make([]byte, sz)
	_, _ = content.Read(data)
	if string(data) != string(pdfContent) {
		t.Fatal("downloaded content mismatch for v1")
	}

	// Other user cannot download
	_, _, _, _, err = s.ResumeVersionDownload(other.ID, res.ID, v1.ID)
	requireStatus(t, err, 404)

	// 5. Rename resume
	renamed, err := s.RenameResume(u.ID, res.ID, "Новое название резюме")
	if err != nil || renamed.Title != "Новое название резюме" {
		t.Fatalf("rename failed: %v, %+v", err, renamed)
	}

	// 6. Delete version 1
	if err := s.DeleteResumeVersion(u.ID, res.ID, v1.ID); err != nil {
		t.Fatal(err)
	}
	resUpdated, err := s.Resume(u.ID, res.ID)
	if err != nil || len(resUpdated.Versions) != 1 || resUpdated.Versions[0].ID != v2.ID {
		t.Fatalf("expected 1 version remaining after deletion: %+v", resUpdated)
	}

	// 7. Delete last version (v2) -> removes resume automatically
	if err := s.DeleteResumeVersion(u.ID, res.ID, v2.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.Resume(u.ID, res.ID)
	requireStatus(t, err, 404)

	listAfterAllDelete, err := s.Resumes(u.ID)
	if err != nil || len(listAfterAllDelete) != 0 {
		t.Fatalf("empty resume was not removed after last version deleted: %+v", listAfterAllDelete)
	}
}

func TestResumeBackupAndRestore(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "backup_resume@example.com")

	pdfContent := []byte("%PDF-1.4 durable resume content")
	res, err := s.CreateResume(u.ID, "Архивное резюме", "archive.pdf", pdfContent)
	if err != nil {
		t.Fatal(err)
	}

	backupDir := t.TempDir()
	backupPath, err := s.Backup(backupDir)
	if err != nil {
		t.Fatal(err)
	}

	// Verify CheckBackup passes on the new schema with blob table
	if err := CheckBackup(backupPath); err != nil {
		t.Fatalf("backup check failed: %v", err)
	}

	// Now restore into a fresh store
	restoreDir := t.TempDir()
	restoreStore, err := Open(filepath.Join(restoreDir, "restored.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restoreStore.Close()

	if err := restoreStore.Restore(backupPath, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(filepath.Join(restoreDir, "restored.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()

	// Verify restored resume and blob content
	restoredList, err := reopened.Resumes(u.ID)
	if err != nil || len(restoredList) != 1 {
		t.Fatalf("restore failed to preserve resume: %v, %+v", err, restoredList)
	}
	v := restoredList[0].Versions[0]
	_, _, sz, content, err := reopened.ResumeVersionDownload(u.ID, res.ID, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	data := make([]byte, sz)
	_, _ = content.Read(data)
	if string(data) != string(pdfContent) {
		t.Fatal("restored resume content mismatch")
	}
}
