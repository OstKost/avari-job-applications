package core

import (
	"context"
	"fmt"
	"time"
)

type DailySummary struct {
	Today                  string `json:"today"`
	Timezone               string `json:"timezone"`
	Goal                   int    `json:"goal"`
	Added                  int    `json:"added"`
	Applied                int    `json:"applied"`
	CompletedTasks         int    `json:"completedTasks"`
	CompletedInterviews    int    `json:"completedInterviews"`
	Total                  int    `json:"total"`
	PlannedTasks           int    `json:"plannedTasks"`
	PlannedInterviews      int    `json:"plannedInterviews"`
	CompletedTodayTasks    int    `json:"completedTodayTasks"`
	CompletedTodayInterviews int  `json:"completedTodayInterviews"`
}

const DailyGoalTarget = 10

// recordGoalAction records a goal action in daily_goal_ledger.
// If an entry already exists for (user_id, object_id, action), it is ignored (deduped).
// localDate should be the user's current local date in their account timezone.
// points is 1 for genuine actions, or 0 for backfill/seeds/imports.
func (s *Store) recordGoalAction(q queryer, user, objectID, action, localDate string, points int, nowStamp string) error {
	id := ID()
	_, err := q.ExecContext(context.Background(),
		`INSERT INTO daily_goal_ledger(id, user_id, action, object_id, local_date, points, created_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT DO NOTHING`,
		id, user, action, objectID, localDate, points, nowStamp,
	)
	return err
}

func (s *Store) userLocalDate(q queryer, user string, at time.Time) (string, string, error) {
	var tz string
	err := q.QueryRowContext(context.Background(), "SELECT timezone FROM users WHERE id=?", user).Scan(&tz)
	if err != nil {
		return "", "", err
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
		tz = "UTC"
	}
	return at.In(loc).Format("2006-01-02"), tz, nil
}

// DailySummary returns the daily summary for the user at the current store time.
func (s *Store) DailySummary(user string) (DailySummary, error) {
	return s.DailySummaryAt(user, s.nowTime())
}

// DailySummaryAt returns the daily summary for the user evaluated at the given time.
func (s *Store) DailySummaryAt(user string, at time.Time) (DailySummary, error) {
	var summary DailySummary
	summary.Goal = DailyGoalTarget

	today, tz, err := s.userLocalDate(s.DB, user, at)
	if err != nil {
		return summary, err
	}
	summary.Today = today
	summary.Timezone = tz

	rows, err := s.DB.QueryContext(context.Background(),
		`SELECT action, points FROM daily_goal_ledger WHERE user_id=? AND local_date=? AND points > 0`,
		user, today,
	)
	if err != nil {
		return summary, fmt.Errorf("query daily_goal_ledger: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var action string
		var points int
		if err := rows.Scan(&action, &points); err != nil {
			return summary, err
		}
		summary.Total += points
		switch action {
		case "created":
			summary.Added += points
		case "applied":
			summary.Applied += points
		case "task_completed":
			summary.CompletedTasks += points
		case "interview_completed":
			summary.CompletedInterviews += points
		}
	}
	if err := rows.Err(); err != nil {
		return summary, err
	}

	// Planned scheduled items for today from tasks
	tasks, err := list[Task](s.DB, user, "task")
	if err != nil {
		return summary, fmt.Errorf("list tasks for daily summary: %w", err)
	}

	for _, t := range tasks {
		if t.Date != today {
			continue
		}
		if t.Kind == "interview" {
			summary.PlannedInterviews++
			if t.State == "done" {
				summary.CompletedTodayInterviews++
			}
		} else {
			summary.PlannedTasks++
			if t.State == "done" {
				summary.CompletedTodayTasks++
			}
		}
	}

	return summary, nil
}
