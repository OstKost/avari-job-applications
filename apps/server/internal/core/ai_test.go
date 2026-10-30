package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func aiSettingsFixture(t *testing.T, s *Store, u User) {
	t.Helper()
	if _, e := s.SaveAISettings(u.ID, AISettings{Provider: "openai", Model: "test-model", APIKey: "private-api-key"}); e != nil {
		t.Fatal(e)
	}
}
func aiApp(t *testing.T, s *Store, u User, text string) Application {
	t.Helper()
	a, e := s.SaveApplication(u.ID, Application{Company: "Example", Position: "Engineer", AI: &AIFields{Text: text, Skills: []SkillRef{}}}, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func waitAI(t *testing.T, s *Store, user, id, status string) AIJob {
	t.Helper()
	deadline := time.After(4 * time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		j, e := s.AIJob(user, id)
		if e != nil {
			t.Fatal(e)
		}
		if j.Status == status {
			return j
		}
		if j.Status == "error" && status != "error" {
			t.Fatalf("job failed: %+v", j)
		}
		select {
		case <-deadline:
			t.Fatalf("timeout: %+v", j)
		case <-ticker.C:
		}
	}
}
func TestAIExtractionQueueProtectionAndStats(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai@example.com")
	other := testUser(t, s, "other-ai@example.com")
	aiSettingsFixture(t, s, u)
	var calls atomic.Int32
	s.AIGenerate = func(context.Context, AISettings, string, map[string]any) (string, error) {
		calls.Add(1)
		return `{"summary":"Разработка с React и SQL","skills":[{"id":"","name":"React.js","category":"hard"},{"id":"","name":"React","category":"hard"},{"id":"","name":"SQL","category":"hard"},{"id":"","name":"MyNewSkill","category":"hard"}]}`, nil
	}
	a := aiApp(t, s, u, "React.js React SQL MyNewSkill")
	b := aiApp(t, s, u, "React SQL MyNewSkill")
	a.Groups = []string{"Web"}
	a, e := s.SaveApplication(u.ID, a, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	j, e := s.QueueAI(u.ID, "extract", a.ID)
	if e != nil {
		t.Fatal(e)
	}
	j2, e := s.QueueAI(u.ID, "extract", b.ID)
	if e != nil {
		t.Fatal(e)
	}
	waitAI(t, s, u.ID, j.ID, "ready")
	waitAI(t, s, u.ID, j2.ID, "ready")
	d, _ := s.Detail(u.ID, a.ID)
	if !AIReady(d.Application) || len(d.Application.AI.Skills) != 3 {
		t.Fatal(d.Application.AI)
	}
	// An older client omitting the entire AI block preserves it.
	oldClient := d.Application
	oldClient.AI = nil
	oldClient.Company = "Edited"
	saved, e := s.SaveApplication(u.ID, oldClient, "", "extension")
	if e != nil || saved.AI == nil {
		t.Fatal(saved, e)
	}
	stats, e := s.SkillStatistics(u.ID, "Web", "", "", "", "hard")
	if e != nil || stats.Total != 1 || stats.Processed != 1 || stats.Skills[0].Count != 1 {
		t.Fatal(stats, e)
	}
	privateStats, _ := s.SkillStatistics(other.ID, "", "", "", "", "")
	if privateStats.Processed != 0 {
		t.Fatal(privateStats)
	}
	skills, _ := s.Skills(other.ID)
	for _, v := range skills {
		if v.Name == "MyNewSkill" {
			t.Fatal("personal skill leaked")
		}
	}
	// Regeneration is a proposal. Changes after completion invalidate Apply.
	j, e = s.QueueAI(u.ID, "extract", a.ID)
	if e != nil {
		t.Fatal(e)
	}
	waitAI(t, s, u.ID, j.ID, "awaiting")
	d, _ = s.Detail(u.ID, a.ID)
	d.Application.AI.Summary = "Моя правка"
	if _, e = s.SaveApplication(u.ID, d.Application, "", "manual"); e != nil {
		t.Fatal(e)
	}
	requireStatus(t, s.ApplyAIJob(u.ID, j.ID), 409)
	j, e = s.QueueAI(u.ID, "extract", a.ID)
	if e != nil {
		t.Fatal(e)
	}
	waitAI(t, s, u.ID, j.ID, "awaiting")
	if e = s.ApplyAIJob(u.ID, j.ID); e != nil {
		t.Fatal(e)
	}
	requireStatus(t, s.ApplyAIJob(u.ID, j.ID), 409)
	d, _ = s.Detail(u.ID, a.ID)
	d.Application.AI.Text += " changed"
	updated, e := s.SaveApplication(u.ID, d.Application, "", "manual")
	if e != nil || !updated.AI.Stale {
		t.Fatal(updated, e)
	}
	_, e = s.AIJob(other.ID, j.ID)
	requireStatus(t, e, 404)
	if calls.Load() != 4 {
		t.Fatal(calls.Load())
	}
}
func TestAIConcurrentEditAndDedup(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-conflict@example.com")
	aiSettingsFixture(t, s, u)
	started := make(chan struct{})
	release := make(chan struct{})
	s.AIGenerate = func(ctx context.Context, _ AISettings, _ string, _ map[string]any) (string, error) {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		return `{"summary":"Result","skills":[]}`, nil
	}
	a := aiApp(t, s, u, "Description")
	j, e := s.QueueAI(u.ID, "extract", a.ID)
	if e != nil {
		t.Fatal(e)
	}
	<-started
	duplicate, e := s.QueueAI(u.ID, "extract", a.ID)
	if e != nil || j.ID != duplicate.ID {
		t.Fatal(duplicate, e)
	}
	a.AI.Text = "Edited while running"
	if _, e = s.SaveApplication(u.ID, a, "", "manual"); e != nil {
		t.Fatal(e)
	}
	close(release)
	waitAI(t, s, u.ID, j.ID, "error")
	d, _ := s.Detail(u.ID, a.ID)
	if d.Application.AI.Summary != "" {
		t.Fatal("stale result applied")
	}
}
func TestAISettingsEncryptionAndValidation(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-secret@example.com")
	aiSettingsFixture(t, s, u)
	v, e := s.AISettings(u.ID)
	if e != nil || v.APIKey != "" || !v.HasKey {
		t.Fatal(v, e)
	}
	var raw []byte
	if e = s.DB.QueryRow("SELECT secret FROM ai_settings WHERE user_id=?", u.ID).Scan(&raw); e != nil || strings.Contains(string(raw), "private-api-key") {
		t.Fatal("plaintext secret", e)
	}
	stat, e := os.Stat(filepath.Join(filepath.Dir(s.Path), "ai-secrets.key"))
	if e != nil || stat.Mode().Perm()&0077 != 0 {
		t.Fatal(stat, e)
	}
	credentials, e := s.aiCredentials(u.ID)
	if e != nil || credentials.APIKey != "private-api-key" {
		t.Fatal(e)
	}
	v.Model = "another-model"
	if _, e = s.SaveAISettings(u.ID, v); e != nil {
		t.Fatal(e)
	}
	v.BaseURL = "https://proxy.example/v1"
	_, e = s.SaveAISettings(u.ID, v)
	requireStatus(t, e, 400)
	for _, base := range []string{"http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=secret"} {
		v.BaseURL = base
		v.APIKey = "key"
		_, e = s.SaveAISettings(u.ID, v)
		requireStatus(t, e, 400)
	}
	if e = s.DeleteAISettings(u.ID); e != nil {
		t.Fatal(e)
	}
	_, e = s.QueueAI(u.ID, "test", "")
	requireStatus(t, e, 400)
}
func TestAISkillMergeAndAssessment(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-skills@example.com")
	zero, ten := 0, 10
	a := aiApp(t, s, u, "C C++ C#")
	a.AI.Skills = []SkillRef{{Name: "C", Category: "hard"}, {Name: "C++", Category: "hard"}, {Name: "C#", Category: "hard"}}
	if _, e := s.SaveApplication(u.ID, a, "", "manual"); e != nil {
		t.Fatal(e)
	}
	d, _ := s.Detail(u.ID, a.ID)
	if len(d.Application.AI.Skills) != 3 {
		t.Fatal(d.Application.AI)
	}
	first, e := s.SaveSkill(u.ID, Skill{SkillRef: SkillRef{Name: "Personal A", Category: "hard"}, Aliases: []string{"Alias A"}, Level: &zero})
	if e != nil {
		t.Fatal(e)
	}
	target, e := s.SaveSkill(u.ID, Skill{SkillRef: SkillRef{Name: "Personal B", Category: "hard"}, Aliases: []string{}, Level: &ten})
	if e != nil {
		t.Fatal(e)
	}
	d.Application.AI.Skills = []SkillRef{first.SkillRef, target.SkillRef}
	if _, e = s.SaveApplication(u.ID, d.Application, "", "manual"); e != nil {
		t.Fatal(e)
	}
	if e = s.MergeSkills(u.ID, first.ID, target.ID, &zero); e != nil {
		t.Fatal(e)
	}
	d, _ = s.Detail(u.ID, a.ID)
	if len(d.Application.AI.Skills) != 1 || d.Application.AI.Skills[0].ID != target.ID {
		t.Fatal(d.Application.AI)
	}
	all, _ := s.Skills(u.ID)
	found := false
	for _, v := range all {
		if v.ID == target.ID {
			found = true
			if v.Level == nil || *v.Level != 0 || len(v.Aliases) != 2 {
				t.Fatal(v)
			}
		}
	}
	if !found {
		t.Fatal("missing target")
	}
}
func TestAIProfilesAndLatest45(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-profiles@example.com")
	aiSettingsFixture(t, s, u)
	s.AIGenerate = func(_ context.Context, _ AISettings, prompt string, _ map[string]any) (string, error) {
		if strings.Contains(prompt, "ровно три") {
			return `{"directions":[{"title":"A","description":"A"},{"title":"B","description":"B"},{"title":"C","description":"C"}]}`, nil
		}
		return `{"content":"Рекомендации без выдуманного опыта"}`, nil
	}
	old := aiApp(t, s, u, "old")
	old.AI.Summary = "old"
	old.AI.ProcessedAt = now()
	old.AI.TextHash = digest("old")
	old.CreatedAt = "2000-01-01T00:00:00Z"
	if e := put(s.DB, u.ID, "application", old.ID, old); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 45; i++ {
		aiApp(t, s, u, "not processed")
	}
	_, e := s.QueueAI(u.ID, "directions", "")
	requireStatus(t, e, 400)
	apps, _ := s.Applications(u.ID)
	var ready Application
	for _, a := range apps {
		if a.ID != old.ID {
			ready = a
			break
		}
	}
	ready.AI.Summary = "SQL Engineer"
	ready.AI.ProcessedAt = now()
	ready.AI.TextHash = digest(ready.AI.Text)
	if e = put(s.DB, u.ID, "application", ready.ID, ready); e != nil {
		t.Fatal(e)
	}
	j, e := s.QueueAI(u.ID, "directions", "")
	if e != nil {
		t.Fatal(e)
	}
	waitAI(t, s, u.ID, j.ID, "ready")
	profiles, _ := s.Profiles(u.ID)
	if len(profiles) != 0 {
		t.Fatal("suggestions created profiles")
	}
	p, e := s.SaveProfile(u.ID, Profile{Title: "My direction", ApplicationIDs: []string{ready.ID}})
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if _, e = s.SaveProfile(u.ID, Profile{Title: "Other"}); e != nil {
			t.Fatal(e)
		}
	}
	_, e = s.SaveProfile(u.ID, Profile{Title: "Fourth"})
	requireStatus(t, e, 400)
	j, e = s.QueueAI(u.ID, "profile", p.ID)
	if e != nil {
		t.Fatal(e)
	}
	waitAI(t, s, u.ID, j.ID, "awaiting")
	if e = s.ApplyAIJob(u.ID, j.ID); e != nil {
		t.Fatal(e)
	}
	profiles, _ = s.Profiles(u.ID)
	for _, v := range profiles {
		if v.ID == p.ID && v.Content == "" {
			t.Fatal("profile was not applied")
		}
	}
}
func TestAIArchiveRoundtripAndPreview(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-export@example.com")
	aiSettingsFixture(t, s, u)
	level := 7
	skill, e := s.SaveSkill(u.ID, Skill{SkillRef: SkillRef{Name: "Special skill", Category: "hard"}, Aliases: []string{"Special alias"}, Level: &level})
	if e != nil {
		t.Fatal(e)
	}
	a := aiApp(t, s, u, "Full description")
	a.AI.Skills = []SkillRef{skill.SkillRef}
	a, e = s.SaveApplication(u.ID, a, "", "manual")
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.SaveProfile(u.ID, Profile{Title: "Direction", ApplicationIDs: []string{a.ID}, Content: "My content"})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.SaveCandidateContext(u.ID, "My experience"); e != nil {
		t.Fatal(e)
	}
	j, e := s.ExportJournal(u.ID)
	if e != nil || j.Version != 2 || j.AI == nil {
		t.Fatal(j, e)
	}
	raw, _ := json.Marshal(j)
	if strings.Contains(string(raw), "private-api-key") {
		t.Fatal("key leaked")
	}
	dest := testStore(t)
	v := testUser(t, dest, "ai-import@example.com")
	req := ImportRequest{Journal: j}
	preview, e := dest.ImportJournal(v.ID, req, false)
	if e != nil {
		t.Fatal(e)
	}
	catalog, _ := dest.Skills(v.ID)
	for _, x := range catalog {
		if x.Name == skill.Name {
			t.Fatal("preview mutated catalogue")
		}
	}
	req.Revision = preview.Revision
	if _, e = dest.ImportJournal(v.ID, req, true); e != nil {
		t.Fatal(e)
	}
	importChecked(t, dest, v.ID, ImportRequest{Journal: j})
	profiles, _ := dest.Profiles(v.ID)
	apps, _ := dest.Applications(v.ID)
	if len(profiles) != 1 || profiles[0].ApplicationIDs[0] != apps[0].ID || len(apps[0].AI.Skills) != 1 {
		t.Fatal(profiles, apps)
	}
	catalog, _ = dest.Skills(v.ID)
	found := false
	for _, x := range catalog {
		if x.Name == skill.Name {
			found = true
			if x.Level == nil || *x.Level != 7 || len(x.Aliases) != 1 {
				t.Fatal(x)
			}
		}
	}
	if !found {
		t.Fatal("missing skill")
	}
	settings, _ := dest.AISettings(v.ID)
	if settings.HasKey {
		t.Fatal("imported credential")
	}
}
func TestAIResponseValidationAndProviders(t *testing.T) {
	for _, v := range []string{`{"summary":"` + strings.Repeat("я", 401) + `","skills":[]}`, `{"summary":"ok","skills":null}`, `{"summary":"ok","skills":[]} trailing`, `{"summary":"ok","skills":[{"id":"","name":"SQL","category":"unknown"}]}`} {
		if validateAIResult("extract", v) == nil {
			t.Fatal("accepted invalid result")
		}
	}
	if e := validateAIResult("extract", `{"summary":"`+strings.Repeat("я", 400)+`","skills":[]}`); e != nil {
		t.Fatal(e)
	}
	for _, provider := range []string{"openai", "anthropic", "gemini"} {
		t.Run(provider, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
					t.Error(e)
				}
				w.Header().Set("Content-Type", "application/json")
				switch provider {
				case "openai":
					if r.URL.Path != "/responses" || r.Header.Get("Authorization") != "Bearer key" || body["store"] != false {
						t.Error("request", r.URL, body)
					}
					w.Write([]byte(`{"status":"completed","output":[{"content":[{"type":"output_text","text":"{\"content\":\"OK\"}"}]}]}`))
				case "anthropic":
					if r.URL.Path != "/messages" || r.Header.Get("x-api-key") != "key" {
						t.Error("request")
					}
					w.Write([]byte(`{"stop_reason":"tool_use","content":[{"type":"tool_use","name":"analysis","input":{"content":"OK"}}]}`))
				case "gemini":
					if r.Header.Get("x-goog-api-key") != "key" || !strings.Contains(r.URL.Path, ":generateContent") {
						t.Error("request")
					}
					w.Write([]byte(`{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"{\"content\":\"OK\"}"}]}}]}`))
				}
			}))
			defer server.Close()
			result, e := generateAIHTTP(context.Background(), server.Client(), AISettings{Provider: provider, Model: "test", BaseURL: server.URL, APIKey: "key"}, "test", profileSchema())
			if e != nil || validateAIResult("test", result) != nil {
				t.Fatal(result, e)
			}
		})
	}
}
func TestAIRecoveryDoesNotResetJobsWhenAdminOpensDatabase(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-recovery@example.com")
	aiSettingsFixture(t, s, u)
	if e := s.StartAI(); e != nil {
		t.Fatal(e)
	}
	_, e := s.DB.Exec("INSERT INTO ai_jobs(id,user_id,kind,target_id,status,input_hash,provider,model,created_at,updated_at) VALUES('interrupted',?,'extract','missing','running','hash','openai','test',?,?)", u.ID, now(), now())
	if e != nil {
		t.Fatal(e)
	}
	admin, e := Open(s.Path)
	if e != nil {
		t.Fatal(e)
	}
	job, e := admin.AIJob(u.ID, "interrupted")
	if e != nil || job.Status != "running" {
		t.Fatal(job, e)
	}
	admin.Close()
	s.Close()
	reopened, e := Open(s.Path)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	if e = reopened.StartAI(); e != nil {
		t.Fatal(e)
	}
	job, e = reopened.AIJob(u.ID, "interrupted")
	if e != nil || job.Status != "error" {
		t.Fatal(job, e)
	}
}

func TestAIMergedBaseAliasesStayMerged(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-base-merge@example.com")
	target, e := s.SaveSkill(u.ID, Skill{SkillRef: SkillRef{Name: "Frontend", Category: "hard"}})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.MergeSkills(u.ID, "base-react", target.ID, nil); e != nil {
		t.Fatal(e)
	}
	a := aiApp(t, s, u, "React.js")
	a.AI.Skills = []SkillRef{{Name: "React.js", Category: "hard"}}
	a, e = s.SaveApplication(u.ID, a, "", "manual")
	if e != nil || a.AI.Skills[0].ID != target.ID {
		t.Fatal(a, e)
	}
	catalog, _ := s.Skills(u.ID)
	for _, v := range catalog {
		if v.ID == "base-react" {
			t.Fatal("merged base skill still visible")
		}
	}
}

func TestAIPrivateAddressesAreRejected(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "::1", "::ffff:127.0.0.1", "fd00::1", "2001:db8::1"} {
		if aiPublicIP(netip.MustParseAddr(ip)) {
			t.Fatal("private IP accepted", ip)
		}
	}
	if !aiPublicIP(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("public IP rejected")
	}
	_, e := generateAIHTTP(context.Background(), aiHTTPClient(), AISettings{Provider: "openai", Model: "test", BaseURL: "https://127.0.0.1", APIKey: "secret"}, "test", profileSchema())
	requireStatus(t, e, 502)
}
func TestAIUpgradeFrom14(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "ai-upgrade@example.com")
	a := testApp(t, s, u, "123")
	path := s.Path
	if _, e := s.DB.Exec("DROP TABLE application_skills; DROP TABLE skill_levels; DROP TABLE skill_aliases; DROP TABLE skills; DROP TABLE ai_settings; DROP TABLE ai_jobs; DELETE FROM schema_migrations WHERE version=15"); e != nil {
		t.Fatal(e)
	}
	s.Close()
	upgraded, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer upgraded.Close()
	detail, e := upgraded.Detail(u.ID, a.ID)
	if e != nil || detail.Application.AI != nil {
		t.Fatal(detail, e)
	}
	skills, e := upgraded.Skills(u.ID)
	if e != nil || len(skills) == 0 {
		t.Fatal(skills, e)
	}
}

func TestAIProfileImportPreservesDistinctIdenticalTitles(t *testing.T) {
	source := testStore(t)
	u := testUser(t, source, "ai-profile-origins@example.com")
	for i := 0; i < 2; i++ {
		if _, e := source.SaveProfile(u.ID, Profile{Title: "Same title"}); e != nil {
			t.Fatal(e)
		}
	}
	archive, e := source.ExportJournal(u.ID)
	if e != nil {
		t.Fatal(e)
	}
	importChecked(t, source, u.ID, ImportRequest{Journal: archive})
	profiles, _ := source.Profiles(u.ID)
	if len(profiles) != 2 {
		t.Fatal("self import duplicated profiles", profiles)
	}
	target := testStore(t)
	v := testUser(t, target, "ai-profile-target@example.com")
	importChecked(t, target, v.ID, ImportRequest{Journal: archive})
	importChecked(t, target, v.ID, ImportRequest{Journal: archive})
	profiles, _ = target.Profiles(v.ID)
	if len(profiles) != 2 {
		t.Fatal("distinct profiles collapsed or duplicated", profiles)
	}
}
