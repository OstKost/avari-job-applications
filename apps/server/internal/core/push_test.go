package core

import (
	"context"
	"crypto/elliptic"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	sherwebpush "github.com/SherClockHolmes/webpush-go"
	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
)

type mockPushTransport struct {
	mu           sync.Mutex
	config       *webpush.Config
	sentMessages []mockSentItem
	sendHook     func(sub webpush.Subscription, payload webpush.Payload, ttlSeconds int) (*webpush.Result, error)
}

type mockSentItem struct {
	Sub     webpush.Subscription
	Payload webpush.Payload
	TTL     int
}

func newMockPushTransport(enabled bool) *mockPushTransport {
	var cfg *webpush.Config
	if enabled {
		// Valid dummy keys
		pub, priv := generateTestVAPIDKeys()
		c, _ := webpush.NewConfig(webpush.VAPIDConfig{
			PublicKey:  pub,
			PrivateKey: priv,
			Contact:    "mailto:dev@avari.test",
		})
		cfg = c
	} else {
		c, _ := webpush.NewConfig(webpush.VAPIDConfig{})
		cfg = c
	}
	return &mockPushTransport{config: cfg}
}

func (m *mockPushTransport) Config() *webpush.Config {
	return m.config
}

func (m *mockPushTransport) Send(ctx context.Context, sub webpush.Subscription, payload webpush.Payload, ttlSeconds int) (*webpush.Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.sentMessages = append(m.sentMessages, mockSentItem{
		Sub:     sub,
		Payload: payload,
		TTL:     ttlSeconds,
	})

	if m.sendHook != nil {
		return m.sendHook(sub, payload, ttlSeconds)
	}

	return &webpush.Result{
		StatusCode: 201,
	}, nil
}

func generateTestVAPIDKeys() (pub, priv string) {
	privKey, pubKey, err := sherwebpush.GenerateVAPIDKeys()
	if err == nil {
		return pubKey, privKey
	}
	panic(err)
}

func makeDummySubscription(endpoint string) webpush.Subscription {
	curve := elliptic.P256()
	_, x, y, _ := elliptic.GenerateKey(curve, strings.NewReader("seed-deterministic-entropy-test-32bytes!"))
	p256Bytes := elliptic.Marshal(curve, x, y)
	p256 := base64.RawURLEncoding.EncodeToString(p256Bytes)
	auth := base64.RawURLEncoding.EncodeToString([]byte("1234567890123456"))

	return webpush.Subscription{
		Endpoint: endpoint,
		Keys: webpush.SubscriptionKeys{
			Auth:   auth,
			P256dh: p256,
		},
	}
}

func TestPushSubscription_LifecycleAndRebind(t *testing.T) {
	s := testStore(t)
	u1 := testUser(t, s, "user1@example.com")
	u2 := testUser(t, s, "user2@example.com")

	_, sess1, _, err := s.Login(u1.Email, "secure-test-password", "web", "Device 1")
	if err != nil {
		t.Fatal(err)
	}
	_, sess2, _, err := s.Login(u2.Email, "secure-test-password", "web", "Device 2")
	if err != nil {
		t.Fatal(err)
	}

	sub := makeDummySubscription("https://updates.push.services.mozilla.com/wpush/v2/token123")

	// 1. Subscribe user 1
	if err := s.SubscribePush(u1.ID, sess1.ID, sub); err != nil {
		t.Fatalf("subscribe u1: %v", err)
	}

	subs1, err := s.PushSubscriptions(u1.ID)
	if err != nil || len(subs1) != 1 {
		t.Fatalf("expected 1 sub for u1, got %d", len(subs1))
	}
	sub1ID := subs1[0].ID

	// 2. Queue an outbox job for u1
	if err := s.EnqueueTestPush(u1.ID, sess1.ID, sub.Endpoint); err != nil {
		t.Fatalf("enqueue test push u1: %v", err)
	}

	var count int
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE subscription_id=?", sub1ID).Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 outbox record, got %d", count)
	}

	// 3. Rebind: User 2 on another device/browser logs into or registers the SAME endpoint
	if err := s.SubscribePush(u2.ID, sess2.ID, sub); err != nil {
		t.Fatalf("rebind to u2: %v", err)
	}

	// Verify old subscription no longer belongs to u1
	subs1After, _ := s.PushSubscriptions(u1.ID)
	if len(subs1After) != 0 {
		t.Fatalf("expected 0 subs for u1 after rebind, got %d", len(subs1After))
	}

	// Verify u2 owns subscription with a fresh ID
	subs2, _ := s.PushSubscriptions(u2.ID)
	if len(subs2) != 1 {
		t.Fatalf("expected 1 sub for u2, got %d", len(subs2))
	}
	if subs2[0].ID == sub1ID {
		t.Fatalf("subscription ID must be reset on rebind to avoid outbox leakage")
	}

	// Verify old outbox for sub1ID was completely deleted
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE subscription_id=?", sub1ID).Scan(&count)
	if count != 0 {
		t.Fatalf("old outbox items must be deleted on rebind, found %d", count)
	}

	// 4. Logout u2 should remove the push subscription tied to sess2
	if err := s.Logout(u2.ID, sess2.ID); err != nil {
		t.Fatalf("logout u2: %v", err)
	}
	subs2AfterLogout, _ := s.PushSubscriptions(u2.ID)
	if len(subs2AfterLogout) != 0 {
		t.Fatalf("push subscription must be removed on logout, got %d", len(subs2AfterLogout))
	}
}

func TestPushSubscription_UnsubscribeScopedSession(t *testing.T) {
	s := testStore(t)
	u := testUser(t, s, "unsub@example.com")
	_, sess1, _, _ := s.Login(u.Email, "secure-test-password", "web", "Sess1")
	_, sess2, _, _ := s.Login(u.Email, "secure-test-password", "web", "Sess2")

	sub1 := makeDummySubscription("https://push.services.mozilla.com/ep1")
	sub2 := makeDummySubscription("https://push.services.mozilla.com/ep2")

	_ = s.SubscribePush(u.ID, sess1.ID, sub1)
	_ = s.SubscribePush(u.ID, sess2.ID, sub2)

	// Unsubscribe ep1 with sess1 scope succeeds
	if err := s.UnsubscribePush(u.ID, sess1.ID, sub1.Endpoint); err != nil {
		t.Fatalf("unsub ep1: %v", err)
	}
	subs, _ := s.PushSubscriptions(u.ID)
	if len(subs) != 1 || subs[0].Endpoint != sub2.Endpoint {
		t.Fatalf("expected only sub2 to remain")
	}

	// Unsubscribe ep2 with mismatched sess1 does not delete ep2
	if err := s.UnsubscribePush(u.ID, sess1.ID, sub2.Endpoint); err != nil {
		t.Fatalf("unsub mismatch: %v", err)
	}
	subs, _ = s.PushSubscriptions(u.ID)
	if len(subs) != 1 {
		t.Fatalf("mismatched session should not delete subscription")
	}
}

func TestPushService_DigestSchedulingAndTimezones(t *testing.T) {
	s := testStore(t)
	transport := newMockPushTransport(true)
	svc := NewPushNotificationService(s, transport)

	// User in Moscow (UTC+3)
	uMsk, err := s.Register("msk@example.com", "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Admin("approve", uMsk.ID, "")
	_, sessMsk, _, _ := s.Login(uMsk.Email, "secure-test-password", "web", "Web")
	subMsk := makeDummySubscription("https://push.services.mozilla.com/msk-endpoint")
	_ = s.SubscribePush(uMsk.ID, sessMsk.ID, subMsk)

	// User in New York (UTC-4 in Daylight Saving)
	uNy, err := s.Register("ny@example.com", "secure-test-password", "America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Admin("approve", uNy.ID, "")
	_, sessNy, _, _ := s.Login(uNy.Email, "secure-test-password", "web", "Web")
	subNy := makeDummySubscription("https://push.services.mozilla.com/ny-endpoint")
	_ = s.SubscribePush(uNy.ID, sessNy.ID, subNy)

	// Case 1: Monday at 06:00 UTC => 09:00 in Moscow, 02:00 in New York
	// 2026-10-19 is a Monday
	t0600UTC := time.Date(2026, 10, 19, 6, 0, 0, 0, time.UTC)
	if err := svc.ReconcileDigests(context.Background(), t0600UTC); err != nil {
		t.Fatalf("reconcile 06:00 UTC: %v", err)
	}

	var mskCount, nyCount int
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE user_id=? AND digest_type='morning'", uMsk.ID).Scan(&mskCount)
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE user_id=? AND digest_type='morning'", uNy.ID).Scan(&nyCount)

	if mskCount != 1 {
		t.Fatalf("expected Moscow morning digest at 09:00 local, got %d", mskCount)
	}
	if nyCount != 0 {
		t.Fatalf("expected NO New York morning digest at 02:00 local, got %d", nyCount)
	}

	// Case 2: Weekend check: Saturday at 06:00 UTC => Should NOT schedule morning digest
	tSatUTC := time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)
	if err := svc.ReconcileDigests(context.Background(), tSatUTC); err != nil {
		t.Fatal(err)
	}
	var satCount int
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE local_date='2026-10-24'").Scan(&satCount)
	if satCount != 0 {
		t.Fatalf("expected no digests on weekend, got %d", satCount)
	}

	// Case 3: Monday at 15:00 UTC => 18:00 in Moscow (evening digest)
	t1500UTC := time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)
	if err := svc.ReconcileDigests(context.Background(), t1500UTC); err != nil {
		t.Fatal(err)
	}
	var eveningCount int
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE user_id=? AND digest_type='evening'", uMsk.ID).Scan(&eveningCount)
	if eveningCount != 1 {
		t.Fatalf("expected Moscow evening digest at 18:00 local, got %d", eveningCount)
	}

	// Case 4: Idempotent restart/re-reconcile check: running reconcile again at the same hour
	// or after restart must NOT duplicate digest entries (enforced by UNIQUE(subscription_id, local_date, digest_type))
	if err := svc.ReconcileDigests(context.Background(), t1500UTC); err != nil {
		t.Fatalf("re-reconcile duplicate check: %v", err)
	}
	_ = s.DB.QueryRow("SELECT count(*) FROM push_outbox WHERE user_id=? AND digest_type='evening'", uMsk.ID).Scan(&eveningCount)
	if eveningCount != 1 {
		t.Fatalf("expected exactly 1 evening digest after re-reconciliation, got %d", eveningCount)
	}
}

func TestPushService_OutboxDeliveryAndRetryHandling(t *testing.T) {
	s := testStore(t)
	transport := newMockPushTransport(true)
	svc := NewPushNotificationService(s, transport)

	u := testUser(t, s, "outbox@example.com")
	_, sess, _, _ := s.Login(u.Email, "secure-test-password", "web", "Web")
	sub := makeDummySubscription("https://push.services.mozilla.com/ep-outbox")
	_ = s.SubscribePush(u.ID, sess.ID, sub)

	// Set controlled time: Monday at 09:00 UTC
	now := time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }

	// Enqueue test push
	if err := s.EnqueueTestPush(u.ID, sess.ID, sub.Endpoint); err != nil {
		t.Fatal(err)
	}

	// Verify TTL is dynamically calculated and capped to 900s
	var ttlSent int
	transport.sendHook = func(s webpush.Subscription, p webpush.Payload, ttlSeconds int) (*webpush.Result, error) {
		ttlSent = ttlSeconds
		return &webpush.Result{StatusCode: 201}, nil
	}

	if err := svc.ProcessOutbox(context.Background(), now); err != nil {
		t.Fatalf("process outbox: %v", err)
	}

	if ttlSent <= 0 || ttlSent > 900 {
		t.Fatalf("expected dynamic TTL between 1 and 900, got %d", ttlSent)
	}

	var status string
	_ = s.DB.QueryRow("SELECT status FROM push_outbox WHERE user_id=?", u.ID).Scan(&status)
	if status != "delivered" {
		t.Fatalf("expected status 'delivered', got %s", status)
	}

	// Test 410 Gone / 404 Not Found removes subscription
	subGone := makeDummySubscription("https://push.services.mozilla.com/ep-gone")
	_ = s.SubscribePush(u.ID, sess.ID, subGone)
	_ = s.EnqueueTestPush(u.ID, sess.ID, subGone.Endpoint)

	transport.sendHook = func(s webpush.Subscription, p webpush.Payload, ttlSeconds int) (*webpush.Result, error) {
		return &webpush.Result{StatusCode: 410, Expired: true}, errors.New("subscription expired")
	}

	if err := svc.ProcessOutbox(context.Background(), now); err != nil {
		t.Fatal(err)
	}

	// Verify subscription was removed
	subs, _ := s.PushSubscriptions(u.ID)
	for _, sb := range subs {
		if sb.Endpoint == subGone.Endpoint {
			t.Fatalf("expired subscription must be deleted on 410")
		}
	}

	// Test 429 transient rate limit retry
	sub429 := makeDummySubscription("https://push.services.mozilla.com/ep-429")
	_ = s.SubscribePush(u.ID, sess.ID, sub429)
	_ = s.EnqueueTestPush(u.ID, sess.ID, sub429.Endpoint)

	retryDuration := 60 * time.Second
	transport.sendHook = func(s webpush.Subscription, p webpush.Payload, ttlSeconds int) (*webpush.Result, error) {
		return &webpush.Result{StatusCode: 429, RetryAfter: &retryDuration}, errors.New("rate limited")
	}

	if err := svc.ProcessOutbox(context.Background(), now); err != nil {
		t.Fatal(err)
	}

	var nextAttemptAt string
	_ = s.DB.QueryRow("SELECT next_attempt_at FROM push_outbox WHERE subscription_id=(SELECT id FROM push_subscriptions WHERE endpoint=?)", sub429.Endpoint).Scan(&nextAttemptAt)
	expectedNext := now.Add(retryDuration).Format(timestampLayout)
	if nextAttemptAt != expectedNext {
		t.Fatalf("expected next attempt at %s, got %s", expectedNext, nextAttemptAt)
	}

	// Test expiry: when nextAttempt exceeds expiresAt (15 minutes), status becomes expired
	s.Now = func() time.Time { return now.Add(20 * time.Minute) }
	if err := svc.ProcessOutbox(context.Background(), now.Add(20*time.Minute)); err != nil {
		t.Fatal(err)
	}

	var status429 string
	_ = s.DB.QueryRow("SELECT status FROM push_outbox WHERE subscription_id=(SELECT id FROM push_subscriptions WHERE endpoint=?)", sub429.Endpoint).Scan(&status429)
	if status429 != "expired" {
		t.Fatalf("expected outbox job to expire after 15m window, got %s", status429)
	}
}
