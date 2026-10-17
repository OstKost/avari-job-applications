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

func TestFavoriteProposal(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "favorite@example.com")
	o := Observation{HHID: "987", URL: "https://rostov.hh.ru/applicant/favorites?tab=vacancies", Status: "favorite", Candidate: &Application{Company: "Example", Position: "Developer"}}
	p, err := s.Observe(u.ID, o)
	if err != nil || p == nil || p.Kind != "create" {
		t.Fatal(p, err)
	}
	again, err := s.Observe(u.ID, o)
	if err != nil || again != nil {
		t.Fatal("duplicate", again, err)
	}
	resolved, err := s.ResolveProposal(u.ID, p.ID, "apply", 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Application(u.ID, resolved.ApplicationID)
	if err != nil || !a.Favorite || a.Stage != "saved" || a.AppliedDate != "" || a.ExternalStatus != "" {
		t.Fatal(a, err)
	}
	o.URL, o.Status, o.Candidate = "https://hh.ru/vacancy/987", "viewed", nil
	p, err = s.Observe(u.ID, o)
	if err != nil || p == nil {
		t.Fatal(p, err)
	}
	resolved, err = s.ResolveProposal(u.ID, p.ID, "apply", a.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	a, _ = s.Application(u.ID, resolved.ApplicationID)
	if !a.Favorite || a.Stage != "applied" {
		t.Fatal(a)
	}
	o.Status = "favorite"
	p, err = s.Observe(u.ID, o)
	if err != nil || p != nil {
		t.Fatal("already favorite", p, err)
	}
}

func TestFavoriteExistingApplicationPreservesStatus(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "favorite-existing@example.com")
	a := Application{Company: "Example", Position: "Developer", URL: "https://hh.ru/vacancy/876", Stage: "interview", State: "active", SavedDate: localDate(s.DB, u.ID), ExternalStatus: "interview"}
	a, err := s.SaveApplication(u.ID, a, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	a.ExternalStatus = "interview"
	if err = put(s.DB, u.ID, "application", a.ID, a); err != nil {
		t.Fatal(err)
	}
	o := Observation{HHID: "876", URL: a.URL, Status: "favorite"}
	p, err := s.Observe(u.ID, o)
	if err != nil || p == nil {
		t.Fatal(p, err)
	}
	if len(p.Changes) != 1 || p.Changes["favorite"] != true {
		t.Fatal(p.Changes)
	}
	_, err = s.ResolveProposal(u.ID, p.ID, "apply", a.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	a, _ = s.Application(u.ID, a.ID)
	if !a.Favorite || a.ExternalStatus != "interview" || a.Stage != "interview" {
		t.Fatal(a)
	}
}

func TestOtherSiteFavoriteLists(t *testing.T) {
	for _, pair := range [][2]string{
		{"https://www.linkedin.com/my-items/saved-jobs/", "https://www.linkedin.com/jobs/view/123"},
		{"https://hirify.me/account/favorites", "https://hirify.me/jobs/123"},
		{"https://career.habr.com/vacancies", "https://career.habr.com/vacancies/123"},
	} {
		t.Run(pair[0], func(t *testing.T) {
			s := testStore(t)
			u := testUser(t, s, "favorite-list@example.com")
			o := Observation{URL: pair[0], VacancyURL: pair[1], Status: "favorite", Candidate: &Application{Company: "Example", Position: "Developer"}}
			p, err := s.Observe(u.ID, o)
			if err != nil || p == nil || p.Kind != "create" {
				t.Fatal(p, err)
			}
			again, err := s.Observe(u.ID, o)
			if err != nil || again != nil {
				t.Fatal("duplicate", again, err)
			}
			resolved, err := s.ResolveProposal(u.ID, p.ID, "apply", 0, nil)
			if err != nil {
				t.Fatal(err)
			}
			a, err := s.Application(u.ID, resolved.ApplicationID)
			if err != nil || !a.Favorite || a.Stage != "saved" || a.AppliedDate != "" {
				t.Fatal(a, err)
			}
			o.Status = "viewed"
			if _, err = s.Observe(u.ID, o); err == nil {
				t.Fatal("accepted response on favorite list")
			}
			o.Status, o.VacancyURL = "favorite", "https://hh.ru/vacancy/123"
			if _, err = s.Observe(u.ID, o); err == nil {
				t.Fatal("accepted cross-site observation")
			}
		})
	}
}

func TestRepeatedFavoriteProposalAfterManualUnfavorite(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "repeat-fav@example.com")
	o := Observation{
		HHID:      "777",
		URL:       "https://hh.ru/applicant/favorites",
		Status:    "favorite",
		Candidate: &Application{Company: "Acme", Position: "Engineer", URL: "https://hh.ru/vacancy/777"},
	}

	// 1. Initial observation creates a pending proposal
	p1, err := s.Observe(u.ID, o)
	if err != nil || p1 == nil {
		t.Fatalf("expected proposal p1, got: %v, err: %v", p1, err)
	}

	// 2. Duplicate observation while proposal is pending returns nil (deduplication)
	dup, err := s.Observe(u.ID, o)
	if err != nil || dup != nil {
		t.Fatalf("expected duplicate proposal to be nil, got: %v, err: %v", dup, err)
	}

	// 3. User applies proposal, setting favorite=true
	resolved, err := s.ResolveProposal(u.ID, p1.ID, "apply", 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	app, err := s.Application(u.ID, resolved.ApplicationID)
	if err != nil || !app.Favorite {
		t.Fatalf("expected application favorite=true, got: %+v, err: %v", app, err)
	}

	// 4. Observing again while favorite=true returns nil (no duplicate / no re-add)
	pWhileFav, err := s.Observe(u.ID, o)
	if err != nil || pWhileFav != nil {
		t.Fatalf("expected nil when already favorite, got: %v, err: %v", pWhileFav, err)
	}

	// 5. User manually unsets favorite
	app.Favorite = false
	if err := put(s.DB, u.ID, "application", app.ID, app); err != nil {
		t.Fatal(err)
	}
	app, _ = s.Application(u.ID, app.ID)
	if app.Favorite {
		t.Fatal("failed to unset favorite manually")
	}

	// 6. Observing favorite again after manual unfavorite proposes again (not auto-restored!)
	p2, err := s.Observe(u.ID, o)
	if err != nil || p2 == nil {
		t.Fatalf("expected proposal p2 after manual unfavorite, got: %v, err: %v", p2, err)
	}
	if p2.Kind == "create" {
		t.Fatalf("expected proposal on existing application, not create: %+v", p2)
	}
	if p2.ApplicationID != app.ID {
		t.Fatalf("expected proposal for existing app ID %s, got %s", app.ID, p2.ApplicationID)
	}

	// Ensure application is not auto-restored before resolution
	appCheck, _ := s.Application(u.ID, app.ID)
	if appCheck.Favorite {
		t.Fatal("application favorite must not be auto-restored without user confirmation")
	}

	// 7. Observing again while p2 is pending does not create duplicate pending proposal
	dup2, err := s.Observe(u.ID, o)
	if err != nil || dup2 != nil {
		t.Fatalf("expected duplicate pending proposal to be deduped, got: %v, err: %v", dup2, err)
	}
}

