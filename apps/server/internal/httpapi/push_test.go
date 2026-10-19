package httpapi

import (
	"crypto/elliptic"
	"encoding/base64"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
	sherwebpush "github.com/SherClockHolmes/webpush-go"
)

func makeTestSubscription(endpoint string) map[string]any {
	curve := elliptic.P256()
	_, x, y, _ := elliptic.GenerateKey(curve, strings.NewReader("seed-deterministic-entropy-test-32bytes!"))
	p256Bytes := elliptic.Marshal(curve, x, y)
	p256 := base64.RawURLEncoding.EncodeToString(p256Bytes)
	auth := base64.RawURLEncoding.EncodeToString([]byte("1234567890123456"))

	return map[string]any{
		"endpoint": endpoint,
		"keys": map[string]string{
			"auth":   auth,
			"p256dh": p256,
		},
	}
}

func setupPushServer(t *testing.T, enabled bool) (*core.Store, *Server, *httptest.Server) {
	t.Helper()
	store, e := core.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if e != nil {
		t.Fatal(e)
	}

	var cfg *webpush.Config
	if enabled {
		privKey, pubKey, err := sherwebpush.GenerateVAPIDKeys()
		if err != nil {
			t.Fatal(err)
		}
		c, err := webpush.NewConfig(webpush.VAPIDConfig{
			PublicKey:  pubKey,
			PrivateKey: privKey,
			Contact:    "mailto:admin@avari.test",
		})
		if err != nil {
			t.Fatal(err)
		}
		cfg = c
	} else {
		c, _ := webpush.NewConfig(webpush.VAPIDConfig{})
		cfg = c
	}

	tr, err := webpush.NewTransport(cfg)
	if err != nil {
		t.Fatal(err)
	}

	svc := core.NewPushNotificationService(store, tr)
	api := &Server{
		Store:         store,
		PushTransport: tr,
		PushService:   svc,
	}

	server := httptest.NewServer(api.Handler())
	api.Origin = server.URL
	t.Cleanup(func() { server.Close(); store.Close() })
	return store, api, server
}

func TestHTTPPushAPI_Disabled(t *testing.T) {
	store, _, server := setupPushServer(t, false)

	// Register & login user
	_, uReg, _ := call(t, server, "POST", "/api/v1/auth/register", map[string]string{
		"email":    "user@example.com",
		"password": "secure-test-password",
		"timezone": "Europe/Moscow",
	}, nil)
	_ = store.Admin("approve", uReg["id"].(string), "")

	_, _, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{
		"email":    "user@example.com",
		"password": "secure-test-password",
	}, nil)

	csrf := ""
	for _, c := range cookies {
		if c.Name == "avari_csrf" {
			csrf = c.Value
		}
	}
	headers := map[string]string{
		"Cookie":       cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value,
		"Origin":       server.URL,
		"X-CSRF-Token": csrf,
	}

	// 1. GET /push/config returns 200 with enabled: false, empty key, and subscribed: false
	status, cfgRes, _ := call(t, server, "GET", "/api/v1/push/config", nil, headers)
	if status != 200 {
		t.Fatalf("expected 200 for push/config, got %d", status)
	}
	if cfgRes["enabled"] != false || cfgRes["publicKey"] != "" || cfgRes["subscribed"] != false {
		t.Fatalf("expected disabled config with subscribed=false, got %+v", cfgRes)
	}

	// 2. POST /push/subscribe returns 503 when push is disabled
	sub := makeTestSubscription("https://updates.push.services.mozilla.com/ep")
	status, _, _ = call(t, server, "POST", "/api/v1/push/subscribe", sub, headers)
	if status != 503 {
		t.Fatalf("expected 503 for subscribe when disabled, got %d", status)
	}

	// 3. POST /push/test returns 503 when push is disabled
	status, _, _ = call(t, server, "POST", "/api/v1/push/test", map[string]string{"endpoint": "https://updates.push.services.mozilla.com/ep"}, headers)
	if status != 503 {
		t.Fatalf("expected 503 for test push when disabled, got %d", status)
	}
}

func TestHTTPPushAPI_EnabledAndFlow(t *testing.T) {
	store, _, server := setupPushServer(t, true)

	// Register & login user 1 session 1
	_, uReg, _ := call(t, server, "POST", "/api/v1/auth/register", map[string]string{
		"email":    "user-push@example.com",
		"password": "secure-test-password",
		"timezone": "Europe/Moscow",
	}, nil)
	_ = store.Admin("approve", uReg["id"].(string), "")

	_, _, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{
		"email":    "user-push@example.com",
		"password": "secure-test-password",
	}, nil)

	csrf := ""
	for _, c := range cookies {
		if c.Name == "avari_csrf" {
			csrf = c.Value
		}
	}
	headers := map[string]string{
		"Cookie":       cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value,
		"Origin":       server.URL,
		"X-CSRF-Token": csrf,
	}

	// 1. GET /push/config returns enabled: true, public key, and subscribed: false initially
	status, cfgRes, _ := call(t, server, "GET", "/api/v1/push/config", nil, headers)
	if status != 200 {
		t.Fatalf("expected 200 for push/config, got %d", status)
	}
	if cfgRes["enabled"] != true || cfgRes["publicKey"] == "" || cfgRes["subscribed"] != false {
		t.Fatalf("expected enabled config with key and subscribed=false, got %+v", cfgRes)
	}

	// 2. Login a second session for the same user
	_, _, cookies2 := call(t, server, "POST", "/api/v1/auth/login", map[string]string{
		"email":    "user-push@example.com",
		"password": "secure-test-password",
	}, nil)
	csrf2 := ""
	for _, c := range cookies2 {
		if c.Name == "avari_csrf" {
			csrf2 = c.Value
		}
	}
	headers2 := map[string]string{
		"Cookie":       cookies2[0].Name + "=" + cookies2[0].Value + "; " + cookies2[1].Name + "=" + cookies2[1].Value,
		"Origin":       server.URL,
		"X-CSRF-Token": csrf2,
	}

	// 3. POST /push/subscribe registers subscription for session 1
	endpoint := "https://updates.push.services.mozilla.com/wpush/v2/test-endpoint"
	sub := makeTestSubscription(endpoint)
	status, subRes, _ := call(t, server, "POST", "/api/v1/push/subscribe", sub, headers)
	if status != 200 || subRes["ok"] != true {
		t.Fatalf("expected subscribe ok: true, got status %d, res: %+v", status, subRes)
	}

	// 4. Session 1 now sees subscribed: true
	status, cfgRes, _ = call(t, server, "GET", "/api/v1/push/config", nil, headers)
	if status != 200 || cfgRes["subscribed"] != true {
		t.Fatalf("expected session 1 to have subscribed=true, got %+v", cfgRes)
	}

	// 5. Session 2 sees subscribed: false (session-scoped consent)
	status, cfgRes2, _ := call(t, server, "GET", "/api/v1/push/config", nil, headers2)
	if status != 200 || cfgRes2["subscribed"] != false {
		t.Fatalf("expected session 2 to have subscribed=false, got %+v", cfgRes2)
	}

	// 6. POST /push/test returns queued: true
	status, testRes, _ := call(t, server, "POST", "/api/v1/push/test", map[string]string{"endpoint": endpoint}, headers)
	if status != 200 || testRes["queued"] != true {
		t.Fatalf("expected test push queued: true, got status %d, res: %+v", status, testRes)
	}

	// 7. POST /push/unsubscribe removes subscription
	status, unsubRes, _ := call(t, server, "POST", "/api/v1/push/unsubscribe", map[string]string{"endpoint": endpoint}, headers)
	if status != 200 || unsubRes["ok"] != true {
		t.Fatalf("expected unsubscribe ok: true, got status %d, res: %+v", status, unsubRes)
	}

	// 8. Session 1 now sees subscribed: false again
	status, cfgRes, _ = call(t, server, "GET", "/api/v1/push/config", nil, headers)
	if status != 200 || cfgRes["subscribed"] != false {
		t.Fatalf("expected session 1 to have subscribed=false after unsub, got %+v", cfgRes)
	}

	// 9. POST /push/test after unsubscribe returns 404
	status, _, _ = call(t, server, "POST", "/api/v1/push/test", map[string]string{"endpoint": endpoint}, headers)
	if status != 404 {
		t.Fatalf("expected 404 when testing unsubscribed endpoint, got %d", status)
	}
}
