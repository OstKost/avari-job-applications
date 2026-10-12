package core

import (
	"strings"
	"testing"
)

func TestApplicationGroupsPersistAndValidate(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "groups@example.com")
	a, err := s.SaveApplication(u.ID, Application{Company: "Компания", Position: "Дизайнер", Groups: []string{" Дизайн ", "Удалённая работа", "дизайн"}}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Groups) != 2 || a.Groups[0] != "Дизайн" {
		t.Fatalf("groups: %v", a.Groups)
	}
	detail, err := s.Detail(u.ID, a.ID)
	if err != nil || len(detail.Application.Groups) != 2 {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	a.Groups = []string{"Контракт"}
	a, err = s.SaveApplication(u.ID, a, "", "manual")
	if err != nil || len(a.Groups) != 1 || a.Groups[0] != "Контракт" {
		t.Fatalf("update: %+v %v", a, err)
	}
	for _, groups := range [][]string{{" "}, {strings.Repeat("я", 101)}, make([]string, 31)} {
		invalid := a
		invalid.Groups = groups
		if _, err := s.SaveApplication(u.ID, invalid, "", "manual"); err == nil {
			t.Fatalf("accepted invalid groups: %v", groups)
		}
	}
	a.Groups = nil
	a, err = s.SaveApplication(u.ID, a, "", "manual")
	if err != nil || a.Groups == nil || len(a.Groups) != 0 {
		t.Fatalf("remove: %+v %v", a, err)
	}
}
