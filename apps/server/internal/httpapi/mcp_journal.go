package httpapi

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpVacancy struct {
	core.Application
	Link string `json:"link"`
}
type mcpSearchResult struct {
	Applications []mcpVacancy `json:"applications"`
	Total        int          `json:"total"`
	HasMore      bool         `json:"hasMore"`
}
type mcpGetInput struct {
	ID string `json:"id"`
}
type mcpUpdateInput struct {
	ID      string               `json:"id"`
	Version int                  `json:"version" jsonschema:"Expected version from get_vacancy; never overwrite a conflict automatically"`
	Fields  core.MCPUpdateFields `json:"fields" jsonschema:"Only supplied fields change. Empty strings clear optional strings; empty arrays clear groups or tags. Salary replaces the entire object. Custom merges keys; null clears a custom value."`
}
type mcpMetadata struct {
	Stages   []string     `json:"stages"`
	States   []string     `json:"states"`
	Outcomes []string     `json:"outcomes"`
	Groups   []string     `json:"groups"`
	Tags     []string     `json:"tags"`
	Fields   []core.Field `json:"fields"`
}

func (s *Server) mcpVacancy(a core.Application) mcpVacancy {
	return mcpVacancy{Application: a, Link: s.mcpExisting(a).Link}
}
func addMCPJournalTool[In, Out any](s *Server, server *mcp.Server, identity mcpIdentity, tool *mcp.Tool, write bool, run func(In) (Out, error)) {
	mcp.AddTool(server, tool, func(_ context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		var zero Out
		operation, limit := "read", 60
		if write {
			operation, limit = "update", 10
		}
		if !s.mcpAllow(identity.Token, operation, limit) {
			return nil, zero, errors.New(mcpErrorMessage(core.Fail(429, "Лимит MCP-запросов. Повторите через минуту")))
		}
		out, err := run(in)
		if err != nil {
			return nil, zero, errors.New(mcpErrorMessage(err))
		}
		return nil, out, nil
	})
}
func (s *Server) addMCPJournalTools(server *mcp.Server, identity mcpIdentity) {
	no, yes := false, true
	addMCPJournalTool(s, server, identity, &mcp.Tool{Name: "search_vacancies", Description: "Search saved vacancies in your journal. Filters combine with AND. Text search covers card text and text/select custom values, excluding notes. Company, position, location and workFormat filters use case-insensitive substrings; other filters are exact. hasTask tests open tasks. Default order: savedDate descending, createdAt descending, ID ascending. Includes closed cards unless filtered.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &no}}, false, func(in core.MCPSearchInput) (mcpSearchResult, error) {
		found, err := s.Store.SearchMCPApplications(identity.User, in)
		out := mcpSearchResult{Applications: []mcpVacancy{}, Total: found.Total, HasMore: found.HasMore}
		for _, a := range found.Applications {
			out.Applications = append(out.Applications, s.mcpVacancy(a))
		}
		return out, err
	})
	addMCPJournalTool(s, server, identity, &mcp.Tool{Name: "get_vacancy", Description: "Read a saved vacancy card and its current version before editing. Does not return notes or tasks.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &no}}, false, func(in mcpGetInput) (mcpVacancy, error) {
		a, err := s.Store.Application(identity.User, in.ID)
		return s.mcpVacancy(a), err
	})
	addMCPJournalTool(s, server, identity, &mcp.Tool{Name: "get_vacancy_metadata", Description: "Read valid stages, states, closure outcomes, used groups and tags, and custom field definitions. The field with role=priority defines the priority filter.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &no}}, false, func(_ struct{}) (mcpMetadata, error) {
		out := mcpMetadata{Stages: []string{"saved", "applied", "hr", "interview", "final", "offer"}, States: []string{"active", "paused", "closed"}, Outcomes: []string{"employer_rejected", "self_rejected", "vacancy_closed", "offer_accepted", "other"}, Groups: []string{}, Tags: []string{}, Fields: []core.Field{}}
		fields, err := s.Store.Fields(identity.User)
		if err != nil {
			return out, err
		}
		out.Fields = fields
		apps, err := s.Store.Applications(identity.User)
		if err != nil {
			return out, err
		}
		groups, tags := map[string]bool{}, map[string]bool{}
		for _, a := range apps {
			for _, g := range a.Groups {
				groups[g] = true
			}
			for _, t := range a.Tags {
				tags[t] = true
			}
		}
		for g := range groups {
			out.Groups = append(out.Groups, g)
		}
		for t := range tags {
			out.Tags = append(out.Tags, t)
		}
		sort.Strings(out.Groups)
		sort.Strings(out.Tags)
		return out, nil
	})
	addMCPJournalTool(s, server, identity, &mcp.Tool{Name: "update_vacancy", Description: "Partially edit an existing card after an explicit user edit request or agreement. Read the card first and supply its version. Omitted fields remain unchanged. On conflict compare current values; never blindly retry. Does not create cards, edit notes/tasks, or send applications.", Annotations: &mcp.ToolAnnotations{DestructiveHint: &yes, OpenWorldHint: &no}}, true, func(in mcpUpdateInput) (mcpVacancy, error) {
		if strings.TrimSpace(in.ID) == "" || in.Version < 1 {
			return mcpVacancy{}, core.Fail(400, "Укажите ID и актуальную версию карточки")
		}
		a, err := s.Store.UpdateMCPApplication(identity.User, in.ID, in.Version, in.Fields)
		return s.mcpVacancy(a), err
	})
}
