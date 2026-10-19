package httpapi

import (
	"testing"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func TestHTTPDailySummary(t *testing.T) {
	store, _, server := setup(t)
	fixedTime, _ := time.Parse(time.RFC3339, "2026-10-18T10:00:00Z")
	store.Now = func() time.Time { return fixedTime }

	path := "/api/v1/daily-summary"
	status, _, _ := call(t, server, "GET", path, nil, nil)
	if status != 401 {
		t.Fatalf("unauthenticated: expected 401, got %d", status)
	}

	user, err := store.Register("summary-api@example.com", "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Admin("approve", user.ID, ""); err != nil {
		t.Fatal(err)
	}

	status, login, _ := call(t, server, "POST", "/api/v1/auth/login", map[string]string{
		"email":    user.Email,
		"password": "secure-test-password",
		"kind":     "extension",
	}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	headers := map[string]string{"Authorization": "Bearer " + login["token"].(string)}

	// Initial daily summary
	status, body, _ := call(t, server, "GET", path, nil, headers)
	if status != 200 {
		t.Fatalf("expected 200, got %d: %+v", status, body)
	}
	if body["today"] != "2026-10-18" || body["timezone"] != "Europe/Moscow" || int(body["goal"].(float64)) != 10 {
		t.Fatalf("unexpected summary body: %+v", body)
	}
	if int(body["total"].(float64)) != 0 {
		t.Fatalf("expected 0 total points initially, got %+v", body)
	}

	// Create an application via API
	status, appBody, _ := call(t, server, "POST", "/api/v1/applications", core.Application{
		Company:  "Тестовая компания",
		Position: "Архитектор",
		Stage:    "saved",
		State:    "active",
	}, headers)
	if status != 200 {
		t.Fatalf("create application failed: %d %+v", status, appBody)
	}

	// Daily summary should reflect +1 added, +1 total
	status, body, _ = call(t, server, "GET", path, nil, headers)
	if status != 200 {
		t.Fatal(status, body)
	}
	if int(body["added"].(float64)) != 1 || int(body["total"].(float64)) != 1 {
		t.Fatalf("expected added=1, total=1; got %+v", body)
	}

	// Create a task scheduled for today
	status, taskBody, _ := call(t, server, "POST", "/api/v1/tasks", core.Task{
		Title: "Созвониться",
		Kind:  "task",
		Date:  "2026-10-18",
		State: "open",
	}, headers)
	if status != 200 {
		t.Fatalf("create task failed: %d %+v", status, taskBody)
	}

	// Planned tasks should now be 1
	status, body, _ = call(t, server, "GET", path, nil, headers)
	if status != 200 {
		t.Fatal(status, body)
	}
	if int(body["plannedTasks"].(float64)) != 1 || int(body["completedTodayTasks"].(float64)) != 0 {
		t.Fatalf("expected plannedTasks=1, completedTodayTasks=0; got %+v", body)
	}

	// Complete the task
	taskID := taskBody["id"].(string)
	status, _, _ = call(t, server, "PUT", "/api/v1/tasks/"+taskID, core.Task{
		ID:      taskID,
		Title:   "Созвониться",
		Kind:    "task",
		Date:    "2026-10-18",
		State:   "done",
		Version: int(taskBody["version"].(float64)),
	}, headers)
	if status != 200 {
		t.Fatalf("update task to done failed: %d", status)
	}

	// Check daily summary again
	status, body, _ = call(t, server, "GET", path, nil, headers)
	if status != 200 {
		t.Fatal(status, body)
	}
	if int(body["completedTasks"].(float64)) != 1 || int(body["completedTodayTasks"].(float64)) != 1 || int(body["total"].(float64)) != 2 {
		t.Fatalf("expected completedTasks=1, completedTodayTasks=1, total=2; got %+v", body)
	}
}
