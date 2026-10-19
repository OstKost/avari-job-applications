package webpush

import (
	"context"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"time"

	sherwebpush "github.com/SherClockHolmes/webpush-go"
)

// Default limits and timeouts.
const (
	MaxResponseBodyBytes = 64 * 1024 // 64 KB bounded response body
	MaxURLLength         = 2048
	DefaultHTTPTimeout   = 10 * time.Second
	MaxRetryAfterSeconds = 86400 * 365 // 1 year upper bound to prevent integer overflow
)

// Standard errors returned by the package.
var (
	ErrDisabled              = errors.New("webpush: push notifications are disabled")
	ErrInvalidConfig         = errors.New("webpush: invalid VAPID configuration")
	ErrInvalidSubscription   = errors.New("webpush: invalid push subscription")
	ErrSSRFProtection        = errors.New("webpush: endpoint address rejected by SSRF protection")
	ErrRedirectNotAllowed    = errors.New("webpush: HTTP redirects are not permitted for push endpoints")
	ErrPayloadTooLarge       = errors.New("webpush: payload exceeds size limit")
	ErrSubscriptionExpired   = errors.New("webpush: subscription has expired or is invalid (404/410)")
	ErrUnsupportedPayloadVer = errors.New("webpush: unsupported payload version")
)

// VAPIDConfig contains raw configuration for VAPID.
type VAPIDConfig struct {
	PublicKey  string
	PrivateKey string
	Contact    string // mailto: or https:
}

// Config is the validated, safe runtime configuration.
type Config struct {
	enabled   bool
	publicKey string
	vapid     *VAPIDConfig
}

// NewConfig validates raw VAPID settings.
// If all fields are empty, push is gracefully disabled (Enabled() == false, err == nil).
// If partial or invalid, an actionable error is returned.
func NewConfig(cfg VAPIDConfig) (*Config, error) {
	pub := strings.TrimSpace(cfg.PublicKey)
	priv := strings.TrimSpace(cfg.PrivateKey)
	contact := strings.TrimSpace(cfg.Contact)

	// Graceful disabled state when none are provided.
	if pub == "" && priv == "" && contact == "" {
		return &Config{enabled: false}, nil
	}

	// Actionable startup validation when partially or fully provided.
	if pub == "" {
		return nil, fmt.Errorf("%w: public key is required when VAPID is configured", ErrInvalidConfig)
	}
	if priv == "" {
		return nil, fmt.Errorf("%w: private key is required when VAPID is configured", ErrInvalidConfig)
	}
	if contact == "" {
		return nil, fmt.Errorf("%w: contact (subscriber) email or URL is required when VAPID is configured", ErrInvalidConfig)
	}

	// Validate contact (RFC 8292: mailto:<email> or https://<url> without user credentials)
	if err := validateContact(contact); err != nil {
		return nil, fmt.Errorf("%w: invalid contact: %v", ErrInvalidConfig, err)
	}

	// Validate public key (uncompressed P-256 point: 65 bytes raw, first byte 0x04)
	pubBytes, err := decodeBase64URL(pub)
	if err != nil {
		return nil, fmt.Errorf("%w: public key is not valid URL-safe base64: %v", ErrInvalidConfig, err)
	}
	if len(pubBytes) != 65 || pubBytes[0] != 0x04 {
		return nil, fmt.Errorf("%w: public key must be 65 uncompressed P-256 EC bytes (first byte 0x04)", ErrInvalidConfig)
	}
	curve := elliptic.P256()
	pubX, pubY := elliptic.Unmarshal(curve, pubBytes)
	if pubX == nil || pubY == nil || !curve.IsOnCurve(pubX, pubY) {
		return nil, fmt.Errorf("%w: public key is not a valid point on P-256 curve", ErrInvalidConfig)
	}

	// Validate private key (strictly raw 32-byte scalar [1, N-1], reject DER/ASN.1/PKCS8 blobs)
	privBytes, err := decodeBase64URL(priv)
	if err != nil {
		return nil, fmt.Errorf("%w: private key is not valid URL-safe base64: %v", ErrInvalidConfig, err)
	}
	if len(privBytes) != 32 {
		return nil, fmt.Errorf("%w: private key must be exactly 32 raw bytes scalar (DER/PKCS8 not supported)", ErrInvalidConfig)
	}

	// Verify scalar range [1, N-1]
	d := new(big.Int).SetBytes(privBytes)
	n := curve.Params().N
	one := big.NewInt(1)
	if d.Cmp(one) < 0 || d.Cmp(new(big.Int).Sub(n, one)) > 0 {
		return nil, fmt.Errorf("%w: private key scalar out of range [1, N-1]", ErrInvalidConfig)
	}

	// Verify that the private key derives the exact provided public key
	derivedX, derivedY := curve.ScalarBaseMult(privBytes)
	if derivedX.Cmp(pubX) != 0 || derivedY.Cmp(pubY) != 0 {
		return nil, fmt.Errorf("%w: private key does not match provided public key", ErrInvalidConfig)
	}

	return &Config{
		enabled:   true,
		publicKey: pub,
		vapid: &VAPIDConfig{
			PublicKey:  pub,
			PrivateKey: priv,
			Contact:    contact,
		},
	}, nil
}

// validateContact ensures contact is a valid mailto: with a valid email or https:// URL without credentials.
func validateContact(contact string) error {
	if strings.HasPrefix(contact, "mailto:") {
		email := strings.TrimPrefix(contact, "mailto:")
		if email == "" {
			return errors.New("mailto address is empty")
		}
		addr, err := mail.ParseAddress(email)
		if err != nil || addr.Address != email {
			return fmt.Errorf("invalid email address in mailto: %v", err)
		}
		return nil
	}

	if strings.HasPrefix(contact, "https://") {
		u, err := url.Parse(contact)
		if err != nil {
			return fmt.Errorf("invalid https URL: %v", err)
		}
		if u.Scheme != "https" {
			return errors.New("contact URL must use https scheme")
		}
		if u.Host == "" {
			return errors.New("contact URL must have host")
		}
		if u.User != nil {
			return errors.New("contact URL must not contain credentials")
		}
		return nil
	}

	return errors.New("contact must start with 'mailto:' or 'https://'")
}

// Enabled returns true if push notifications are configured and enabled.
func (c *Config) Enabled() bool {
	if c == nil {
		return false
	}
	return c.enabled
}

// PublicKey returns the VAPID public key safe for distribution to clients.
func (c *Config) PublicKey() string {
	if c == nil {
		return ""
	}
	return c.publicKey
}

// Subscription Keys as specified in Web Push API.
type SubscriptionKeys struct {
	Auth   string `json:"auth"`
	P256dh string `json:"p256dh"`
}

// Subscription represents client push subscription.
type Subscription struct {
	Endpoint string           `json:"endpoint"`
	Keys     SubscriptionKeys `json:"keys"`
}

// Validate ensures the push subscription has a safe HTTPS endpoint and valid keys.
func (s *Subscription) Validate() error {
	if s == nil {
		return fmt.Errorf("%w: subscription is nil", ErrInvalidSubscription)
	}

	// Validate Endpoint
	ep := strings.TrimSpace(s.Endpoint)
	if ep == "" {
		return fmt.Errorf("%w: endpoint is empty", ErrInvalidSubscription)
	}
	if len(ep) > MaxURLLength {
		return fmt.Errorf("%w: endpoint exceeds maximum length of %d bytes", ErrInvalidSubscription, MaxURLLength)
	}
	u, err := url.Parse(ep)
	if err != nil {
		return fmt.Errorf("%w: malformed endpoint URL: %v", ErrInvalidSubscription, err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("%w: endpoint must use https scheme", ErrInvalidSubscription)
	}
	if u.Host == "" {
		return fmt.Errorf("%w: endpoint missing host", ErrInvalidSubscription)
	}
	if u.User != nil {
		return fmt.Errorf("%w: endpoint must not contain userinfo/credentials", ErrInvalidSubscription)
	}
	if u.Fragment != "" {
		return fmt.Errorf("%w: endpoint must not contain URL fragments", ErrInvalidSubscription)
	}

	// Validate Auth key (16 bytes raw)
	authBytes, err := decodeBase64URL(s.Keys.Auth)
	if err != nil {
		return fmt.Errorf("%w: invalid auth key base64: %v", ErrInvalidSubscription, err)
	}
	if len(authBytes) != 16 {
		return fmt.Errorf("%w: auth key must be exactly 16 bytes (got %d)", ErrInvalidSubscription, len(authBytes))
	}

	// Validate P256dh key (65 bytes raw, uncompressed EC point)
	p256Bytes, err := decodeBase64URL(s.Keys.P256dh)
	if err != nil {
		return fmt.Errorf("%w: invalid p256dh key base64: %v", ErrInvalidSubscription, err)
	}
	if len(p256Bytes) != 65 || p256Bytes[0] != 0x04 {
		return fmt.Errorf("%w: p256dh key must be 65 uncompressed P-256 EC bytes", ErrInvalidSubscription)
	}
	curve := elliptic.P256()
	x, y := elliptic.Unmarshal(curve, p256Bytes)
	if x == nil || y == nil || !curve.IsOnCurve(x, y) {
		return fmt.Errorf("%w: p256dh key is not a valid curve point", ErrInvalidSubscription)
	}

	return nil
}

// Payload is the version 1 push notification payload.
// Note: no personal or sensitive content should be placed here.
type Payload struct {
	Version int    `json:"version"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	URL     string `json:"url,omitempty"`
	Tag     string `json:"tag,omitempty"`
}

// Validate verifies payload version and size constraints.
func (p *Payload) Validate() error {
	if p == nil {
		return fmt.Errorf("%w: payload is nil", ErrPayloadTooLarge)
	}
	if p.Version != 1 {
		return fmt.Errorf("%w: got version %d, expected 1", ErrUnsupportedPayloadVer, p.Version)
	}
	data, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("webpush: failed to marshal payload: %w", err)
	}
	// Max standard Web Push payload record is 4096 bytes (including encryption overhead).
	// Limit plaintext JSON payload safely to 3072 bytes.
	if len(data) > 3072 {
		return fmt.Errorf("%w: serialized payload is %d bytes (limit 3072)", ErrPayloadTooLarge, len(data))
	}
	return nil
}

// DeriveTopic derives a deterministic, URL-safe base64url Topic header (<= 32 characters)
// suitable for RFC 8030 from an arbitrary notification tag.
// If the tag is empty, an empty string is returned (omitting the Topic header).
func DeriveTopic(tag string) string {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return ""
	}
	// Hash the tag using SHA-256
	h := sha256.Sum256([]byte(tag))
	// 24 bytes in base64url unpadded is exactly 32 ASCII characters [A-Za-z0-9-_]
	return base64.RawURLEncoding.EncodeToString(h[:24])
}

// Result holds the outcome of sending a push message.
type Result struct {
	StatusCode int
	RetryAfter *time.Duration
	Expired    bool
}

// Transport sends web push messages.
type Transport interface {
	Send(ctx context.Context, sub Subscription, payload Payload, ttlSeconds int) (*Result, error)
	Config() *Config
}

// HTTPClient represents the HTTP client interface needed by WebPush.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// Option configures standard transport behavior.
type Option func(*defaultTransport)

// WithHTTPClient overrides the underlying HTTP client (for deterministic testing).
func WithHTTPClient(client HTTPClient) Option {
	return func(t *defaultTransport) {
		t.httpClient = client
	}
}

// WithHTTPTimeout overrides default request timeout.
func WithHTTPTimeout(d time.Duration) Option {
	return func(t *defaultTransport) {
		t.timeout = d
	}
}

type defaultTransport struct {
	config     *Config
	httpClient HTTPClient
	timeout    time.Duration
}

// NewTransport constructs a WebPush transport with safe SSRF-protected networking by default.
func NewTransport(config *Config, opts ...Option) (Transport, error) {
	if config == nil {
		return nil, fmt.Errorf("%w: config cannot be nil", ErrInvalidConfig)
	}

	t := &defaultTransport{
		config:  config,
		timeout: DefaultHTTPTimeout,
	}

	for _, opt := range opts {
		opt(t)
	}

	if t.httpClient == nil {
		t.httpClient = newSafeHTTPClient(t.timeout)
	}

	return t, nil
}

func (t *defaultTransport) Config() *Config {
	return t.config
}

// Send sends the web push payload to the subscriber endpoint.
func (t *defaultTransport) Send(ctx context.Context, sub Subscription, payload Payload, ttlSeconds int) (*Result, error) {
	if !t.config.Enabled() {
		return nil, ErrDisabled
	}

	if err := sub.Validate(); err != nil {
		return nil, err
	}

	if err := payload.Validate(); err != nil {
		return nil, err
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("webpush: marshal payload error: %w", err)
	}

	sherSub := &sherwebpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: sherwebpush.Keys{
			Auth:   sub.Keys.Auth,
			P256dh: sub.Keys.P256dh,
		},
	}

	subscriber := t.config.vapid.Contact
	if strings.HasPrefix(subscriber, "mailto:") {
		subscriber = strings.TrimPrefix(subscriber, "mailto:")
	}

	sherOpts := &sherwebpush.Options{
		HTTPClient:      t.httpClient,
		Subscriber:      subscriber,
		VAPIDPublicKey:  t.config.vapid.PublicKey,
		VAPIDPrivateKey: t.config.vapid.PrivateKey,
		TTL:             ttlSeconds,
		Topic:           DeriveTopic(payload.Tag),
	}

	// Send notification using SherClockHolmes/webpush-go
	resp, err := sherwebpush.SendNotificationWithContext(ctx, payloadBytes, sherSub, sherOpts)
	if err != nil {
		// Check for context cancellation or SSRF rejection wrapped errors
		if errors.Is(err, ErrSSRFProtection) || errors.Is(err, ErrRedirectNotAllowed) {
			return nil, err
		}
		return nil, fmt.Errorf("webpush: send error: %w", err)
	}
	defer func() {
		// Read bounded body and close
		_, _ = io.CopyN(io.Discard, resp.Body, MaxResponseBodyBytes)
		_ = resp.Body.Close()
	}()

	res := &Result{
		StatusCode: resp.StatusCode,
	}

	// Classify expired subscriptions: 404 Not Found or 410 Gone
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		res.Expired = true
		return res, fmt.Errorf("%w: received HTTP %d", ErrSubscriptionExpired, resp.StatusCode)
	}

	// Handle 429 Too Many Requests: parse Retry-After
	if resp.StatusCode == http.StatusTooManyRequests {
		retryAfterStr := resp.Header.Get("Retry-After")
		if retryAfterStr != "" {
			res.RetryAfter = parseRetryAfter(retryAfterStr)
		}
		return res, fmt.Errorf("webpush: rate limited (HTTP 429)")
	}

	// Success status is typically 200 OK or 201 Created
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return res, nil
	}

	return res, fmt.Errorf("webpush: unexpected HTTP status %d", resp.StatusCode)
}

// parseRetryAfter parses either seconds delta or HTTP date.
// Clamps values to MaxRetryAfterSeconds to prevent integer overflow.
func parseRetryAfter(val string) *time.Duration {
	val = strings.TrimSpace(val)
	if val == "" {
		return nil
	}

	// Try integer seconds
	if sec, err := strconv.ParseInt(val, 10, 64); err == nil && sec >= 0 {
		if sec > MaxRetryAfterSeconds {
			sec = MaxRetryAfterSeconds
		}
		d := time.Duration(sec) * time.Second
		return &d
	}

	// Try HTTP date formats (RFC 1123, RFC 850, ANSI C)
	formats := []string{
		http.TimeFormat,
		time.RFC850,
		time.ANSIC,
	}
	for _, format := range formats {
		if t, err := time.Parse(format, val); err == nil {
			delta := time.Until(t)
			if delta < 0 {
				delta = 0
			}
			maxD := time.Duration(MaxRetryAfterSeconds) * time.Second
			if delta > maxD {
				delta = maxD
			}
			return &delta
		}
	}

	return nil
}

// isRestrictedIP checks if an IP is loopback, private, multicast, link-local or reserved.
func isRestrictedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}

	// Additional reserved IPv4 ranges:
	// 0.0.0.0/8 (current network)
	// 100.64.0.0/10 (carrier-grade NAT) - covered by IsPrivate in newer Go, but explicitly check
	// 192.0.0.0/24 (IETF protocol assignments)
	// 192.0.2.0/24 (TEST-NET-1)
	// 198.51.100.0/24 (TEST-NET-2)
	// 203.0.113.0/24 (TEST-NET-3)
	// 198.18.0.0/15 (benchmarking)
	// 240.0.0.0/4 (reserved)
	// 255.255.255.255/32 (broadcast)
	if ip4 := ip.To4(); ip4 != nil {
		b0 := ip4[0]
		b1 := ip4[1]
		if b0 == 0 {
			return true
		}
		if b0 == 100 && (b1 >= 64 && b1 <= 127) {
			return true
		}
		if b0 == 192 && b1 == 0 && ip4[2] == 0 {
			return true
		}
		if b0 == 192 && b1 == 0 && ip4[2] == 2 {
			return true
		}
		if b0 == 198 && b1 == 51 && ip4[2] == 100 {
			return true
		}
		if b0 == 203 && b1 == 0 && ip4[2] == 113 {
			return true
		}
		if b0 == 198 && (b1 == 18 || b1 == 19) {
			return true
		}
		if b0 >= 240 {
			return true
		}
	}

	// IPv6 reserved checks:
	// ::ffff:0:0/96 (IPv4-mapped IPv6)
	// 2001:db8::/32 (documentation)
	// fc00::/7 (unique local) - covered by IsPrivate
	// fe80::/10 (link local) - covered by IsLinkLocalUnicast
	// ::1 (loopback) - covered by IsLoopback
	if ip.To4() == nil {
		if strings.HasPrefix(ip.String(), "::ffff:") {
			// Extract mapped IPv4 and check
			if len(ip) == 16 {
				mapped4 := net.IPv4(ip[12], ip[13], ip[14], ip[15])
				return isRestrictedIP(mapped4)
			}
			return true
		}
		// 2001:db8::/32
		if len(ip) >= 4 && ip[0] == 0x20 && ip[1] == 0x01 && ip[2] == 0x0d && ip[3] == 0xb8 {
			return true
		}
	}

	return false
}

// newSafeHTTPClient builds an http.Client that enforces SSRF checks during DNS lookup AND at socket connect time,
// disables redirects, and ignores environment proxy bypasses.
func newSafeHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
		Control: func(network, address string, c syscall.RawConn) error {
			// Secondary safety check at raw connection level
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip != nil && isRestrictedIP(ip) {
				return fmt.Errorf("%w: control callback blocked address %s", ErrSSRFProtection, address)
			}
			return nil
		},
	}

	transport := &http.Transport{
		Proxy: nil, // Refuse proxy bypasses from environment (e.g. HTTP_PROXY)
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("%w: invalid address: %v", ErrSSRFProtection, err)
			}

			// Pre-resolve DNS using resolver and verify every resolved IP
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, fmt.Errorf("webpush: dns resolution failed: %w", err)
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("webpush: no ip addresses found for host %s", host)
			}

			for _, ip := range ips {
				if isRestrictedIP(ip) {
					return nil, fmt.Errorf("%w: resolved IP %s is restricted", ErrSSRFProtection, ip)
				}
			}

			// Connect to the first valid resolved IP to prevent DNS rebinding between check and connect
			targetAddr := net.JoinHostPort(ips[0].String(), port)
			return dialer.DialContext(ctx, network, targetAddr)
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return ErrRedirectNotAllowed
		},
	}
}

// decodeBase64URL decodes URL-safe base64 strings with or without padding.
func decodeBase64URL(s string) ([]byte, error) {
	// Add padding if missing
	pad := len(s) % 4
	if pad > 0 {
		s += strings.Repeat("=", 4-pad)
	}
	// Try standard RawURLEncoding or URLEncoding
	b, err := base64.URLEncoding.DecodeString(s)
	if err == nil {
		return b, nil
	}
	// Fallback to standard base64 if someone used standard encoding
	return base64.StdEncoding.DecodeString(s)
}
