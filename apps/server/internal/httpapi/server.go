package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Server struct {
	TelegramEnabled  bool
	TelegramSecret   string
	TelegramUsername string
	Store            *core.Store
	Origin           string
	Secure           bool
	Assets           fs.FS
	TrustedProxy     bool
	Personal         bool
	SetupToken       string
	LauncherURL      string
	LauncherToken    string
	PushService      *core.PushNotificationService
	PushTransport    webpush.Transport
	limitMu          sync.Mutex
	limits           map[string][]time.Time
	LoginGate        chan struct{}
}
type identity struct {
	User    core.User
	Session core.Session
}
type key int

func (s *Server) Handler() http.Handler {
	s.limits = map[string][]time.Time{}
	s.LoginGate = make(chan struct{}, 4)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { write(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if e := s.Store.DB.PingContext(r.Context()); e != nil {
			write(w, 503, map[string]string{"error": "База недоступна"})
			return
		}
		write(w, 200, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("GET /api/v1/local/status", s.localStatus)
	mux.HandleFunc("POST /api/v1/local/setup", s.localSetup)
	mux.HandleFunc("POST /api/v1/telegram/webhook", s.telegramWebhook)
	mux.HandleFunc("GET /api/v1/auth/telegram/config", func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, map[string]bool{"enabled": s.telegramEnabled(), "extensionLogin": s.telegramEnabled()})
	})
	mux.HandleFunc("POST /api/v1/auth/telegram/extension/requests", s.telegramExtensionLogin)
	mux.HandleFunc("GET /api/v1/auth/telegram/extension/requests/{id}", s.telegramExtensionLogin)
	mux.HandleFunc("POST /api/v1/auth/telegram/extension/requests/{id}/complete", s.telegramExtensionLogin)
	mux.HandleFunc("POST /api/v1/auth/telegram/requests", s.telegramLogin)
	mux.HandleFunc("GET /api/v1/auth/telegram/requests/{id}", s.telegramLogin)
	mux.HandleFunc("POST /api/v1/auth/telegram/requests/{id}/complete", s.telegramLogin)
	mux.HandleFunc("POST /api/v1/auth/register", s.register)
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("POST /api/v1/auth/recovery", s.recovery)
	mux.HandleFunc("GET /api/v1/calendar/feed/{token}", s.calendarFeed)
	mux.HandleFunc("GET /api/v1/extension/download/{token}/avari-extension.zip", s.extensionDownload)
	mux.Handle("/api/v1/", s.auth(http.HandlerFunc(s.api)))
	if s.Assets != nil {
		mux.Handle("/", http.HandlerFunc(s.static))
	}
	return s.middleware(mux)
}
func write(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}
func fail(w http.ResponseWriter, e error) {
	var ce *core.Error
	if errors.As(e, &ce) {
		write(w, ce.Status, map[string]any{"error": ce.Message, "current": ce.Current})
		return
	}
	slog.Error("request failed", "error", e)
	write(w, 500, map[string]string{"error": "Внутренняя ошибка. Попробуйте ещё раз"})
}
func read(r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return core.Fail(415, "Ожидается JSON")
	}
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return core.Fail(400, "Некорректный JSON запроса")
	}
	var extra any
	if e := d.Decode(&extra); e != io.EOF {
		return core.Fail(400, "Лишние данные запроса")
	}
	return nil
}

var extensionOriginPattern = regexp.MustCompile(`^(chrome-extension://[a-p]{32}|moz-extension://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`)

func extensionOrigin(origin string) bool {
	return extensionOriginPattern.MatchString(origin)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				slog.Error("panic", "error", fmt.Sprint(v))
				write(w, 500, map[string]string{"error": "Внутренняя ошибка"})
			}
		}()
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: https://www.gravatar.com; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com; frame-ancestors 'none'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		origin := r.Header.Get("Origin")
		allowed := origin == s.Origin || extensionOrigin(origin)
		if origin != "" && allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, Idempotency-Key, X-Telegram-Login-Secret")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if r.Method == "OPTIONS" {
			if !allowed {
				write(w, 403, map[string]string{"error": "Источник не разрешён"})
				return
			}
			w.WriteHeader(204)
			return
		}
		if !oneSafe(r.Method) && origin != "" && !allowed {
			write(w, 403, map[string]string{"error": "Источник не разрешён"})
			return
		}
		if s.Personal {
			expected, err := url.Parse(s.Origin)
			if err != nil || r.Host != expected.Host {
				fail(w, core.Fail(403, "Неверный локальный адрес"))
				return
			}
		}
		limit := int64(256 * 1024)
		if r.URL.Path == "/api/v1/journal/import/preview" || r.URL.Path == "/api/v1/journal/import" {
			limit = 32 * 1024 * 1024
		} else if r.Method == "POST" && (r.URL.Path == "/api/v1/resumes" || (strings.HasPrefix(r.URL.Path, "/api/v1/resumes/") && strings.HasSuffix(r.URL.Path, "/versions"))) {
			limit = 25 * 1024 * 1024 // 20 MiB file + multipart overhead
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)

		start := time.Now()
		rec := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		duration := time.Since(start)

		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			slog.Debug("http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", duration.Milliseconds(),
				"remote_addr", r.RemoteAddr,
			)
			return
		}

		attrs := []any{
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", duration.Milliseconds(),
			"remote_addr", r.RemoteAddr,
			"bytes", rec.bytes,
		}

		switch {
		case rec.status >= 500:
			slog.Error("http request", attrs...)
		case rec.status >= 400:
			slog.Warn("http request", attrs...)
		default:
			slog.Info("http request", attrs...)
		}
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}
func oneSafe(method string) bool { return method == "GET" || method == "HEAD" || method == "OPTIONS" }
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		bearer := false
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
			bearer = true
		} else if c, e := r.Cookie("avari_session"); e == nil {
			token = c.Value
		}
		if token == "" {
			fail(w, core.Fail(401, "Войдите в аккаунт"))
			return
		}
		u, ss, e := s.Store.Authenticate(token)
		if e != nil {
			fail(w, e)
			return
		}
		if bearer && ss.Kind != "extension" || !bearer && ss.Kind != "web" {
			fail(w, core.Fail(401, "Неверный тип сессии"))
			return
		}
		if !bearer && !oneSafe(r.Method) {
			c, e := r.Cookie("avari_csrf")
			if e != nil || c.Value == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
				fail(w, core.Fail(403, "Проверка безопасности не пройдена. Обновите страницу"))
				return
			}
		}
		if u.Status != "active" && !(u.Status == "pending" && (r.URL.Path == "/api/v1/telegram" && r.Method == "GET" || strings.HasPrefix(r.URL.Path, "/api/v1/telegram/challenges"))) && r.URL.Path != "/api/v1/me" && r.URL.Path != "/api/v1/auth/logout" {
			fail(w, core.Fail(403, "Аккаунт ожидает одобрения или заблокирован"))
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), key(0), identity{u, ss})))
	})
}
func (s *Server) throttle(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if s.TrustedProxy {
		if ip := net.ParseIP(r.Header.Get("X-Real-IP")); ip != nil {
			host = ip.String()
		}
	}
	s.limitMu.Lock()
	defer s.limitMu.Unlock()
	now := time.Now()
	for k, values := range s.limits {
		if len(values) == 0 || now.Sub(values[len(values)-1]) > time.Minute {
			delete(s.limits, k)
		}
	}
	values := s.limits[host]
	active := values[:0]
	for _, t := range values {
		if now.Sub(t) < time.Minute {
			active = append(active, t)
		}
	}
	if len(active) >= 15 {
		s.limits[host] = active
		return false
	}
	s.limits[host] = append(active, now)
	return true
}
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if s.Personal {
		fail(w, core.Fail(403, "Создайте владельца через мастер локальной настройки"))
		return
	}
	if !s.throttle(r) {
		fail(w, core.Fail(429, "Слишком много попыток. Подождите минуту"))
		return
	}
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Timezone string `json:"timezone"`
	}
	if e := read(r, &b); e != nil {
		fail(w, e)
		return
	}
	s.LoginGate <- struct{}{}
	defer func() { <-s.LoginGate }()
	if b.Timezone == "" {
		b.Timezone = "Europe/Moscow"
	}
	u, e := s.Store.Register(b.Email, b.Password, b.Timezone)
	if e != nil {
		fail(w, e)
		return
	}
	write(w, 201, u)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.throttle(r) {
		fail(w, core.Fail(429, "Слишком много попыток. Подождите минуту"))
		return
	}
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Kind     string `json:"kind"`
		Name     string `json:"name"`
	}
	if e := read(r, &b); e != nil {
		fail(w, e)
		return
	}
	if b.Kind == "" {
		b.Kind = "web"
	}
	s.LoginGate <- struct{}{}
	defer func() { <-s.LoginGate }()
	u, ss, token, e := s.Store.Login(b.Email, b.Password, b.Kind, b.Name)
	if e != nil {
		fail(w, e)
		return
	}
	result := map[string]any{"user": u, "session": ss}
	if b.Kind == "web" {
		csrf := core.ID()
		for name, value := range map[string]string{"avari_session": token, "avari_csrf": csrf} {
			http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: name == "avari_session", Secure: s.Secure, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 3600})
		}
		result["csrf"] = csrf
	} else {
		result["token"] = token
	}
	write(w, 200, result)
}
func (s *Server) recovery(w http.ResponseWriter, r *http.Request) {
	if s.Personal {
		fail(w, core.Fail(400, "Для восстановления используйте резервную копию и сохранённый пароль владельца"))
		return
	}
	if !s.throttle(r) {
		fail(w, core.Fail(429, "Слишком много попыток. Подождите минуту"))
		return
	}
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if e := read(r, &b); e != nil {
		fail(w, e)
		return
	}
	s.LoginGate <- struct{}{}
	defer func() { <-s.LoginGate }()
	if e := s.Store.RequestPasswordReset(b.Email, b.Password); e != nil {
		fail(w, e)
		return
	}
	write(w, 200, map[string]any{"ok": true, "message": "Запрос на восстановление пароля отправлен администратору."})
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.Method != "GET" && r.Method != "HEAD" {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if strings.HasPrefix(name, "downloads/") {
		http.NotFound(w, r)
		return
	}
	if name == "" || name == "." {
		name = "index.html"
	}
	if _, e := fs.Stat(s.Assets, name); e != nil {
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
	}
	if name == "index.html" || name == "release.json" || name == "release-notes.json" || name == "privacy.html" || name == "sw.js" || name == "manifest.webmanifest" {
		w.Header().Set("Cache-Control", "no-cache")
	}
	if name == "sw.js" {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	} else if name == "manifest.webmanifest" {
		w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	}
	raw, e := fs.ReadFile(s.Assets, name)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(raw))
}
func clonePath(r *http.Request, p string) *http.Request {
	v := r.Clone(r.Context())
	u := *r.URL
	u.Path = p
	v.URL = &u
	return v
}
