package core

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const telegramMigration = `
CREATE TABLE IF NOT EXISTS telegram_links(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, telegram_id INTEGER NOT NULL UNIQUE, chat_id INTEGER NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL, morning INTEGER NOT NULL DEFAULT 0, evening INTEGER NOT NULL DEFAULT 0, delivery_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS telegram_challenges(id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('registration','link','login')), user_id TEXT REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, browser_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL, created_at TEXT NOT NULL, browser TEXT NOT NULL, code TEXT NOT NULL, telegram_id INTEGER, chat_id INTEGER, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS telegram_challenges_user ON telegram_challenges(user_id,purpose,status);
CREATE TABLE IF NOT EXISTS telegram_drafts(telegram_id INTEGER PRIMARY KEY, payload TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_receipts(update_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS telegram_inbox(update_id INTEGER PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_outbox(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,chat_id INTEGER NOT NULL,challenge_id TEXT NOT NULL DEFAULT '',payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,expires_at TEXT NOT NULL,dedupe TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS telegram_outbox_pending ON telegram_outbox(status,next_attempt_at);
CREATE TRIGGER IF NOT EXISTS telegram_block AFTER UPDATE OF status ON users WHEN NEW.status='blocked' BEGIN
UPDATE telegram_challenges SET status='cancelled' WHERE user_id=NEW.id AND status IN ('pending','approved');
UPDATE telegram_outbox SET status='cancelled' WHERE user_id=NEW.id AND status='pending';
END;
CREATE TRIGGER IF NOT EXISTS telegram_revoke AFTER DELETE ON sessions BEGIN
UPDATE telegram_challenges SET status='cancelled' WHERE user_id=OLD.user_id AND purpose='login' AND status IN ('pending','approved');
END;`

type TelegramLink struct {
	TelegramID      int64  `json:"telegramId"`
	ChatID          int64  `json:"-"`
	Username        string `json:"username"`
	DisplayName     string `json:"displayName"`
	Morning         bool   `json:"morning"`
	Evening         bool   `json:"evening"`
	DeliveryEnabled bool   `json:"deliveryEnabled"`
}
type TelegramChallenge struct {
	ID          string `json:"id"`
	Purpose     string `json:"purpose"`
	Status      string `json:"status"`
	ExpiresAt   string `json:"expiresAt"`
	CreatedAt   string `json:"createdAt"`
	Browser     string `json:"browser"`
	Code        string `json:"code"`
	Email       string `json:"email,omitempty"`
	TelegramID  int64  `json:"telegramId,omitempty"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	UserID      string `json:"-"`
	ChatID      int64  `json:"-"`
}

func (s *Store) TelegramLink(user string) (*TelegramLink, error) {
	var l TelegramLink
	e := s.DB.QueryRow("SELECT telegram_id,chat_id,username,display_name,morning,evening,delivery_enabled FROM telegram_links WHERE user_id=?", user).Scan(&l.TelegramID, &l.ChatID, &l.Username, &l.DisplayName, &l.Morning, &l.Evening, &l.DeliveryEnabled)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	return &l, e
}
func (s *Store) TelegramUser(id int64) (User, error) {
	var u User
	e := s.DB.QueryRow("SELECT u.id,u.email,u.status,u.timezone,u.created_at FROM users u JOIN telegram_links t ON t.user_id=u.id WHERE t.telegram_id=? AND u.status='active'", id).Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt)
	if e == sql.ErrNoRows {
		return u, Fail(403, "Привяжите активный аккаунт на сайте jobs.avari.dev")
	}
	return u, e
}
func (s *Store) NewTelegramChallenge(user, purpose, browser string, previous ...string) (TelegramChallenge, string, string, error) {
	c := TelegramChallenge{ID: ID(), UserID: user, Purpose: purpose, Status: "pending", Browser: browser, Code: strings.ToUpper(ID()[:6]), CreatedAt: s.nowTime().UTC().Format(timestampLayout)}
	token, secret := ID(), ID()+ID()
	ttl := 10 * time.Minute
	if purpose == "login" {
		ttl = 5 * time.Minute
	} else if !oneOf(purpose, "registration", "link") {
		return c, "", "", Fail(400, "Неизвестное назначение")
	}
	if len(browser) > 200 {
		browser = browser[:200]
		c.Browser = browser
	}
	c.ExpiresAt = s.nowTime().Add(ttl).UTC().Format(timestampLayout)
	e := s.transaction(func(tx *sql.Tx) error {
		if len(previous) == 2 {
			if _, e := tx.Exec("UPDATE telegram_challenges SET status='cancelled' WHERE id=? AND browser_hash=? AND purpose=? AND status IN ('pending','approved')", previous[0], tokenHash(previous[1]), purpose); e != nil {
				return e
			}
		}
		var uid any
		if purpose != "login" {
			var status string
			if e := tx.QueryRow("SELECT status FROM users WHERE id=?", user).Scan(&status); e != nil {
				return e
			}
			if status == "blocked" || (purpose == "registration" && status != "pending") || (purpose == "link" && status != "active") {
				return Fail(403, "Операция недоступна")
			}
			uid = user
			if _, e := tx.Exec("UPDATE telegram_challenges SET status='cancelled' WHERE user_id=? AND purpose=? AND status IN ('pending','approved')", user, purpose); e != nil {
				return e
			}
		}
		_, e := tx.Exec("INSERT INTO telegram_challenges(id,purpose,user_id,token_hash,browser_hash,expires_at,created_at,browser,code) VALUES(?,?,?,?,?,?,?,?,?)", c.ID, purpose, uid, tokenHash(token), tokenHash(secret), c.ExpiresAt, c.CreatedAt, browser, c.Code)
		return e
	})
	return c, token, secret, e
}
func telegramChallenge(q queryer, column, value string) (TelegramChallenge, error) {
	var c TelegramChallenge
	e := q.QueryRowContext(context.Background(), `SELECT c.id,c.purpose,c.status,c.expires_at,c.created_at,c.browser,c.code,coalesce(c.user_id,''),coalesce(c.telegram_id,0),coalesce(c.chat_id,0),c.username,c.display_name,coalesce(u.email,'') FROM telegram_challenges c LEFT JOIN users u ON u.id=c.user_id WHERE `+column+`=?`, value).Scan(&c.ID, &c.Purpose, &c.Status, &c.ExpiresAt, &c.CreatedAt, &c.Browser, &c.Code, &c.UserID, &c.TelegramID, &c.ChatID, &c.Username, &c.DisplayName, &c.Email)
	if e == sql.ErrNoRows {
		return c, Fail(404, "Запрос не найден")
	}
	return c, e
}
func (s *Store) TelegramChallenge(id, secret string) (TelegramChallenge, error) {
	c, e := telegramChallenge(s.DB, "c.id", id)
	if e != nil {
		return c, e
	}
	var valid int
	e = s.DB.QueryRow("SELECT count(*) FROM telegram_challenges WHERE id=? AND browser_hash=?", id, tokenHash(secret)).Scan(&valid)
	if e != nil {
		return c, e
	}
	if valid != 1 {
		return TelegramChallenge{}, Fail(404, "Запрос не найден или заменён")
	}
	if c.ExpiresAt <= s.nowTime().UTC().Format(timestampLayout) && oneOf(c.Status, "pending", "approved") {
		c.Status = "expired"
	}
	if c.Purpose == "login" {
		c.Email = ""
	}
	return c, nil
}
func (s *Store) TelegramStart(token string, id, chat int64, username, name string) (TelegramChallenge, error) {
	var out TelegramChallenge
	e := s.transaction(func(tx *sql.Tx) error {
		c, e := telegramChallenge(tx, "c.token_hash", tokenHash(token))
		if e != nil {
			return e
		}
		if c.Status != "pending" || c.ExpiresAt <= s.nowTime().UTC().Format(timestampLayout) {
			return Fail(410, "Ссылка истекла или уже использована")
		}
		if c.TelegramID != 0 && c.TelegramID != id {
			return Fail(403, "Запрос открыт другим Telegram-аккаунтом")
		}
		if c.UserID != "" {
			var status string
			if e = tx.QueryRow("SELECT status FROM users WHERE id=?", c.UserID).Scan(&status); e != nil {
				return e
			}
			if status == "blocked" {
				return Fail(403, "Аккаунт заблокирован")
			}
		}
		if c.Purpose == "login" {
			e = tx.QueryRow("SELECT u.id FROM users u JOIN telegram_links l ON l.user_id=u.id WHERE l.telegram_id=? AND u.status='active'", id).Scan(&c.UserID)
			if e != nil && e != sql.ErrNoRows {
				return e
			}
		}
		var uid any
		if c.UserID != "" {
			uid = c.UserID
		}
		_, e = tx.Exec("UPDATE telegram_challenges SET telegram_id=?,chat_id=?,username=?,display_name=?,user_id=? WHERE id=?", id, chat, username, name, uid, c.ID)
		c.TelegramID = id
		c.ChatID = chat
		c.Username = username
		c.DisplayName = name
		out = c
		return e
	})
	return out, e
}
func (s *Store) TelegramDecide(id string, tg int64, approve bool) error {
	return s.transaction(func(tx *sql.Tx) error { return s.telegramDecideTx(tx, id, tg, approve) })
}
func (s *Store) telegramDecideTx(tx *sql.Tx, id string, tg int64, approve bool) error {
	return func() error {
		c, e := telegramChallenge(tx, "c.id", id)
		if e != nil {
			return e
		}
		if c.TelegramID != tg || c.Status != "pending" || c.ExpiresAt <= s.nowTime().UTC().Format(timestampLayout) {
			return Fail(409, "Запрос истёк или уже обработан")
		}
		status := "cancelled"
		if approve {
			status = "approved"
			if c.Purpose == "login" {
				if e = tx.QueryRow("SELECT u.id FROM users u JOIN telegram_links l ON l.user_id=u.id WHERE l.telegram_id=? AND u.status='active'", tg).Scan(&c.UserID); e != nil {
					return Fail(403, "Для входа нужен активный привязанный аккаунт")
				}
			} else {
				var state string
				if e = tx.QueryRow("SELECT status FROM users WHERE id=?", c.UserID).Scan(&state); e != nil {
					return e
				}
				if state == "blocked" {
					return Fail(403, "Аккаунт заблокирован")
				}
				var count int
				if e = tx.QueryRow("SELECT count(*) FROM telegram_links WHERE user_id=? OR telegram_id=?", c.UserID, tg).Scan(&count); e != nil {
					return e
				}
				if count != 0 {
					return Fail(409, "Аккаунт уже привязан")
				}
				if c.Purpose == "registration" {
					if state != "pending" {
						return Fail(409, "Регистрация уже обработана")
					}
					if _, e = tx.Exec("INSERT INTO telegram_links(user_id,telegram_id,chat_id,username,display_name) VALUES(?,?,?,?,?)", c.UserID, tg, c.ChatID, c.Username, c.DisplayName); e != nil {
						return e
					}
					if _, e = tx.Exec("UPDATE users SET status='active' WHERE id=?", c.UserID); e != nil {
						return e
					}
					status = "completed"
				}
			}
		}
		var uid any
		if c.UserID != "" {
			uid = c.UserID
		}
		_, e = tx.Exec("UPDATE telegram_challenges SET status=?,user_id=? WHERE id=?", status, uid, c.ID)
		if e != nil {
			return e
		}
		if status == "completed" && c.Purpose == "registration" {
			return s.telegramWelcomeTx(tx, c.UserID, c.TelegramID, c.ChatID, c.ID)
		}
		return nil
	}()
}
func (s *Store) CompleteTelegramLink(id, secret, user string) error {
	c, e := s.TelegramChallenge(id, secret)
	if e != nil {
		return e
	}
	if c.UserID != user || c.Purpose != "link" {
		return Fail(403, "Чужой запрос")
	}
	return s.transaction(func(tx *sql.Tx) error {
		var state string
		if e := tx.QueryRow("SELECT c.status FROM telegram_challenges c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.expires_at>? AND u.status='active'", id, s.nowTime().UTC().Format(timestampLayout)).Scan(&state); e != nil || state != "approved" {
			return Fail(409, "Подключение не подтверждено или истекло")
		}
		if _, e := tx.Exec("INSERT INTO telegram_links(user_id,telegram_id,chat_id,username,display_name) VALUES(?,?,?,?,?)", user, c.TelegramID, c.ChatID, c.Username, c.DisplayName); e != nil {
			if strings.Contains(e.Error(), "UNIQUE") {
				return Fail(409, "Аккаунт уже привязан")
			}
			return e
		}
		_, e := tx.Exec("UPDATE telegram_challenges SET status='completed' WHERE id=?", id)
		if e != nil {
			return e
		}
		return s.telegramWelcomeTx(tx, user, c.TelegramID, c.ChatID, id)
	})
}
func (s *Store) CompleteTelegramLogin(id, secret string) (User, Session, string, error) {
	c, e := s.TelegramChallenge(id, secret)
	var u User
	var ss Session
	token := ID() + ID()
	if e != nil {
		return u, ss, "", e
	}
	if c.Purpose != "login" || c.Status != "approved" {
		return u, ss, "", Fail(409, "Вход не подтверждён или истёк")
	}
	e = s.transaction(func(tx *sql.Tx) error {
		if e := tx.QueryRow("SELECT u.id,u.email,u.status,u.timezone,u.created_at FROM users u JOIN telegram_links l ON l.user_id=u.id JOIN telegram_challenges c ON c.user_id=u.id WHERE c.id=? AND c.status='approved' AND c.expires_at>? AND c.browser_hash=? AND l.telegram_id=c.telegram_id AND u.status='active'", id, s.nowTime().UTC().Format(timestampLayout), tokenHash(secret)).Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt); e != nil {
			return Fail(403, "Вход больше недоступен")
		}
		ss = Session{ID: ID(), UserID: u.ID, Kind: "web", Name: c.Browser, CreatedAt: s.nowTime().UTC().Format(timestampLayout), ExpiresAt: s.nowTime().Add(30 * 24 * time.Hour).UTC().Format(timestampLayout)}
		if _, e := tx.Exec("INSERT INTO sessions(id,user_id,token_hash,kind,name,created_at,expires_at) VALUES(?,?,?,?,?,?,?)", ss.ID, u.ID, tokenHash(token), ss.Kind, ss.Name, ss.CreatedAt, ss.ExpiresAt); e != nil {
			return e
		}
		_, e := tx.Exec("UPDATE telegram_challenges SET status='completed' WHERE id=?", id)
		return e
	})
	return u, ss, token, e
}
func (s *Store) TelegramPreferences(user string, morning, evening bool) error {
	res, e := s.DB.Exec("UPDATE telegram_links SET morning=?,evening=?,delivery_enabled=1 WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')", morning, evening, user, user)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return Fail(404, "Telegram не подключён")
	}
	return nil
}
func (s *Store) DisconnectTelegram(user string) error {
	return s.transaction(func(tx *sql.Tx) error {
		if _, e := tx.Exec("DELETE FROM telegram_drafts WHERE telegram_id=(SELECT telegram_id FROM telegram_links WHERE user_id=?)", user); e != nil {
			return e
		}
		if _, e := tx.Exec("UPDATE telegram_challenges SET status='cancelled' WHERE user_id=? AND status IN ('pending','approved')", user); e != nil {
			return e
		}
		if _, e := tx.Exec("UPDATE telegram_outbox SET status='cancelled' WHERE user_id=? AND status='pending'", user); e != nil {
			return e
		}
		_, e := tx.Exec("DELETE FROM telegram_links WHERE user_id=?", user)
		return e
	})
}
func (s *Store) EnqueueTelegramUpdate(id int64, payload []byte) error {
	_, e := s.DB.Exec("INSERT OR IGNORE INTO telegram_inbox(update_id,payload,created_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM telegram_receipts WHERE update_id=?)", id, string(payload), s.nowTime().UTC().Format(timestampLayout), id)
	return e
}
func (s *Store) TelegramDraft(tg int64, v any) error {
	var raw string
	e := s.DB.QueryRow("SELECT payload FROM telegram_drafts WHERE telegram_id=? AND expires_at>?", tg, s.nowTime().UTC().Format(timestampLayout)).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	return json.Unmarshal([]byte(raw), v)
}
func (s *Store) SaveTelegramDraft(tg int64, v any) error {
	raw, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec("INSERT INTO telegram_drafts VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", tg, string(raw), s.nowTime().Add(24*time.Hour).UTC().Format(timestampLayout))
	return e
}

func (s *Store) TelegramUserForDelivery(user string, chat int64) (bool, error) {
	var count int
	e := s.DB.QueryRow("SELECT count(*) FROM telegram_links l JOIN users u ON u.id=l.user_id WHERE u.id=? AND u.status='active' AND l.chat_id=? AND l.delivery_enabled=1", user, chat).Scan(&count)
	return count == 1, e
}
func (s *Store) ReconcileTelegramDigests(at time.Time, origin string) error {
	type target struct {
		user, tz         string
		chat             int64
		morning, evening bool
	}
	rows, e := s.DB.Query("SELECT u.id,u.timezone,l.chat_id,l.morning,l.evening FROM users u JOIN telegram_links l ON l.user_id=u.id WHERE u.status='active' AND l.delivery_enabled=1 AND (l.morning=1 OR l.evening=1)")
	if e != nil {
		return e
	}
	targets := []target{}
	for rows.Next() {
		var t target
		if e = rows.Scan(&t.user, &t.tz, &t.chat, &t.morning, &t.evening); e != nil {
			rows.Close()
			return e
		}
		targets = append(targets, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, t := range targets {
		loc, e := time.LoadLocation(t.tz)
		if e != nil {
			return e
		}
		local := at.In(loc)
		if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
			continue
		}
		kind := ""
		if local.Hour() == 9 && t.morning {
			kind = "morning"
		}
		if local.Hour() == 18 && t.evening {
			kind = "evening"
		}
		if kind == "" || local.Minute() >= 15 {
			continue
		}
		var already int
		if e = s.DB.QueryRow("SELECT count(*) FROM telegram_outbox WHERE dedupe=?", "digest:"+t.user+":"+local.Format("2006-01-02")+":"+kind).Scan(&already); e != nil {
			return e
		}
		if already > 0 {
			continue
		}
		summary, e := s.DailySummaryAt(t.user, at)
		if e != nil {
			return e
		}
		title := "Утренняя сводка"
		if kind == "evening" {
			title = "Вечерняя сводка"
		}
		text := fmt.Sprintf("%s · %s\nДневная цель: %d/%d\nДобавлено: %d · Отклики: %d\nЗавершено задач: %d · Интервью: %d\nНа сегодня: %d задач, %d интервью", title, summary.Today, summary.Total, summary.Goal, summary.Added, summary.Applied, summary.CompletedTasks, summary.CompletedInterviews, summary.PlannedTasks, summary.PlannedInterviews)
		payload := tgJSON(map[string]any{"chat_id": t.chat, "text": text, "reply_markup": map[string]any{"inline_keyboard": [][]TelegramButton{{{Text: "Открыть сайт", URL: origin}}}}})
		expires := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), 15, 0, 0, loc).UTC().Format(timestampLayout)
		_, e = s.DB.Exec("INSERT OR IGNORE INTO telegram_outbox(id,user_id,chat_id,payload,next_attempt_at,expires_at,dedupe) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM telegram_links l JOIN users u ON u.id=l.user_id WHERE l.user_id=? AND l.chat_id=? AND l.delivery_enabled=1 AND u.status='active' AND "+kind+"=1)", ID(), t.user, t.chat, payload, at.UTC().Format(timestampLayout), expires, "digest:"+t.user+":"+summary.Today+":"+kind, t.user, t.chat)
		if e != nil {
			return e
		}
	}
	return nil
}

const telegramDeliveryPredicate = `
 (o.user_id IS NULL OR EXISTS(SELECT 1 FROM users u JOIN telegram_links l ON l.user_id=u.id WHERE u.id=o.user_id AND u.status='active' AND l.chat_id=o.chat_id)) AND
 (o.dedupe NOT LIKE 'digest:%' OR EXISTS(SELECT 1 FROM telegram_links l WHERE l.user_id=o.user_id AND l.delivery_enabled=1 AND ((o.dedupe LIKE '%:morning' AND l.morning=1) OR (o.dedupe LIKE '%:evening' AND l.evening=1)))) AND
 (o.challenge_id='' OR EXISTS(SELECT 1 FROM telegram_challenges c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=o.challenge_id AND c.chat_id=o.chat_id AND c.expires_at>? AND c.status IN ('pending','approved','completed') AND (u.id IS NULL OR u.status!='blocked')))`

func (s *Store) TelegramDeliveryAllowed(id string) (bool, error) {
	var count int
	stamp := s.nowTime().UTC().Format(timestampLayout)
	e := s.DB.QueryRow(`SELECT count(*) FROM telegram_outbox o WHERE o.id=? AND o.status='pending' AND o.expires_at>? AND `+telegramDeliveryPredicate, id, stamp, stamp).Scan(&count)
	return count == 1, e
}

func (s *Store) telegramWelcomeTx(tx *sql.Tx, user string, tg, chat int64, challenge string) error {
	d := telegramDraft{Step: "settings", Nonce: ID()[:12]}
	stamp := s.nowTime().UTC().Format(timestampLayout)
	expires := s.nowTime().Add(24 * time.Hour).UTC().Format(timestampLayout)
	if _, e := tx.Exec("INSERT INTO telegram_drafts VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", tg, tgJSON(d), expires); e != nil {
		return e
	}
	payload := tgJSON(map[string]any{"chat_id": chat, "text": "Telegram подключён. Включить сводки по будням? Обе сейчас выключены. Время — по часовому поясу аккаунта. Настройки всегда доступны через /settings.", "reply_markup": map[string]any{"inline_keyboard": [][]TelegramButton{{tgButton("Утренняя · 09:00", d.Nonce+":morning")}, {tgButton("Вечерняя · 18:00", d.Nonce+":evening")}}}})
	_, e := tx.Exec("INSERT INTO telegram_outbox(id,user_id,chat_id,payload,next_attempt_at,expires_at,dedupe) VALUES(?,?,?,?,?,?,?)", ID(), user, chat, payload, stamp, expires, "welcome:"+challenge)
	return e
}
func (s *Store) ExpireTelegramDrafts() error {
	_, e := s.DB.Exec("DELETE FROM telegram_drafts WHERE expires_at<=?", s.nowTime().UTC().Format(timestampLayout))
	return e
}
