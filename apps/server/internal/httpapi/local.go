package httpapi

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func (s *Server) localStatus(w http.ResponseWriter, r *http.Request) {
	if !s.Personal {
		write(w, 200, map[string]any{"personal": false, "setupNeeded": false, "launcher": false})
		return
	}
	var count int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM users").Scan(&count); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"personal": true, "setupNeeded": count == 0, "launcher": s.LauncherURL != "", "origin": s.Origin, "checks": []string{"Каталог данных доступен", "База данных готова", "Локальный адрес доступен"}})
}
func (s *Server) localSetup(w http.ResponseWriter, r *http.Request) {
	if !s.Personal || s.SetupToken == "" {
		fail(w, core.Fail(404, "Мастер недоступен"))
		return
	}
	if !s.throttle(r) {
		fail(w, core.Fail(429, "Подождите минуту"))
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Timezone string `json:"timezone"`
		Token    string `json:"token"`
	}
	if err := read(r, &body); err != nil {
		fail(w, err)
		return
	}
	if subtle.ConstantTimeCompare([]byte(body.Token), []byte(s.SetupToken)) != 1 {
		fail(w, core.Fail(403, "Откройте мастер через иконку Avari.Jobs"))
		return
	}
	s.LoginGate <- struct{}{}
	defer func() { <-s.LoginGate }()
	user, err := s.Store.RegisterOwner(body.Email, body.Password, body.Timezone)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 201, user)
}

// The per-launch secret stays in the two native processes, never in browser JS.
func (s *Server) localSettings(w http.ResponseWriter, r *http.Request) {
	if !s.Personal || s.LauncherURL == "" || s.LauncherToken == "" {
		fail(w, core.Fail(404, "Лаунчер недоступен"))
		return
	}
	target, err := url.Parse(s.LauncherURL)
	if err != nil || target.Scheme != "http" || target.Hostname() != "127.0.0.1" {
		fail(w, core.Fail(503, "Неверный адрес лаунчера"))
		return
	}
	var data []byte
	if r.Method == "PUT" {
		var body struct {
			Autostart bool `json:"autostart"`
		}
		if err = read(r, &body); err != nil {
			fail(w, err)
			return
		}
		data, _ = json.Marshal(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, s.LauncherURL+"/settings", bytes.NewReader(data))
	if err != nil {
		fail(w, err)
		return
	}
	req.Header.Set("X-Avari-Launcher-Token", s.LauncherToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		fail(w, core.Fail(503, "Лаунчер не отвечает. Перезапустите Avari.Jobs"))
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		fail(w, core.Fail(503, "Не удалось изменить автозапуск в ОС"))
		return
	}
	var result struct {
		Autostart bool `json:"autostart"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&result); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, result)
}
