package core

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCalendarFeedFormattingAndTimezones(t *testing.T) {
	u := User{Timezone: "Europe/Berlin"}
	tasks := []Task{
		{ID: "winter", Title: "Интервью, тест; \\ путь\nBEGIN:VEVENT", Kind: "interview", Date: "2026-01-20", Time: "10:30", State: "open", Version: 2, CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-02T00:00:00Z", ApplicationID: "app"},
		{ID: "summer", Title: "Летняя встреча", Date: "2026-07-20", Time: "10:30", State: "open", Version: 1, CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "date", Title: strings.Repeat("Длинная задача ", 30), Date: "2026-12-31", State: "open", Version: 1, CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "done", Title: "Выполнено", Date: "2026-01-20", State: "done"},
	}
	apps := []Application{{ID: "app", Company: "Компания", Position: "Go developer", UpdatedAt: "2026-01-03T00:00:00Z"}}
	feed, e := renderCalendar(u, tasks, apps, "https://avari.example")
	if e != nil {
		t.Fatal(e)
	}
	for _, line := range strings.Split(feed, "\r\n") {
		if len(line) > 75 || !utf8.ValidString(line) {
			t.Fatalf("invalid folded line: %q", line)
		}
	}
	unfolded := strings.ReplaceAll(feed, "\r\n ", "")
	for _, value := range []string{
		"BEGIN:VCALENDAR\r\nVERSION:2.0", "END:VCALENDAR\r\n",
		"DTSTART:20260120T093000Z", "DTSTART:20260720T083000Z",
		"DTSTART;VALUE=DATE:20261231", "DTEND;VALUE=DATE:20270101",
		"SEQUENCE:1", "UID:avari-task-winter@avari", "DTSTAMP:20260103T000000Z",
		"SUMMARY:Интервью\\, тест\\; \\\\ путь\\nBEGIN:VEVENT · Компания",
		"DESCRIPTION:Интервью в Avari.Jobs\\nКомпания · Go developer",
		"URL:https://avari.example/applications/app", tasks[2].Title,
	} {
		if !strings.Contains(unfolded, value) {
			t.Fatalf("missing %q in %s", value, unfolded)
		}
	}
	if strings.Count(unfolded, "BEGIN:VEVENT\r\n") != 3 || strings.Contains(unfolded, "avari-task-done") {
		t.Fatal("completed or injected event exported", unfolded)
	}
	again, e := renderCalendar(u, tasks, apps, "https://avari.example")
	if e != nil || feed != again {
		t.Fatal("unchanged calendar is not stable", e)
	}
}

func TestCalendarCapabilityIsolationAndLifecycle(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "calendar@example.com")
	other := testUser(t, s, "calendar-other@example.com")
	task, e := s.SaveTask(u.ID, Task{Title: "Личная встреча", Kind: "interview", Date: "2026-10-20", Time: "10:30"}, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.SaveTask(other.ID, Task{Title: "Чужая встреча", Date: "2026-10-20"}, "", "manual"); e != nil {
		t.Fatal(e)
	}
	token, e := s.EnableCalendar(u.ID, false)
	if e != nil || len(token) != 64 {
		t.Fatal("token", e)
	}
	again, e := s.EnableCalendar(u.ID, false)
	if e != nil || again != token {
		t.Fatal("enabling rotated an existing subscription", e)
	}
	feed, e := s.CalendarFeed(token, "https://avari.example")
	if e != nil || !strings.Contains(feed, "Личная встреча") || strings.Contains(feed, "Чужая встреча") || !strings.Contains(feed, "DTSTART:20261020T073000Z") {
		t.Fatal(feed, e)
	}
	if _, e := s.CalendarFeed(token[:32], ""); e == nil {
		t.Fatal("short token accepted")
	}
	task.Date, task.Time = "2026-10-22", "11:00"
	task, e = s.SaveTask(u.ID, task, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	updated, e := s.CalendarFeed(token, "https://avari.example")
	if e != nil || updated == feed || strings.Count(updated, "UID:avari-task-"+task.ID+"@avari") != 1 || !strings.Contains(updated, "DTSTART:20261022T080000Z") {
		t.Fatal(updated, e)
	}
	if e := s.SetTimezone(u.ID, "Asia/Tokyo"); e != nil {
		t.Fatal(e)
	}
	updated, e = s.CalendarFeed(token, "https://avari.example")
	if e != nil || !strings.Contains(updated, "DTSTART:20261022T020000Z") {
		t.Fatal(updated, e)
	}
	task.State = "done"
	if _, e = s.SaveTask(u.ID, task, "", "manual"); e != nil {
		t.Fatal(e)
	}
	updated, e = s.CalendarFeed(token, "https://avari.example")
	if e != nil || strings.Contains(updated, "BEGIN:VEVENT") {
		t.Fatal("completed task retained", updated, e)
	}
	rotated, e := s.EnableCalendar(u.ID, true)
	if e != nil || rotated == token {
		t.Fatal("rotation", e)
	}
	_, e = s.CalendarFeed(token, "")
	requireStatus(t, e, 404)
	if e = s.DisableCalendar(other.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.CalendarFeed(rotated, ""); e != nil {
		t.Fatal("other user disabled subscription", e)
	}
	if e = s.DisableCalendar(u.ID); e != nil {
		t.Fatal(e)
	}
	_, e = s.CalendarFeed(rotated, "")
	requireStatus(t, e, 404)
	for _, action := range []string{"block", "reset_password"} {
		token, e = s.EnableCalendar(u.ID, false)
		if e != nil {
			t.Fatal(e)
		}
		if e = s.Admin(action, u.ID, "replacement-password"); e != nil {
			t.Fatal(e)
		}
		if action == "block" {
			if e = s.Admin("unblock", u.ID, ""); e != nil {
				t.Fatal(e)
			}
		}
		_, e = s.CalendarFeed(token, "")
		requireStatus(t, e, 404)
	}
}
