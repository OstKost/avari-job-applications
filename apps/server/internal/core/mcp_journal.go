package core

import (
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
)

type MCPFilters struct {
	Stage      string `json:"stage,omitempty"`
	State      string `json:"state,omitempty"`
	Favorite   *bool  `json:"favorite,omitempty"`
	Group      string `json:"group,omitempty"`
	Ungrouped  bool   `json:"ungrouped,omitempty"`
	Tag        string `json:"tag,omitempty"`
	Priority   string `json:"priority,omitempty"`
	HasTask    *bool  `json:"hasTask,omitempty"`
	Company    string `json:"company,omitempty"`
	Position   string `json:"position,omitempty"`
	Location   string `json:"location,omitempty"`
	WorkFormat string `json:"workFormat,omitempty"`
}

type MCPSearchInput struct {
	Query   string     `json:"query,omitempty"`
	Filters MCPFilters `json:"filters,omitempty"`
	Limit   *int       `json:"limit,omitempty" jsonschema:"Page size, default 20, maximum 100"`
	Offset  int        `json:"offset,omitempty"`
}

type MCPSearchResult struct {
	Applications []Application `json:"applications"`
	Total        int           `json:"total"`
	HasMore      bool          `json:"hasMore"`
}

func (s *Store) SearchMCPApplications(user string, in MCPSearchInput) (MCPSearchResult, error) {
	out := MCPSearchResult{Applications: []Application{}}
	limit := 20
	if in.Limit != nil {
		limit = *in.Limit
	}
	f := in.Filters
	if limit < 1 || limit > 100 || in.Offset < 0 {
		return out, Fail(400, "Проверьте limit (1–100) и offset (от 0)")
	}
	if f.Group != "" && f.Ungrouped {
		return out, Fail(400, "Нельзя совместить group и ungrouped")
	}
	if f.Stage != "" && !oneOf(f.Stage, "saved", "applied", "hr", "interview", "final", "offer") || f.State != "" && !oneOf(f.State, "active", "paused", "closed") {
		return out, Fail(400, "Некорректный этап или состояние")
	}
	apps, err := s.Applications(user)
	if err != nil {
		return out, err
	}
	fields, err := s.Fields(user)
	if err != nil {
		return out, err
	}
	priorityID := ""
	for _, field := range fields {
		if field.Role == "priority" {
			priorityID = field.ID
		}
	}
	openTasks := map[string]bool{}
	if f.HasTask != nil {
		tasks, err := s.Tasks(user)
		if err != nil {
			return out, err
		}
		for _, task := range tasks {
			if task.State == "open" {
				openTasks[task.ApplicationID] = true
			}
		}
	}
	contains := func(value, query string) bool {
		return strings.Contains(strings.ToLower(value), strings.ToLower(strings.TrimSpace(query)))
	}
	matches := []Application{}
	for _, a := range apps {
		if f.Stage != "" && a.Stage != f.Stage || f.State != "" && a.State != f.State || f.Favorite != nil && a.Favorite != *f.Favorite {
			continue
		}
		if f.Group != "" && !oneOf(f.Group, a.Groups...) || f.Ungrouped && len(a.Groups) != 0 || f.Tag != "" && !oneOf(f.Tag, a.Tags...) {
			continue
		}
		if f.Priority != "" && (priorityID == "" || a.Custom[priorityID] != f.Priority) || f.HasTask != nil && openTasks[a.ID] != *f.HasTask {
			continue
		}
		if !contains(a.Company, f.Company) || !contains(a.Position, f.Position) || !contains(a.Location, f.Location) || !contains(a.WorkFormat, f.WorkFormat) {
			continue
		}
		texts := []string{a.Company, a.Position, a.URL, a.Location, a.WorkFormat, a.Recruiter}
		texts = append(texts, a.Groups...)
		texts = append(texts, a.Tags...)
		for _, field := range fields {
			if oneOf(field.Type, "text", "select") {
				if value, ok := a.Custom[field.ID].(string); ok {
					texts = append(texts, value)
				}
			}
		}
		found := strings.TrimSpace(in.Query) == ""
		for _, value := range texts {
			if contains(value, in.Query) {
				found = true
				break
			}
		}
		if found {
			matches = append(matches, a)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if a.SavedDate != b.SavedDate {
			return a.SavedDate > b.SavedDate
		}
		if a.CreatedAt != b.CreatedAt {
			return a.CreatedAt > b.CreatedAt
		}
		return a.ID < b.ID
	})
	out.Total = len(matches)
	if in.Offset >= out.Total {
		return out, nil
	}
	end := in.Offset + min(limit, out.Total-in.Offset)
	out.Applications = matches[in.Offset:end]
	out.HasMore = end < out.Total
	return out, nil
}

// MCPUpdateFields is an explicit allowlist; omitted values remain unchanged.
type MCPUpdateFields struct {
	Company     *string        `json:"company,omitempty"`
	Position    *string        `json:"position,omitempty"`
	URL         *string        `json:"url,omitempty"`
	Salary      *Salary        `json:"salary,omitempty"`
	Location    *string        `json:"location,omitempty"`
	WorkFormat  *string        `json:"workFormat,omitempty"`
	Recruiter   *string        `json:"recruiter,omitempty"`
	CompanyLogo *string        `json:"companyLogo,omitempty"`
	Groups      *[]string      `json:"groups,omitempty"`
	Tags        *[]string      `json:"tags,omitempty"`
	Favorite    *bool          `json:"favorite,omitempty"`
	Stage       *string        `json:"stage,omitempty"`
	State       *string        `json:"state,omitempty"`
	Outcome     *string        `json:"outcome,omitempty"`
	SavedDate   *string        `json:"savedDate,omitempty"`
	AppliedDate *string        `json:"appliedDate,omitempty"`
	Custom      map[string]any `json:"custom,omitempty"`
}

func (s *Store) UpdateMCPApplication(user, id string, version int, patch MCPUpdateFields) (Application, error) {
	var result Application
	raw, err := json.Marshal(patch)
	if err != nil {
		return result, Fail(400, "Неверные значения полей")
	}
	if string(raw) == "{}" {
		return result, Fail(400, "Укажите изменения")
	}
	err = s.transaction(func(tx *sql.Tx) error {
		a, err := get[Application](tx, user, "application", id)
		if err != nil {
			return err
		}
		if a.Version != version {
			return &Error{Status: 409, Message: "Запись изменилась. Сравните актуальные значения", Current: a}
		}
		custom := a.Custom
		if custom == nil {
			custom = map[string]any{}
		}
		if err = json.Unmarshal(raw, &a); err != nil {
			return err
		}
		for key, value := range patch.Custom {
			if value == nil {
				delete(custom, key)
			} else {
				custom[key] = value
			}
		}
		a.Custom = custom
		if patch.URL != nil {
			a.URL, a.HHID = strings.TrimSpace(*patch.URL), ""
		}
		if patch.URL != nil && a.URL != "" {
			normalized, err := MCPVacancyURL(*patch.URL)
			if err != nil {
				return err
			}
			a.URL, a.HHID = normalized, ""
			duplicate, err := mcpDuplicate(tx, user, normalized)
			if err != nil {
				return err
			}
			if duplicate != nil && duplicate.ID != id {
				return &Error{Status: 409, Message: "Эта вакансия уже есть в журнале", Current: *duplicate}
			}
		}
		result, err = s.saveApplicationTx(tx, user, a, "", "mcp")
		return err
	})
	return result, err
}
