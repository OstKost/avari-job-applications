package core

import (
	"fmt"
	"testing"
	"time"
)

func TestDailyGoalsActionsAndPoints(t *testing.T) {
	s := testStore(t)
	// Inject deterministic time
	fixedTime, _ := time.Parse(time.RFC3339, "2026-10-18T10:00:00Z")
	s.Now = func() time.Time { return fixedTime }

	u := testUser(t, s, "daily-goal@example.com") // Europe/Moscow: 2026-10-18 13:00

	// 1. Initial summary: all zeroes, goal = 10
	summary, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Today != "2026-10-18" || summary.Timezone != "Europe/Moscow" || summary.Goal != 10 {
		t.Fatalf("unexpected initial summary: %+v", summary)
	}
	if summary.Total != 0 || summary.Added != 0 || summary.Applied != 0 {
		t.Fatalf("expected 0 points, got %+v", summary)
	}

	// 2. Vacancy created in 'saved' stage: +1 added, total = 1
	appSaved, err := s.SaveApplication(u.ID, Application{
		Company:  "Компания 1",
		Position: "Go Dev",
		Stage:    "saved",
		State:    "active",
	}, "k1", "manual")
	if err != nil {
		t.Fatal(err)
	}

	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 1 || summary.Applied != 0 || summary.Total != 1 {
		t.Fatalf("after saved app created: want added=1, total=1, got %+v", summary)
	}

	// 3. Edit vacancy (cosmetic change) -> no additional points
	appSaved.Company = "Компания 1 (изменено)"
	appSaved, err = s.SaveApplication(u.ID, appSaved, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 1 || summary.Applied != 0 || summary.Total != 1 {
		t.Fatalf("after cosmetic edit: points changed! %+v", summary)
	}

	// 4. Vacancy transitions from 'saved' to 'applied': +1 applied, total = 2
	appSaved.Stage = "applied"
	appSaved.AppliedDate = "2026-10-18"
	appSaved, err = s.SaveApplication(u.ID, appSaved, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 1 || summary.Applied != 1 || summary.Total != 2 {
		t.Fatalf("after transition to applied: want added=1, applied=1, total=2, got %+v", summary)
	}

	// 5. Subsequent stage change (applied -> interview) -> NO additional point (already applied)
	appSaved.Stage = "interview"
	appSaved, err = s.SaveApplication(u.ID, appSaved, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Applied != 1 || summary.Total != 2 {
		t.Fatalf("after stage to interview: dedupe failed, got %+v", summary)
	}

	// 6. Vacancy created already applied yields +2 (both created and applied)
	_, err = s.SaveApplication(u.ID, Application{
		Company:     "Компания 2",
		Position:    "Backend Lead",
		Stage:       "applied",
		AppliedDate: "2026-10-18",
		State:       "active",
	}, "k2", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 2 || summary.Applied != 2 || summary.Total != 4 {
		t.Fatalf("after vacancy created already applied: want added=2, applied=2, total=4, got %+v", summary)
	}

	// 7. Standalone task completion: +1 completedTasks, total = 5
	standaloneTask, err := s.SaveTask(u.ID, Task{
		Title: "Обновить резюме",
		Kind:  "task",
		Date:  "2026-10-18",
		State: "open",
	}, "t1", "manual")
	if err != nil {
		t.Fatal(err)
	}
	// Verify planned counts before completion
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.PlannedTasks != 1 || summary.CompletedTodayTasks != 0 {
		t.Fatalf("expected plannedTasks=1, completedTodayTasks=0, got %+v", summary)
	}

	// Complete standalone task
	standaloneTask.State = "done"
	standaloneTask, err = s.SaveTask(u.ID, standaloneTask, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.CompletedTasks != 1 || summary.Total != 5 || summary.CompletedTodayTasks != 1 {
		t.Fatalf("after completing standalone task: want completedTasks=1, total=5, completedTodayTasks=1, got %+v", summary)
	}

	// Reopen task and re-complete -> deduplication prevents repeating point!
	standaloneTask.State = "open"
	standaloneTask, err = s.SaveTask(u.ID, standaloneTask, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	standaloneTask.State = "done"
	standaloneTask, err = s.SaveTask(u.ID, standaloneTask, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.CompletedTasks != 1 || summary.Total != 5 {
		t.Fatalf("re-completing task must not award extra point: got %+v", summary)
	}

	// 8. Interview completion: +1 completedInterviews, total = 6
	interviewTask, err := s.SaveTask(u.ID, Task{
		Title:         "Собеседование с HR",
		Kind:          "interview",
		Date:          "2026-10-18",
		ApplicationID: appSaved.ID,
		State:         "open",
	}, "t2", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.PlannedInterviews != 1 || summary.CompletedTodayInterviews != 0 {
		t.Fatalf("plannedInterviews check failed: %+v", summary)
	}

	interviewTask.State = "done"
	interviewTask, err = s.SaveTask(u.ID, interviewTask, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.CompletedInterviews != 1 || summary.CompletedTodayInterviews != 1 || summary.Total != 6 {
		t.Fatalf("after interview completed: want completedInterviews=1, total=6, got %+v", summary)
	}

	// 9. Scheduled item for tomorrow does not count into planned today
	_, err = s.SaveTask(u.ID, Task{
		Title: "Завтрашняя задача",
		Kind:  "task",
		Date:  "2026-10-19",
		State: "open",
	}, "t3", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.PlannedTasks != 1 {
		t.Fatalf("tomorrow's task counted towards today's plannedTasks: %+v", summary)
	}
}

func TestTimezoneFreezing(t *testing.T) {
	s := testStore(t)
	// Day 1: 2026-10-18 22:30 UTC
	// In Europe/Moscow (UTC+3), it is 2026-10-19 01:30.
	t1, _ := time.Parse(time.RFC3339, "2026-10-18T22:30:00Z")
	s.Now = func() time.Time { return t1 }

	u := testUser(t, s, "tz-freeze@example.com") // Created with Europe/Moscow

	_, err := s.SaveApplication(u.ID, Application{
		Company:  "Freeze Test",
		Position: "Dev",
		Stage:    "saved",
		State:    "active",
	}, "k-tz", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Point was recorded for local_date 2026-10-19
	summary19, err := s.DailySummaryAt(u.ID, t1)
	if err != nil {
		t.Fatal(err)
	}
	if summary19.Today != "2026-10-19" || summary19.Total != 1 {
		t.Fatalf("expected 1 point on 2026-10-19, got %+v", summary19)
	}

	// Now user changes timezone to UTC or Atlantic/Azores (where 22:30 UTC is 2026-10-18)
	err = s.SetTimezone(u.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}

	// In UTC now, today is 2026-10-18. The point recorded yesterday in Moscow should NOT move to today!
	summaryUTC, err := s.DailySummaryAt(u.ID, t1)
	if err != nil {
		t.Fatal(err)
	}
	if summaryUTC.Today != "2026-10-18" {
		t.Fatalf("expected today to be 2026-10-18, got %s", summaryUTC.Today)
	}
	if summaryUTC.Total != 0 {
		t.Fatalf("point should be frozen to 2026-10-19 and NOT moved to 2026-10-18 on timezone change, got total=%d", summaryUTC.Total)
	}
}

func TestMigrationAndImportSeedingPointsZero(t *testing.T) {
	sourceStore, sourceUser, j := transferFixture(t)
	_ = sourceStore
	_ = sourceUser

	targetStore := testStore(t)
	nowStamp, _ := time.Parse(time.RFC3339, "2026-10-18T10:00:00Z")
	targetStore.Now = func() time.Time { return nowStamp }

	u := testUser(t, targetStore, "seed-zero@example.com")

	report := importChecked(t, targetStore, u.ID, ImportRequest{Journal: j})
	if report.NewApplications == 0 {
		t.Fatal("expected imported applications")
	}

	// Verify points in daily summary remain 0!
	summary, err := targetStore.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Total != 0 {
		t.Fatalf("imported items must not give points! got %+v", summary)
	}

	// Editing the imported application or marking it saved->applied again must still yield 0 (deduped)!
	apps, err := targetStore.Applications(u.ID)
	if err != nil || len(apps) == 0 {
		t.Fatal("no imported apps", err)
	}
	importedApp := apps[0]
	importedApp.Company = "Imported Co (Renamed)"
	importedApp, err = targetStore.SaveApplication(u.ID, importedApp, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	summary, err = targetStore.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Total != 0 {
		t.Fatalf("editing imported app should yield 0 points, got %+v", summary)
	}
}

func TestProposalResolveDailyGoals(t *testing.T) {
	s := testStore(t)
	nowStamp, _ := time.Parse(time.RFC3339, "2026-10-18T10:00:00Z")
	s.Now = func() time.Time { return nowStamp }

	u := testUser(t, s, "proposal-goals@example.com")

	// Observe a new vacancy from extension
	p, err := s.Observe(u.ID, Observation{
		HHID: "9999",
		URL:  "https://hh.ru/applicant/negotiations",
		Candidate: &Application{
			Company:     "Yandex",
			Position:    "Go dev",
			AppliedDate: "2026-10-18",
		},
		Status: "applied", // creates proposal with kind="create", stage="applied"
	})
	if err != nil || p == nil {
		t.Fatalf("observe failed: %v", err)
	}

	// Before resolving proposal, 0 points
	summary, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Total != 0 {
		t.Fatalf("proposal pending should not give points, got %+v", summary)
	}

	// Resolve proposal (apply)
	resolved, err := s.ResolveProposal(u.ID, p.ID, "apply", 0, nil)
	if err != nil {
		t.Fatalf("resolve proposal failed: %v", err)
	}
	if resolved.Status != "applied" {
		t.Fatalf("expected resolved applied, got %s", resolved.Status)
	}

	// Resolving response-page import proposal yields 0 points (historical response import)
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 0 || summary.Applied != 0 || summary.Total != 0 {
		fmt.Printf("Daily summary: %+v\n", summary)
		t.Fatalf("expected 0 points after resolving response-page import proposal; got %+v", summary)
	}

	// But a genuine favorite proposal gives added 1 point
	pFav, err := s.Observe(u.ID, Observation{
		HHID: "8888",
		URL:  "https://hh.ru/applicant/favorites",
		Candidate: &Application{
			Company:  "Ozon",
			Position: "Go engineer",
		},
		Status: "favorite",
	})
	if err != nil || pFav == nil {
		t.Fatalf("observe favorite failed: %v", err)
	}
	resolvedFav, err := s.ResolveProposal(u.ID, pFav.ID, "apply", 0, nil)
	if err != nil || resolvedFav.Status != "applied" {
		t.Fatalf("resolve favorite failed: %v", err)
	}

	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 1 || summary.Applied != 0 || summary.Total != 1 {
		t.Fatalf("expected added=1, applied=0, total=1 after resolving favorite proposal; got %+v", summary)
	}
}

func TestCompletionDedupeAcrossKindsAndDays(t *testing.T) {
	s := testStore(t)
	// Day 1: 2026-10-18
	t1, _ := time.Parse(time.RFC3339, "2026-10-18T10:00:00Z")
	s.Now = func() time.Time { return t1 }

	u := testUser(t, s, "dedupe-task@example.com") // Moscow UTC+3

	// Direction 1: task -> done, reopen, change to interview -> done on Day 2
	task1, err := s.SaveTask(u.ID, Task{
		Title: "Task 1",
		Kind:  "task",
		Date:  "2026-10-18",
		State: "open",
	}, "k1", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Complete task on day 1 -> 1 point (task_completed)
	task1.State = "done"
	task1, err = s.SaveTask(u.ID, task1, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	summary1, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary1.CompletedTasks != 1 || summary1.CompletedInterviews != 0 || summary1.Total != 1 {
		t.Fatalf("day 1 task completion: want completedTasks=1, total=1, got %+v", summary1)
	}

	// Reopen task on day 1
	task1.State = "open"
	task1, err = s.SaveTask(u.ID, task1, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Advance to Day 2: 2026-10-19
	t2, _ := time.Parse(time.RFC3339, "2026-10-19T10:00:00Z")
	s.Now = func() time.Time { return t2 }

	// Change kind to interview and complete on day 2
	task1.Kind = "interview"
	task1.Date = "2026-10-19"
	task1.State = "done"
	task1, err = s.SaveTask(u.ID, task1, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Summary on day 2 must have 0 points for completion!
	summary2, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary2.CompletedInterviews != 0 || summary2.CompletedTasks != 0 || summary2.Total != 0 {
		t.Fatalf("day 2 interview completion after task reopened: must be 0 points, got %+v", summary2)
	}

	// Summary on day 1 still has its original task_completed point
	summaryDay1Again, err := s.DailySummaryAt(u.ID, t1)
	if err != nil {
		t.Fatal(err)
	}
	if summaryDay1Again.CompletedTasks != 1 || summaryDay1Again.CompletedInterviews != 0 || summaryDay1Again.Total != 1 {
		t.Fatalf("day 1 summary should preserve first completion category: got %+v", summaryDay1Again)
	}

	// Direction 2: interview -> done, reopen, change to task -> done on Day 3
	t3, _ := time.Parse(time.RFC3339, "2026-10-20T10:00:00Z")
	s.Now = func() time.Time { return t3 }

	task2, err := s.SaveTask(u.ID, Task{
		Title: "Task 2 (Interview first)",
		Kind:  "interview",
		Date:  "2026-10-20",
		State: "open",
	}, "k2", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Complete interview on day 3 -> 1 point (interview_completed)
	task2.State = "done"
	task2, err = s.SaveTask(u.ID, task2, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	summary3, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary3.CompletedInterviews != 1 || summary3.CompletedTasks != 0 || summary3.Total != 1 {
		t.Fatalf("day 3 interview completion: want completedInterviews=1, total=1, got %+v", summary3)
	}

	// Reopen task2 on day 3
	task2.State = "open"
	task2, err = s.SaveTask(u.ID, task2, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Advance to Day 4: 2026-10-21
	t4, _ := time.Parse(time.RFC3339, "2026-10-21T10:00:00Z")
	s.Now = func() time.Time { return t4 }

	// Change kind to task and complete on day 4
	task2.Kind = "task"
	task2.Date = "2026-10-21"
	task2.State = "done"
	task2, err = s.SaveTask(u.ID, task2, "", "manual")
	if err != nil {
		t.Fatal(err)
	}

	summary4, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary4.CompletedInterviews != 0 || summary4.CompletedTasks != 0 || summary4.Total != 0 {
		t.Fatalf("day 4 task completion after interview reopened: must be 0 points, got %+v", summary4)
	}

	// Summary on day 3 still has its original interview_completed point
	summaryDay3Again, err := s.DailySummaryAt(u.ID, t3)
	if err != nil {
		t.Fatal(err)
	}
	if summaryDay3Again.CompletedInterviews != 1 || summaryDay3Again.CompletedTasks != 0 || summaryDay3Again.Total != 1 {
		t.Fatalf("day 3 summary should preserve first completion category: got %+v", summaryDay3Again)
	}
}

func TestHistoricalAppliedDateProposals(t *testing.T) {
	s := testStore(t)
	nowStamp, _ := time.Parse(time.RFC3339, "2026-10-18T10:00:00Z")
	s.Now = func() time.Time { return nowStamp }

	u := testUser(t, s, "historical-proposals@example.com")

	// 1. Existing application in saved stage with no appliedDate
	app, err := s.SaveApplication(u.ID, Application{
		Company:  "Old App Co",
		Position: "Developer",
		URL:      "https://hh.ru/vacancy/1111",
		Stage:    "saved",
		State:    "active",
	}, "k-app", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Initially 1 point for created
	summary, err := s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Total != 1 || summary.Added != 1 || summary.Applied != 0 {
		t.Fatalf("expected 1 added point, got %+v", summary)
	}

	// Proposal updates this application with historical appliedDate predating localToday (e.g. 2026-10-10)
	p, err := s.Observe(u.ID, Observation{
		HHID: "1111",
		URL:  "https://hh.ru/applicant/negotiations",
		Candidate: &Application{
			Company:     "Old App Co",
			Position:    "Developer",
			AppliedDate: "2026-10-10",
		},
		Status: "invitation",
	})
	if err != nil || p == nil {
		t.Fatalf("observe failed: %v", err)
	}

	// Resolve the proposal
	_, err = s.ResolveProposal(u.ID, p.ID, "apply", app.Version, nil)
	if err != nil {
		t.Fatal(err)
	}

	// Points should STILL be 1 (applied seeded with 0 points because predating localToday)
	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Applied != 0 || summary.Total != 1 {
		t.Fatalf("historical applied proposal should seed applied with 0 points: got %+v", summary)
	}

	// A genuine direct action on an application today counts
	appToday, err := s.SaveApplication(u.ID, Application{
		Company:     "Direct Action Co",
		Position:    "Lead",
		URL:         "https://hh.ru/vacancy/2222",
		Stage:       "applied",
		AppliedDate: "2026-10-18",
		State:       "active",
	}, "k-direct", "extension")
	if err != nil {
		t.Fatal(err)
	}
	_ = appToday

	summary, err = s.DailySummary(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Direct action adds +1 created, +1 applied => Total = 1 (old) + 2 = 3
	if summary.Added != 2 || summary.Applied != 1 || summary.Total != 3 {
		t.Fatalf("direct extension SaveApplication must award applied points: got %+v", summary)
	}
}

func TestMigration9To10UpgradeAndAccountIsolation(t *testing.T) {
	s := testStore(t)
	dbPath := s.Path

	// Seed data before migration 10 exists
	u1 := testUser(t, s, "user1-mig10@example.com")
	u2 := testUser(t, s, "user2-mig10@example.com")

	// User 1 has an application and a done task
	app1, err := s.SaveApplication(u1.ID, Application{
		Company:     "U1 Corp",
		Position:    "Engineer",
		Stage:       "applied",
		AppliedDate: "2026-10-17",
		SavedDate:   "2026-10-17",
		State:       "active",
	}, "k-u1-app", "manual")
	if err != nil {
		t.Fatal(err)
	}

	task1, err := s.SaveTask(u1.ID, Task{
		Title: "U1 Interview",
		Kind:  "interview",
		Date:  "2026-10-17",
		State: "done",
	}, "k-u1-task", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// User 2 has a saved application
	app2, err := s.SaveApplication(u2.ID, Application{
		Company:   "U2 Corp",
		Position:  "Designer",
		Stage:     "saved",
		SavedDate: "2026-10-17",
		State:     "active",
	}, "k-u2-app", "manual")
	if err != nil {
		t.Fatal(err)
	}

	// Roll back migration 10+: drop daily_goal_ledger and decrement schema_migrations to 9
	if _, err := s.DB.Exec("DROP TABLE IF EXISTS daily_goal_ledger; DELETE FROM schema_migrations WHERE version >= 10"); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()

	// Reopen store to trigger migration 9 -> 10
	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatalf("failed to reopen and run migration 10: %v", err)
	}
	defer reopened.Close()

	var version int
	if err := reopened.DB.QueryRow("SELECT max(version) FROM schema_migrations").Scan(&version); err != nil || version != SchemaVersion {
		t.Fatalf("expected schema version %d, got %d (err: %v)", SchemaVersion, version, err)
	}

	// Check table and index markers for migration 10
	var idxCount int
	if err := reopened.DB.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='daily_goal_ledger_completion'").Scan(&idxCount); err != nil || idxCount != 1 {
		t.Fatalf("expected daily_goal_ledger_completion index, got %d (err: %v)", idxCount, err)
	}

	// Migration 10 should have seeded 0 points for pre-existing records
	var u1Points, u2Points int
	if err := reopened.DB.QueryRow("SELECT coalesce(sum(points), 0) FROM daily_goal_ledger WHERE user_id=?", u1.ID).Scan(&u1Points); err != nil || u1Points != 0 {
		t.Fatalf("expected 0 points seeded for u1, got %d (err: %v)", u1Points, err)
	}
	if err := reopened.DB.QueryRow("SELECT coalesce(sum(points), 0) FROM daily_goal_ledger WHERE user_id=?", u2.ID).Scan(&u2Points); err != nil || u2Points != 0 {
		t.Fatalf("expected 0 points seeded for u2, got %d (err: %v)", u2Points, err)
	}

	// Verify account isolation: actions for u1 are NOT visible or mixed with u2
	fixedTime, _ := time.Parse(time.RFC3339, "2026-10-18T12:00:00Z")
	reopened.Now = func() time.Time { return fixedTime }

	// User 1 performs an action today
	_, err = reopened.SaveApplication(u1.ID, Application{
		Company:  "U1 New App",
		Position: "Go Dev",
		Stage:    "saved",
		State:    "active",
	}, "k-u1-today", "manual")
	if err != nil {
		t.Fatal(err)
	}

	sum1, err := reopened.DailySummary(u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	sum2, err := reopened.DailySummary(u2.ID)
	if err != nil {
		t.Fatal(err)
	}

	if sum1.Total != 1 || sum1.Added != 1 {
		t.Fatalf("u1 should have 1 point today, got %+v", sum1)
	}
	if sum2.Total != 0 {
		t.Fatalf("u2 should have 0 points, got %+v (account isolation failure)", sum2)
	}

	_ = app1
	_ = task1
	_ = app2
}
