package core

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMCPTokensLifecycle(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "mcp@example.com")
	other := testUser(t, s, "other-mcp@example.com")
	token, secret, err := s.CreateMCPToken(u.ID, " Codex ")
	if err != nil {
		t.Fatal(err)
	}
	if token.Name != "Codex" || !strings.HasPrefix(secret, "avari_mcp_") {
		t.Fatal(token)
	}
	expiry, _ := time.Parse(timestampLayout, token.ExpiresAt)
	if time.Until(expiry) < 89*24*time.Hour {
		t.Fatal("short expiry")
	}
	var hash string
	if err = s.DB.QueryRow("SELECT token_hash FROM mcp_tokens WHERE id=?", token.ID).Scan(&hash); err != nil || hash == secret || hash != tokenHash(secret) {
		t.Fatal("unhashed secret", err)
	}
	user, id, err := s.AuthenticateMCP(secret)
	if err != nil || user != u.ID || id != token.ID {
		t.Fatal(user, id, err)
	}
	tokens, err := s.MCPTokens(u.ID)
	if err != nil || len(tokens) != 1 || tokens[0].LastUsedAt == "" {
		t.Fatal(tokens, err)
	}
	tokens, err = s.MCPTokens(other.ID)
	if err != nil || len(tokens) != 0 {
		t.Fatal("tokens leaked", tokens, err)
	}
	if err = s.RevokeMCPToken(other.ID, token.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.AuthenticateMCP(secret); err != nil {
		t.Fatal("other user revoked token", err)
	}
	if _, _, err = s.Authenticate(secret); err == nil {
		t.Fatal("MCP secret accepted as session")
	}
	if _, _, err = s.AuthenticateMCP("bad"); err == nil {
		t.Fatal("invalid secret accepted")
	}
	if _, err = s.DB.Exec("UPDATE mcp_tokens SET expires_at='2000-01-01' WHERE id=?", token.ID); err != nil {
		t.Fatal(err)
	}
	_, _, err = s.AuthenticateMCP(secret)
	requireStatus(t, err, 401)
	if _, err = s.DB.Exec("UPDATE mcp_tokens SET expires_at=? WHERE id=?", token.ExpiresAt, token.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.RevokeMCPToken(u.ID, token.ID); err != nil {
		t.Fatal(err)
	}
	_, _, err = s.AuthenticateMCP(secret)
	requireStatus(t, err, 401)
	_, secret, err = s.CreateMCPToken(u.ID, "Blocked")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Admin("block", u.ID, ""); err != nil {
		t.Fatal(err)
	}
	_, _, err = s.AuthenticateMCP(secret)
	requireStatus(t, err, 401)
}

func TestMCPVacancyIdentity(t *testing.T) {
	cases := map[string]string{
		" https://Example.COM:443/jobs/1?utm_source=chat&job=2#apply ": "https://example.com/jobs/1?job=2",
		"https://example.com?fbclid=123":                               "https://example.com/",
		"http://example.com:80/jobs?b=2&a=1":                           "http://example.com/jobs?a=1&b=2",
		"https://spb.hh.ru/vacancy/123?from=search":                    "https://hh.ru/vacancy/123",
		"https://example.com/jobs?id=2&ref=engineering":                "https://example.com/jobs?id=2&ref=engineering",
	}
	for input, want := range cases {
		got, err := MCPVacancyURL(input)
		if err != nil || got != want {
			t.Errorf("%s: %s %v, want %s", input, got, err, want)
		}
	}
	for _, input := range []string{"", "file:///tmp/job", "javascript:alert(1)", "https://user:password@example.com/job", strings.Repeat("x", 2049)} {
		if _, err := MCPVacancyURL(input); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
}

func TestMCPConcurrentSaveAndCrossChannelDuplicates(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "mcp-save@example.com")
	other := testUser(t, s, "mcp-save-other@example.com")
	a := Application{Company: "ACME", Position: "Go", URL: "https://example.com/jobs/1?utm_source=codex#apply"}
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Go(func() {
			saved, _, err := s.SaveMCPApplication(u.ID, a, ID())
			if err != nil {
				t.Error(err)
				return
			}
			ids <- saved.ID
		})
	}
	wg.Wait()
	close(ids)
	id := ""
	for got := range ids {
		if id != "" && got != id {
			t.Fatal("concurrent duplicates")
		}
		id = got
	}
	apps, err := s.Applications(u.ID)
	if err != nil || len(apps) != 1 {
		t.Fatal(apps, err)
	}
	if apps[0].Stage != "saved" || apps[0].State != "active" || apps[0].SavedDate == "" {
		t.Fatal("defaults missing", apps[0])
	}
	saved, created, err := s.SaveMCPApplication(u.ID, a, "retry")
	if err != nil || created || saved.ID != id {
		t.Fatal(saved, created, err)
	}
	a.Position = "Must not overwrite"
	saved, created, err = s.SaveMCPApplication(u.ID, a, "retry")
	if err != nil || created || saved.Position != "Go" {
		t.Fatal("retry changed card", saved, created, err)
	}
	saved, created, err = s.SaveMCPApplication(other.ID, a, "retry")
	if err != nil || !created || saved.ID == id {
		t.Fatal("users not isolated", saved, created, err)
	}
	manual, err := s.SaveApplication(u.ID, Application{Company: "Manual", Position: "Go", URL: "https://example.com/jobs/2?utm_medium=mail"}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.MCPDuplicate(u.ID, "https://EXAMPLE.com/jobs/2#apply")
	if err != nil || duplicate == nil || duplicate.ID != manual.ID {
		t.Fatal(duplicate, err)
	}
	saved, created, err = s.SaveMCPApplication(u.ID, Application{Company: "MCP", Position: "Go", URL: "https://example.com/jobs/2"}, "manual-duplicate")
	if err != nil || created || saved.ID != manual.ID {
		t.Fatal(saved, created, err)
	}
	events, err := s.Events(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, e := range events {
		if e.Source == "mcp" {
			found++
		}
	}
	if found != 1 {
		t.Fatal("unexpected MCP events", found)
	}
	for _, bad := range []Application{{Company: "No URL", Position: "Go"}, {Company: "", Position: "Go", URL: "https://example.com/missing"}, {ID: id, Company: "Update", Position: "Go", URL: a.URL}} {
		_, _, err = s.SaveMCPApplication(u.ID, bad, ID())
		requireStatus(t, err, 400)
	}
}

func TestMCPMigrationFrom13(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "mcp-migration@example.com")
	application := testApp(t, s, u, "13214")
	path := s.Path
	if _, err := s.DB.Exec("DROP TABLE mcp_tokens; DELETE FROM schema_migrations WHERE version>=14"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, _, err = reopened.CreateMCPToken(u.ID, "Migrated Codex"); err != nil {
		t.Fatal(err)
	}
	if saved, err := reopened.Application(u.ID, application.ID); err != nil || saved.Company != application.Company {
		t.Fatal("migration damaged journal", saved, err)
	}
}
