package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

func (s *Server) telegramEnabled() bool {
	return s.TelegramEnabled && !s.Personal && s.TelegramSecret != "" && s.TelegramUsername != ""
}
func (s *Server) telegramWebhook(w http.ResponseWriter, r *http.Request) {
	if !s.telegramEnabled() {
		http.NotFound(w, r)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Telegram-Bot-Api-Secret-Token")), []byte(s.TelegramSecret)) != 1 {
		fail(w, core.Fail(403, "Неверный секрет webhook"))
		return
	}
	raw, e := io.ReadAll(r.Body)
	if e != nil {
		fail(w, core.Fail(400, "Слишком большой запрос"))
		return
	}
	var u struct {
		UpdateID *int64 `json:"update_id"`
	}
	if json.Unmarshal(raw, &u) != nil || u.UpdateID == nil {
		fail(w, core.Fail(400, "Некорректное событие"))
		return
	}
	if e = s.Store.EnqueueTelegramUpdate(*u.UpdateID, raw); e != nil {
		fail(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) telegramBrowserSecret(r *http.Request) string {
	c, e := r.Cookie("avari_telegram")
	if e != nil {
		return ""
	}
	return c.Value
}
func (s *Server) telegramNew(w http.ResponseWriter, r *http.Request, user, purpose string) {
	previousID := ""
	if c, e := r.Cookie("avari_telegram_request"); e == nil {
		previousID = c.Value
	}
	c, token, secret, e := s.Store.NewTelegramChallenge(user, purpose, r.UserAgent(), previousID, s.telegramBrowserSecret(r))
	if e != nil {
		fail(w, e)
		return
	}
	for name, value := range map[string]string{"avari_telegram": secret, "avari_telegram_request": c.ID} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/api/v1/", HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteStrictMode, MaxAge: 600})
	}
	write(w, 201, map[string]any{"challenge": c, "url": "https://t.me/" + s.TelegramUsername + "?start=" + token})
}
func (s *Server) telegramLogin(w http.ResponseWriter, r *http.Request) {
	if !s.telegramEnabled() {
		fail(w, core.Fail(503, "Telegram недоступен"))
		return
	}
	if !oneSafe(r.Method) && r.Header.Get("Origin") != s.Origin {
		fail(w, core.Fail(403, "Источник не разрешён"))
		return
	}
	if !s.throttle(r) {
		fail(w, core.Fail(429, "Слишком много запросов"))
		return
	}
	id := r.PathValue("id")
	if id == "" {
		s.telegramNew(w, r, "", "login")
		return
	}
	if r.Method == "GET" {
		c, e := s.Store.TelegramChallenge(id, s.telegramBrowserSecret(r))
		if e != nil {
			fail(w, e)
			return
		}
		if c.Purpose != "login" || c.ClientKind != "web" {
			fail(w, core.Fail(403, "Чужой запрос"))
			return
		}
		write(w, 200, c)
		return
	}
	u, ss, token, e := s.Store.CompleteTelegramLogin(id, s.telegramBrowserSecret(r))
	if e != nil {
		fail(w, e)
		return
	}
	csrf := core.ID()
	for name, value := range map[string]string{"avari_session": token, "avari_csrf": csrf} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: name == "avari_session", Secure: s.Secure, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 3600})
	}
	write(w, 200, map[string]any{"user": u, "session": ss, "csrf": csrf})
}
func (s *Server) telegramAPI(w http.ResponseWriter, r *http.Request, who identity) {
	p := strings.TrimPrefix(r.URL.Path, "/api/v1/telegram")
	if who.Session.Kind != "web" {
		fail(w, core.Fail(403, "Управление Telegram доступно на сайте"))
		return
	}
	if !oneSafe(r.Method) && r.Header.Get("Origin") != s.Origin {
		fail(w, core.Fail(403, "Источник не разрешён"))
		return
	}
	if p == "" && r.Method == "GET" {
		l, e := s.Store.TelegramLink(who.User.ID)
		if e != nil {
			fail(w, e)
			return
		}
		write(w, 200, map[string]any{"enabled": s.telegramEnabled(), "link": l})
		return
	}
	if !s.telegramEnabled() {
		fail(w, core.Fail(503, "Telegram недоступен"))
		return
	}
	var e error
	switch {
	case p == "/challenges" && r.Method == "POST":
		var b struct {
			Purpose string `json:"purpose"`
		}
		if e = read(r, &b); e != nil {
			break
		}
		if b.Purpose != "registration" && b.Purpose != "link" {
			e = core.Fail(400, "Неизвестное назначение")
			break
		}
		s.telegramNew(w, r, who.User.ID, b.Purpose)
		return
	case strings.HasPrefix(p, "/challenges/"):
		id := strings.TrimPrefix(p, "/challenges/")
		complete := strings.HasSuffix(id, "/complete")
		id = strings.TrimSuffix(id, "/complete")
		var c core.TelegramChallenge
		c, e = s.Store.TelegramChallenge(id, s.telegramBrowserSecret(r))
		if e != nil {
			break
		}
		if c.UserID != who.User.ID || c.Purpose == "login" {
			e = core.Fail(403, "Чужой запрос")
			break
		}
		if complete && r.Method == "POST" {
			e = s.Store.CompleteTelegramLink(id, s.telegramBrowserSecret(r), who.User.ID)
		} else if !complete && r.Method == "GET" {
			write(w, 200, c)
			return
		} else {
			e = core.Fail(405, "Метод недоступен")
		}
	case p == "/preferences" && r.Method == "PATCH":
		var b struct {
			Morning bool `json:"morning"`
			Evening bool `json:"evening"`
		}
		if e = read(r, &b); e == nil {
			e = s.Store.TelegramPreferences(who.User.ID, b.Morning, b.Evening)
		}
	case p == "" && r.Method == "DELETE":
		e = s.Store.DisconnectTelegram(who.User.ID)
	default:
		e = core.Fail(404, "Маршрут не найден")
	}
	if e != nil {
		fail(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

// Extension login uses a separate, secret-bound challenge and never sets web cookies.
func (s *Server) telegramExtensionLogin(w http.ResponseWriter, r *http.Request) {
	if !s.telegramEnabled() {
		fail(w, core.Fail(503, "Telegram недоступен"))
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && !extensionOrigin(origin) {
		fail(w, core.Fail(403, "Источник не разрешён"))
		return
	}
	if !s.throttle(r) {
		fail(w, core.Fail(429, "Слишком много запросов"))
		return
	}
	id := r.PathValue("id")
	if id == "" {
		c, token, secret, e := s.Store.NewExtensionTelegramLogin("Расширение · " + r.UserAgent())
		if e != nil {
			fail(w, e)
			return
		}
		write(w, 201, map[string]any{"challenge": c, "url": "https://t.me/" + s.TelegramUsername + "?start=" + token, "secret": secret})
		return
	}
	secret := r.Header.Get("X-Telegram-Login-Secret")
	if secret == "" {
		fail(w, core.Fail(404, "Запрос не найден"))
		return
	}
	c, e := s.Store.TelegramChallenge(id, secret)
	if e != nil {
		fail(w, e)
		return
	}
	if c.Purpose != "login" || c.ClientKind != "extension" {
		fail(w, core.Fail(403, "Чужой запрос"))
		return
	}
	if r.Method == "GET" {
		write(w, 200, c)
		return
	}
	u, ss, token, e := s.Store.CompleteExtensionTelegramLogin(id, secret)
	if e != nil {
		fail(w, e)
		return
	}
	write(w, 200, map[string]any{"user": u, "session": ss, "token": token})
}
