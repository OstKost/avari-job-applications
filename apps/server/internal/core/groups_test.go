package core

import (
	"strings"
	"testing"
)

func TestApplicationGroupsAndTagsPersistAndValidate(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "groups@example.com")
	a, err := s.SaveApplication(u.ID, Application{
		Company:  "Компания",
		Position: "Дизайнер",
		Groups:   []string{"  Дизайн  "},
		Tags:     []string{" Удалёнка ", "дизайн", "УДАЛЁНКА"},
	}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Groups) != 1 || a.Groups[0] != "Дизайн" {
		t.Fatalf("groups: %v", a.Groups)
	}
	if len(a.Tags) != 2 || a.Tags[0] != "Удалёнка" || a.Tags[1] != "дизайн" {
		t.Fatalf("tags: %v", a.Tags)
	}
	detail, err := s.Detail(u.ID, a.ID)
	if err != nil || len(detail.Application.Groups) != 1 || len(detail.Application.Tags) != 2 {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	a.Groups = []string{"Контракт"}
	a.Tags = []string{"Senior", "Go"}
	a, err = s.SaveApplication(u.ID, a, "", "manual")
	if err != nil || len(a.Groups) != 1 || a.Groups[0] != "Контракт" || len(a.Tags) != 2 {
		t.Fatalf("update: %+v %v", a, err)
	}
	// Groups: only 1 group allowed, max 100 runes
	for _, groups := range [][]string{{" "}, {strings.Repeat("я", 101)}, {"Группа 1", "Группа 2"}} {
		invalid := a
		invalid.Groups = groups
		if _, err := s.SaveApplication(u.ID, invalid, "", "manual"); err == nil {
			t.Fatalf("accepted invalid groups: %v", groups)
		}
	}
	// Tags: up to 30 tags, max 100 runes
	for _, tags := range [][]string{{" "}, {strings.Repeat("я", 101)}, make([]string, 31)} {
		invalid := a
		invalid.Tags = tags
		if _, err := s.SaveApplication(u.ID, invalid, "", "manual"); err == nil {
			t.Fatalf("accepted invalid tags: %v", tags)
		}
	}
	a.Groups = nil
	a.Tags = nil
	a, err = s.SaveApplication(u.ID, a, "", "manual")
	if err != nil || a.Groups == nil || len(a.Groups) != 0 || a.Tags == nil || len(a.Tags) != 0 {
		t.Fatalf("remove: %+v %v", a, err)
	}
}

// Existing journals retain additional groups as tags after the single-group upgrade.
func TestLegacyGroupsMigrateToTags(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "legacy-groups@example.com")
	a, err := s.SaveApplication(u.ID, Application{Company: "Legacy", Position: "Developer", Groups: []string{"Основная"}}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.DB.Exec(`UPDATE documents SET payload=json_set(payload, '$.groups', json_array('Основная', 'Удалёнка', 'Go'), '$.tags', json_array('Senior')) WHERE id=?`, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("DELETE FROM schema_migrations WHERE version=6"); err != nil {
		t.Fatal(err)
	}
	if err = s.migrate(); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(u.ID, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	migrated := detail.Application
	if len(migrated.Groups) != 1 || migrated.Groups[0] != "Основная" || len(migrated.Tags) != 3 || migrated.Version != a.Version+1 {
		t.Fatalf("migration: %+v", migrated)
	}
	for _, expected := range []string{"Удалёнка", "Go", "Senior"} {
		found := false
		for _, tag := range migrated.Tags {
			if tag == expected {
				found = true
			}
		}
		if !found {
			t.Fatalf("lost tag %q: %+v", expected, migrated)
		}
	}
	if _, err = s.SaveApplication(u.ID, migrated, "", "manual"); err != nil {
		t.Fatal(err)
	}
	if err = s.migrate(); err != nil {
		t.Fatal(err)
	}
	again, err := s.Detail(u.ID, a.ID)
	if err != nil || again.Application.Version != migrated.Version+1 {
		t.Fatalf("repeated migration: %+v %v", again, err)
	}
}
