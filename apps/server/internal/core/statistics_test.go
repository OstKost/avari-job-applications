package core

import (
	"testing"
	"time"
)

func TestActivityStatistics(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "statistics@example.com")
	other := testUser(t, s, "statistics-other@example.com")
	entries := []struct {
		user, date, kind, source, app string
		diff                          map[string]any
	}{
		{u.ID, "2026-10-01T20:59:59Z", "created", "manual", "a", nil},
		{u.ID, "2026-10-01T21:00:00Z", "note", "manual", "a", nil},
		{u.ID, "2026-10-02T09:00:00Z", "updated", "manual", "a", map[string]any{"stage": "hr", "state": "active"}},
		{u.ID, "2026-10-02T09:00:00Z", "proposal", "extension", "a", map[string]any{"stage": "interview"}},
		{u.ID, "2026-10-02T09:00:00Z", "task", "manual", "a", map[string]any{"state": "done"}},
		{u.ID, "2026-10-02T09:00:00Z", "note_updated", "extension", "a", map[string]any{"text": "changed"}},
		{u.ID, "2026-10-02T09:00:00Z", "task", "system", "a", map[string]any{"title": "reminder"}},
		{u.ID, "2026-10-02T09:00:00Z", "updated", "manual", "a", map[string]any{"version": 2, "lastActivityAt": "date"}},
		{u.ID, "2026-10-02T09:00:00Z", "task", "manual", "a", nil},
		{u.ID, "2026-10-02T09:00:00Z", "created", "manual", "", nil},
		{u.ID, "2026-10-02T09:00:00Z", "observation", "extension", "a", map[string]any{"status": "waiting"}},
		{other.ID, "2026-10-02T09:00:00Z", "created", "manual", "a", nil},
		{u.ID, "2026-10-04T00:00:00Z", "created", "manual", "a", nil},
	}
	for _, entry := range entries {
		e := Event{ID: ID(), ApplicationID: entry.app, Kind: entry.kind, Source: entry.source, Changes: entry.diff, CreatedAt: entry.date}
		if err := put(s.DB, entry.user, "event", e.ID, e); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.ActivityStatistics(u.ID, "2026-10-01", "2026-10-03")
	if err != nil {
		t.Fatal(err)
	}
	if got.Timezone != "Europe/Moscow" || len(got.Days) != 3 {
		t.Fatal(got)
	}
	for i, count := range []int{1, 5, 0} {
		if got.Days[i].Count != count {
			t.Fatalf("day %d: %+v", i, got.Days)
		}
	}
	// Re-reading imported history must not create or re-date any activity.
	again, err := s.ActivityStatistics(u.ID, "2026-10-01", "2026-10-03")
	if err != nil || again.Days[1].Count != 5 {
		t.Fatal(again, err)
	}
	if err := s.SetTimezone(u.ID, "UTC"); err != nil {
		t.Fatal(err)
	}
	utc, err := s.ActivityStatistics(u.ID, "2026-10-01", "2026-10-01")
	if err != nil || utc.Days[0].Count != 2 {
		t.Fatal(utc, err)
	}
	for _, dates := range [][2]string{{"", "2026-10-01"}, {"2026-02-30", "2026-03-01"}, {"2026-10-03", "2026-10-01"}, {"2025-01-01", "2026-10-01"}} {
		_, err := s.ActivityStatistics(u.ID, dates[0], dates[1])
		requireStatus(t, err, 400)
	}
}

func TestActivityStatisticsSavedActions(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "statistics-actions@example.com")
	a := testApp(t, s, u, "999123")
	// Saving the same vacancy and note text must not increase the count.
	if _, err := s.SaveApplication(u.ID, a, "", "manual"); err != nil {
		t.Fatal(err)
	}
	note, err := s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "note"}, "note-key", "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "note"}, "note-key", "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateNote(u.ID, note, "manual"); err != nil {
		t.Fatal(err)
	}
	date := time.Now().UTC().Format(time.DateOnly)
	task, err := s.SaveTask(u.ID, Task{ApplicationID: a.ID, Title: "task", Date: date}, "task-key", "extension")
	if err != nil {
		t.Fatal(err)
	}
	task.State = "done"
	if _, err := s.SaveTask(u.ID, task, "", "manual"); err != nil {
		t.Fatal(err)
	}
	got, err := s.ActivityStatistics(u.ID, time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly), time.Now().UTC().AddDate(0, 0, 1).Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, day := range got.Days {
		total += day.Count
	}
	if total != 4 {
		t.Fatalf("want creation, note, task, completion; got %d", total)
	}
}
