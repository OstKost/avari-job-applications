package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

var updateBridgeClient = &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}

// Only the native launcher may fetch or install packages. Its secret never reaches JS.
func (s *Server) localUpdate(w http.ResponseWriter, r *http.Request, action string) {
	if !s.Personal || s.LauncherURL == "" || s.LauncherToken == "" {
		fail(w, core.Fail(404, "Обновление доступно только в установленном приложении"))
		return
	}
	target, err := url.Parse(s.LauncherURL)
	if err != nil || target.Scheme != "http" || target.Hostname() != "127.0.0.1" || target.User != nil || target.RawQuery != "" || target.Fragment != "" || target.Path != "" {
		fail(w, core.Fail(503, "Неверный адрес лаунчера"))
		return
	}
	if r.Method == "POST" {
		var body struct{}
		if err := read(r, &body); err != nil {
			fail(w, err)
			return
		}
	}
	path := "/update"
	if action != "" {
		path += "/" + action
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, s.LauncherURL+path, bytes.NewReader([]byte("{}")))
	if err != nil {
		fail(w, err)
		return
	}
	req.Header.Set("X-Avari-Launcher-Token", s.LauncherToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := updateBridgeClient.Do(req)
	if err != nil {
		fail(w, core.Fail(503, "Лаунчер не отвечает. Откройте Avari.Jobs через иконку приложения"))
		return
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 256*1024+1))
	if err != nil || len(raw) > 256*1024 || !json.Valid(raw) {
		fail(w, core.Fail(503, "Некорректный ответ лаунчера"))
		return
	}
	if res.StatusCode != 200 && res.StatusCode != 409 && res.StatusCode != 503 {
		fail(w, core.Fail(503, "Операция обновления недоступна"))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(res.StatusCode)
	_, _ = w.Write(raw)
}
