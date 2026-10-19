package core

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
)

const (
	DigestMorning = "morning"
	DigestEvening = "evening"

	OutboxLeaseDuration = 2 * time.Minute
	OutboxWindow        = 15 * time.Minute
	MaxPushTTL          = 900 // Capped to 900 seconds (15-minute window)
)

// PushNotificationService coordinates digest generation and outbox delivery.
type PushNotificationService struct {
	Store     *Store
	Transport webpush.Transport
}

// NewPushNotificationService creates a service coordinating push scheduling and dispatch.
func NewPushNotificationService(store *Store, transport webpush.Transport) *PushNotificationService {
	return &PushNotificationService{
		Store:     store,
		Transport: transport,
	}
}

// FormatMorningDigest formats the 09:00 morning digest in concise Russian.
// Shows planned tasks and interviews separately, goal 10, concise aggregate-only without personal names or contacts.
func FormatMorningDigest(s DailySummary) (title, body string) {
	title = "План на день"
	body = fmt.Sprintf("На сегодня: задач — %d, интервью — %d. Цель на день: %d действий.",
		s.PlannedTasks, s.PlannedInterviews, s.Goal)
	return title, body
}

// FormatEveningDigest formats the 18:00 evening digest in concise Russian.
// Shows completion of today's scheduled tasks/meetings plus added/applied/completed today and N/10 goal, encouraging remaining count.
// Sends even when values are zeros, concise aggregate-only without personal names or contacts.
func FormatEveningDigest(s DailySummary) (title, body string) {
	title = "Итоги дня"
	remaining := s.Goal - s.Total
	if remaining < 0 {
		remaining = 0
	}

	var encourage string
	if s.Total >= s.Goal {
		encourage = "Отличная работа, цель достигнута!"
	} else if remaining == 1 {
		encourage = "Осталось всего 1 действие до цели!"
	} else if remaining <= 4 {
		encourage = fmt.Sprintf("Осталось всего %d действия до цели!", remaining)
	} else {
		encourage = fmt.Sprintf("Осталось %d действий до цели на сегодня.", remaining)
	}

	body = fmt.Sprintf("Выполнено по плану: задач %d/%d, интервью %d/%d. За сегодня: добавлено %d, откликов %d. Итог: %d/%d. %s",
		s.CompletedTodayTasks, s.PlannedTasks,
		s.CompletedTodayInterviews, s.PlannedInterviews,
		s.Added, s.Applied,
		s.Total, s.Goal,
		encourage,
	)
	return title, body
}

// ReconcileDigests schedules 09:00 and 18:00 digests for all active users on Monday-Friday.
// Evaluates user's local date and time in their account timezone.
// Does NOT send old catchup: if the current minute in user's timezone is not the target window, nothing is queued.
func (svc *PushNotificationService) ReconcileDigests(ctx context.Context, now time.Time) error {
	if svc == nil || svc.Store == nil {
		return nil
	}

	// If push transport is disabled or unconfigured, do nothing
	if svc.Transport == nil || svc.Transport.Config() == nil || !svc.Transport.Config().Enabled() {
		return nil
	}

	users, err := svc.Store.Users()
	if err != nil {
		return fmt.Errorf("list users for push digests: %w", err)
	}

	for _, u := range users {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// Active users only
		if u.Status != "active" {
			continue
		}

		loc, err := time.LoadLocation(u.Timezone)
		if err != nil {
			loc = time.UTC
		}

		userTime := now.In(loc)
		weekday := userTime.Weekday()
		// Mon-Fri only
		if weekday == time.Sunday || weekday == time.Saturday {
			continue
		}

		hour := userTime.Hour()
		minute := userTime.Minute()

		var digestType string
		// Mon-Fri 09:00 morning digest
		if hour == 9 && minute == 0 {
			digestType = DigestMorning
		} else if hour == 18 && minute == 0 { // Mon-Fri 18:00 evening digest
			digestType = DigestEvening
		} else {
			continue
		}

		if err := svc.scheduleUserDigest(ctx, u.ID, userTime, digestType); err != nil {
			slog.Error("failed scheduling user push digest", "user", u.ID, "digest", digestType, "error", err)
		}
	}

	return nil
}

func (svc *PushNotificationService) scheduleUserDigest(ctx context.Context, userID string, userTime time.Time, digestType string) error {
	localDate := userTime.Format("2006-01-02")
	summary, err := svc.Store.DailySummaryAt(userID, userTime)
	if err != nil {
		return fmt.Errorf("compute summary: %w", err)
	}

	var title, body string
	if digestType == DigestMorning {
		title, body = FormatMorningDigest(summary)
	} else {
		title, body = FormatEveningDigest(summary)
	}

	// Deterministic tag per user, date, and digest type
	tag := fmt.Sprintf("digest-%s-%s-%s", userID, localDate, digestType)
	clickURL := "/" // Click URL opens root day plan

	nowStamp := userTime.UTC().Format(timestampLayout)
	// Notifications expire after a 15-minute window
	expiresStamp := userTime.UTC().Add(OutboxWindow).Format(timestampLayout)

	return svc.Store.transaction(func(tx *sql.Tx) error {
		// Load active push subscriptions for user that have a valid, unexpired session
		rows, err := tx.QueryContext(ctx, `
			SELECT ps.id
			FROM push_subscriptions ps
			JOIN sessions s ON s.id = ps.session_id AND s.user_id = ps.user_id
			WHERE ps.user_id = ? AND s.expires_at > ?
		`, userID, nowStamp)
		if err != nil {
			return err
		}
		defer rows.Close()

		var subIDs []string
		for rows.Next() {
			var sid string
			if err := rows.Scan(&sid); err != nil {
				return err
			}
			subIDs = append(subIDs, sid)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		for _, subID := range subIDs {
			outboxID := ID()
			// UNIQUE(subscription_id, local_date, digest_type) ensures at-most-once enqueue per subscription
			_, err = tx.ExecContext(ctx, `
				INSERT INTO push_outbox(
					id, subscription_id, user_id, local_date, digest_type,
					title, body, url, tag, status, attempts, next_attempt_at,
					expires_at, lease_token, leased_until, created_at, updated_at
				) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, '', '', ?, ?)
				ON CONFLICT(subscription_id, local_date, digest_type) DO NOTHING
			`, outboxID, subID, userID, localDate, digestType,
				title, body, clickURL, tag, nowStamp, expiresStamp, nowStamp, nowStamp)
			if err != nil {
				return err
			}
		}

		return nil
	})
}

// ProcessOutbox claims and sends pending outbox notifications one at a time atomically.
// Updates actual clock before each send, validates current subscription+session immediately before send,
// scopes every state update WHERE id AND lease_token owner, calculates dynamic remaining TTL capped to 900s,
// retries only network/429/5xx (marking other 4xx failed), and checks DB state update errors.
func (svc *PushNotificationService) ProcessOutbox(ctx context.Context, _ time.Time) error {
	if svc == nil || svc.Store == nil || svc.Transport == nil {
		return nil
	}
	if svc.Transport.Config() == nil || !svc.Transport.Config().Enabled() {
		return nil
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		currentTime := svc.Store.nowTime()
		nowStamp := currentTime.Format(timestampLayout)

		// Clean up expired items
		if _, err := svc.Store.DB.ExecContext(ctx, `
			UPDATE push_outbox
			SET status='expired', updated_at=?
			WHERE status='pending' AND expires_at <= ?
		`, nowStamp, nowStamp); err != nil {
			return fmt.Errorf("expire push outbox: %w", err)
		}

		// Find the next candidate job
		var candidateID string
		err := svc.Store.DB.QueryRowContext(ctx, `
			SELECT id
			FROM push_outbox
			WHERE status='pending'
			  AND next_attempt_at <= ?
			  AND expires_at > ?
			  AND (leased_until = '' OR leased_until <= ?)
			ORDER BY next_attempt_at ASC
			LIMIT 1
		`, nowStamp, nowStamp, nowStamp).Scan(&candidateID)

		if errors.Is(err, sql.ErrNoRows) {
			// No more jobs to process
			return nil
		} else if err != nil {
			return fmt.Errorf("query candidate outbox job: %w", err)
		}

		// Atomically claim candidate with fresh lease
		leaseToken := ID()
		leasedUntil := currentTime.Add(OutboxLeaseDuration).Format(timestampLayout)
		claimRes, err := svc.Store.DB.ExecContext(ctx, `
			UPDATE push_outbox
			SET lease_token=?, leased_until=?, updated_at=?
			WHERE id=?
			  AND status='pending'
			  AND next_attempt_at <= ?
			  AND expires_at > ?
			  AND (leased_until = '' OR leased_until <= ?)
		`, leaseToken, leasedUntil, nowStamp, candidateID, nowStamp, nowStamp, nowStamp)
		if err != nil {
			return fmt.Errorf("claim outbox job: %w", err)
		}
		rowsAffected, _ := claimRes.RowsAffected()
		if rowsAffected == 0 {
			// Lost race, loop to try next
			continue
		}

		// Verify job still within lease and check fresh expiry immediately before send
		var (
			subscriptionID string
			userID         string
			title          string
			body           string
			url            string
			tag            string
			attempts       int
			expiresAtStr   string
			endpoint       sql.NullString
			p256dh         sql.NullString
			auth           sql.NullString
			sessionID      sql.NullString
			userStatus     sql.NullString
		)

		err = svc.Store.DB.QueryRowContext(ctx, `
			SELECT o.subscription_id, o.user_id, o.title, o.body, o.url, o.tag, o.attempts, o.expires_at,
			       ps.endpoint, ps.p256dh, ps.auth, s.id, u.status
			FROM push_outbox o
			LEFT JOIN push_subscriptions ps ON ps.id = o.subscription_id
			LEFT JOIN sessions s ON s.id = ps.session_id AND s.user_id = o.user_id AND s.expires_at > ?
			LEFT JOIN users u ON u.id = o.user_id
			WHERE o.id = ? AND o.lease_token = ?
		`, nowStamp, candidateID, leaseToken).Scan(
			&subscriptionID, &userID, &title, &body, &url, &tag, &attempts, &expiresAtStr,
			&endpoint, &p256dh, &auth, &sessionID, &userStatus,
		)

		if err != nil {
			// Job not found under this lease token (e.g. purged by rebind or expired)
			continue
		}

		sendClock := svc.Store.nowTime()
		sendClockStamp := sendClock.Format(timestampLayout)

		// Parse expiry time
		expiresAt, err := time.Parse(timestampLayout, expiresAtStr)
		if err != nil {
			expiresAt, _ = time.Parse(time.RFC3339Nano, expiresAtStr)
		}

		if !expiresAt.IsZero() && !sendClock.Before(expiresAt) {
			// Already expired right before send: mark expired
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='expired', lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, sendClockStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}

		// Check active user and valid session
		if !userStatus.Valid || userStatus.String != "active" || !sessionID.Valid || sessionID.String == "" {
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='expired', lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, sendClockStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}

		// Check subscription endpoint
		if !endpoint.Valid || endpoint.String == "" {
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='failed', lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, sendClockStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}

		// Dynamic TTL calculation: remaining seconds until expiresAt, capped at MaxPushTTL (900s)
		remainingSeconds := int(expiresAt.Sub(sendClock).Seconds())
		if remainingSeconds <= 0 {
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='expired', lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, sendClockStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}
		if remainingSeconds > MaxPushTTL {
			remainingSeconds = MaxPushTTL
		}

		sub := webpush.Subscription{
			Endpoint: endpoint.String,
			Keys: webpush.SubscriptionKeys{
				Auth:   auth.String,
				P256dh: p256dh.String,
			},
		}

		payload := webpush.Payload{
			Version: 1,
			Title:   title,
			Body:    body,
			URL:     url,
			Tag:     tag,
		}

		res, sendErr := svc.Transport.Send(ctx, sub, payload, remainingSeconds)
		afterSendStamp := svc.Store.nowTime().Format(timestampLayout)

		if sendErr == nil && res != nil && res.StatusCode >= 200 && res.StatusCode < 300 {
			// Delivered!
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='delivered', attempts=attempts+1, lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, afterSendStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}

		// Subscription expired / gone (404 or 410)
		if res != nil && (res.Expired || res.StatusCode == 404 || res.StatusCode == 410) {
			_, _ = svc.Store.DB.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE id=?`, subscriptionID)
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='failed', attempts=attempts+1, lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, afterSendStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}

		// Determine if failure is transient (network / 429 / 5xx) vs permanent 4xx (400, 401, 403, 413, etc.)
		isTransient := false
		if res == nil {
			// Network error (timeout, connection reset, etc.) is transient
			isTransient = true
		} else if res.StatusCode == 429 || res.StatusCode >= 500 {
			// Rate limiting or provider server error is transient
			isTransient = true
		}

		if !isTransient {
			// Non-retriable 4xx client error
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='failed', attempts=attempts+1, lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, afterSendStamp, candidateID, leaseToken); e != nil {
				return e
			}
			continue
		}

		// Transient error: retry respecting Retry-After
		newAttempts := attempts + 1
		retryDelay := 30 * time.Second
		if res != nil && res.RetryAfter != nil && *res.RetryAfter > 0 {
			retryDelay = *res.RetryAfter
		} else if newAttempts > 1 {
			retryDelay = time.Duration(1<<newAttempts) * 15 * time.Second
		}

		nextAttempt := svc.Store.nowTime().Add(retryDelay)
		nextAttemptStamp := nextAttempt.Format(timestampLayout)

		if !nextAttempt.Before(expiresAt) {
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET status='expired', attempts=attempts+1, lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, afterSendStamp, candidateID, leaseToken); e != nil {
				return e
			}
		} else {
			if _, e := svc.Store.DB.ExecContext(ctx, `
				UPDATE push_outbox
				SET attempts=attempts+1, next_attempt_at=?, lease_token='', leased_until='', updated_at=?
				WHERE id=? AND lease_token=?
			`, nextAttemptStamp, afterSendStamp, candidateID, leaseToken); e != nil {
				return e
			}
		}
	}
}
