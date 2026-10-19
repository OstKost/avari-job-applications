package core

import (
	"strings"
	"sync"
	"testing"
)

func TestAdditionalSitesDedupAndObservations(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "sites@example.com")
	other := testUser(t, s, "other-sites@example.com")
	hh := testApp(t, s, u, "123")
	seen := map[string]bool{hh.ID: true}
	for _, raw := range []string{
		"https://ru.linkedin.com/jobs/view/developer-at-example-123/?trackingId=x",
		"https://getmatch.ru/vacancies/123-developer?s=offers",
		"https://hirify.me/jobs/123-developer?utm_source=x",
		"https://geekjob.ru/vacancy/6acce1f84f35ccbd760b3413?from=search",
		"https://career.habr.com/vacancies/1000169149?s=search",
		"https://deeplayhr.huntflow.io/vacancy/rukovoditel-napravleniia-razrabotki-lider-modulia?from=share",
	} {
		t.Run(raw, func(t *testing.T) {
			a, e := s.SaveApplication(u.ID, Application{Company: "Example", Position: "Developer", URL: raw}, "", "extension")
			if e != nil {
				t.Fatal(e)
			}
			if a.HHID != "" || seen[a.ID] || a.URL != trackedJobURL(raw) {
				t.Fatal("wrong identity", a)
			}
			seen[a.ID] = true
			// Exercise matching of manually saved links from before multi-site support.
			legacy := a
			legacy.URL = raw
			if e = put(s.DB, u.ID, "application", a.ID, legacy); e != nil {
				t.Fatal(e)
			}
			var wg sync.WaitGroup
			for i := 0; i < 4; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					again, e := s.SaveApplication(u.ID, Application{Company: "Example", Position: "Developer", URL: a.URL}, "", "extension")
					if e != nil || again.ID != a.ID {
						t.Errorf("duplicate: %v %v", again, e)
					}
				}()
			}
			wg.Wait()
			p, e := s.Observe(u.ID, Observation{VacancyURL: raw, Status: "applied", URL: a.URL})
			if e != nil || p == nil || p.ApplicationID != a.ID {
				t.Fatal(p, e)
			}
			unchanged, e := s.Application(u.ID, a.ID)
			if e != nil || unchanged.Stage != "saved" {
				t.Fatal("observation changed stage", unchanged, e)
			}
			repeat, e := s.Observe(u.ID, Observation{VacancyURL: a.URL, Status: "applied", URL: raw})
			if e != nil || repeat != nil {
				t.Fatal("duplicate proposal", repeat, e)
			}
			foreign, e := s.Observe(other.ID, Observation{VacancyURL: a.URL, Status: "applied", URL: a.URL})
			if e != nil || foreign != nil {
				t.Fatal("cross-user observation", foreign, e)
			}
			_, e = s.ResolveProposal(u.ID, p.ID, "apply", a.Version, nil)
			if e != nil {
				t.Fatal(e)
			}
			updated, e := s.Application(u.ID, a.ID)
			if e != nil || updated.Stage != "applied" || updated.ExternalStatus != "applied" {
				t.Fatal(updated, e)
			}
		})
	}
	apps, e := s.Applications(u.ID)
	if e != nil || len(apps) != 7 {
		t.Fatal(apps, e)
	}
}

func TestObservationRejectsMismatchedSitesAndURLs(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "invalid-sites@example.com")
	for _, o := range []Observation{
		{VacancyURL: "https://getmatch.ru/vacancies/123", URL: "https://hirify.me/jobs/123", Status: "applied"},
		{VacancyURL: "https://getmatch.ru/vacancies/123", URL: "https://getmatch.ru/vacancies/456", Status: "applied"},
		{VacancyURL: "https://getmatch.ru/vacancies/123", URL: "http://getmatch.ru/vacancies/123", Status: "applied"},
		{VacancyURL: "https://getmatch.ru/vacancies/123", URL: "https://getmatch.ru.evil.example/vacancies/123", Status: "applied"},
		{HHID: "123", URL: "https://getmatch.ru/vacancies/123", Status: "applied"},
		{HHID: "123", URL: "https://hh.ru/vacancy/456", Status: "applied"},
		{HHID: "123", URL: "https://hh.ru/account", Status: "applied"},
		{HHID: "123", VacancyURL: "https://getmatch.ru/vacancies/123", URL: "https://getmatch.ru/vacancies/123", Status: "applied"},
		{VacancyURL: "https://hirify.me/", URL: "https://hirify.me/", Status: "applied"},
	} {
		_, e := s.Observe(u.ID, o)
		requireStatus(t, e, 400)
	}
}

func TestResponseListsAndHirifyStages(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "response-lists@example.com")
	for _, site := range []struct{ raw, list string }{
		{"https://getmatch.ru/vacancies/123-developer", "https://getmatch.ru/applications?s=menu"},
		{"https://hirify.me/jobs/123-developer", "https://hirify.me/applications?page=1"},
	} {
		a, e := s.SaveApplication(u.ID, Application{Company: "Example", Position: "Developer", URL: site.raw}, "", "extension")
		if e != nil {
			t.Fatal(e)
		}
		p, e := s.Observe(u.ID, Observation{VacancyURL: a.URL, URL: site.list, Status: "applied"})
		if e != nil || p == nil || p.ApplicationID != a.ID {
			t.Fatal(p, e)
		}
		if p.URL != strings.Split(site.list, "?")[0] {
			t.Fatal("tracking query leaked", p.URL)
		}
		for _, raw := range []string{"https://getmatch.ru/profile", "https://hirify.me/account", "https://getmatch.ru/applications/other", "https://www.linkedin.com/jobs-tracker/"} {
			_, e := s.Observe(u.ID, Observation{VacancyURL: a.URL, URL: raw, Status: "applied"})
			requireStatus(t, e, 400)
		}
	}
	a := Application{Stage: "saved", State: "active"}
	for _, status := range []string{"hr", "final", "offer"} {
		changes := recommend(a, status)
		if changes["stage"] != status {
			t.Fatal(status, changes)
		}
	}
	a.Stage = "offer"
	if _, exists := recommend(a, "hr")["stage"]; exists {
		t.Fatal("stage regressed")
	}
	for _, status := range []string{"no_response", "test_assignment"} {
		changes := recommend(a, status)
		if len(changes) != 1 || changes["externalStatus"] != status {
			t.Fatal("status inferred outcome", changes)
		}
	}
}
