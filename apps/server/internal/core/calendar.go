package core

import (
	"database/sql"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Calendar subscriptions are independent, read-only capabilities, not sessions.
func (s *Store) CalendarToken(user string) (string, error) {
	var token string
	e := s.DB.QueryRow("SELECT token FROM calendar_subscriptions WHERE user_id=?", user).Scan(&token)
	if e == sql.ErrNoRows {
		return "", nil
	}
	return token, e
}

func (s *Store) EnableCalendar(user string, rotate bool) (string, error) {
	var token string
	e := s.transaction(func(tx *sql.Tx) error {
		candidate := ID() + ID()
		query := "INSERT INTO calendar_subscriptions(user_id,token) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING"
		if rotate {
			query = "INSERT INTO calendar_subscriptions(user_id,token) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token"
		}
		if _, e := tx.Exec(query, user, candidate); e != nil {
			return e
		}
		return tx.QueryRow("SELECT token FROM calendar_subscriptions WHERE user_id=?", user).Scan(&token)
	})
	return token, e
}

func (s *Store) DisableCalendar(user string) error {
	_, e := s.DB.Exec("DELETE FROM calendar_subscriptions WHERE user_id=?", user)
	return e
}

func (s *Store) CalendarFeed(token, origin string) (string, error) {
	if raw, e := hex.DecodeString(token); e != nil || len(raw) != 32 {
		return "", Fail(404, "Календарь не найден")
	}
	var user User
	var tasks []Task
	var applications []Application
	e := s.transaction(func(tx *sql.Tx) error {
		e := tx.QueryRow(`SELECT u.id,u.timezone FROM calendar_subscriptions c JOIN users u ON u.id=c.user_id WHERE c.token=? AND u.status='active'`, token).Scan(&user.ID, &user.Timezone)
		if e == sql.ErrNoRows {
			return Fail(404, "Календарь не найден")
		}
		if e != nil {
			return e
		}
		if tasks, e = list[Task](tx, user.ID, "task"); e != nil {
			return e
		}
		applications, e = list[Application](tx, user.ID, "application")
		return e
	})
	if e != nil {
		return "", e
	}
	return renderCalendar(user, tasks, applications, origin)
}

func calendarText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.NewReplacer("\\", "\\\\", ";", "\\;", ",", "\\,", "\n", "\\n").Replace(value)
}

// RFC 5545 folds at 75 octets, without splitting a UTF-8 code point.
func calendarLine(out *strings.Builder, line string) {
	limit := 75
	for len(line) > limit {
		n := limit
		for !utf8.RuneStart(line[n]) {
			n--
		}
		out.WriteString(line[:n])
		out.WriteString("\r\n ")
		line = line[n:]
		limit = 74
	}
	out.WriteString(line)
	out.WriteString("\r\n")
}

func calendarStamp(raw string) string {
	t, e := time.Parse(time.RFC3339Nano, raw)
	if e != nil {
		return "19700101T000000Z"
	}
	return t.UTC().Format("20060102T150405Z")
}

func renderCalendar(user User, tasks []Task, applications []Application, origin string) (string, error) {
	loc, e := time.LoadLocation(user.Timezone)
	if e != nil {
		return "", e
	}
	apps := map[string]Application{}
	for _, app := range applications {
		apps[app.ID] = app
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].ID < tasks[j].ID })
	var out strings.Builder
	line := func(value string) { calendarLine(&out, value) }
	line("BEGIN:VCALENDAR")
	line("VERSION:2.0")
	line("PRODID:-//Avari.Jobs//Job applications//RU")
	line("CALSCALE:GREGORIAN")
	line("X-WR-CALNAME:Avari.Jobs — поиск работы")
	line("X-WR-TIMEZONE:" + calendarText(user.Timezone))
	line("REFRESH-INTERVAL;VALUE=DURATION:PT1H")
	line("X-PUBLISHED-TTL:PT1H")
	for _, task := range tasks {
		if task.State != "open" {
			continue
		}
		stamp := task.UpdatedAt
		if stamp == "" {
			stamp = task.CreatedAt
		}
		summary := task.Title
		description := "Задача в Avari.Jobs"
		if task.Kind == "interview" {
			description = "Интервью в Avari.Jobs"
		}
		eventURL := strings.TrimRight(origin, "/") + "/"
		if app, ok := apps[task.ApplicationID]; ok {
			summary += " · " + app.Company
			description += "\n" + app.Company + " · " + app.Position
			eventURL += "applications/" + app.ID
			if app.UpdatedAt > stamp {
				stamp = app.UpdatedAt
			}
		}
		line("BEGIN:VEVENT")
		line("UID:avari-task-" + task.ID + "@avari")
		line("DTSTAMP:" + calendarStamp(stamp))
		line("LAST-MODIFIED:" + calendarStamp(stamp))
		line(fmt.Sprintf("SEQUENCE:%d", task.Version-1))
		if task.Time == "" {
			date, e := time.Parse("2006-01-02", task.Date)
			if e != nil {
				return "", e
			}
			line("DTSTART;VALUE=DATE:" + date.Format("20060102"))
			line("DTEND;VALUE=DATE:" + date.AddDate(0, 0, 1).Format("20060102"))
			line("TRANSP:TRANSPARENT")
		} else {
			start, e := time.ParseInLocation("2006-01-02 15:04", task.Date+" "+task.Time, loc)
			if e != nil {
				return "", e
			}
			line("DTSTART:" + start.UTC().Format("20060102T150405Z"))
			// No duration is stored in Avari.Jobs; a timed event denotes a start only.
			line("TRANSP:OPAQUE")
		}
		line("SUMMARY:" + calendarText(summary))
		line("DESCRIPTION:" + calendarText(description))
		line("URL:" + eventURL)
		line("STATUS:CONFIRMED")
		line("END:VEVENT")
	}
	line("END:VCALENDAR")
	return out.String(), nil
}
