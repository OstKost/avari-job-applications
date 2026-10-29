package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func mcpWebLogin(t *testing.T, store *core.Store, server *httptest.Server, email string) (core.User, map[string]string) {
	t.Helper()
	u, err := store.Register(email, "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Admin("approve", u.ID, ""); err != nil {
		t.Fatal(err)
	}
	status, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": email, "password": "secure-test-password"}, nil)
	if status != 200 {
		t.Fatal(status, login)
	}
	pairs := []string{}
	for _, cookie := range cookies {
		pairs = append(pairs, cookie.Name+"="+cookie.Value)
	}
	return u, map[string]string{"Cookie": strings.Join(pairs, "; "), "X-CSRF-Token": login["csrf"].(string), "Origin": server.URL}
}
func rpc(t *testing.T, server *httptest.Server, secret, method string, params any) map[string]any {
	t.Helper()
	status, out, _ := call(t, server, "POST", "/mcp", map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, map[string]string{"Authorization": "Bearer " + secret, "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"})
	if status != 200 || out["error"] != nil {
		t.Fatalf("RPC %s: %d %#v", method, status, out)
	}
	result, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("RPC %s: %#v", method, out)
	}
	return result
}
func tool(t *testing.T, server *httptest.Server, secret, name string, args any) map[string]any {
	t.Helper()
	return rpc(t, server, secret, "tools/call", map[string]any{"name": name, "arguments": args})
}
func structured(t *testing.T, result map[string]any) map[string]any {
	t.Helper()
	if result["isError"] == true {
		t.Fatalf("tool failed: %#v", result)
	}
	out, ok := result["structuredContent"].(map[string]any)
	if !ok {
		t.Fatalf("no structured output: %#v", result)
	}
	return out
}
func TestMCPToolsOverHTTP(t *testing.T) {
	store, _, server := setup(t)
	u, _ := mcpWebLogin(t, store, server, "mcp-tools@example.com")
	_, secret, err := store.CreateMCPToken(u.ID, "HTTP test")
	if err != nil {
		t.Fatal(err)
	}
	init := rpc(t, server, secret, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "test", "version": "1"}})
	if !strings.Contains(init["instructions"].(string), "explicit request") {
		t.Fatal("missing workflow instructions", init)
	}
	tools := rpc(t, server, secret, "tools/list", map[string]any{})["tools"].([]any)
	if len(tools) != 6 {
		t.Fatal(tools)
	}
	for _, entry := range tools {
		v := entry.(map[string]any)
		if v["name"] == "prepare_vacancy" && !v["annotations"].(map[string]any)["readOnlyHint"].(bool) {
			t.Fatal("missing read-only annotation")
		}
	}
	url := "https://example.com/jobs/1?utm_source=test#apply"
	prepared := structured(t, tool(t, server, secret, "prepare_vacancy", map[string]any{"url": url}))
	if prepared["needsAgentExtraction"] != true || len(prepared["missingRequired"].([]any)) != 2 {
		t.Fatal(prepared)
	}
	apps, _ := store.Applications(u.ID)
	if len(apps) != 0 {
		t.Fatal("prepare wrote application")
	}
	fields := map[string]any{"company": "ACME", "position": "Senior Go", "location": "Москва", "tags": []string{"Go"}}
	prepared = structured(t, tool(t, server, secret, "prepare_vacancy", map[string]any{"url": url, "fields": fields}))
	if prepared["needsAgentExtraction"] != false || len(prepared["missingRequired"].([]any)) != 0 {
		t.Fatal(prepared)
	}
	args := map[string]any{"url": prepared["url"], "fields": prepared["fields"], "idempotencyKey": prepared["idempotencyKey"]}
	saved := structured(t, tool(t, server, secret, "save_vacancy", args))
	if saved["status"] != "created" {
		t.Fatal(saved)
	}
	again := structured(t, tool(t, server, secret, "save_vacancy", args))
	if again["status"] != "already_exists" {
		t.Fatal(again)
	}
	duplicate := structured(t, tool(t, server, secret, "prepare_vacancy", map[string]any{"url": url}))
	if duplicate["existing"] == nil {
		t.Fatal("duplicate not found", duplicate)
	}
	apps, _ = store.Applications(u.ID)
	if len(apps) != 1 || apps[0].Position != "Senior Go" {
		t.Fatal(apps)
	}
	for _, args := range []map[string]any{
		{"url": "https://example.com/missing", "fields": map[string]string{"company": "ACME"}, "idempotencyKey": "missing"},
		{"url": "https://example.com/update", "fields": map[string]string{"company": "ACME", "position": "Go", "id": apps[0].ID}, "idempotencyKey": "update"},
	} {
		result := tool(t, server, secret, "save_vacancy", args)
		if result["isError"] != true {
			t.Fatal("invalid save accepted", result)
		}
	}
}

type mcpAuthTransport struct{ secret string }

func (t mcpAuthTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+t.secret)
	return http.DefaultTransport.RoundTrip(r)
}
func TestMCPClientConnection(t *testing.T) {
	store, _, server := setup(t)
	u, _ := mcpWebLogin(t, store, server, "mcp-client@example.com")
	_, secret, err := store.CreateMCPToken(u.ID, "SDK client")
	if err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "integration-test", Version: "1"}, nil)
	session, err := client.Connect(t.Context(), &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: &http.Client{Transport: mcpAuthTransport{secret}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(t.Context(), nil)
	if err != nil || len(tools.Tools) != 6 {
		t.Fatal(tools, err)
	}
	result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "prepare_vacancy", Arguments: map[string]string{"url": "https://example.com/jobs/sdk"}})
	if err != nil || result.IsError {
		t.Fatal(result, err)
	}
	raw, _ := json.Marshal(result.StructuredContent)
	if !strings.Contains(string(raw), "needsAgentExtraction") {
		t.Fatal(string(raw))
	}
	for _, name := range []string{"search_vacancies", "get_vacancy_metadata"} {
		result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: name, Arguments: map[string]any{}})
		if err != nil || result.IsError {
			t.Fatal(name, result, err)
		}
	}
	card, err := store.SaveApplication(u.ID, core.Application{Company: "SDK", Position: "Go"}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		args map[string]any
	}{
		{"get_vacancy", map[string]any{"id": card.ID}},
		{"update_vacancy", map[string]any{"id": card.ID, "version": card.Version, "fields": map[string]any{"position": "Senior Go"}}},
	} {
		result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: tc.name, Arguments: tc.args})
		if err != nil || result.IsError {
			t.Fatal(tc.name, result, err)
		}
	}
}

func TestMCPTokenAPIAndAuthorization(t *testing.T) {
	store, _, server := setup(t)
	u, web := mcpWebLogin(t, store, server, "mcp-auth@example.com")
	other, otherWeb := mcpWebLogin(t, store, server, "mcp-other@example.com")
	status, _, _ := call(t, server, "POST", "/api/v1/mcp/tokens", map[string]string{"name": "Codex"}, map[string]string{"Cookie": web["Cookie"]})
	if status != 403 {
		t.Fatal("CSRF not enforced", status)
	}
	status, created, _ := call(t, server, "POST", "/api/v1/mcp/tokens", map[string]string{"name": "Codex"}, web)
	if status != 201 {
		t.Fatal(status, created)
	}
	secret := created["secret"].(string)
	id := created["token"].(map[string]any)["id"].(string)
	bearer := map[string]string{"Authorization": "Bearer " + secret, "Accept": "application/json, text/event-stream"}
	status, _, _ = call(t, server, "GET", "/api/v1/applications", nil, bearer)
	if status != 401 {
		t.Fatal("MCP token accepted as session", status)
	}
	_, _, extension, err := store.Login(u.Email, "secure-test-password", "extension", "extension")
	if err != nil {
		t.Fatal(err)
	}
	for _, headers := range []map[string]string{nil, web, {"Authorization": "Bearer " + extension}} {
		status, _, _ = call(t, server, "POST", "/mcp", map[string]any{}, headers)
		if status != 401 {
			t.Fatal("non-MCP credential accepted", status)
		}
	}
	status, _, _ = call(t, server, "GET", "/api/v1/mcp/tokens", nil, map[string]string{"Authorization": "Bearer " + extension})
	if status != 403 {
		t.Fatal("extension can manage tokens", status)
	}
	status, _, _ = call(t, server, "DELETE", "/api/v1/mcp/tokens/"+id, nil, otherWeb)
	if status != 200 {
		t.Fatal(status)
	}
	if _, _, err = store.AuthenticateMCP(secret); err != nil {
		t.Fatal("another user revoked token", err)
	}
	if tokens, err := store.MCPTokens(other.ID); err != nil || len(tokens) != 0 {
		t.Fatal(tokens, err)
	}
	bearer["Origin"] = "https://evil.example"
	status, _, _ = call(t, server, "POST", "/mcp", map[string]any{}, bearer)
	if status != 403 {
		t.Fatal("foreign origin accepted", status)
	}
	delete(bearer, "Origin")
	status, _, _ = call(t, server, "DELETE", "/api/v1/mcp/tokens/"+id, nil, web)
	if status != 200 {
		t.Fatal(status)
	}
	status, _, _ = call(t, server, "POST", "/mcp", map[string]any{}, bearer)
	if status != 401 {
		t.Fatal("revoked token accepted", status)
	}
}
func TestMCPPreparationFailureAndRateLimit(t *testing.T) {
	store, s, server := setup(t)
	u, _ := mcpWebLogin(t, store, server, "mcp-limits@example.com")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	out, err := s.prepareMCP(ctx, u.ID, mcpPrepareInput{URL: "https://hh.ru/vacancy/123"})
	if err != nil || !out.NeedsAgentExtraction || len(out.Warnings) == 0 {
		t.Fatal(out, err)
	}
	for i := 0; i < 30; i++ {
		if !s.mcpAllow("token", "prepare", 30) {
			t.Fatal("early rate limit", i)
		}
	}
	if s.mcpAllow("token", "prepare", 30) {
		t.Fatal("rate limit not enforced")
	}
	if !s.mcpAllow("other", "prepare", 30) || !s.mcpAllow("token", "save", 10) {
		t.Fatal("limits not isolated")
	}
}

func TestMCPTrustedProxyHostValidation(t *testing.T) {
	store, _, fixture := setup(t)
	u, _ := mcpWebLogin(t, store, fixture, "mcp-proxy@example.com")
	_, secret, err := store.CreateMCPToken(u.ID, "Proxy test")
	if err != nil {
		t.Fatal(err)
	}
	api := &Server{Store: store, Origin: "https://jobs.example.com", TrustedProxy: true}
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	for _, host := range []string{"jobs.example.com", "evil.example.com"} {
		body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
		request, err := http.NewRequest("POST", server.URL+"/mcp", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Host = host
		request.Header.Set("Authorization", "Bearer "+secret)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", "application/json, text/event-stream")
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := http.StatusOK
		if host != "jobs.example.com" {
			want = http.StatusForbidden
		}
		if response.StatusCode != want {
			t.Fatalf("host %s: %d, want %d", host, response.StatusCode, want)
		}
	}
}
