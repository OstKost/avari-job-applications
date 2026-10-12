package httpapi

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func (s *Server) extensionDownloadLink(token string) map[string]string {
	url := ""
	if token != "" {
		url = strings.TrimRight(s.Origin, "/") + "/api/v1/extension/download/" + token + "/avari-extension.zip"
	}
	return map[string]string{"url": url}
}

func (s *Server) extensionDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	token := r.PathValue("token")
	if _, e := s.Store.VerifyExtensionDownloadToken(token); e != nil {
		fail(w, core.Fail(404, "Архив не найден"))
		return
	}
	if s.Assets == nil {
		fail(w, core.Fail(404, "Архив не найден"))
		return
	}
	raw, e := fs.ReadFile(s.Assets, "downloads/avari-extension.zip")
	if e != nil {
		fail(w, core.Fail(404, "Архив не найден"))
		return
	}
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(raw))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="avari-extension.zip"`)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)
	for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	if r.Method != "HEAD" {
		http.ServeContent(w, r, "avari-extension.zip", time.Time{}, bytes.NewReader(raw))
	}
}
