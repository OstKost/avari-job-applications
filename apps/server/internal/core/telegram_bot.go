package core

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TelegramActor struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}
type TelegramEntity struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}
type TelegramMessage struct {
	Entities        []TelegramEntity `json:"entities"`
	CaptionEntities []TelegramEntity `json:"caption_entities"`
	From            TelegramActor    `json:"from"`
	Chat            struct {
		ID   int64  `json:"id"`
		Type string `json:"type"`
	} `json:"chat"`
	Text    string `json:"text"`
	Caption string `json:"caption"`
}
type TelegramUpdate struct {
	ID       int64            `json:"update_id"`
	Message  *TelegramMessage `json:"message"`
	Callback *struct {
		ID      string           `json:"id"`
		From    TelegramActor    `json:"from"`
		Message *TelegramMessage `json:"message"`
		Data    string           `json:"data"`
	} `json:"callback_query"`
}
type TelegramButton struct {
	Text string `json:"text"`
	Data string `json:"callback_data,omitempty"`
	URL  string `json:"url,omitempty"`
}
type telegramDraft struct {
	Step        string
	Nonce       string
	Application Application
	Text        string
	URLs        []string
	Query       string
	Page        int
	Duplicate   bool
}
type TelegramOutgoing struct {
	ID, UserID string
	ChatID     int64
	Payload    string
	Attempts   int
	ExpiresAt  string
}

var telegramURL = regexp.MustCompile(`https?://[^\s<>]+`)
var tgStages = []string{"saved", "applied", "hr", "interview", "final", "offer"}
var tgStageNames = []string{"Сохранена", "Отклик", "HR", "Интервью", "Финал", "Оффер"}
var tgOutcomes = []string{"employer_rejected", "self_rejected", "vacancy_closed", "offer_accepted", "other"}
var tgOutcomeNames = []string{"Отказ работодателя", "Мой отказ", "Вакансия закрыта", "Оффер принят", "Другое"}

func tgButton(text, data string) TelegramButton { return TelegramButton{Text: text, Data: data} }
func tgJSON(v any) string                       { b, _ := json.Marshal(v); return string(b) }
func (s *Store) NextTelegramUpdate() (TelegramUpdate, bool, error) {
	var u TelegramUpdate
	var raw string
	e := s.DB.QueryRow("SELECT payload FROM telegram_inbox ORDER BY update_id LIMIT 1").Scan(&raw)
	if e == sql.ErrNoRows {
		return u, false, nil
	}
	if e != nil {
		return u, false, e
	}
	e = json.Unmarshal([]byte(raw), &u)
	return u, true, e
}

// All state changes, domain writes, responses and inbox acknowledgement commit together.
func (s *Store) ProcessTelegramUpdate(u TelegramUpdate, origin string, preview *Application) error {
	return s.transaction(func(tx *sql.Tx) error {
		var exists int
		if e := tx.QueryRow("SELECT count(*) FROM telegram_inbox WHERE update_id=?", u.ID).Scan(&exists); e != nil {
			return e
		}
		if exists == 0 {
			return nil
		}
		if _, e := tx.Exec("DELETE FROM telegram_inbox WHERE update_id=?", u.ID); e != nil {
			return e
		}
		// Keep a receipt so Telegram retries cannot replay already processed updates.
		if _, e := tx.Exec("INSERT OR IGNORE INTO telegram_receipts(update_id) VALUES(?)", u.ID); e != nil {
			return e
		}
		m := u.Message
		actor := TelegramActor{}
		data := ""
		if u.Callback != nil {
			m = u.Callback.Message
			actor = u.Callback.From
			data = u.Callback.Data
		} else if m != nil {
			actor = m.From
		}
		if m == nil || m.Chat.Type != "private" || actor.ID == 0 || actor.ID != m.Chat.ID {
			return nil
		}
		user := ""
		var account User
		e := tx.QueryRow("SELECT u.id,u.email,u.status,u.timezone FROM users u JOIN telegram_links l ON l.user_id=u.id WHERE l.telegram_id=?", actor.ID).Scan(&account.ID, &account.Email, &account.Status, &account.Timezone)
		if e != nil && e != sql.ErrNoRows {
			return e
		}
		if account.ID != "" && account.Status != "active" {
			return nil
		}
		user = account.ID
		seq := 0
		challengeID := ""
		send := func(text string, buttons ...[]TelegramButton) error {
			runes := []rune(text)
			for len(runes) > 1900 {
				if e := sendTelegramChunk(tx, s, user, m.Chat.ID, string(runes[:1900]), fmt.Sprintf("update:%d:chunk:%d", u.ID, seq)); e != nil {
					return e
				}
				seq++
				runes = runes[1900:]
			}
			text = string(runes)
			seq++
			payload := map[string]any{"chat_id": m.Chat.ID, "text": text, "link_preview_options": map[string]bool{"is_disabled": true}}
			if len(buttons) > 0 {
				payload["reply_markup"] = map[string]any{"inline_keyboard": buttons}
			}
			var uid any
			if user != "" {
				uid = user
			}
			_, e := tx.Exec("INSERT INTO telegram_outbox(id,user_id,chat_id,challenge_id,payload,next_attempt_at,expires_at,dedupe) VALUES(?,?,?,?,?,?,?,?)", ID(), uid, m.Chat.ID, challengeID, tgJSON(payload), s.nowTime().UTC().Format(timestampLayout), s.nowTime().Add(24*time.Hour).UTC().Format(timestampLayout), fmt.Sprintf("update:%d:%d", u.ID, seq))
			return e
		}
		text := strings.TrimSpace(m.Text)
		if text == "" {
			text = strings.TrimSpace(m.Caption)
		}
		if strings.HasPrefix(text, "/start ") && u.Callback == nil {
			token := strings.TrimSpace(strings.TrimPrefix(text, "/start "))
			c, e := telegramChallenge(tx, "c.token_hash", tokenHash(token))
			if e != nil {
				return send("Ссылка недействительна. Создайте новый запрос на сайте.")
			}
			if c.Status != "pending" || c.ExpiresAt <= s.nowTime().UTC().Format(timestampLayout) || c.TelegramID != 0 && c.TelegramID != actor.ID {
				return send("Ссылка истекла или уже использована.")
			}
			if c.Purpose == "login" && user == "" {
				return send("Для входа нужен привязанный аккаунт. Зарегистрируйтесь на сайте jobs.avari.dev или подключите Telegram в настройках существующего аккаунта.", []TelegramButton{{Text: "Открыть сайт", URL: origin}})
			}
			if c.UserID != "" {
				var status string
				if e = tx.QueryRow("SELECT status FROM users WHERE id=?", c.UserID).Scan(&status); e != nil {
					return e
				}
				if status == "blocked" {
					return nil
				}
			}
			if c.Purpose == "login" {
				c.UserID = user
			}
			var challengeUser any
			if c.UserID != "" {
				challengeUser = c.UserID
			}
			if _, e = tx.Exec("UPDATE telegram_challenges SET telegram_id=?,chat_id=?,username=?,display_name=?,user_id=? WHERE id=?", actor.ID, m.Chat.ID, actor.Username, strings.TrimSpace(actor.FirstName+" "+actor.LastName), challengeUser, c.ID); e != nil {
				return e
			}
			challengeID = c.ID
			title := "Подключить Telegram к " + c.Email + "? После этого подтвердите аккаунт на сайте."
			if c.Purpose == "registration" {
				title = "Подтвердить регистрацию " + c.Email + "? Email при этом не подтверждается."
			}
			if c.Purpose == "login" {
				destination := "Вход на " + origin
				if c.ClientKind == "extension" {
					destination = "Вход в расширение Avari.Jobs · " + origin
				}
				title = fmt.Sprintf("%s\nБраузер: %s\nВремя: %s\nКод: %s\nПодтвердите, только если вы начали вход и код совпадает.", destination, c.Browser, c.CreatedAt, c.Code)
			}
			return send(title, []TelegramButton{tgButton("Подтвердить", "auth:"+c.ID), tgButton("Отмена", "deny:"+c.ID)})
		}
		if strings.HasPrefix(data, "auth:") || strings.HasPrefix(data, "deny:") {
			id := strings.SplitN(data, ":", 2)[1]
			challengeID = id
			e := s.telegramDecideTx(tx, id, actor.ID, strings.HasPrefix(data, "auth:"))
			if e != nil {
				challengeID = ""
				var ce *Error
				if errors.As(e, &ce) {
					return send(ce.Message)
				}
				return e
			}
			if strings.HasPrefix(data, "deny:") {
				challengeID = ""
			}
			return send("Запрос обработан. Вернитесь на сайт. Сводки можно включить отдельно в /settings.")
		}
		if user == "" {
			return send("Зарегистрируйтесь или подключите Telegram в настройках на сайте jobs.avari.dev.", []TelegramButton{{Text: "Открыть сайт", URL: origin}})
		}
		var d telegramDraft
		var raw string
		e = tx.QueryRow("SELECT payload FROM telegram_drafts WHERE telegram_id=? AND expires_at>?", actor.ID, s.nowTime().UTC().Format(timestampLayout)).Scan(&raw)
		if e == nil {
			if e = json.Unmarshal([]byte(raw), &d); e != nil {
				return e
			}
		} else if e != sql.ErrNoRows {
			return e
		}
		persist := func() error {
			_, e := tx.Exec("INSERT INTO telegram_drafts VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", actor.ID, tgJSON(d), s.nowTime().Add(24*time.Hour).UTC().Format(timestampLayout))
			return e
		}
		reset := func() { d = telegramDraft{Nonce: ID()[:12]} }
		callback := func(action string) string { return d.Nonce + ":" + action }
		cancel := func() []TelegramButton { return []TelegramButton{tgButton("Отмена", callback("cancel"))} }
		card := func(a Application) error {
			d.Application = a
			d.Step = "card"
			stage := a.Stage
			for i, v := range tgStages {
				if v == a.Stage {
					stage = tgStageNames[i]
				}
			}
			state := map[string]string{"active": "Активна", "paused": "Приостановлена", "closed": "Закрыта"}[a.State]
			return send(fmt.Sprintf("%s — %s\n%s\nЭтап: %s · %s\n%s · %s", a.Company, a.Position, a.URL, stage, state, a.Location, a.WorkFormat)+"\nЗарплата: "+telegramSalary(a.Salary)+"\nСохранена: "+a.SavedDate, []TelegramButton{tgButton("Этап", callback("stage")), tgButton("Состояние", callback("state"))}, []TelegramButton{tgButton("Добавить заметку", callback("note")), tgButton("Задачи и интервью", callback("events"))}, []TelegramButton{{Text: "Открыть на сайте", URL: origin + "/applications/" + a.ID}})
		}
		previewCard := func() error {
			d.Step = "preview"
			a := d.Application
			if canonical := trackedJobURL(a.URL); canonical != "" {
				apps, err := list[Application](tx, user, "application")
				if err != nil {
					return err
				}
				for _, existing := range apps {
					if trackedJobURL(existing.URL) == canonical {
						d.Duplicate = true
						if err = card(existing); err != nil {
							return err
						}
						if d.Text != "" {
							return send("Эта вакансия уже есть. Добавить присланный текст отдельной заметкой?", []TelegramButton{tgButton("Добавить текст", callback("duplicate-note"))}, cancel())
						}
						return nil
					}
				}
			}
			if a.Company == "" {
				d.Step = "company"
				return send("Укажите компанию (до 500 символов).", cancel())
			}
			if a.Position == "" {
				d.Step = "position"
				return send("Укажите должность (до 500 символов).", cancel())
			}
			a.Stage = "saved"
			a.State = "active"
			a.SavedDate = s.localDate(tx, user)
			if e := a.Validate(); e != nil {
				return send(e.Error(), cancel())
			}
			var count int
			if e := tx.QueryRow("SELECT count(*) FROM documents WHERE user_id=? AND kind='application'", user).Scan(&count); e != nil {
				return e
			}
			if count >= 1000 {
				return send("Достигнут лимит 1000 вакансий.", cancel())
			}
			extra := fmt.Sprintf("\nМесто: %s\nФормат: %s\nЗарплата: %s", a.Location, a.WorkFormat, telegramSalary(a.Salary))
			return send(fmt.Sprintf("Предварительная карточка\n%s — %s\n%s%s\nНачальная заметка:\n%s", a.Company, a.Position, a.URL, extra, d.Text), []TelegramButton{tgButton("Сохранить", callback("save"))}, []TelegramButton{tgButton("Компания", callback("company")), tgButton("Должность", callback("position"))}, cancel())
		}
		showSearch := func() error {
			apps, e := list[Application](tx, user, "application")
			if e != nil {
				return e
			}
			sort.Slice(apps, func(i, j int) bool { return apps[i].UpdatedAt > apps[j].UpdatedAt })
			filtered := []Application{}
			for _, a := range apps {
				if strings.Contains(strings.ToLower(a.Company+" "+a.Position), strings.ToLower(d.Query)) {
					filtered = append(filtered, a)
				}
			}
			rows := [][]TelegramButton{}
			start := d.Page * 5
			if start > len(filtered) {
				start = 0
				d.Page = 0
			}
			end := start + 5
			if end > len(filtered) {
				end = len(filtered)
			}
			for i := start; i < end; i++ {
				a := filtered[i]
				rows = append(rows, []TelegramButton{tgButton(a.Company+" — "+a.Position, callback("open:"+a.ID))})
			}
			nav := []TelegramButton{}
			if d.Page > 0 {
				nav = append(nav, tgButton("Назад", callback("prev")))
			}
			if end < len(filtered) {
				nav = append(nav, tgButton("Далее", callback("next")))
			}
			if len(nav) > 0 {
				rows = append(rows, nav)
			}
			rows = append(rows, []TelegramButton{tgButton("Поиск", callback("search"))})
			d.Step = "search"
			return send(fmt.Sprintf("Вакансии: %d. Страница %d. Отправьте компанию или должность для поиска.", len(filtered), d.Page+1), rows...)
		}
		agenda := func(days int, appID string) error {
			today, _, e := s.userLocalDate(tx, user, s.nowTime())
			if e != nil {
				return e
			}
			loc, _ := time.LoadLocation(account.Timezone)
			if loc == nil {
				loc = time.UTC
			}
			until := s.nowTime().In(loc).AddDate(0, 0, days-1).Format("2006-01-02")
			tasks, e := list[Task](tx, user, "task")
			if e != nil {
				return e
			}
			sort.Slice(tasks, func(i, j int) bool { return tasks[i].Date+tasks[i].Time < tasks[j].Date+tasks[j].Time })
			lines := []string{"Задачи и интервью (" + account.Timezone + ")"}
			for _, t := range tasks {
				if appID == "" && t.State != "open" || appID != "" && t.ApplicationID != appID || t.Date > until {
					continue
				}
				prefix := ""
				if t.Date < today && t.State == "open" {
					prefix = "Просрочено: "
				}
				kind := map[string]string{"task": "задача", "interview": "интервью"}[t.Kind]
				if t.State == "done" {
					kind += " · завершено"
				}
				lines = append(lines, prefix+t.Date+" "+t.Time+" — "+t.Title+" ("+kind+")")
			}
			if len(lines) == 1 {
				lines = append(lines, "Открытых событий нет.")
			}
			return send(strings.Join(lines, "\n"), []TelegramButton{{Text: "Открыть на сайте", URL: origin}})
		}
		settings := func() error {
			var morning, evening bool
			if e := tx.QueryRow("SELECT morning,evening FROM telegram_links WHERE user_id=?", user).Scan(&morning, &evening); e != nil {
				return e
			}
			d.Step = "settings"
			label := func(b bool) string {
				if b {
					return "вкл"
				}
				return "выкл"
			}
			return send("Сводки по будням в 09:00 и 18:00 ("+account.Timezone+").", []TelegramButton{tgButton("Утренняя: "+label(morning), callback("morning")), tgButton("Вечерняя: "+label(evening), callback("evening"))}, []TelegramButton{tgButton("Отключить Telegram", callback("disconnect"))})
		}
		if data != "" {
			if d.Nonce == "" || !strings.HasPrefix(data, d.Nonce+":") {
				return send("Кнопка устарела. Откройте карточку заново через /search.")
			}
			action := strings.TrimPrefix(data, d.Nonce+":")
			d.Nonce = ID()[:12]
			switch {
			case action == "cancel":
				reset()
				e = send("Диалог отменён. /add · /search · /today · /week · /settings")
			case strings.HasPrefix(action, "open:"):
				var a Application
				a, e = get[Application](tx, user, "application", strings.TrimPrefix(action, "open:"))
				if e == nil {
					e = card(a)
				}
			case action == "today":
				e = agenda(1, "")
			case action == "week":
				e = agenda(7, "")
			case action == "settings":
				e = settings()
			case action == "add":
				d.Step = "input"
				e = send("Отправьте ссылку, текст или перешлите сообщение с вакансией.", cancel())
			case action == "search":
				d.Step = "search"
				d.Query = ""
				d.Page = 0
				e = showSearch()
			case action == "next" || action == "prev":
				if action == "next" {
					d.Page++
				} else if d.Page > 0 {
					d.Page--
				}
				e = showSearch()
			case action == "company" || action == "position":
				d.Step = action
				e = send("Введите "+map[string]string{"company": "компанию", "position": "должность"}[action]+" (до 500 символов).", cancel())
			case strings.HasPrefix(action, "url:"):
				i, _ := strconv.Atoi(strings.TrimPrefix(action, "url:"))
				if i < 0 || i >= len(d.URLs) {
					return send("Ссылка недоступна.")
				}
				d.Application.URL = d.URLs[i]
				if preview != nil {
					d.Application = *preview
					d.Application.URL = d.URLs[i]
				}
				e = previewCard()
			case action == "save" && d.Step == "preview":
				apps, err := list[Application](tx, user, "application")
				if err != nil {
					return err
				}
				canonical := trackedJobURL(d.Application.URL)
				var duplicate *Application
				for _, a := range apps {
					if canonical != "" && trackedJobURL(a.URL) == canonical {
						copy := a
						duplicate = &copy
						break
					}
				}
				if duplicate != nil {
					d.Duplicate = true
					e = card(*duplicate)
					if e == nil && d.Text != "" {
						e = send("Эта вакансия уже есть. Добавить присланный текст отдельной заметкой?", []TelegramButton{tgButton("Добавить текст", callback("duplicate-note"))}, cancel())
					}
				} else {
					a := d.Application
					a.Stage = "saved"
					a.State = "active"
					a.ID = ""
					a.SavedDate = s.localDate(tx, user)
					a, e = s.saveApplicationTx(tx, user, a, fmt.Sprintf("telegram:%d", u.ID), "telegram")
					if e != nil {
						break
					}
					if d.Text != "" {
						_, e = s.addNoteTx(tx, user, Note{ApplicationID: a.ID, Text: d.Text}, fmt.Sprintf("telegram:%d", u.ID), "telegram")
						if e != nil {
							return e
						}
					}
					d.Text = ""
					e = card(a)
				}
			case action == "duplicate-note" && d.Duplicate:
				_, e = s.addNoteTx(tx, user, Note{ApplicationID: d.Application.ID, Text: d.Text}, fmt.Sprintf("telegram:%d", u.ID), "telegram")
				if e == nil {
					d.Text = ""
					d.Duplicate = false
					e = card(d.Application)
				}
			case action == "stage":
				d.Step = "stage"
				rows := [][]TelegramButton{}
				for i, v := range tgStages {
					rows = append(rows, []TelegramButton{tgButton(tgStageNames[i], callback("stage:"+v))})
				}
				rows = append(rows, cancel())
				e = send("Выберите этап.", rows...)
			case action == "state":
				d.Step = "state"
				e = send("Выберите состояние.", []TelegramButton{tgButton("Активна", callback("state:active")), tgButton("Приостановлена", callback("state:paused"))}, []TelegramButton{tgButton("Закрыть", callback("close"))}, cancel())
			case action == "close":
				d.Step = "outcome"
				rows := [][]TelegramButton{}
				for i, v := range tgOutcomes {
					rows = append(rows, []TelegramButton{tgButton(tgOutcomeNames[i], callback("outcome:"+v))})
				}
				rows = append(rows, cancel())
				e = send("Выберите результат закрытия.", rows...)
			case strings.HasPrefix(action, "stage:") || strings.HasPrefix(action, "state:") || strings.HasPrefix(action, "outcome:"):
				a := d.Application
				v := strings.SplitN(action, ":", 2)
				switch v[0] {
				case "stage":
					a.Stage = v[1]
				case "state":
					a.State = v[1]
				case "outcome":
					a.State = "closed"
					a.Outcome = v[1]
				}
				a, e = s.saveApplicationTx(tx, user, a, "", "telegram")
				if e == nil {
					e = card(a)
				}
			case action == "note":
				d.Step = "note"
				e = send("Введите заметку (до 20000 символов).", cancel())
			case action == "note-save" && d.Step == "note-confirm":
				_, e = s.addNoteTx(tx, user, Note{ApplicationID: d.Application.ID, Text: d.Text}, fmt.Sprintf("telegram:%d", u.ID), "telegram")
				if e == nil {
					d.Text = ""
					e = card(d.Application)
				}
			case action == "events":
				e = agenda(36500, d.Application.ID)
			case action == "morning" || action == "evening":
				if _, e = tx.Exec("UPDATE telegram_links SET "+action+"=1-"+action+",delivery_enabled=1 WHERE user_id=?", user); e == nil {
					e = settings()
				}
			case action == "disconnect":
				d.Step = "disconnect"
				e = send("Отключить Telegram и сводки? Веб-сессии сохранятся.", []TelegramButton{tgButton("Отключить", callback("disconnect-confirm"))}, cancel())
			case action == "disconnect-confirm" && d.Step == "disconnect":
				if _, e = tx.Exec("UPDATE telegram_challenges SET status='cancelled' WHERE user_id=? AND status IN ('pending','approved')", user); e != nil {
					return e
				}
				if _, e = tx.Exec("UPDATE telegram_outbox SET status='cancelled' WHERE user_id=? AND status='pending'", user); e != nil {
					return e
				}
				if _, e = tx.Exec("DELETE FROM telegram_links WHERE user_id=?", user); e != nil {
					return e
				}
				reset()
				user = ""
				e = send("Telegram отключён.")
			default:
				e = send("Действие недоступно. /cancel")
			}
		} else if strings.HasPrefix(text, "/") {
			command := strings.Fields(text)[0]
			reset()
			switch command {
			case "/add":
				d.Step = "input"
				e = send("Отправьте ссылку, текст или перешлите сообщение с вакансией.", cancel())
			case "/search":
				d.Query = strings.TrimSpace(strings.TrimPrefix(text, "/search"))
				e = showSearch()
			case "/today":
				e = agenda(1, "")
			case "/week":
				e = agenda(7, "")
			case "/settings":
				e = settings()
			case "/cancel":
				e = send("Диалог отменён.")
			default:
				e = send("Avari.Jobs\n/add — добавить вакансию\n/search — журнал и поиск\n/today — сегодня и просроченные\n/week — ближайшие семь дней\n/settings — сводки и подключение\n/cancel — отмена", []TelegramButton{tgButton("Добавить", callback("add")), tgButton("Журнал", callback("search"))}, []TelegramButton{tgButton("Сегодня", callback("today")), tgButton("Неделя", callback("week"))}, []TelegramButton{tgButton("Настройки", callback("settings"))})
			}
		} else {
			switch d.Step {
			case "company", "position":
				if textLength(text) == 0 || textLength(text) > 500 {
					e = send("Введите от 1 до 500 символов.", cancel())
					break
				}
				if d.Step == "company" {
					d.Application.Company = text
				} else {
					d.Application.Position = text
				}
				e = previewCard()
			case "search":
				d.Query = text
				d.Page = 0
				e = showSearch()
			case "note":
				if text == "" || textLength(text) > 20000 {
					e = send("Заметка должна содержать от 1 до 20000 символов.", cancel())
					break
				}
				d.Text = text
				d.Step = "note-confirm"
				e = send("Добавить заметку?\n"+text, []TelegramButton{tgButton("Сохранить заметку", callback("note-save"))}, cancel())
			default:
				reset()
				d.Step = "input"
				if text == "" {
					e = send("Отправьте текст или ссылку.", cancel())
					break
				}
				if textLength(text) > 20000 {
					e = send("Текст превышает лимит 20000 символов.", cancel())
					break
				}
				d.URLs = TelegramMessageURLs(m)
				if len(d.URLs) > 20 {
					e = send("В сообщении больше 20 ссылок. Отправьте меньше ссылок.", cancel())
					break
				}
				d.Text = text
				if len(d.URLs) == 1 && d.URLs[0] == text {
					d.Text = ""
				}
				if len(d.URLs) > 1 {
					d.Step = "urls"
					rows := [][]TelegramButton{}
					for i, url := range d.URLs {
						rows = append(rows, []TelegramButton{tgButton(url, callback("url:"+strconv.Itoa(i)))})
					}
					e = send("Выберите одну ссылку. Полный текст останется в начальной заметке.", rows...)
				} else {
					if len(d.URLs) == 1 {
						d.Application.URL = d.URLs[0]
						if preview != nil {
							d.Application = *preview
							d.Application.URL = d.URLs[0]
						}
					}
					e = previewCard()
				}
			}
		}
		if e != nil {
			var ce *Error
			if !errors.As(e, &ce) {
				return e
			}
			if ce.Status == 409 && d.Application.ID != "" {
				current, err := get[Application](tx, user, "application", d.Application.ID)
				if err != nil {
					return err
				}
				if err = send("Запись изменилась на сайте. Проверьте актуальные данные и повторите действие."); err != nil {
					return err
				}
				if err = card(current); err != nil {
					return err
				}
			} else if err := send(ce.Message, cancel()); err != nil {
				return err
			}
		}
		return persist()
	})
}
func (s *Store) TelegramPending(at time.Time) ([]TelegramOutgoing, error) {
	stamp := at.UTC().Format(timestampLayout)
	var retryUntil string
	err := s.DB.QueryRow("SELECT value FROM instance_metadata WHERE key='telegram_retry_after'").Scan(&retryUntil)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if retryUntil > stamp {
		return []TelegramOutgoing{}, nil
	}
	if _, e := s.DB.Exec("UPDATE telegram_outbox SET status='expired' WHERE status='pending' AND expires_at<=?", stamp); e != nil {
		return nil, e
	}
	if _, e := s.DB.Exec("UPDATE telegram_outbox AS o SET status='cancelled' WHERE o.status='pending' AND NOT ("+telegramDeliveryPredicate+")", stamp); e != nil {
		return nil, e
	}
	rows, e := s.DB.Query(`SELECT o.id,coalesce(o.user_id,''),o.chat_id,o.payload,o.attempts,o.expires_at FROM telegram_outbox o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN telegram_links l ON l.user_id=o.user_id WHERE o.status='pending' AND o.next_attempt_at<=? AND (o.user_id IS NULL OR (u.status='active' AND l.chat_id=o.chat_id )) AND NOT EXISTS(SELECT 1 FROM telegram_outbox earlier WHERE earlier.chat_id=o.chat_id AND earlier.rowid<o.rowid AND earlier.status='pending') ORDER BY o.rowid LIMIT 50`, stamp)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []TelegramOutgoing{}
	for rows.Next() {
		var o TelegramOutgoing
		if e = rows.Scan(&o.ID, &o.UserID, &o.ChatID, &o.Payload, &o.Attempts, &o.ExpiresAt); e != nil {
			return nil, e
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func (s *Store) TelegramDelivery(o TelegramOutgoing, code, retry int, at time.Time) error {
	status := "pending"
	if code == 200 {
		status = "delivered"
	} else if code == 403 || code == 400 {
		status = "failed"
	}
	if code == 403 {
		if _, e := s.DB.Exec("UPDATE telegram_links SET morning=0,evening=0,delivery_enabled=0 WHERE chat_id=?", o.ChatID); e != nil {
			return e
		}
	}
	if code == 429 && retry > 0 {
		if _, e := s.DB.Exec("INSERT INTO instance_metadata(key,value) VALUES('telegram_retry_after',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", at.Add(time.Duration(retry)*time.Second).UTC().Format(timestampLayout)); e != nil {
			return e
		}
	}
	if retry < 1 {
		retry = 1 << min(o.Attempts+1, 9)
	}
	_, e := s.DB.Exec("UPDATE telegram_outbox SET status=?,attempts=attempts+1,next_attempt_at=? WHERE id=? AND status='pending'", status, at.Add(time.Duration(retry)*time.Second).UTC().Format(timestampLayout), o.ID)
	return e
}

func sendTelegramChunk(tx *sql.Tx, s *Store, user string, chat int64, text, dedupe string) error {
	var uid any
	if user != "" {
		uid = user
	}
	_, e := tx.Exec("INSERT INTO telegram_outbox(id,user_id,chat_id,payload,next_attempt_at,expires_at,dedupe) VALUES(?,?,?,?,?,?,?)", ID(), uid, chat, tgJSON(map[string]any{"chat_id": chat, "text": text}), s.nowTime().UTC().Format(timestampLayout), s.nowTime().Add(24*time.Hour).UTC().Format(timestampLayout), dedupe)
	return e
}

func telegramSalary(s Salary) string {
	parts := []string{}
	if s.Min != nil {
		parts = append(parts, fmt.Sprintf("от %g", *s.Min))
	}
	if s.Max != nil {
		parts = append(parts, fmt.Sprintf("до %g", *s.Max))
	}
	if len(parts) == 0 {
		return "не указана"
	}
	parts = append(parts, s.Currency)
	if p := map[string]string{"month": "в месяц", "year": "в год", "hour": "в час", "project": "за проект"}[s.Period]; p != "" {
		parts = append(parts, p)
	}
	if s.Tax == "gross" {
		parts = append(parts, "до налогов")
	} else if s.Tax == "net" {
		parts = append(parts, "на руки")
	}
	return strings.Join(parts, " ")
}

// Telegram represents hidden links in entities rather than in message text.
func TelegramMessageURLs(m *TelegramMessage) []string {
	text := m.Text
	if text == "" {
		text = m.Caption
	}
	candidates := telegramURL.FindAllString(text, -1)
	for _, entity := range append(append([]TelegramEntity{}, m.Entities...), m.CaptionEntities...) {
		if entity.Type == "text_link" && strings.HasPrefix(entity.URL, "http") {
			candidates = append(candidates, entity.URL)
		}
	}
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range candidates {
		raw = strings.TrimRight(raw, ".,;!?)")
		if !seen[raw] {
			out = append(out, raw)
			seen[raw] = true
		}
	}
	return out
}
