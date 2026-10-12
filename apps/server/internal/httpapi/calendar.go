package httpapi

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func (s *Server) calendarSubscription(token string) map[string]string {
	url := ""
	if token != "" {
		url = strings.TrimRight(s.Origin, "/") + "/api/v1/calendar/feed/" + token + ".ics"
	}
	return map[string]string{"url": url}
}

func (s *Server) calendarFeed(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	value := r.PathValue("token")
	if !strings.HasSuffix(value, ".ics") {
		fail(w, core.Fail(404, "Календарь не найден"))
		return
	}
	feed, e := s.Store.CalendarFeed(strings.TrimSuffix(value, ".ics"), s.Origin)
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="avari.jobs.ics"`)
	w.Header().Set("Cache-Control", "private, no-cache")
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256([]byte(feed)))
	w.Header().Set("ETag", etag)
	for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	if r.Method != "HEAD" {
		_, _ = w.Write([]byte(feed))
	}
}
