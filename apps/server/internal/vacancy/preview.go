// Package vacancy loads public vacancy metadata without executing page scripts.
package vacancy

import (
	"context"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

const maxBody = 5 << 20

var ErrUnavailable = errors.New("Не удалось получить данные вакансии. Страница может требовать вход или быть недоступна. Заполните поля вручную или попробуйте ещё раз.")
var ErrNoData = errors.New("На странице не найдены данные вакансии. Заполните поля вручную.")

type Fields struct {
	VacancyText string  `json:"vacancyText,omitempty"`
	Company     string  `json:"company,omitempty"`
	Position    string  `json:"position,omitempty"`
	Location    string  `json:"location,omitempty"`
	WorkFormat  string  `json:"workFormat,omitempty"`
	CompanyLogo string  `json:"companyLogo,omitempty"`
	Salary      *Salary `json:"salary,omitempty"`
}
type Salary struct {
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
	Currency string   `json:"currency,omitempty"`
	Period   string   `json:"period,omitempty"`
	Tax      string   `json:"tax,omitempty"`
}
type Preview struct {
	URL    string `json:"url"`
	Fields Fields `json:"fields"`
}

// Check every resolved address, then dial the checked IP directly to prevent DNS rebinding.
func safeDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil || port != "443" {
		return nil, ErrUnavailable
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, ErrUnavailable
	}
	for _, ip := range ips {
		if !publicIP(ip) {
			return nil, ErrUnavailable
		}
	}
	var last error
	for _, ip := range ips {
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// Shared, documentation, benchmarking, reserved and IPv6 translation ranges.
	for _, raw := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2001::/23", "2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(raw).Contains(ip) {
			return false
		}
	}
	return true
}

func redirect(req *http.Request, via []*http.Request) error {
	if len(via) > 3 {
		return ErrUnavailable
	}
	canonical, site := core.VacancyPreviewURL(req.URL.String())
	_, originalSite := core.VacancyPreviewURL(via[0].URL.String())
	original, _ := core.VacancyPreviewURL(via[0].URL.String())
	if canonical == "" || site != originalSite || canonical != original {
		return ErrUnavailable
	}
	return nil
}

func Fetch(ctx context.Context, raw string) (Preview, error) {
	canonical, _ := core.VacancyPreviewURL(raw)
	if canonical == "" {
		return Preview{}, errors.New("Укажите HTTPS-ссылку на вакансию поддерживаемого сайта")
	}
	transport := &http.Transport{DialContext: safeDial, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 7 * time.Second, MaxResponseHeaderBytes: 1 << 20}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: 10 * time.Second, Transport: transport, CheckRedirect: redirect}
	return fetch(ctx, client, canonical)
}

func fetch(ctx context.Context, client *http.Client, canonical string) (Preview, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", canonical, nil)
	if err != nil {
		return Preview{}, ErrUnavailable
	}
	req.Header.Set("User-Agent", "Avari.Jobs/1.0 (+https://jobs.avari.dev)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("Accept-Language", "ru,en;q=0.8")
	res, err := client.Do(req)
	if err != nil {
		return Preview{}, ErrUnavailable
	}
	defer res.Body.Close()
	media, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if res.StatusCode != 200 || (media != "text/html" && media != "application/xhtml+xml") || res.ContentLength > maxBody {
		return Preview{}, ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBody+1))
	if err != nil || len(body) > maxBody {
		return Preview{}, ErrUnavailable
	}
	// A login redirect cannot supply metadata for the requested vacancy.
	if res.Request != nil {
		final, _ := core.VacancyPreviewURL(res.Request.URL.String())
		if final != canonical {
			return Preview{}, ErrUnavailable
		}
	}
	return Parse(strings.NewReader(string(body)), canonical)
}

func logoURL(raw, base string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	b, _ := url.Parse(base)
	u = b.ResolveReference(u)
	if u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Port() != "" || len(u.String()) > 2048 {
		return ""
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !publicIP(ip) {
		return ""
	}
	return u.String()
}
