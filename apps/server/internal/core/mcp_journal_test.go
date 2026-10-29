package core

import (
	"testing"
)

func ptr[T any](v T) *T { return &v }

func TestMCPJournalSearch(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "journal@example.com")
	other := testUser(t, s, "journal-other@example.com")
	fields, err := s.SaveFields(u.ID, []Field{{Name: "Приоритет", Type: "select", Role: "priority", Options: []string{"Высокий", "Низкий"}}, {Name: "Описание", Type: "text"}}, false)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.SaveApplication(u.ID, Application{Company: "АВАРИ", Position: "Go Engineer", URL: "https://example.com/alpha", Location: "Москва", WorkFormat: "Удалённо", Recruiter: "Мария", Groups: []string{"Разработка"}, Tags: []string{"Go"}, Favorite: true, Custom: map[string]any{fields[0].ID: "Высокий", fields[1].ID: "Распределённые системы"}}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.SaveApplication(u.ID, Application{Company: "Beta", Position: "Designer", State: "closed", Outcome: "other"}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveApplication(other.ID, Application{Company: "Secret", Position: "Private"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveTask(u.ID, Task{ApplicationID: a.ID, Title: "Позвонить", Date: a.SavedDate}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveTask(u.ID, Task{ApplicationID: b.ID, Title: "Готово", Date: b.SavedDate, State: "done"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddNote(u.ID, Note{ApplicationID: a.ID, Text: "invisible-note"}, "", "manual"); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"авари", "ENGINEER", "EXAMPLE.COM", "мОСКВА", "удалённо", "мария", "разработка", "go", "высокий", "распределённые"} {
		t.Run(query, func(t *testing.T) {
			out, err := s.SearchMCPApplications(u.ID, MCPSearchInput{Query: query})
			if err != nil || out.Total != 1 || out.Applications[0].ID != a.ID {
				t.Fatal(out, err)
			}
		})
	}
	cases := []struct {
		name  string
		in    MCPSearchInput
		total int
	}{
		{"all", MCPSearchInput{}, 2},
		{"and", MCPSearchInput{Filters: MCPFilters{Stage: "saved", State: "active", Favorite: ptr(true), Group: "Разработка", Tag: "Go", Priority: "Высокий", HasTask: ptr(true), Company: "ва", Position: "engineer", Location: "моск", WorkFormat: "удал"}}, 1},
		{"ungrouped", MCPSearchInput{Filters: MCPFilters{Ungrouped: true}}, 1},
		{"false", MCPSearchInput{Filters: MCPFilters{Favorite: ptr(false), HasTask: ptr(false)}}, 1},
		{"closed", MCPSearchInput{Filters: MCPFilters{State: "closed"}}, 1},
		{"exact tag", MCPSearchInput{Filters: MCPFilters{Tag: "go"}}, 0},
		{"mismatch", MCPSearchInput{Filters: MCPFilters{Stage: "offer"}}, 0},
		{"notes excluded", MCPSearchInput{Query: "invisible-note"}, 0},
		{"foreign excluded", MCPSearchInput{Query: "Secret"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := s.SearchMCPApplications(u.ID, tc.in)
			if err != nil || out.Total != tc.total {
				t.Fatal(out, err)
			}
		})
	}
	first, err := s.SearchMCPApplications(u.ID, MCPSearchInput{Limit: ptr(1)})
	if err != nil || len(first.Applications) != 1 || !first.HasMore || first.Total != 2 || first.Applications[0].ID != b.ID {
		t.Fatal(first, err)
	}
	second, err := s.SearchMCPApplications(u.ID, MCPSearchInput{Limit: ptr(1), Offset: 1})
	if err != nil || len(second.Applications) != 1 || second.HasMore || first.Applications[0].ID == second.Applications[0].ID {
		t.Fatal(second, err)
	}
	empty, err := s.SearchMCPApplications(u.ID, MCPSearchInput{Offset: 100})
	if err != nil || len(empty.Applications) != 0 || empty.Applications == nil || empty.Total != 2 {
		t.Fatal(empty, err)
	}
	for _, in := range []MCPSearchInput{{Limit: ptr(0)}, {Limit: ptr(101)}, {Offset: -1}, {Filters: MCPFilters{Group: "x", Ungrouped: true}}, {Filters: MCPFilters{Stage: "bad"}}, {Filters: MCPFilters{State: "bad"}}} {
		_, err := s.SearchMCPApplications(u.ID, in)
		requireStatus(t, err, 400)
	}
}

func TestMCPJournalUpdate(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "edit@example.com")
	other := testUser(t, s, "edit-other@example.com")
	fields, err := s.SaveFields(u.ID, []Field{{Name: "One", Type: "text"}, {Name: "Two", Type: "text"}}, false)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.SaveApplication(u.ID, Application{Company: "ACME", Position: "Go", URL: "https://hh.ru/vacancy/123", CompanyLogo: "https://example.com/logo.png", Location: "Москва", Groups: []string{"Group"}, Tags: []string{"Go"}, Salary: Salary{Min: ptr(100.0), Max: ptr(200.0), Currency: "RUB", Tax: "net"}, Custom: map[string]any{fields[0].ID: "one", fields[1].ID: "two"}}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := s.UpdateMCPApplication(u.ID, a.ID, a.Version, MCPUpdateFields{Position: ptr("Senior Go"), Location: ptr(""), CompanyLogo: ptr(""), Groups: ptr([]string{}), Tags: ptr([]string{}), Salary: &Salary{Min: ptr(300.0), Currency: "USD"}, Custom: map[string]any{fields[0].ID: nil}})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Company != a.Company || updated.Position != "Senior Go" || updated.Location != "" || updated.CompanyLogo != "" || len(updated.Groups) != 0 || len(updated.Tags) != 0 || updated.Salary.Max != nil || updated.Salary.Tax != "" || updated.Custom[fields[1].ID] != "two" || updated.Version != a.Version+1 || updated.CreatedAt != a.CreatedAt {
		t.Fatal(updated)
	}
	if _, ok := updated.Custom[fields[0].ID]; ok {
		t.Fatal("custom value not removed", updated.Custom)
	}
	stored, err := s.Application(u.ID, a.ID)
	if err != nil || stored.CompanyLogo != "" {
		t.Fatal(stored, err)
	}
	_, err = s.UpdateMCPApplication(u.ID, a.ID, a.Version, MCPUpdateFields{Position: ptr("stale")})
	requireStatus(t, err, 409)
	_, err = s.UpdateMCPApplication(other.ID, a.ID, updated.Version, MCPUpdateFields{Position: ptr("foreign")})
	requireStatus(t, err, 404)
	for _, patch := range []MCPUpdateFields{{}, {Company: ptr("")}, {State: ptr("closed")}, {Stage: ptr("bad")}, {Custom: map[string]any{"unknown": "bad"}}, {Salary: &Salary{Min: ptr(200.0), Max: ptr(100.0)}}} {
		_, err = s.UpdateMCPApplication(u.ID, a.ID, updated.Version, patch)
		requireStatus(t, err, 400)
	}
	updated, err = s.UpdateMCPApplication(u.ID, a.ID, updated.Version, MCPUpdateFields{URL: ptr("https://example.com/new?utm_source=test"), Stage: ptr("applied"), Favorite: ptr(true), Custom: map[string]any{fields[1].ID: "changed"}})
	if err != nil || updated.HHID != "" || updated.URL != "https://example.com/new" || updated.Stage != "applied" || !updated.Favorite || updated.Custom[fields[1].ID] != "changed" {
		t.Fatal(updated, err)
	}
	duplicate, _, err := s.SaveMCPApplication(u.ID, Application{Company: "Other", Position: "Go", URL: "https://example.com/duplicate"}, "duplicate")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.UpdateMCPApplication(u.ID, a.ID, updated.Version, MCPUpdateFields{URL: ptr(duplicate.URL + "?utm_source=x")})
	requireStatus(t, err, 409)
	updated, err = s.UpdateMCPApplication(u.ID, a.ID, updated.Version, MCPUpdateFields{URL: ptr(""), State: ptr("closed"), Outcome: ptr("other"), SavedDate: ptr("2026-01-01"), AppliedDate: ptr("2026-01-02")})
	if err != nil || updated.URL != "" || updated.HHID != "" || updated.State != "closed" || updated.Outcome != "other" || updated.SavedDate != "2026-01-01" || updated.AppliedDate != "2026-01-02" {
		t.Fatal(updated, err)
	}
	events, err := s.Events(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range events {
		if e.ApplicationID == a.ID && e.Kind == "updated" && e.Source == "mcp" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing MCP history")
	}
}
