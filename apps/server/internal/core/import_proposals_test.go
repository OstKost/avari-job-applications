package core

import (
	"testing"
	"time"
)

func TestRecentResponseDates(t *testing.T) {
	for _, c := range []struct {
		date, today string
		want        bool
	}{
		{"2026-09-11", "2026-10-11", true}, {"2026-09-10", "2026-10-11", false},
		{"2026-10-12", "2026-10-11", false}, {"2026-02-28", "2026-03-31", true},
		{"2026-02-27", "2026-03-31", false}, {"2025-12-11", "2026-01-11", true},
		{"", "2026-10-11", false}, {"2026-02-31", "2026-03-31", false},
	} {
		if got := recentResponseDate(c.date, c.today); got != c.want {
			t.Fatalf("%+v: got %v", c, got)
		}
	}
}

func TestImportResponseProposal(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "import@example.com")
	today := localDate(s.DB, u.ID)
	observation := Observation{HHID: "123", URL: "https://rostov.hh.ru/applicant/negotiations", Status: "waiting", Candidate: &Application{Company: "Example", Position: "Developer", AppliedDate: today, URL: "https://hh.ru/vacancy/999", Stage: "offer"}}
	p, e := s.Observe(u.ID, observation)
	if e != nil || p == nil || p.Kind != "create" || p.ApplicationID != "" {
		t.Fatal(p, e)
	}
	if p.Current.URL != "https://hh.ru/vacancy/123" || p.Current.Stage != "applied" {
		t.Fatal("candidate identity or stage was trusted", p)
	}
	apps, _ := s.Applications(u.ID)
	if len(apps) != 0 {
		t.Fatal("application created before confirmation")
	}
	again, e := s.Observe(u.ID, observation)
	if e != nil || again != nil {
		t.Fatal("duplicate proposal", again, e)
	}
	observation.Status = "rejected"
	_, e = s.Observe(u.ID, observation)
	if e != nil {
		t.Fatal(e)
	}
	proposals, _ := s.Proposals(u.ID)
	if len(proposals) != 1 || proposals[0].DetectedStatus != "rejected" {
		t.Fatal("pending import should reflect latest status", proposals)
	}
	resolved, e := s.ResolveProposal(u.ID, p.ID, "apply", 0, nil)
	if e != nil || resolved.ApplicationID == "" {
		t.Fatal(resolved, e)
	}
	a, e := s.Application(u.ID, resolved.ApplicationID)
	if e != nil || a.Stage != "applied" || a.State != "closed" || a.Outcome != "employer_rejected" || a.ExternalStatus != "rejected" || a.AppliedDate != today {
		t.Fatal(a, e)
	}
	_, e = s.ResolveProposal(u.ID, p.ID, "apply", 0, nil)
	if e != nil {
		t.Fatal(e)
	}
	apps, _ = s.Applications(u.ID)
	if len(apps) != 1 {
		t.Fatal("duplicate application")
	}
	again, e = s.Observe(u.ID, observation)
	if e != nil || again != nil {
		t.Fatal("status duplicated after import", again, e)
	}
}

func TestImportDismissalManualSaveAndDateFiltering(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "import-filter@example.com")
	today := localDate(s.DB, u.ID)
	observation := Observation{HHID: "123", URL: "https://hh.ru/applicant/negotiations", Status: "viewed", Candidate: &Application{Company: "Example", Position: "Developer", AppliedDate: today}}
	p, e := s.Observe(u.ID, observation)
	if e != nil || p == nil {
		t.Fatal(p, e)
	}
	_, e = s.ResolveProposal(u.ID, p.ID, "dismiss", 0, nil)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Observe(u.ID, observation)
	if e != nil || again != nil {
		t.Fatal("dismissed proposal recreated")
	}
	observation.HHID = "456"
	p, e = s.Observe(u.ID, observation)
	if e != nil || p == nil {
		t.Fatal(p, e)
	}
	manual := testApp(t, s, u, "456")
	resolved, e := s.ResolveProposal(u.ID, p.ID, "apply", 0, nil)
	if e != nil || resolved.ApplicationID != manual.ID {
		t.Fatal(resolved, e)
	}
	a, _ := s.Application(u.ID, manual.ID)
	if a.Version != manual.Version || a.Stage != manual.Stage {
		t.Fatal("manual application overwritten", a)
	}
	observation.HHID = "789"
	for _, date := range []string{"", "invalid", "2000-01-01", time.Now().AddDate(0, 0, 2).Format("2006-01-02")} {
		observation.Candidate.AppliedDate = date
		p, e = s.Observe(u.ID, observation)
		if e != nil || p != nil {
			t.Fatal("imported invalid or out-of-range date", date, p, e)
		}
	}
	observation.URL = "https://hh.ru/vacancy/789"
	observation.Candidate.AppliedDate = today
	p, e = s.Observe(u.ID, observation)
	if e != nil || p != nil {
		t.Fatal("vacancy card cannot prove a recent response", p, e)
	}
}
