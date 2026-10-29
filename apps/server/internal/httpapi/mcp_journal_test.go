package httpapi

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func TestMCPJournalToolsOverHTTP(t *testing.T) {
	store, _, server := setup(t)
	u, _ := mcpWebLogin(t, store, server, "mcp-journal-http@example.com")
	other, _ := mcpWebLogin(t, store, server, "mcp-journal-other@example.com")
	_, secret, err := store.CreateMCPToken(u.ID, "Journal")
	if err != nil {
		t.Fatal(err)
	}
	fields, err := store.SaveFields(u.ID, []core.Field{{Name: "Priority", Type: "select", Role: "priority", Options: []string{"High", "Low"}}, {Name: "Comment", Type: "text"}}, false)
	if err != nil {
		t.Fatal(err)
	}
	a, err := store.SaveApplication(u.ID, core.Application{Company: "АВАРИ", Position: "Go", URL: "https://example.com/card", Tags: []string{"Go"}, Groups: []string{"Backend"}, Custom: map[string]any{fields[0].ID: "High", fields[1].ID: "keep"}}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	private, err := store.SaveApplication(other.ID, core.Application{Company: "Private", Position: "Secret"}, "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	meta := structured(t, tool(t, server, secret, "get_vacancy_metadata", map[string]any{}))
	if len(meta["stages"].([]any)) != 6 || meta["tags"].([]any)[0] != "Go" || len(meta["fields"].([]any)) != 2 {
		t.Fatal(meta)
	}
	found := structured(t, tool(t, server, secret, "search_vacancies", map[string]any{"query": "авари", "filters": map[string]any{"priority": "High", "hasTask": false}, "limit": 1}))
	cards := found["applications"].([]any)
	if found["total"] != float64(1) || len(cards) != 1 || cards[0].(map[string]any)["link"] != server.URL+"/applications/"+a.ID {
		t.Fatal(found)
	}
	card := structured(t, tool(t, server, secret, "get_vacancy", map[string]any{"id": a.ID}))
	if card["version"] != float64(a.Version) || card["company"] != a.Company {
		t.Fatal(card)
	}
	updated := structured(t, tool(t, server, secret, "update_vacancy", map[string]any{"id": a.ID, "version": card["version"], "fields": map[string]any{"position": "Senior Go", "favorite": true, "groups": []string{}, "custom": map[string]any{fields[0].ID: nil}}}))
	if updated["position"] != "Senior Go" || updated["version"] != float64(a.Version+1) || updated["custom"].(map[string]any)[fields[1].ID] != "keep" || len(updated["groups"].([]any)) != 0 {
		t.Fatal(updated)
	}
	conflict := tool(t, server, secret, "update_vacancy", map[string]any{"id": a.ID, "version": card["version"], "fields": map[string]any{"position": "Conflict"}})
	if conflict["isError"] != true {
		t.Fatal(conflict)
	}
	message := conflict["content"].([]any)[0].(map[string]any)["text"].(string)
	var detail struct {
		Status  int              `json:"status"`
		Current core.Application `json:"current"`
	}
	if err = json.Unmarshal([]byte(message), &detail); err != nil || detail.Status != 409 || detail.Current.Position != "Senior Go" {
		t.Fatal(message, err)
	}
	for _, tc := range []struct {
		name string
		args map[string]any
	}{
		{"get_vacancy", map[string]any{"id": private.ID}},
		{"update_vacancy", map[string]any{"id": private.ID, "version": private.Version, "fields": map[string]any{"position": "Leak"}}},
		{"update_vacancy", map[string]any{"id": a.ID, "version": updated["version"], "fields": map[string]any{"id": "injected"}}},
		{"update_vacancy", map[string]any{"id": a.ID, "version": updated["version"], "fields": map[string]any{"externalStatus": "injected"}}},
		{"update_vacancy", map[string]any{"id": a.ID, "version": updated["version"], "fields": map[string]any{"state": "closed"}}},
		{"search_vacancies", map[string]any{"limit": 101}},
		{"search_vacancies", map[string]any{"filters": map[string]any{"group": "Backend", "ungrouped": true}}},
	} {
		result := tool(t, server, secret, tc.name, tc.args)
		if result["isError"] != true {
			t.Fatal(tc.name, result)
		}
		raw, _ := json.Marshal(result)
		if strings.Contains(string(raw), "Secret") {
			t.Fatal("foreign card leaked", result)
		}
	}
	empty := structured(t, tool(t, server, secret, "search_vacancies", map[string]any{"query": "Secret"}))
	if empty["total"] != float64(0) {
		t.Fatal(empty)
	}
	_, tokenID, err := store.AuthenticateMCP(secret)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.RevokeMCPToken(u.ID, tokenID); err != nil {
		t.Fatal(err)
	}
	status, _, _ := call(t, server, "POST", "/mcp", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "get_vacancy", "arguments": map[string]any{"id": a.ID}}}, map[string]string{"Authorization": "Bearer " + secret, "Accept": "application/json, text/event-stream"})
	if status != 401 {
		t.Fatal(status)
	}
}

func TestMCPJournalRateLimits(t *testing.T) {
	store, api, server := setup(t)
	u, _ := mcpWebLogin(t, store, server, "mcp-rates@example.com")
	token, secret, err := store.CreateMCPToken(u.ID, "Limits")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 60; i++ {
		if !api.mcpAllow(token.ID, "read", 60) {
			t.Fatal(i)
		}
	}
	for _, name := range []string{"search_vacancies", "get_vacancy_metadata", "get_vacancy"} {
		args := map[string]any{}
		if name == "get_vacancy" {
			args["id"] = "missing"
		}
		if result := tool(t, server, secret, name, args); result["isError"] != true {
			t.Fatal(name, result)
		}
	}
	for i := 0; i < 10; i++ {
		if !api.mcpAllow(token.ID, "update", 10) {
			t.Fatal(i)
		}
	}
	result := tool(t, server, secret, "update_vacancy", map[string]any{"id": "missing", "version": 1, "fields": map[string]any{"position": "New"}})
	if result["isError"] != true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), "Лимит") {
		t.Fatal(result)
	}
	if !api.mcpAllow(token.ID, "prepare", 30) || !api.mcpAllow(token.ID, "save", 10) {
		t.Fatal("journal quotas affected existing tools")
	}
}
