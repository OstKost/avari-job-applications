package webpush

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	sherwebpush "github.com/SherClockHolmes/webpush-go"
	"github.com/golang-jwt/jwt/v5"
)

// generateTestKeys generates dummy VAPID keys for testing.
// Never committed as real secrets.
func generateTestKeys(t *testing.T) (pub string, priv string) {
	t.Helper()
	privKey, pubKey, err := sherwebpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("failed to generate test VAPID keys: %v", err)
	}
	return pubKey, privKey
}

// generateTestSubscription generates a valid dummy push subscription.
func generateTestSubscription(t *testing.T, endpoint string) Subscription {
	t.Helper()
	// Dummy uncompressed P-256 public key (65 bytes, starts with 0x04)
	curve := elliptic.P256()
	_, x, y, err := elliptic.GenerateKey(curve, strings.NewReader("some-deterministic-32-byte-entropy-seed-for-testing!"))
	if err != nil {
		t.Fatalf("failed to generate dummy curve key: %v", err)
	}
	p256Bytes := elliptic.Marshal(curve, x, y)
	p256b64 := base64.RawURLEncoding.EncodeToString(p256Bytes)

	// Dummy 16-byte auth secret
	authBytes := []byte("1234567890123456")
	authb64 := base64.RawURLEncoding.EncodeToString(authBytes)

	return Subscription{
		Endpoint: endpoint,
		Keys: SubscriptionKeys{
			Auth:   authb64,
			P256dh: p256b64,
		},
	}
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) Do(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestVAPIDConfig_Validation(t *testing.T) {
	pub, priv := generateTestKeys(t)

	// Case 1: Empty config => gracefully disabled
	cfg, err := NewConfig(VAPIDConfig{})
	if err != nil {
		t.Fatalf("expected nil error on empty config, got: %v", err)
	}
	if cfg.Enabled() {
		t.Fatalf("expected Enabled() == false for empty config")
	}
	if cfg.PublicKey() != "" {
		t.Fatalf("expected empty public key, got %s", cfg.PublicKey())
	}

	// Case 2: Partial configs => actionable errors
	_, err = NewConfig(VAPIDConfig{PublicKey: pub})
	if err == nil || !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("expected ErrInvalidConfig for missing private key/contact, got: %v", err)
	}

	_, err = NewConfig(VAPIDConfig{PrivateKey: priv})
	if err == nil || !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("expected ErrInvalidConfig for missing public key/contact, got: %v", err)
	}

	_, err = NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: priv})
	if err == nil || !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("expected ErrInvalidConfig for missing contact, got: %v", err)
	}

	// Case 3: Invalid contact schemes and validation
	badContacts := []string{
		"admin@example.com",             // Missing scheme
		"mailto:",                       // Empty email
		"mailto:invalid-email",          // Invalid email
		"mailto:user@bad space.com",     // Space in email
		"http://example.com/push",       // Non-https
		"https://user:pass@example.com", // Credentials present
		"ftp://example.com",             // Invalid scheme
	}
	for _, badContact := range badContacts {
		_, err = NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: priv, Contact: badContact})
		if err == nil || !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("expected ErrInvalidConfig for contact %q, got: %v", badContact, err)
		}
	}

	// Valid contacts: mailto and https
	goodContacts := []string{
		"mailto:admin@example.com",
		"mailto:push-alerts@sub.domain.org",
		"https://example.com/push-contact",
		"https://api.domain.com/push/v1",
	}
	for _, goodContact := range goodContacts {
		c, err := NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: priv, Contact: goodContact})
		if err != nil {
			t.Errorf("unexpected error for contact %q: %v", goodContact, err)
		}
		if !c.Enabled() {
			t.Errorf("expected enabled for contact %q", goodContact)
		}
	}

	// Case 4: Invalid public key base64
	_, err = NewConfig(VAPIDConfig{PublicKey: "invalid!!!base64", PrivateKey: priv, Contact: "mailto:admin@example.com"})
	if err == nil || !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("expected ErrInvalidConfig on invalid public key base64")
	}

	// Case 5: Valid config with mailto:
	cfg, err = NewConfig(VAPIDConfig{
		PublicKey:  pub,
		PrivateKey: priv,
		Contact:    "mailto:admin@example.com",
	})
	if err != nil {
		t.Fatalf("unexpected error for valid config: %v", err)
	}
	if !cfg.Enabled() {
		t.Fatalf("expected Enabled() == true")
	}
	if cfg.PublicKey() != pub {
		t.Fatalf("expected PublicKey() == %s, got %s", pub, cfg.PublicKey())
	}
}

func TestVAPIDConfig_PrivateKeyRejection(t *testing.T) {
	pub, priv := generateTestKeys(t)
	contact := "mailto:admin@example.com"

	// 1. Zero scalar rejected
	zeroScalar := make([]byte, 32)
	zeroB64 := base64.RawURLEncoding.EncodeToString(zeroScalar)
	_, err := NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: zeroB64, Contact: contact})
	if err == nil || !strings.Contains(err.Error(), "out of range") {
		t.Fatalf("expected out of range error for zero scalar, got: %v", err)
	}

	// 2. Scalar out-of-range >= N rejected
	curve := elliptic.P256()
	n := curve.Params().N
	nBytes := n.Bytes()
	nB64 := base64.RawURLEncoding.EncodeToString(nBytes)
	_, err = NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: nB64, Contact: contact})
	if err == nil || !strings.Contains(err.Error(), "out of range") {
		t.Fatalf("expected out of range error for scalar >= N, got: %v", err)
	}

	// 3. Scalar mismatch with public key
	otherPub, otherPriv := generateTestKeys(t)
	_, err = NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: otherPriv, Contact: contact})
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected mismatch error when pairing pub with otherPriv, got: %v", err)
	}
	_, err = NewConfig(VAPIDConfig{PublicKey: otherPub, PrivateKey: priv, Contact: contact})
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected mismatch error when pairing otherPub with priv, got: %v", err)
	}

	// 4. DER / PKCS#8 ASN.1 blob rejected (must be raw 32 bytes only)
	privRaw, _ := decodeBase64URL(priv)
	d := new(big.Int).SetBytes(privRaw)
	pubRaw, _ := decodeBase64URL(pub)
	pubX, pubY := elliptic.Unmarshal(curve, pubRaw)
	ecKey := &ecdsa.PrivateKey{
		PublicKey: ecdsa.PublicKey{
			Curve: curve,
			X:     pubX,
			Y:     pubY,
		},
		D: d,
	}
	pkcs8Der, err := x509.MarshalPKCS8PrivateKey(ecKey)
	if err != nil {
		t.Fatalf("failed to marshal PKCS8: %v", err)
	}
	pkcs8B64 := base64.RawURLEncoding.EncodeToString(pkcs8Der)
	_, err = NewConfig(VAPIDConfig{PublicKey: pub, PrivateKey: pkcs8B64, Contact: contact})
	if err == nil || !strings.Contains(err.Error(), "DER/PKCS8 not supported") {
		t.Fatalf("expected DER rejection error, got: %v", err)
	}
}

func TestDeriveTopic(t *testing.T) {
	// Empty tag yields empty Topic
	if got := DeriveTopic(""); got != "" {
		t.Fatalf("expected empty topic for empty tag, got: %q", got)
	}
	if got := DeriveTopic("   "); got != "" {
		t.Fatalf("expected empty topic for whitespace tag, got: %q", got)
	}

	// Long non-ASCII tag
	longTag := "привет-мир-very-long-tag-that-exceeds-thirty-two-bytes-and-has-non-ascii-unicode-characters-🚀🌟"
	topic := DeriveTopic(longTag)
	if len(topic) != 32 {
		t.Fatalf("expected topic length exactly 32, got %d (%s)", len(topic), topic)
	}

	// Verify URL-safe base64 characters only
	for _, ch := range topic {
		isAlphanumeric := (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		isSafe := isAlphanumeric || ch == '-' || ch == '_'
		if !isSafe {
			t.Fatalf("invalid character in topic %s: %c", topic, ch)
		}
	}

	// Determinism
	topic2 := DeriveTopic(longTag)
	if topic != topic2 {
		t.Fatalf("expected deterministic topic, got %s and %s", topic, topic2)
	}

	// Distinct tags produce distinct topics
	topic3 := DeriveTopic("another-tag")
	if topic == topic3 {
		t.Fatalf("different tags should produce different topics")
	}
}

func TestSubscription_Validation(t *testing.T) {
	validSub := generateTestSubscription(t, "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB...")

	if err := validSub.Validate(); err != nil {
		t.Fatalf("expected valid subscription, got: %v", err)
	}

	// Non-HTTPS
	httpSub := validSub
	httpSub.Endpoint = "http://updates.push.services.mozilla.com/wpush"
	if err := httpSub.Validate(); err == nil || !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("expected error on http endpoint, got %v", err)
	}

	// Fragment not allowed
	fragSub := validSub
	fragSub.Endpoint = "https://updates.push.services.mozilla.com/wpush#frag"
	if err := fragSub.Validate(); err == nil || !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("expected error on fragment, got %v", err)
	}

	// Credentials not allowed
	userSub := validSub
	userSub.Endpoint = "https://user:pass@updates.push.services.mozilla.com/wpush"
	if err := userSub.Validate(); err == nil || !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("expected error on userinfo, got %v", err)
	}

	// Endpoint too long (>2048)
	longSub := validSub
	longSub.Endpoint = "https://updates.push.services.mozilla.com/" + strings.Repeat("a", 2050)
	if err := longSub.Validate(); err == nil || !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("expected error on long endpoint, got %v", err)
	}

	// Auth key invalid length (e.g. not 16 bytes)
	badAuthSub := validSub
	badAuthSub.Keys.Auth = base64.RawURLEncoding.EncodeToString([]byte("short"))
	if err := badAuthSub.Validate(); err == nil || !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("expected error on short auth key, got %v", err)
	}

	// P256dh key invalid length
	badP256Sub := validSub
	badP256Sub.Keys.P256dh = base64.RawURLEncoding.EncodeToString([]byte("invalid-p256dh-bytes"))
	if err := badP256Sub.Validate(); err == nil || !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("expected error on invalid p256dh key, got %v", err)
	}
}

func TestPayload_Validation(t *testing.T) {
	validPayload := Payload{
		Version: 1,
		Title:   "Weekday Digest",
		Body:    "You have 3 active applications.",
		URL:     "/applications",
		Tag:     "digest-weekday",
	}

	if err := validPayload.Validate(); err != nil {
		t.Fatalf("expected valid payload, got: %v", err)
	}

	// Unsupported version
	badVer := validPayload
	badVer.Version = 2
	if err := badVer.Validate(); err == nil || !errors.Is(err, ErrUnsupportedPayloadVer) {
		t.Fatalf("expected ErrUnsupportedPayloadVer, got: %v", err)
	}

	// Payload too large
	bigPayload := validPayload
	bigPayload.Body = strings.Repeat("x", 4000)
	if err := bigPayload.Validate(); err == nil || !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("expected ErrPayloadTooLarge, got: %v", err)
	}
}

func TestTransport_DisabledGracefully(t *testing.T) {
	cfg, err := NewConfig(VAPIDConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	tr, err := NewTransport(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sub := generateTestSubscription(t, "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB...")
	payload := Payload{
		Version: 1,
		Title:   "Digest",
		Body:    "Summary",
	}

	res, err := tr.Send(context.Background(), sub, payload, 3600)
	if err == nil || !errors.Is(err, ErrDisabled) {
		t.Fatalf("expected ErrDisabled, got res=%v, err=%v", res, err)
	}
}

func TestTransport_DeterministicMockSuccessAndVAPIDSignature(t *testing.T) {
	pub, priv := generateTestKeys(t)
	cfg, err := NewConfig(VAPIDConfig{
		PublicKey:  pub,
		PrivateKey: priv,
		Contact:    "mailto:dev@avari.test",
	})
	if err != nil {
		t.Fatalf("unexpected config error: %v", err)
	}

	endpoint := "https://fcm.googleapis.com/fcm/send/fake-token"
	tag := "my-tag-with-unicode-🚀"
	expectedTopic := DeriveTopic(tag)

	called := false
	var capturedAuthHeader string
	mockClient := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		called = true
		capturedAuthHeader = req.Header.Get("Authorization")
		if capturedAuthHeader == "" {
			t.Errorf("missing Authorization header")
		}
		if req.Header.Get("TTL") != "3600" {
			t.Errorf("expected TTL 3600, got %s", req.Header.Get("TTL"))
		}
		if req.Header.Get("Topic") != expectedTopic {
			t.Errorf("expected Topic header %q, got %q", expectedTopic, req.Header.Get("Topic"))
		}

		return &http.Response{
			StatusCode: http.StatusCreated,
			Body:       io.NopCloser(bytes.NewBufferString("ok")),
			Header:     make(http.Header),
		}, nil
	})

	tr, err := NewTransport(cfg, WithHTTPClient(mockClient))
	if err != nil {
		t.Fatalf("failed to init transport: %v", err)
	}

	sub := generateTestSubscription(t, endpoint)
	payload := Payload{
		Version: 1,
		Title:   "New Stage",
		Body:    "Interview Scheduled",
		Tag:     tag,
	}

	res, err := tr.Send(context.Background(), sub, payload, 3600)
	if err != nil {
		t.Fatalf("unexpected send error: %v", err)
	}
	if !called {
		t.Fatalf("mock client was not called")
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", res.StatusCode)
	}
	if res.Expired {
		t.Fatalf("expected not expired")
	}

	// Verify captured VAPID Authorization header and cryptographically verify the JWT signature
	// Format is: "vapid t=<jwt>, k=<b64 public key>" or "WebPush <jwt>"
	if !strings.HasPrefix(capturedAuthHeader, "vapid ") && !strings.HasPrefix(capturedAuthHeader, "WebPush ") {
		t.Fatalf("unexpected authorization header format: %s", capturedAuthHeader)
	}

	// Extract token string
	var tokenStr string
	parts := strings.Split(capturedAuthHeader, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "vapid t=") {
			tokenStr = strings.TrimPrefix(part, "vapid t=")
		} else if strings.HasPrefix(part, "t=") {
			tokenStr = strings.TrimPrefix(part, "t=")
		}
	}
	if tokenStr == "" {
		t.Fatalf("failed to extract token from header: %s", capturedAuthHeader)
	}

	// Verify JWT using public key
	pubRaw, _ := decodeBase64URL(pub)
	curve := elliptic.P256()
	pubX, pubY := elliptic.Unmarshal(curve, pubRaw)
	ecdsaPub := &ecdsa.PublicKey{
		Curve: curve,
		X:     pubX,
		Y:     pubY,
	}

	parsedToken, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodECDSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return ecdsaPub, nil
	})
	if err != nil || !parsedToken.Valid {
		t.Fatalf("VAPID JWT failed signature verification: %v", err)
	}

	claims, ok := parsedToken.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatalf("invalid claims structure")
	}
	if claims["sub"] != "mailto:dev@avari.test" {
		t.Fatalf("expected sub 'mailto:dev@avari.test', got %v", claims["sub"])
	}
	if claims["aud"] != "https://fcm.googleapis.com" {
		t.Fatalf("expected aud 'https://fcm.googleapis.com', got %v", claims["aud"])
	}
}

func TestTransport_ExpiredClassification(t *testing.T) {
	pub, priv := generateTestKeys(t)
	cfg, err := NewConfig(VAPIDConfig{
		PublicKey:  pub,
		PrivateKey: priv,
		Contact:    "mailto:dev@avari.test",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, code := range []int{http.StatusNotFound, http.StatusGone} {
		mockClient := roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: code,
				Body:       io.NopCloser(bytes.NewBufferString("unsubscribed")),
				Header:     make(http.Header),
			}, nil
		})

		tr, _ := NewTransport(cfg, WithHTTPClient(mockClient))
		sub := generateTestSubscription(t, "https://push.apple.com/send/fake")
		payload := Payload{Version: 1, Title: "T", Body: "B"}

		res, err := tr.Send(context.Background(), sub, payload, 60)
		if err == nil || !errors.Is(err, ErrSubscriptionExpired) {
			t.Fatalf("for HTTP %d, expected ErrSubscriptionExpired, got %v", code, err)
		}
		if res == nil || !res.Expired {
			t.Fatalf("for HTTP %d, expected res.Expired == true", code)
		}
	}
}

func TestTransport_RateLimit429RetryAfter(t *testing.T) {
	pub, priv := generateTestKeys(t)
	cfg, _ := NewConfig(VAPIDConfig{
		PublicKey:  pub,
		PrivateKey: priv,
		Contact:    "mailto:dev@avari.test",
	})

	// Test delta seconds
	mockClient := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		h := make(http.Header)
		h.Set("Retry-After", "120")
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Body:       io.NopCloser(bytes.NewBufferString("rate limited")),
			Header:     h,
		}, nil
	})

	tr, _ := NewTransport(cfg, WithHTTPClient(mockClient))
	sub := generateTestSubscription(t, "https://push.example.com/send")
	payload := Payload{Version: 1, Title: "T", Body: "B"}

	res, err := tr.Send(context.Background(), sub, payload, 60)
	if err == nil || !strings.Contains(err.Error(), "429") {
		t.Fatalf("expected 429 error, got: %v", err)
	}
	if res.RetryAfter == nil || *res.RetryAfter != 120*time.Second {
		t.Fatalf("expected RetryAfter 120s, got %v", res.RetryAfter)
	}

	// Test HTTP Date
	future := time.Now().Add(45 * time.Second).UTC().Format(http.TimeFormat)
	mockClientDate := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		h := make(http.Header)
		h.Set("Retry-After", future)
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Body:       io.NopCloser(bytes.NewBufferString("rate limited")),
			Header:     h,
		}, nil
	})

	trDate, _ := NewTransport(cfg, WithHTTPClient(mockClientDate))
	resDate, errDate := trDate.Send(context.Background(), sub, payload, 60)
	if errDate == nil {
		t.Fatalf("expected error on 429")
	}
	if resDate.RetryAfter == nil || *resDate.RetryAfter < 40*time.Second || *resDate.RetryAfter > 50*time.Second {
		t.Fatalf("expected RetryAfter around 45s, got %v", resDate.RetryAfter)
	}

	// Test huge/overflow seconds bounded by MaxRetryAfterSeconds
	mockClientHuge := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		h := make(http.Header)
		h.Set("Retry-After", "999999999999")
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Body:       io.NopCloser(bytes.NewBufferString("rate limited")),
			Header:     h,
		}, nil
	})

	trHuge, _ := NewTransport(cfg, WithHTTPClient(mockClientHuge))
	resHuge, _ := trHuge.Send(context.Background(), sub, payload, 60)
	if resHuge.RetryAfter == nil || *resHuge.RetryAfter != time.Duration(MaxRetryAfterSeconds)*time.Second {
		t.Fatalf("expected RetryAfter bounded to %ds, got %v", MaxRetryAfterSeconds, resHuge.RetryAfter)
	}
}

func TestSSRF_Protection(t *testing.T) {
	restrictedIPs := []string{
		"127.0.0.1",
		"127.0.1.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254", // AWS metadata
		"100.64.0.1",      // CGNAT
		"192.0.2.1",       // TEST-NET-1
		"198.51.100.1",    // TEST-NET-2
		"203.0.113.1",     // TEST-NET-3
		"224.0.0.1",       // Multicast
		"0.0.0.0",
		"::1",
		"fe80::1",
		"::ffff:127.0.0.1",
		"2001:db8::1",
	}

	for _, ipStr := range restrictedIPs {
		ip := net.ParseIP(ipStr)
		if !isRestrictedIP(ip) {
			t.Errorf("expected IP %s to be recognized as restricted", ipStr)
		}
	}

	allowedIPs := []string{
		"142.250.180.206", // Public Google IP
		"104.16.132.229",  // Public Cloudflare IP
		"151.101.1.140",   // Public Fastly IP
	}

	for _, ipStr := range allowedIPs {
		ip := net.ParseIP(ipStr)
		if isRestrictedIP(ip) {
			t.Errorf("expected public IP %s NOT to be restricted", ipStr)
		}
	}
}

func TestHTTPClient_RedirectRefusal(t *testing.T) {
	client := newSafeHTTPClient(2 * time.Second)
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	via := []*http.Request{req}
	err := client.CheckRedirect(req, via)
	if !errors.Is(err, ErrRedirectNotAllowed) {
		t.Fatalf("expected ErrRedirectNotAllowed, got: %v", err)
	}
}
