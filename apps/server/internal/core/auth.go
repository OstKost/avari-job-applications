package core

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"golang.org/x/crypto/argon2"
	"net/mail"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

func HashPassword(password string) (string, error) {
	if utf8.RuneCountInString(password) < 10 || utf8.RuneCountInString(password) > 256 {
		return "", Fail(400, "Пароль должен содержать от 10 до 256 символов")
	}
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return "", e
	}
	key := argon2.IDKey([]byte(password), salt, 2, 64*1024, 2, 32)
	return base64.RawStdEncoding.EncodeToString(salt) + "." + base64.RawStdEncoding.EncodeToString(key), nil
}
func checkPassword(password, encoded string) bool {
	parts := strings.Split(encoded, ".")
	if len(parts) != 2 {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(parts[0])
	if e != nil {
		return false
	}
	expected, e := base64.RawStdEncoding.DecodeString(parts[1])
	if e != nil || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 2, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func (s *Store) Register(email, password, tz string) (User, error) {
	return s.register(email, password, tz, false)
}
func (s *Store) RegisterOwner(email, password, tz string) (User, error) {
	return s.register(email, password, tz, true)
}
func (s *Store) register(email, password, tz string, personal bool) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	address, e := mail.ParseAddress(email)
	if e != nil || address.Address != email || len(email) > 254 {
		return User{}, Fail(400, "Укажите корректный email")
	}
	if _, e = time.LoadLocation(tz); e != nil {
		return User{}, Fail(400, "Неизвестный часовой пояс")
	}
	hash, e := HashPassword(password)
	if e != nil {
		return User{}, e
	}
	u := User{ID: ID(), Email: email, Status: "pending", Timezone: tz, CreatedAt: now()}
	if personal {
		u.Status = "active"
	}
	e = s.transaction(func(tx *sql.Tx) error {
		if personal {
			var count int
			if e := tx.QueryRow("SELECT count(*) FROM users").Scan(&count); e != nil {
				return e
			}
			if count != 0 {
				return Fail(409, "Владелец уже создан. Войдите в аккаунт")
			}
		}
		_, e := tx.Exec("INSERT INTO users(id,email,password,status,timezone,created_at) VALUES(?,?,?,?,?,?)", u.ID, u.Email, hash, u.Status, u.Timezone, u.CreatedAt)
		if e != nil {
			if strings.Contains(e.Error(), "UNIQUE") {
				return Fail(409, "Этот email уже зарегистрирован")
			}
			return e
		}
		fields := []Field{{ID: ID(), Name: "Приоритет", Type: "select", Role: "priority", Options: []string{"Высокий", "Средний", "Низкий"}}, {ID: ID(), Name: "Интерес к роли", Type: "select", Options: []string{"Высокий", "Средний", "Низкий"}}, {ID: ID(), Name: "Масштаб ответственности", Type: "text", Options: []string{}}, {ID: ID(), Name: "Соответствие опыту", Type: "select", Options: []string{"Полное", "Частичное", "Новый вызов"}}, {ID: ID(), Name: "Риски", Type: "text", Options: []string{}}}
		for _, f := range fields {
			if e = put(tx, u.ID, "field", f.ID, f); e != nil {
				return e
			}
		}
		return nil
	})
	return u, e
}
func (s *Store) Login(email, password, kind, name string) (User, Session, string, error) {
	var u User
	var hash string
	e := s.DB.QueryRow("SELECT id,email,password,status,timezone,created_at FROM users WHERE email=? COLLATE NOCASE", strings.ToLower(strings.TrimSpace(email))).Scan(&u.ID, &u.Email, &hash, &u.Status, &u.Timezone, &u.CreatedAt)
	if e != nil && e != sql.ErrNoRows {
		return u, Session{}, "", e
	}
	if e == sql.ErrNoRows {
		_, _ = HashPassword("dummy-authentication-password")
		return u, Session{}, "", Fail(401, "Неверный email или пароль")
	}
	if utf8.RuneCountInString(password) > 256 || !checkPassword(password, hash) {
		return u, Session{}, "", Fail(401, "Неверный email или пароль")
	}
	if !oneOf(kind, "web", "extension") {
		return u, Session{}, "", Fail(400, "Некорректный тип сессии")
	}
	if len(name) > 200 {
		return u, Session{}, "", Fail(400, "Слишком длинное название устройства")
	}
	if name == "" {
		name = kind
	}
	session := Session{ID: ID(), UserID: u.ID, Kind: kind, Name: name, CreatedAt: now(), ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour).Format(timestampLayout)}
	token := ID() + ID()
	e = s.transaction(func(tx *sql.Tx) error {
		var currentHash string
		if e := tx.QueryRow("SELECT password,status FROM users WHERE id=?", u.ID).Scan(&currentHash, &u.Status); e != nil {
			return e
		}
		if currentHash != hash {
			return Fail(401, "Пароль изменён. Войдите с новым паролем")
		}
		_, e := tx.Exec("INSERT INTO sessions(id,user_id,token_hash,kind,name,created_at,expires_at) VALUES(?,?,?,?,?,?,?)", session.ID, u.ID, tokenHash(token), kind, name, session.CreatedAt, session.ExpiresAt)
		return e
	})
	return u, session, token, e
}
func (s *Store) Authenticate(token string) (User, Session, error) {
	var ss Session
	var u User
	e := s.DB.QueryRow(`SELECT s.id,s.user_id,s.kind,s.name,s.created_at,s.expires_at,u.id,u.email,u.status,u.timezone,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, tokenHash(token), now()).Scan(&ss.ID, &ss.UserID, &ss.Kind, &ss.Name, &ss.CreatedAt, &ss.ExpiresAt, &u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt)
	if e == sql.ErrNoRows {
		return u, ss, Fail(401, "Войдите в аккаунт")
	}
	return u, ss, e
}
func (s *Store) Logout(user, id string) error {
	_, e := s.DB.Exec("DELETE FROM sessions WHERE user_id=? AND id=?", user, id)
	return e
}
func (s *Store) ExtensionDownloadToken(user string) (string, error) {
	var token string
	e := s.transaction(func(tx *sql.Tx) error {
		candidate := ID() + ID()
		_, e := tx.Exec("INSERT INTO extension_download_tokens(user_id,token) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token", user, candidate)
		if e != nil {
			return e
		}
		return tx.QueryRow("SELECT token FROM extension_download_tokens WHERE user_id=?", user).Scan(&token)
	})
	return token, e
}
func (s *Store) VerifyExtensionDownloadToken(token string) (User, error) {
	if raw, e := hex.DecodeString(token); e != nil || len(raw) != 32 {
		return User{}, Fail(404, "Архив не найден")
	}
	var u User
	e := s.DB.QueryRow(`SELECT u.id,u.email,u.status,u.timezone,u.created_at FROM extension_download_tokens t JOIN users u ON u.id=t.user_id WHERE t.token=? AND u.status='active'`, token).Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt)
	if e == sql.ErrNoRows {
		return u, Fail(404, "Архив не найден")
	}
	return u, e
}
func (s *Store) Sessions(user string) ([]Session, error) {
	rows, e := s.DB.Query("SELECT id,kind,name,created_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC", user, now())
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var ss Session
		if e = rows.Scan(&ss.ID, &ss.Kind, &ss.Name, &ss.CreatedAt, &ss.ExpiresAt); e != nil {
			return nil, e
		}
		out = append(out, ss)
	}
	return out, rows.Err()
}
func (s *Store) SetTimezone(user, tz string) error {
	if _, e := time.LoadLocation(tz); e != nil {
		return Fail(400, "Неизвестный часовой пояс")
	}
	_, e := s.DB.Exec("UPDATE users SET timezone=? WHERE id=?", tz, user)
	return e
}
func (s *Store) Users() ([]User, error) {
	rows, e := s.DB.Query("SELECT id,email,status,timezone,created_at FROM users ORDER BY created_at DESC")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if e = rows.Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt); e != nil {
			return nil, e
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func audit(q queryer, action, user, detail string) error {
	_, e := q.ExecContext(context.Background(), "INSERT INTO audit(id,action,user_id,detail,created_at) VALUES(?,?,?,?,?)", ID(), action, user, detail, now())
	return e
}
func (s *Store) Admin(action, user, password string) error {
	return s.transaction(func(tx *sql.Tx) error {
		var state string
		if e := tx.QueryRow("SELECT status FROM users WHERE id=?", user).Scan(&state); e == sql.ErrNoRows {
			return Fail(404, "Пользователь не найден")
		} else if e != nil {
			return e
		}
		switch action {
		case "approve":
			if state != "pending" {
				return Fail(400, "Одобрить можно только ожидающую заявку")
			}
			_, e := tx.Exec("UPDATE users SET status='active' WHERE id=?", user)
			if e != nil {
				return e
			}
		case "block":
			_, e := tx.Exec("UPDATE users SET status='blocked' WHERE id=?", user)
			if e != nil {
				return e
			}
		case "unblock":
			if state != "blocked" {
				return Fail(400, "Пользователь не заблокирован")
			}
			_, e := tx.Exec("UPDATE users SET status='active' WHERE id=?", user)
			if e != nil {
				return e
			}
		case "reset_password":
			hash, e := HashPassword(password)
			if e != nil {
				return e
			}
			if _, e = tx.Exec("UPDATE users SET password=? WHERE id=?", hash, user); e != nil {
				return e
			}
		case "revoke_sessions":
		default:
			return Fail(400, fmt.Sprintf("Неизвестная операция %s", action))
		}
		if oneOf(action, "block", "reset_password", "revoke_sessions") {
			if _, e := tx.Exec("DELETE FROM sessions WHERE user_id=?", user); e != nil {
				return e
			}
		}
		if oneOf(action, "block", "reset_password") {
			if _, e := tx.Exec("DELETE FROM calendar_subscriptions WHERE user_id=?", user); e != nil {
				return e
			}
			if _, e := tx.Exec("DELETE FROM extension_download_tokens WHERE user_id=?", user); e != nil {
				return e
			}
		}
		return audit(tx, action, user, "")
	})
}
func (s *Store) Audits() ([]Audit, error) {
	rows, e := s.DB.Query("SELECT id,action,user_id,detail,created_at FROM audit ORDER BY created_at DESC LIMIT 1000")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Audit{}
	for rows.Next() {
		var a Audit
		if e = rows.Scan(&a.ID, &a.Action, &a.UserID, &a.Detail, &a.CreatedAt); e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) ChangePassword(userID, currentPassword, newPassword, currentSessionID string) error {
	newHash, e := HashPassword(newPassword)
	if e != nil {
		return e
	}
	return s.transaction(func(tx *sql.Tx) error {
		var currentHash string
		if e := tx.QueryRow("SELECT password FROM users WHERE id=?", userID).Scan(&currentHash); e != nil {
			if e == sql.ErrNoRows {
				return Fail(404, "Пользователь не найден")
			}
			return e
		}
		if utf8.RuneCountInString(currentPassword) > 256 || !checkPassword(currentPassword, currentHash) {
			return Fail(400, "Текущий пароль указан неверно")
		}
		if _, e := tx.Exec("UPDATE users SET password=? WHERE id=?", newHash, userID); e != nil {
			return e
		}
		// Revoke other sessions to protect account across other devices
		if currentSessionID != "" {
			if _, e := tx.Exec("DELETE FROM sessions WHERE user_id=? AND id!=?", userID, currentSessionID); e != nil {
				return e
			}
		}
		return audit(tx, "change_password", userID, "Пароль изменён пользователем")
	})
}

func (s *Store) RequestPasswordReset(email, newPassword string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	hash, e := HashPassword(newPassword)
	if e != nil {
		return e
	}
	var u User
	e = s.DB.QueryRow("SELECT id,email,status,timezone,created_at FROM users WHERE email=? COLLATE NOCASE", email).Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt)
	if e == sql.ErrNoRows {
		// Return success without revealing user existence to prevent account enumeration
		return nil
	} else if e != nil {
		return e
	}
	reqID := ID()
	createdAt := now()
	return s.transaction(func(tx *sql.Tx) error {
		// Remove any existing pending reset requests for this user
		if _, e := tx.Exec("DELETE FROM password_resets WHERE user_id=? AND status='pending'", u.ID); e != nil {
			return e
		}
		if _, e := tx.Exec("INSERT INTO password_resets(id,user_id,password_hash,status,created_at) VALUES(?,?,?,'pending',?)", reqID, u.ID, hash, createdAt); e != nil {
			return e
		}
		return audit(tx, "request_password_reset", u.ID, "Запрошено восстановление пароля")
	})
}

func (s *Store) PendingPasswordResets() ([]PasswordResetRequest, error) {
	rows, e := s.DB.Query(`SELECT pr.id, pr.user_id, u.email, pr.created_at
		FROM password_resets pr
		JOIN users u ON u.id = pr.user_id
		WHERE pr.status = 'pending'
		ORDER BY pr.created_at DESC`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []PasswordResetRequest{}
	for rows.Next() {
		var pr PasswordResetRequest
		if e := rows.Scan(&pr.ID, &pr.UserID, &pr.UserEmail, &pr.CreatedAt); e != nil {
			return nil, e
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

func (s *Store) ApprovePasswordReset(requestID string) error {
	return s.transaction(func(tx *sql.Tx) error {
		var userID, passwordHash string
		e := tx.QueryRow("SELECT user_id, password_hash FROM password_resets WHERE id=? AND status='pending'", requestID).Scan(&userID, &passwordHash)
		if e == sql.ErrNoRows {
			return Fail(404, "Запрос на смену пароля не найден или уже обработан")
		} else if e != nil {
			return e
		}
		if _, e := tx.Exec("UPDATE users SET password=? WHERE id=?", passwordHash, userID); e != nil {
			return e
		}
		if _, e := tx.Exec("UPDATE password_resets SET status='approved' WHERE id=?", requestID); e != nil {
			return e
		}
		if _, e := tx.Exec("DELETE FROM sessions WHERE user_id=?", userID); e != nil {
			return e
		}
		if _, e := tx.Exec("DELETE FROM calendar_subscriptions WHERE user_id=?", userID); e != nil {
			return e
		}
		if _, e := tx.Exec("DELETE FROM extension_download_tokens WHERE user_id=?", userID); e != nil {
			return e
		}
		return audit(tx, "approve_password_reset", userID, "Смена пароля одобрена администратором")
	})
}

func (s *Store) RejectPasswordReset(requestID string) error {
	return s.transaction(func(tx *sql.Tx) error {
		var userID string
		e := tx.QueryRow("SELECT user_id FROM password_resets WHERE id=? AND status='pending'", requestID).Scan(&userID)
		if e == sql.ErrNoRows {
			return Fail(404, "Запрос на смену пароля не найден или уже обработан")
		} else if e != nil {
			return e
		}
		if _, e := tx.Exec("UPDATE password_resets SET status='rejected' WHERE id=?", requestID); e != nil {
			return e
		}
		return audit(tx, "reject_password_reset", userID, "Запрос на смену пароля отклонён администратором")
	})
}
