package core

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Status    string `json:"status"`
	Timezone  string `json:"timezone"`
	CreatedAt string `json:"createdAt"`
}
type PasswordResetRequest struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	UserEmail string `json:"userEmail,omitempty"`
	CreatedAt string `json:"createdAt"`
}
type Session struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
	UserID    string `json:"-"`
}
type Salary struct {
	Min      *float64 `json:"min"`
	Max      *float64 `json:"max"`
	Currency string   `json:"currency"`
	Period   string   `json:"period"`
	Tax      string   `json:"tax"`
}
type Application struct {
	Favorite       bool           `json:"favorite"`
	Groups         []string       `json:"groups"`
	Tags           []string       `json:"tags"`
	ID             string         `json:"id"`
	Company        string         `json:"company"`
	Position       string         `json:"position"`
	URL            string         `json:"url"`
	HHID           string         `json:"hhId"`
	SavedDate      string         `json:"savedDate"`
	AppliedDate    string         `json:"appliedDate"`
	Stage          string         `json:"stage"`
	State          string         `json:"state"`
	Outcome        string         `json:"outcome"`
	Salary         Salary         `json:"salary"`
	Location       string         `json:"location"`
	WorkFormat     string         `json:"workFormat"`
	Recruiter      string         `json:"recruiter"`
	CompanyLogo    string         `json:"companyLogo,omitempty"`
	ExternalStatus string         `json:"externalStatus"`
	Custom         map[string]any `json:"custom"`
	Version        int            `json:"version"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
}
type Task struct {
	ID            string `json:"id"`
	ApplicationID string `json:"applicationId"`
	Title         string `json:"title"`
	Kind          string `json:"kind"`
	Date          string `json:"date"`
	Time          string `json:"time"`
	State         string `json:"state"`
	Version       int    `json:"version"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
}
type Note struct {
	ID            string `json:"id"`
	ApplicationID string `json:"applicationId"`
	Text          string `json:"text"`
	CreatedAt     string `json:"createdAt"`
	Version       int    `json:"version"`
}
type Event struct {
	ID            string         `json:"id"`
	ApplicationID string         `json:"applicationId"`
	Kind          string         `json:"kind"`
	Source        string         `json:"source"`
	Changes       map[string]any `json:"changes"`
	CreatedAt     string         `json:"createdAt"`
}
type Field struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	Options []string `json:"options"`
	Role    string   `json:"role"`
}
type Observation struct {
	Candidate     *Application `json:"candidate,omitempty"`
	ID            string       `json:"id"`
	ApplicationID string       `json:"applicationId"`
	HHID          string       `json:"hhId"`
	VacancyURL    string       `json:"vacancyUrl,omitempty"`
	Status        string       `json:"status"`
	URL           string       `json:"url"`
	CreatedAt     string       `json:"createdAt"`
}
type Proposal struct {
	Kind           string         `json:"kind,omitempty"`
	ID             string         `json:"id"`
	ApplicationID  string         `json:"applicationId"`
	ObservationID  string         `json:"observationId"`
	Status         string         `json:"status"`
	DetectedStatus string         `json:"detectedStatus"`
	URL            string         `json:"url"`
	Current        Application    `json:"current"`
	Changes        map[string]any `json:"changes"`
	CreatedAt      string         `json:"createdAt"`
	Source         string         `json:"source"`
}
type Audit struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	UserID    string `json:"userId"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"createdAt"`
}
type Error struct {
	Status  int
	Message string
	Current any
}

func (e *Error) Error() string              { return e.Message }
func Fail(status int, message string) error { return &Error{Status: status, Message: message} }

const timestampLayout = "2006-01-02T15:04:05.000000000Z07:00"

func now() string             { return time.Now().UTC().Format(timestampLayout) }
func textLength(s string) int { return utf8.RuneCountInString(s) }
func oneOf(s string, options ...string) bool {
	for _, o := range options {
		if s == o {
			return true
		}
	}
	return false
}
func ValidDate(s string) bool {
	t, e := time.Parse("2006-01-02", s)
	return e == nil && t.Format("2006-01-02") == s
}

var hhPath = regexp.MustCompile(`^/vacancy/(\d+)(?:/|$)`)

func NormalizeURL(raw string) (string, string, error) {
	if raw == "" {
		return "", "", nil
	}
	u, e := url.Parse(raw)
	if e != nil || !oneOf(u.Scheme, "http", "https") || u.Hostname() == "" || u.User != nil {
		return "", "", Fail(400, "Укажите корректную ссылку HTTP или HTTPS")
	}
	if canonical, site := canonicalJobURL(u); canonical != "" {
		id := ""
		if site == "hh.ru" {
			id = hhPath.FindStringSubmatch(u.Path)[1]
		}
		return canonical, id, nil
	}
	return raw, "", nil
}
func (a *Application) Validate() error {
	if len(a.Groups) > 1 {
		return Fail(400, "Можно выбрать только одну группу")
	}
	groups := []string{}
	for _, group := range a.Groups {
		group = strings.TrimSpace(group)
		if group == "" || textLength(group) > 100 {
			return Fail(400, "Название группы должно содержать от 1 до 100 символов")
		}
		groups = append(groups, group)
	}
	a.Groups = groups

	if len(a.Tags) > 30 {
		return Fail(400, "Можно указать до 30 тегов")
	}
	tags := []string{}
	seenTags := map[string]bool{}
	for _, tag := range a.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || textLength(tag) > 100 {
			return Fail(400, "Название тега должно содержать от 1 до 100 символов")
		}
		key := strings.ToLower(tag)
		if !seenTags[key] {
			tags = append(tags, tag)
			seenTags[key] = true
		}
	}
	a.Tags = tags
	a.Company = strings.TrimSpace(a.Company)
	a.Position = strings.TrimSpace(a.Position)
	if a.Company == "" || a.Position == "" || textLength(a.Company) > 500 || textLength(a.Position) > 500 {
		return Fail(400, "Укажите компанию и позицию (до 500 символов)")
	}
	if !oneOf(a.Stage, "saved", "applied", "hr", "interview", "final", "offer") || !oneOf(a.State, "active", "paused", "closed") {
		return Fail(400, "Некорректный этап или состояние")
	}
	if a.State == "closed" && !oneOf(a.Outcome, "employer_rejected", "self_rejected", "vacancy_closed", "offer_accepted", "other") {
		return Fail(400, "Выберите результат закрытия")
	}
	if a.State != "closed" {
		a.Outcome = ""
	}
	if !ValidDate(a.SavedDate) || (a.AppliedDate != "" && !ValidDate(a.AppliedDate)) {
		return Fail(400, "Некорректная дата")
	}
	if a.Salary.Min != nil && *a.Salary.Min < 0 || a.Salary.Max != nil && *a.Salary.Max < 0 || a.Salary.Min != nil && a.Salary.Max != nil && *a.Salary.Min > *a.Salary.Max {
		return Fail(400, "Некорректный диапазон зарплаты")
	}
	if !oneOf(a.Salary.Period, "", "month", "year", "hour", "project") || !oneOf(a.Salary.Tax, "", "gross", "net") {
		return Fail(400, "Некорректные параметры зарплаты")
	}
	if textLength(a.Location) > 500 || textLength(a.WorkFormat) > 500 || textLength(a.Recruiter) > 2000 || len(a.URL) > 2048 || len(a.CompanyLogo) > 2048 || textLength(a.Salary.Currency) > 12 {
		return Fail(400, "Поле превышает допустимую длину")
	}
	if a.CompanyLogo != "" {
		lu, err := url.Parse(a.CompanyLogo)
		if err != nil || !oneOf(lu.Scheme, "http", "https") || lu.Hostname() == "" {
			return Fail(400, "Ссылка на логотип должна быть корректным URL (HTTP или HTTPS)")
		}
	}
	u, id, e := NormalizeURL(a.URL)
	if e != nil {
		return e
	}
	if a.HHID != "" && id == "" {
		return Fail(400, "ID hh.ru должен соответствовать ссылке вакансии")
	}
	if a.HHID != "" && a.HHID != id {
		return Fail(400, "ID hh.ru не соответствует ссылке")
	}
	a.URL = u
	a.HHID = id
	if a.Custom == nil {
		a.Custom = map[string]any{}
	}
	return nil
}
func (t *Task) Validate() error {
	t.Title = strings.TrimSpace(t.Title)
	if t.Title == "" || textLength(t.Title) > 500 || !oneOf(t.Kind, "task", "interview") || !oneOf(t.State, "open", "done") || !ValidDate(t.Date) {
		return Fail(400, "Проверьте название, тип, дату и состояние задачи")
	}
	if t.Time != "" {
		v, e := time.Parse("15:04", t.Time)
		if e != nil || v.Format("15:04") != t.Time {
			return Fail(400, "Некорректное время")
		}
	}
	return nil
}
func validateCustom(values map[string]any, fields []Field) error {
	byID := map[string]Field{}
	for _, f := range fields {
		byID[f.ID] = f
	}
	for id, v := range values {
		f, ok := byID[id]
		if !ok {
			return Fail(400, "Неизвестное custom-поле")
		}
		if v == nil || v == "" {
			continue
		}
		valid := false
		switch f.Type {
		case "text":
			s, ok := v.(string)
			valid = ok && textLength(s) <= 5000
		case "number":
			_, valid = v.(float64)
		case "date":
			s, ok := v.(string)
			valid = ok && ValidDate(s)
		case "flag":
			_, valid = v.(bool)
		case "select":
			s, ok := v.(string)
			valid = ok && oneOf(s, f.Options...)
		}
		if !valid {
			return Fail(400, fmt.Sprintf("Некорректное значение поля «%s»", f.Name))
		}
	}
	return nil
}
func changes(before, after any) map[string]any {
	var a, b map[string]any
	x, _ := json.Marshal(before)
	y, _ := json.Marshal(after)
	_ = json.Unmarshal(x, &a)
	_ = json.Unmarshal(y, &b)
	out := map[string]any{}
	for k, v := range b {
		if oneOf(k, "version", "updatedAt", "id", "createdAt") {
			continue
		}
		x, _ := json.Marshal(a[k])
		y, _ := json.Marshal(v)
		if string(x) != string(y) {
			out[k] = map[string]any{"before": a[k], "after": v}
		}
	}
	return out
}

type Detail struct {
	Application Application `json:"application"`
	Notes       []Note      `json:"notes"`
	Events      []Event     `json:"events"`
	Tasks       []Task      `json:"tasks"`
	Proposals   []Proposal  `json:"proposals"`
}
