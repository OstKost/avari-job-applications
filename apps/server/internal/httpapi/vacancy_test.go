package httpapi

import (
	"strings"
	"testing"
)

func TestVacancyPreviewAuthenticationAndValidation(t *testing.T) {
	store, _, server := setup(t)
	status, _, _ := call(t, server, "POST", "/api/v1/vacancies/preview", map[string]string{"url": "https://hh.ru/vacancy/123"}, nil)
	if status != 401 {
		t.Fatalf("unauthenticated: %d", status)
	}
	user, err := store.Register("preview@example.com", "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Admin("approve", user.ID, ""); err != nil {
		t.Fatal(err)
	}
	_, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": user.Email, "password": "secure-test-password"}, nil)
	pairs := []string{}
	for _, c := range cookies {
		pairs = append(pairs, c.Name+"="+c.Value)
	}
	headers := map[string]string{"Cookie": strings.Join(pairs, "; "), "Origin": server.URL}
	status, _, _ = call(t, server, "POST", "/api/v1/vacancies/preview", map[string]string{"url": "https://hh.ru/vacancy/123"}, headers)
	if status != 403 {
		t.Fatalf("CSRF missing: %d", status)
	}
	headers["X-CSRF-Token"] = login["csrf"].(string)
	for _, raw := range []string{"https://example.com/job/123", "https://hh.ru/", "http://hh.ru/vacancy/123", "https://user@hh.ru/vacancy/123", strings.Repeat("a", 2049)} {
		status, res, _ := call(t, server, "POST", "/api/v1/vacancies/preview", map[string]string{"url": raw}, headers)
		if status != 400 || res["error"] == nil {
			t.Fatalf("validation %s: %d %v", raw, status, res)
		}
	}
	apps, err := store.Applications(user.ID)
	if err != nil || len(apps) != 0 {
		t.Fatal("preview created application", apps, err)
	}
}
