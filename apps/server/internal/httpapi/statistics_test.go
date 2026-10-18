package httpapi

import "testing"

func TestHTTPActivityStatistics(t *testing.T) {
	store, _, server := setup(t)
	path := "/api/v1/statistics/activity?from=2026-10-01&to=2026-10-03"
	status, _, _ := call(t, server, "GET", path, nil, nil)
	if status != 401 {
		t.Fatalf("unauthenticated: %d", status)
	}
	user, err := store.Register("statistics@example.com", "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Admin("approve", user.ID, ""); err != nil {
		t.Fatal(err)
	}
	status, login, _ := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": user.Email, "password": "secure-test-password", "kind": "extension"}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	headers := map[string]string{"Authorization": "Bearer " + login["token"].(string)}
	status, body, _ := call(t, server, "GET", path, nil, headers)
	if status != 200 || body["timezone"] != "Europe/Moscow" || len(body["days"].([]any)) != 3 {
		t.Fatal(status, body)
	}
	status, _, _ = call(t, server, "GET", "/api/v1/statistics/activity?from=2026-10-03&to=2026-10-01", nil, headers)
	if status != 400 {
		t.Fatal(status)
	}
	status, _, _ = call(t, server, "GET", "/api/v1/statistics/activity", nil, headers)
	if status != 400 {
		t.Fatal(status)
	}
}
