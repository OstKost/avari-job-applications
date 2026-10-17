package core

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const (
	StaleInactivityHours      = 240
	AutomationInactivityHours = 48
	ReminderTaskTitle         = "Сделать отклик по вакансии"
	ReminderTriggerSource     = "system"
)

// HasMeaningfulActivityEvent checks if an event represents meaningful user activity.
// Stage/state change, note create/edit, task create/reschedule/complete count.
// Cosmetic/favorite/logo edits, empty saves, system reminder creation do not.
func HasMeaningfulActivityEvent(e Event) bool {
	switch e.Kind {
	case "created":
		// Initial manual creation of application counts as meaningful activity.
		return true
	case "updated", "proposal":
		if e.Changes == nil {
			return false
		}
		for field := range e.Changes {
			if field == "stage" || field == "state" {
				return true
			}
		}
		return false
	case "note":
		return true
	case "note_updated":
		if e.Changes == nil {
			return false
		}
		_, hasText := e.Changes["text"]
		return hasText
	case "task":
		if e.Source == ReminderTriggerSource {
			return false
		}
		if e.Changes == nil {
			// New task created without changes map
			return true
		}
		// Task creation has applicationId in changes diff
		if _, ok := e.Changes["applicationId"]; ok {
			return true
		}
		// Reschedule has date or time in changes
		if _, ok := e.Changes["date"]; ok {
			return true
		}
		if _, ok := e.Changes["time"]; ok {
			return true
		}
		// Status change / complete has state in changes
		if _, ok := e.Changes["state"]; ok {
			return true
		}
		// Title-only or kind-only edits, or empty no-ops do NOT count
		return false
	default:
		return false
	}
}

// ComputeLastActivity recovers the last meaningful activity timestamp for an application.
// Stage/state change, note create/edit, task create/reschedule/complete count.
// Cosmetic/favorite/logo edits, empty saves, system reminder creation do not.
// Fallback: application.CreatedAt.
func ComputeLastActivity(app Application, events []Event) time.Time {
	fallbackTime, err := time.Parse(time.RFC3339Nano, app.CreatedAt)
	if err != nil {
		fallbackTime, _ = time.Parse(timestampLayout, app.CreatedAt)
	}

	var latest time.Time
	for _, e := range events {
		if e.ApplicationID != app.ID {
			continue
		}
		if HasMeaningfulActivityEvent(e) {
			t, err := time.Parse(time.RFC3339Nano, e.CreatedAt)
			if err != nil {
				t, _ = time.Parse(timestampLayout, e.CreatedAt)
			}
			if t.After(latest) {
				latest = t
			}
		}
	}

	if latest.IsZero() {
		return fallbackTime
	}
	return latest
}

// EnrichApplication computes lastActivityAt and stale flag for an application.
func EnrichApplication(app Application, events []Event, now time.Time) Application {
	lastActivity := ComputeLastActivity(app, events)
	if !lastActivity.IsZero() {
		app.LastActivityAt = lastActivity.UTC().Format(timestampLayout)
	}

	// Meaningful inactivity > 240 hours and application is active
	if app.State == "active" && !lastActivity.IsZero() && now.Sub(lastActivity) > StaleInactivityHours*time.Hour {
		app.Stale = true
	} else {
		app.Stale = false
	}
	return app
}

// NextWeekdayInLocation returns the target date formatted as YYYY-MM-DD.
// If t is on a Saturday or Sunday, moves forward to the next Monday.
// Otherwise returns the date of t.
func NextWeekdayInLocation(t time.Time, loc *time.Location) string {
	inLoc := t.In(loc)
	weekday := inLoc.Weekday()
	if weekday == time.Saturday {
		inLoc = inLoc.AddDate(0, 0, 2)
	} else if weekday == time.Sunday {
		inLoc = inLoc.AddDate(0, 0, 1)
	}
	return inLoc.Format("2006-01-02")
}

// ReconcileReminders processes applications eligible for automatic reminders.
// - Explicit eligibility: only newly created live applications in reminder_eligibility (zero historic/imported)
// - Active, saved stage, no appliedDate
// - 48h since meaningful activity
// - Suppressed while any open linked task exists
// - Max 1 reminder lifetime per application (even if deleted by user)
func (s *Store) ReconcileReminders(ctx context.Context, now time.Time) error {
	return s.transaction(func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, "SELECT id,email,status,timezone,created_at FROM users ORDER BY created_at DESC")
		if err != nil {
			return err
		}
		defer rows.Close()
		users := []User{}
		for rows.Next() {
			var u User
			if err = rows.Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt); err != nil {
				return err
			}
			users = append(users, u)
		}
		if err = rows.Err(); err != nil {
			return err
		}

		for _, u := range users {
			loc, err := time.LoadLocation(u.Timezone)
			if err != nil {
				loc = time.UTC
			}

			// Load eligible applications for this user
			elRows, err := tx.QueryContext(ctx, "SELECT application_id FROM reminder_eligibility WHERE user_id=?", u.ID)
			if err != nil {
				return err
			}
			eligibleMap := map[string]bool{}
			for elRows.Next() {
				var aid string
				if err = elRows.Scan(&aid); err != nil {
					elRows.Close()
					return err
				}
				eligibleMap[aid] = true
			}
			elRows.Close()
			if err = elRows.Err(); err != nil {
				return err
			}
			if len(eligibleMap) == 0 {
				continue
			}

			// Load reminder records to avoid duplicate reminders over application lifetime
			recRows, err := tx.QueryContext(ctx, "SELECT application_id FROM reminder_records WHERE user_id=?", u.ID)
			if err != nil {
				return err
			}
			reminderCreatedMap := map[string]bool{}
			for recRows.Next() {
				var aid string
				if err = recRows.Scan(&aid); err != nil {
					recRows.Close()
					return err
				}
				reminderCreatedMap[aid] = true
			}
			recRows.Close()
			if err = recRows.Err(); err != nil {
				return err
			}

			apps, err := list[Application](tx, u.ID, "application")
			if err != nil {
				return err
			}
			events, err := list[Event](tx, u.ID, "event")
			if err != nil {
				return err
			}
			tasks, err := list[Task](tx, u.ID, "task")
			if err != nil {
				return err
			}

			// Pre-index tasks and events by application ID
			tasksByApp := map[string][]Task{}
			for _, t := range tasks {
				tasksByApp[t.ApplicationID] = append(tasksByApp[t.ApplicationID], t)
			}
			eventsByApp := map[string][]Event{}
			for _, e := range events {
				eventsByApp[e.ApplicationID] = append(eventsByApp[e.ApplicationID], e)
			}

			for _, a := range apps {
				// Eligible check (only live created applications after rollout)
				if !eligibleMap[a.ID] {
					continue
				}
				if a.State != "active" || a.Stage != "saved" || a.AppliedDate != "" {
					continue
				}

				// Check if automatic task was EVER created for this application
				if reminderCreatedMap[a.ID] {
					continue
				}

				// Check if any open task exists for this application
				hasOpenTask := false
				for _, t := range tasksByApp[a.ID] {
					if t.State == "open" {
						hasOpenTask = true
						break
					}
				}
				if hasOpenTask {
					continue
				}

				// Check 48h since meaningful activity
				lastActivity := ComputeLastActivity(a, eventsByApp[a.ID])
				if lastActivity.IsZero() || now.Sub(lastActivity) < AutomationInactivityHours*time.Hour {
					continue
				}

				// Trigger reminder!
				targetDate := NextWeekdayInLocation(now, loc)
				taskID := ID()
				remTask := Task{
					ID:            taskID,
					ApplicationID: a.ID,
					Title:         ReminderTaskTitle,
					Kind:          "task",
					Date:          targetDate,
					State:         "open",
					Version:       1,
					CreatedAt:     now.UTC().Format(timestampLayout),
					UpdatedAt:     now.UTC().Format(timestampLayout),
				}
				if err := put(tx, u.ID, "task", remTask.ID, remTask); err != nil {
					return err
				}

				// Record system event (does not count as meaningful activity)
				ev := Event{
					ID:            ID(),
					ApplicationID: a.ID,
					Kind:          "task",
					Source:        ReminderTriggerSource,
					Changes:       changes(Task{}, remTask),
					CreatedAt:     now.UTC().Format(timestampLayout),
				}
				if err := put(tx, u.ID, "event", ev.ID, ev); err != nil {
					return err
				}

				// Record in reminder_records
				if _, err := tx.ExecContext(ctx, "INSERT INTO reminder_records(user_id, application_id, task_id, created_at) VALUES(?,?,?,?)", u.ID, a.ID, taskID, now.UTC().Format(timestampLayout)); err != nil {
					return err
				}
				reminderCreatedMap[a.ID] = true
			}
		}
		return nil
	})
}

// OnApplicationStateOrStageChanged completes open automatic reminders when application is applied, paused, or closed.
func (s *Store) OnApplicationStateOrStageChanged(tx *sql.Tx, user string, app Application) error {
	// If application is moved out of active 'saved' without appliedDate (i.e. applied, or paused, or closed)
	shouldClose := app.State != "active" || app.Stage != "saved" || app.AppliedDate != ""
	if !shouldClose {
		return nil
	}

	var reminderTaskID string
	err := tx.QueryRow("SELECT task_id FROM reminder_records WHERE user_id=? AND application_id=?", user, app.ID).Scan(&reminderTaskID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if reminderTaskID == "" {
		return nil
	}

	t, err := get[Task](tx, user, "task", reminderTaskID)
	if err != nil {
		var appErr *Error
		if errors.As(err, &appErr) && appErr.Status == 404 {
			return nil
		}
		return err
	}

	if t.State == "open" {
		old := t
		t.State = "done"
		t.Version++
		t.UpdatedAt = now()
		if err := put(tx, user, "task", t.ID, t); err != nil {
			return err
		}
		if err := event(tx, user, app.ID, "task", ReminderTriggerSource, changes(old, t)); err != nil {
			return err
		}
	}
	return nil
}
