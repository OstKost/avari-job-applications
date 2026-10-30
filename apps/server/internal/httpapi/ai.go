package httpapi

import (
	"net/http"
	"strings"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func (s *Server) aiAPI(w http.ResponseWriter, r *http.Request, user string) {
	p := strings.TrimPrefix(r.URL.Path, "/api/v1/ai/")
	method := r.Method
	respond := func(v any, e error) {
		if e != nil {
			fail(w, e)
		} else {
			write(w, 200, v)
		}
	}
	switch {
	case p == "settings" && method == "GET":
		v, e := s.Store.AISettings(user)
		respond(v, e)
	case p == "settings" && method == "PUT":
		var b core.AISettings
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.SaveAISettings(user, b)
		respond(v, e)
	case p == "settings" && method == "DELETE":
		respond(map[string]bool{"ok": true}, s.Store.DeleteAISettings(user))
	case p == "jobs" && method == "GET":
		v, e := s.Store.AIJobs(user)
		respond(v, e)
	case p == "jobs" && method == "POST":
		var b struct {
			Kind     string `json:"kind"`
			TargetID string `json:"targetId"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		if b.Kind == "directions" || b.Kind == "test" {
			b.TargetID = ""
		}
		v, e := s.Store.QueueAI(user, b.Kind, b.TargetID)
		respond(v, e)
	case strings.HasPrefix(p, "jobs/") && strings.HasSuffix(p, "/apply") && method == "POST":
		id := strings.TrimSuffix(strings.TrimPrefix(p, "jobs/"), "/apply")
		respond(map[string]bool{"ok": true}, s.Store.ApplyAIJob(user, id))
	case strings.HasPrefix(p, "jobs/") && method == "GET":
		v, e := s.Store.AIJob(user, strings.TrimPrefix(p, "jobs/"))
		respond(v, e)
	case p == "skills/statistics" && method == "GET":
		q := r.URL.Query()
		v, e := s.Store.SkillStatistics(user, q.Get("group"), q.Get("state"), q.Get("from"), q.Get("to"), q.Get("category"))
		respond(v, e)
	case p == "skills" && method == "GET":
		v, e := s.Store.Skills(user)
		respond(v, e)
	case p == "skills" && method == "PUT":
		var b core.Skill
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.SaveSkill(user, b)
		respond(v, e)
	case p == "skills/merge" && method == "POST":
		var b struct {
			Source string `json:"source"`
			Target string `json:"target"`
			Level  *int   `json:"level"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		respond(map[string]bool{"ok": true}, s.Store.MergeSkills(user, b.Source, b.Target, b.Level))
	case p == "profiles" && method == "GET":
		v, e := s.Store.Profiles(user)
		respond(v, e)
	case p == "profiles" && method == "PUT":
		var b core.Profile
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.SaveProfile(user, b)
		respond(v, e)
	case strings.HasPrefix(p, "profiles/") && method == "DELETE":
		respond(map[string]bool{"ok": true}, s.Store.DeleteProfile(user, strings.TrimPrefix(p, "profiles/")))
	case p == "context" && method == "GET":
		v, e := s.Store.CandidateContext(user)
		respond(map[string]string{"text": v}, e)
	case p == "context" && method == "PUT":
		var b struct {
			Text string `json:"text"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		respond(map[string]bool{"ok": true}, s.Store.SaveCandidateContext(user, b.Text))
	default:
		write(w, 404, map[string]string{"error": "Метод не найден"})
	}
}
