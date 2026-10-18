package core

import "time"

type ActivityDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type ActivityStatistics struct {
	Timezone string        `json:"timezone"`
	Days     []ActivityDay `json:"days"`
}

// ActivityStatistics counts recorded user actions, not visits or system work.
// Imported events retain their original timestamps and are counted just once.
func (s *Store) ActivityStatistics(user, from, to string) (ActivityStatistics, error) {
	result := ActivityStatistics{Days: []ActivityDay{}}
	start, err := time.Parse(time.DateOnly, from)
	if err != nil {
		return result, Fail(400, "Некорректная начальная дата")
	}
	end, err := time.Parse(time.DateOnly, to)
	if err != nil || end.Before(start) {
		return result, Fail(400, "Некорректная конечная дата")
	}
	// Bound allocation even for direct API callers; the page only requests 30/90 days.
	if end.Sub(start) > 366*24*time.Hour {
		return result, Fail(400, "Период не должен превышать 367 дней")
	}
	u, err := s.User(user)
	if err != nil {
		return result, err
	}
	loc, err := time.LoadLocation(u.Timezone)
	if err != nil {
		return result, err
	}
	result.Timezone = u.Timezone
	counts := map[string]int{}
	events, err := s.Events(user)
	if err != nil {
		return result, err
	}
	for _, e := range events {
		if !isStatisticsActivity(e) {
			continue
		}
		timestamp, err := time.Parse(time.RFC3339Nano, e.CreatedAt)
		if err != nil {
			continue
		}
		day := timestamp.In(loc).Format(time.DateOnly)
		if day >= from && day <= to {
			counts[day]++
		}
	}
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		date := day.Format(time.DateOnly)
		result.Days = append(result.Days, ActivityDay{Date: date, Count: counts[date]})
	}
	return result, nil
}

func isStatisticsActivity(e Event) bool {
	if e.ApplicationID == "" || (e.Source != "manual" && e.Source != "extension") {
		return false
	}
	switch e.Kind {
	case "created", "note":
		return true
	case "updated", "proposal", "task", "note_updated":
		for field := range e.Changes {
			switch field {
			case "id", "version", "createdAt", "updatedAt", "lastActivityAt", "stale":
				continue
			default:
				return true
			}
		}
	}
	return false
}
