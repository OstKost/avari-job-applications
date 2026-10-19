package httpapi

import (
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	who := r.Context().Value(key(0)).(identity)
	user := who.User.ID
	p := strings.TrimPrefix(r.URL.Path, "/api/v1/")
	method := r.Method
	source := "manual"
	if who.Session.Kind == "extension" {
		source = "extension"
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 200 {
		fail(w, core.Fail(400, "Слишком длинный ключ запроса"))
		return
	}
	respond := func(v any, e error) {
		if e != nil {
			fail(w, e)
		} else {
			write(w, 200, v)
		}
	}
	switch {
	case p == "vacancies/preview" && method == "POST":
		s.vacancyPreview(w, r)
	case p == "statistics/activity" && method == "GET":
		v, e := s.Store.ActivityStatistics(user, r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		respond(v, e)
	case p == "push/config" && method == "GET":
		enabled := false
		publicKey := ""
		if s.PushTransport != nil && s.PushTransport.Config() != nil {
			enabled = s.PushTransport.Config().Enabled()
			publicKey = s.PushTransport.Config().PublicKey()
		}
		subscribed := false
		if s.Store != nil && who.Session.ID != "" {
			subscribed = s.Store.IsSessionPushSubscribed(user, who.Session.ID)
		}
		write(w, 200, map[string]any{
			"enabled":    enabled,
			"publicKey":  publicKey,
			"subscribed": subscribed,
		})
	case p == "push/subscribe" && method == "POST":
		if s.PushTransport == nil || s.PushTransport.Config() == nil || !s.PushTransport.Config().Enabled() {
			fail(w, core.Fail(503, "Push-уведомления не настроены на сервере"))
			return
		}
		var sub webpush.Subscription
		if e := read(r, &sub); e != nil {
			fail(w, e)
			return
		}
		e := s.Store.SubscribePush(user, who.Session.ID, sub)
		respond(map[string]bool{"ok": true}, e)
	case p == "push/unsubscribe" && method == "POST":
		var b struct {
			Endpoint string `json:"endpoint"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		e := s.Store.UnsubscribePush(user, who.Session.ID, b.Endpoint)
		respond(map[string]bool{"ok": true}, e)
	case p == "push/test" && method == "POST":
		if s.PushTransport == nil || s.PushTransport.Config() == nil || !s.PushTransport.Config().Enabled() {
			fail(w, core.Fail(503, "Push-уведомления не настроены на сервере"))
			return
		}
		var b struct {
			Endpoint string `json:"endpoint"`
		}
		// Body is optional
		if r.Body != nil && r.ContentLength > 0 {
			if e := read(r, &b); e != nil {
				fail(w, e)
				return
			}
		}
		e := s.Store.EnqueueTestPush(user, who.Session.ID, b.Endpoint)
		if e != nil {
			fail(w, e)
			return
		}
		// If PushService is available, immediately trigger outbox processing
		if s.PushService != nil {
			_ = s.PushService.ProcessOutbox(r.Context(), time.Now().UTC())
		}
		write(w, 200, map[string]bool{"queued": true})
	case p == "daily-summary" && method == "GET":
		v, e := s.Store.DailySummary(user)
		respond(v, e)
	case p == "journal/export" && method == "GET":
		journal, e := s.Store.ExportJournal(user)
		w.Header().Set("Content-Disposition", `attachment; filename="avari-journal.json"`)
		respond(journal, e)
	case (p == "journal/import/preview" || p == "journal/import") && method == "POST":
		var b core.ImportRequest
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		report, e := s.Store.ImportJournal(user, b, p == "journal/import")
		respond(report, e)
	case (p == "local/update" && method == "GET") || (method == "POST" && (p == "local/update/check" || p == "local/update/download" || p == "local/update/install" || p == "local/update/snooze")):
		if who.Session.Kind != "web" {
			fail(w, core.Fail(403, "Обновление доступно только в браузере"))
			return
		}
		s.localUpdate(w, r, strings.TrimPrefix(strings.TrimPrefix(p, "local/update"), "/"))

	case p == "local/settings" && (method == "GET" || method == "PUT"):
		if who.Session.Kind != "web" {
			fail(w, core.Fail(403, "Настройки лаунчера доступны в браузере"))
			return
		}
		s.localSettings(w, r)

	case p == "me" && method == "GET":
		write(w, 200, who.User)
	case p == "me" && method == "PUT":
		var b struct {
			Timezone string `json:"timezone"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		if e := s.Store.SetTimezone(user, b.Timezone); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.User(user)
		respond(v, e)
	case p == "auth/logout" && method == "POST":
		e := s.Store.Logout(user, who.Session.ID)
		for _, name := range []string{"avari_session", "avari_csrf"} {
			http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: name == "avari_session", Secure: s.Secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
		}
		respond(map[string]bool{"ok": true}, e)
	case p == "auth/password" && method == "POST":
		var b struct {
			CurrentPassword string `json:"currentPassword"`
			NewPassword     string `json:"newPassword"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		e := s.Store.ChangePassword(user, b.CurrentPassword, b.NewPassword, who.Session.ID)
		respond(map[string]bool{"ok": true}, e)
	case p == "sessions" && method == "GET":
		v, e := s.Store.Sessions(user)
		respond(v, e)
	case strings.HasPrefix(p, "sessions/") && method == "DELETE":
		respond(map[string]bool{"ok": true}, s.Store.Logout(user, strings.TrimPrefix(p, "sessions/")))
	case p == "applications" && method == "GET":
		v, e := s.Store.Applications(user)
		respond(v, e)
	case p == "applications" && method == "POST":
		var b core.Application
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		if b.ID != "" {
			fail(w, core.Fail(400, "ID новой записи задаёт сервер"))
			return
		}
		v, e := s.Store.SaveApplication(user, b, key, source)
		respond(v, e)
	case strings.HasPrefix(p, "applications/") && method == "PUT":
		var b core.Application
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		id := strings.TrimPrefix(p, "applications/")
		if b.ID != "" && b.ID != id {
			fail(w, core.Fail(400, "ID записи не совпадает"))
			return
		}
		b.ID = id
		v, e := s.Store.SaveApplication(user, b, "", source)
		respond(v, e)
	case strings.HasPrefix(p, "applications/") && method == "GET":
		v, e := s.Store.Detail(user, strings.TrimPrefix(p, "applications/"))
		respond(v, e)
	case p == "tasks" && method == "GET":
		v, e := s.Store.Tasks(user)
		respond(v, e)
	case p == "tasks" && method == "POST":
		var b core.Task
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		if b.ID != "" {
			fail(w, core.Fail(400, "ID новой задачи задаёт сервер"))
			return
		}
		v, e := s.Store.SaveTask(user, b, key, source)
		respond(v, e)
	case strings.HasPrefix(p, "tasks/") && method == "PUT":
		var b core.Task
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		id := strings.TrimPrefix(p, "tasks/")
		if b.ID != "" && b.ID != id {
			fail(w, core.Fail(400, "ID задачи не совпадает"))
			return
		}
		b.ID = id
		v, e := s.Store.SaveTask(user, b, "", source)
		respond(v, e)
	case p == "notes" && method == "POST":
		var b core.Note
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.AddNote(user, b, key, source)
		respond(v, e)
	case strings.HasPrefix(p, "notes/") && method == "PUT":
		var b core.Note
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		id := strings.TrimPrefix(p, "notes/")
		if b.ID != "" && b.ID != id {
			fail(w, core.Fail(400, "ID заметки не совпадает"))
			return
		}
		b.ID = id
		v, e := s.Store.UpdateNote(user, b, source)
		respond(v, e)
	case p == "fields" && method == "GET":
		v, e := s.Store.Fields(user)
		respond(v, e)
	case p == "fields" && method == "PUT":
		var b struct {
			Fields        []core.Field `json:"fields"`
			ConfirmDelete bool         `json:"confirmDelete"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.SaveFields(user, b.Fields, b.ConfirmDelete)
		respond(v, e)
	case p == "proposals" && method == "GET":
		v, e := s.Store.PendingProposals(user)
		respond(v, e)
	case strings.HasPrefix(p, "proposals/") && method == "POST":
		var b struct {
			Action  string         `json:"action"`
			Version int            `json:"version"`
			Changes map[string]any `json:"changes"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.ResolveProposal(user, strings.TrimPrefix(p, "proposals/"), b.Action, b.Version, b.Changes)
		respond(v, e)
	case p == "observations" && method == "POST":
		if who.Session.Kind != "extension" {
			fail(w, core.Fail(403, "Наблюдения отправляет расширение"))
			return
		}
		var b core.Observation
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.Observe(user, b)
		respond(map[string]any{"proposal": v}, e)
	case p == "calendar/subscription" && method == "GET":
		token, e := s.Store.CalendarToken(user)
		respond(s.calendarSubscription(token), e)
	case p == "calendar/subscription" && (method == "POST" || method == "PUT"):
		token, e := s.Store.EnableCalendar(user, method == "PUT")
		respond(s.calendarSubscription(token), e)
	case p == "calendar/subscription" && method == "DELETE":
		respond(s.calendarSubscription(""), s.Store.DisableCalendar(user))
	case p == "extension/download" && (method == "GET" || method == "POST"):
		token, e := s.Store.ExtensionDownloadToken(user)
		respond(s.extensionDownloadLink(token), e)
	case p == "calendar" && method == "GET":
		loc, _ := time.LoadLocation(who.User.Timezone)
		if loc == nil {
			loc = time.UTC
		}
		today := time.Now().In(loc).Format("2006-01-02")
		end := time.Now().In(loc).AddDate(0, 0, 6).Format("2006-01-02")
		tasks, e := s.Store.Tasks(user)
		if e != nil {
			fail(w, e)
			return
		}
		upcoming := []core.Task{}
		overdue := []core.Task{}
		for _, t := range tasks {
			if t.Date < today && t.State == "open" {
				overdue = append(overdue, t)
			} else if t.Date >= today && t.Date <= end {
				upcoming = append(upcoming, t)
			}
		}
		write(w, 200, map[string]any{"today": today, "end": end, "tasks": upcoming, "overdue": overdue})
	case p == "resumes" && method == "GET":
		v, e := s.Store.Resumes(user)
		respond(v, e)
	case p == "resumes" && method == "POST":
		r.Body = http.MaxBytesReader(w, r.Body, 25*1024*1024)
		if err := r.ParseMultipartForm(10 * 1024 * 1024); err != nil {
			fail(w, core.Fail(400, "Ошибка чтения multipart формы или превышен лимит размера"))
			return
		}
		defer func() {
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
			}
		}()
		file, header, err := r.FormFile("file")
		if err != nil {
			fail(w, core.Fail(400, "Файл резюме обязателен"))
			return
		}
		defer file.Close()
		lr := io.LimitReader(file, core.MaxResumeFileSize+1)
		content, err := io.ReadAll(lr)
		if err != nil {
			fail(w, core.Fail(400, "Ошибка чтения файла резюме"))
			return
		}
		if int64(len(content)) > core.MaxResumeFileSize {
			fail(w, core.Fail(400, "Размер файла превышает лимит 20 МБ"))
			return
		}
		title := r.FormValue("title")
		v, e := s.Store.CreateResume(user, title, header.Filename, content)
		if e != nil {
			fail(w, e)
			return
		}
		write(w, 201, v)
	case strings.HasPrefix(p, "resumes/") && method == "PUT" && !strings.Contains(strings.TrimPrefix(p, "resumes/"), "/"):
		id := strings.TrimPrefix(p, "resumes/")
		var b struct {
			Title string `json:"title"`
		}
		if e := read(r, &b); e != nil {
			fail(w, e)
			return
		}
		v, e := s.Store.RenameResume(user, id, b.Title)
		respond(v, e)
	case strings.HasPrefix(p, "resumes/") && method == "DELETE" && !strings.Contains(strings.TrimPrefix(p, "resumes/"), "/"):
		id := strings.TrimPrefix(p, "resumes/")
		e := s.Store.DeleteResume(user, id)
		respond(map[string]bool{"ok": true}, e)
	case strings.HasPrefix(p, "resumes/") && strings.HasSuffix(p, "/versions") && method == "POST":
		id := strings.TrimSuffix(strings.TrimPrefix(p, "resumes/"), "/versions")
		r.Body = http.MaxBytesReader(w, r.Body, 25*1024*1024)
		if err := r.ParseMultipartForm(10 * 1024 * 1024); err != nil {
			fail(w, core.Fail(400, "Ошибка чтения multipart формы или превышен лимит размера"))
			return
		}
		defer func() {
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
			}
		}()
		file, header, err := r.FormFile("file")
		if err != nil {
			fail(w, core.Fail(400, "Файл резюме обязателен"))
			return
		}
		defer file.Close()
		lr := io.LimitReader(file, core.MaxResumeFileSize+1)
		content, err := io.ReadAll(lr)
		if err != nil {
			fail(w, core.Fail(400, "Ошибка чтения файла резюме"))
			return
		}
		if int64(len(content)) > core.MaxResumeFileSize {
			fail(w, core.Fail(400, "Размер файла превышает лимит 20 МБ"))
			return
		}
		v, e := s.Store.AddResumeVersion(user, id, header.Filename, content)
		if e != nil {
			fail(w, e)
			return
		}
		write(w, 201, v)
	case strings.HasPrefix(p, "resumes/") && strings.Contains(p, "/versions/") && strings.HasSuffix(p, "/download") && method == "GET":
		sub := strings.TrimSuffix(strings.TrimPrefix(p, "resumes/"), "/download")
		parts := strings.Split(sub, "/versions/")
		if len(parts) != 2 {
			fail(w, core.Fail(404, "Маршрут не найден"))
			return
		}
		resumeID, versionID := parts[0], parts[1]
		filename, _, size, content, err := s.Store.ResumeVersionDownload(user, resumeID, versionID)
		if err != nil {
			fail(w, err)
			return
		}
		safeFilename := filepath.Base(filename)
		disposition := mime.FormatMediaType("attachment", map[string]string{"filename": safeFilename})
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", disposition)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "private, no-cache")
		http.ServeContent(w, r, safeFilename, time.Time{}, content.(io.ReadSeeker))
		_ = size
	case strings.HasPrefix(p, "resumes/") && strings.Contains(p, "/versions/") && method == "DELETE":
		parts := strings.Split(strings.TrimPrefix(p, "resumes/"), "/versions/")
		if len(parts) != 2 {
			fail(w, core.Fail(404, "Маршрут не найден"))
			return
		}
		resumeID, versionID := parts[0], parts[1]
		e := s.Store.DeleteResumeVersion(user, resumeID, versionID)
		respond(map[string]bool{"ok": true}, e)
	default:
		fail(w, core.Fail(404, "Маршрут не найден"))
	}
}
