package core

import (
	"strings"
	"testing"
)

func TestCompanyLogoPersistenceAndRemoval(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "logo@example.com")
	a := testApp(t, s, u, "987654")
	a.CompanyLogo = "https://example.com/logo.png"
	a, err := s.SaveApplication(u.ID, a, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.Application(u.ID, a.ID)
	if err != nil || stored.CompanyLogo != a.CompanyLogo {
		t.Fatalf("logo did not persist: %+v, %v", stored, err)
	}
	for _, invalid := range []string{"javascript:alert(1)", "file:///logo.png", "https:///logo.png", "https://example.com/" + strings.Repeat("x", 2048)} {
		candidate := stored
		candidate.CompanyLogo = invalid
		_, err := s.SaveApplication(u.ID, candidate, "", "manual")
		requireStatus(t, err, 400)
	}
	stored.CompanyLogo = ""
	if _, err = s.SaveApplication(u.ID, stored, "", "manual"); err != nil {
		t.Fatal(err)
	}
	stored, err = s.Application(u.ID, a.ID)
	if err != nil || stored.CompanyLogo != "https://example.com/logo.png" {
		t.Fatalf("logo was not preserved on empty save: %+v, %v", stored, err)
	}
}
