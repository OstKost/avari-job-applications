package core

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
)

// PushSubscriptionRecord represents a stored push subscription in SQLite.
type PushSubscriptionRecord struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId"`
	Endpoint  string `json:"endpoint"`
	P256dh    string `json:"p256dh"`
	Auth      string `json:"auth"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// PushOutboxRecord represents a scheduled or in-flight notification in SQLite.
type PushOutboxRecord struct {
	ID             string `json:"id"`
	SubscriptionID string `json:"subscriptionId"`
	UserID         string `json:"userId"`
	LocalDate      string `json:"localDate"`
	DigestType     string `json:"digestType"` // "morning", "evening", or "test"
	Title          string `json:"title"`
	Body           string `json:"body"`
	URL            string `json:"url"`
	Tag            string `json:"tag"`
	Status         string `json:"status"` // "pending", "delivered", "expired", "failed"
	Attempts       int    `json:"attempts"`
	NextAttemptAt  string `json:"nextAttemptAt"`
	ExpiresAt      string `json:"expiresAt"`
	LeaseToken     string `json:"leaseToken"`
	LeasedUntil    string `json:"leasedUntil"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

// SubscribePush registers or rebinds a Web Push subscription to the current user and session.
// Validates endpoint, auth, and p256dh key formats, enforcing safe HTTPS and key constraints.
// When an endpoint is rebound or re-registered:
// - If owner, session, or keys change: deletes old outbox jobs (including delivered uniqueness keys) to prevent cross-account leaks or blocked digests
// - Resets subscription identity
func (s *Store) SubscribePush(user, sessionID string, sub webpush.Subscription) error {
	if err := sub.Validate(); err != nil {
		return Fail(400, fmt.Sprintf("Некорректная подписка push: %v", err))
	}

	endpoint := strings.TrimSpace(sub.Endpoint)
	auth := strings.TrimSpace(sub.Keys.Auth)
	p256dh := strings.TrimSpace(sub.Keys.P256dh)
	nowStamp := s.nowTime().Format(timestampLayout)

	return s.transaction(func(tx *sql.Tx) error {
		// Verify that the user and session exist and are active
		var sessCount int
		err := tx.QueryRow("SELECT count(*) FROM sessions WHERE id=? AND user_id=? AND expires_at>?", sessionID, user, nowStamp).Scan(&sessCount)
		if err != nil {
			return err
		}
		if sessCount == 0 {
			return Fail(401, "Сессия не найдена или истекла")
		}

		// Rebind check: If endpoint already exists for any user/session, clear old outbox and assign fresh ID
		var existingID, oldUser, oldSession, oldP256, oldAuth string
		err = tx.QueryRow("SELECT id, user_id, session_id, p256dh, auth FROM push_subscriptions WHERE endpoint=?", endpoint).
			Scan(&existingID, &oldUser, &oldSession, &oldP256, &oldAuth)

		if err == nil {
			// Endpoint exists. If user, session, or keys changed, clean up old outbox and assign fresh identity
			if oldUser != user || oldSession != sessionID || oldP256 != p256dh || oldAuth != auth {
				if _, err = tx.Exec("DELETE FROM push_outbox WHERE subscription_id=?", existingID); err != nil {
					return err
				}
				newSubID := ID()
				if _, err = tx.Exec(`UPDATE push_subscriptions
					SET id=?, user_id=?, session_id=?, p256dh=?, auth=?, updated_at=?
					WHERE id=?`,
					newSubID, user, sessionID, p256dh, auth, nowStamp, existingID); err != nil {
					return err
				}
				return nil
			}
			// Same user, session, and keys: just touch updated_at
			_, err = tx.Exec(`UPDATE push_subscriptions SET updated_at=? WHERE id=?`, nowStamp, existingID)
			return err
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		// Insert new push subscription record
		subID := ID()
		_, err = tx.Exec(`INSERT INTO push_subscriptions(id, user_id, session_id, endpoint, p256dh, auth, created_at, updated_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			subID, user, sessionID, endpoint, p256dh, auth, nowStamp, nowStamp)
		return err
	})
}

// UnsubscribePush removes the push subscription corresponding to the given endpoint for the user.
// When sessionID is provided, scopes removal to current session as well.
func (s *Store) UnsubscribePush(user, sessionID, endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return Fail(400, "Укажите endpoint подписки")
	}

	query := "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?"
	args := []any{user, endpoint}
	if sessionID != "" {
		query += " AND session_id=?"
		args = append(args, sessionID)
	}

	_, err := s.DB.Exec(query, args...)
	return err
}

// PushSubscriptions returns all active push subscriptions for a user.
func (s *Store) PushSubscriptions(user string) ([]PushSubscriptionRecord, error) {
	rows, err := s.DB.Query(`SELECT id, user_id, session_id, endpoint, p256dh, auth, created_at, updated_at
		FROM push_subscriptions WHERE user_id=? ORDER BY created_at DESC`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []PushSubscriptionRecord
	for rows.Next() {
		var r PushSubscriptionRecord
		if err := rows.Scan(&r.ID, &r.UserID, &r.SessionID, &r.Endpoint, &r.P256dh, &r.Auth, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, rows.Err()
}

// IsSessionPushSubscribed returns true if there is an active push subscription
// for the given user and session. Returns false if user or session is empty, or no row exists.
func (s *Store) IsSessionPushSubscribed(user, sessionID string) bool {
	if user == "" || sessionID == "" {
		return false
	}
	nowStamp := s.nowTime().Format(timestampLayout)
	var count int
	err := s.DB.QueryRow(`
		SELECT count(*)
		FROM push_subscriptions ps
		JOIN sessions s ON s.id = ps.session_id AND s.user_id = ps.user_id
		JOIN users u ON u.id = ps.user_id
		WHERE ps.user_id = ? AND ps.session_id = ? AND s.expires_at > ? AND u.status = 'active'
	`, user, sessionID, nowStamp).Scan(&count)
	return err == nil && count > 0
}

// EnqueueTestPush queues an immediate test push notification for the user on all or a specific subscription.
// Scoped to current session when endpoint is provided.
func (s *Store) EnqueueTestPush(user, sessionID, endpoint string) error {
	now := s.nowTime()
	nowStamp := now.Format(timestampLayout)
	expiresStamp := now.Add(15 * time.Minute).Format(timestampLayout)

	return s.transaction(func(tx *sql.Tx) error {
		query := `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
			FROM push_subscriptions ps
			JOIN sessions s ON s.id = ps.session_id AND s.user_id = ps.user_id
			WHERE ps.user_id=? AND s.expires_at > ?`
		args := []any{user, nowStamp}

		if endpoint != "" {
			query += ` AND ps.endpoint=?`
			args = append(args, endpoint)
			if sessionID != "" {
				query += ` AND ps.session_id=?`
				args = append(args, sessionID)
			}
		} else if sessionID != "" {
			query += ` AND ps.session_id=?`
			args = append(args, sessionID)
		}

		rows, err := tx.Query(query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		type subItem struct {
			id string
		}
		var subs []subItem
		for rows.Next() {
			var si subItem
			var ep, p256, a string
			if err := rows.Scan(&si.id, &ep, &p256, &a); err != nil {
				return err
			}
			subs = append(subs, si)
		}
		if len(subs) == 0 {
			return Fail(404, "Подписка на push-уведомления не найдена")
		}

		title := "Тестовое уведомление"
		body := "Avari.Jobs: push-уведомления успешно настроены."
		clickURL := "/"
		tag := fmt.Sprintf("test-%s-%d", user, now.UnixNano())
		localDate := now.Format("2006-01-02")
		digestType := fmt.Sprintf("test-%d", now.UnixNano())

		for _, sub := range subs {
			outboxID := ID()
			_, err = tx.Exec(`INSERT INTO push_outbox(
				id, subscription_id, user_id, local_date, digest_type,
				title, body, url, tag, status, attempts, next_attempt_at,
				expires_at, lease_token, leased_until, created_at, updated_at
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, '', '', ?, ?)`,
				outboxID, sub.id, user, localDate, digestType,
				title, body, clickURL, tag, nowStamp, expiresStamp, nowStamp, nowStamp)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
