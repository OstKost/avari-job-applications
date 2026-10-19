package vacancy

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
)

// Minimal public markup excerpts shared with the extension's parser scenarios.
func TestSiteMetadata(t *testing.T) {
	cases := []struct {
		url, html, company, position, location, format string
		min, max                                       float64
		currency, period, tax                          string
	}{
		{"https://hh.ru/vacancy/123", `<h1 data-qa="vacancy-title">Developer</h1><a data-qa="vacancy-company-name">Acme</a><span data-qa="vacancy-salary">50&nbsp;000 ₽ за месяц, на руки</span><p data-qa="work-formats-text">Формат работы: удалённо</p><span data-qa="vacancy-view-raw-address">Ростов-на-Дону</span>`, "Acme", "Developer", "Ростов-на-Дону", "удалённо", 50000, 50000, "RUB", "month", "net"},
		{"https://getmatch.ru/vacancies/19879", `<section class="b-vacancy-header"><h1>Golang</h1><h2>в <a href="/companies/example">Example</a></h2><h3>250 000 —‍ 350 000 ₽/‍мес на руки</h3></section><div class="b-vacancy-locations__group"><span class="tag__title">📍 Россия</span><span class="tag__title">Удалённо</span></div>`, "Example", "Golang", "Россия", "Удалённо", 250000, 350000, "RUB", "month", "net"},
		{"https://hirify.me/jobs/1090398", `<div class="vacancy-header"><div class="company-name">Example</div><h1>Analyst</h1><div class="common-detail-item"><div class="label">Work format</div><div class="value">remote (Global)</div></div><div class="common-detail-item"><div class="label">Country</div><div class="value">Russia/Kazakhstan</div></div></div><article><h1>Recommendation</h1></article><script type="application/ld+json">{"@type":"JobPosting","title":"Analyst","hiringOrganization":{"name":"Example"},"description":"private text","baseSalary":{"currency":"USD","value":{"minValue":2000,"maxValue":3000,"unitText":"MONTH"}}}</script>`, "Example", "Analyst", "Russia/Kazakhstan", "remote (Global)", 2000, 3000, "USD", "month", ""},
		{"https://www.linkedin.com/jobs/view/123", `<h1 class="top-card-layout__title">Developer</h1><a class="topcard__org-name-link">Example</a><span class="topcard__flavor--bullet">London</span><div class="compensation__salary">$110,000.00/yr - $120,000.00/yr</div>`, "Example", "Developer", "London", "", 110000, 120000, "USD", "year", ""},
		{"https://geekjob.ru/vacancy/abc123", `<article class="vacancy"><h1>Игровой партнёр</h1><h5 class="company-name">Работодатель <a href="/company/123">Soulmate.gg</a></h5><div class="location">Россия</div><span class="jobformat">Релокация • Удаленная работа<br>Опыт работы любой</span><span class="salary">от 40 000 до 60 000 ₽</span></article>`, "Soulmate.gg", "Игровой партнёр", "Россия", "Релокация, Удаленная работа", 40000, 60000, "RUB", "", ""},
		{"https://career.habr.com/vacancies/1000168817", `<div class="vacancy-header"><h1 class="page-title__title">Data Engineer</h1><div class="basic-salary">от 270 000 до 285 000 ₽</div><div class="vacancy-meta"><div class="basic-chip">Можно удалённо</div></div></div><div class="company_name"><a>Top Selection</a></div><script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"name":"Top Selection"},"jobLocation":{"address":{"addressLocality":"Москва"}},"description":"private text"}</script>`, "Top Selection", "Data Engineer", "Москва", "Можно удалённо", 270000, 285000, "RUB", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.url, func(t *testing.T) {
			p, err := Parse(strings.NewReader(tc.html), tc.url)
			if err != nil {
				t.Fatal(err)
			}
			f := p.Fields
			if f.Company != tc.company || f.Position != tc.position || f.Location != tc.location || f.WorkFormat != tc.format {
				t.Fatalf("unexpected fields: %+v", f)
			}
			if f.Salary == nil || f.Salary.Min == nil || f.Salary.Max == nil || *f.Salary.Min != tc.min || *f.Salary.Max != tc.max || f.Salary.Currency != tc.currency || f.Salary.Period != tc.period || f.Salary.Tax != tc.tax {
				t.Fatalf("unexpected salary: %+v", f.Salary)
			}
			b, _ := json.Marshal(p)
			if strings.Contains(string(b), "private") || strings.Contains(string(b), "Recommendation") {
				t.Fatal(string(b))
			}
		})
	}
}

func TestPartialAndStructuredMetadata(t *testing.T) {
	p, err := Parse(strings.NewReader(`<h1 data-qa="vacancy-title">Role</h1><script type="application/ld+json">broken</script><script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["Thing","JobPosting"],"baseSalary":{"currency":"RUR","value":{"minValue":0}},"hiringOrganization":{"logo":{"url":"/logo.png"}}}]}</script>`), "https://hh.ru/vacancy/123")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(p.Fields)
	var fields map[string]any
	json.Unmarshal(raw, &fields)
	if fields["company"] != nil || fields["location"] != nil || p.Fields.CompanyLogo != "https://hh.ru/logo.png" {
		t.Fatal(string(raw))
	}
	if !reflect.DeepEqual(fields["salary"], map[string]any{"min": float64(0), "currency": "RUB"}) {
		t.Fatal(string(raw))
	}
	for _, html := range []string{`<h1>Войти</h1><form><input type="password"></form>`, `<title>CAPTCHA</title><h1>Проверка</h1>`, `<script type="application/ld+json">{"@type":"JobPosting","url":"https://hh.ru/vacancy/999","title":"Wrong job"}</script>`} {
		if _, err := Parse(strings.NewReader(html), "https://hh.ru/vacancy/123"); !errors.Is(err, ErrNoData) {
			t.Fatalf("expected no data: %v", err)
		}
	}
}

func TestPreviewURLs(t *testing.T) {
	for _, raw := range []string{"http://hh.ru/vacancy/123", "https://user:pass@hh.ru/vacancy/123", "https://hh.ru:443/vacancy/123", "https://evilhh.ru/vacancy/123", "https://hh.ru.evil.com/vacancy/123", "https://hh.ru/", "https://hh.ru/search/vacancy", "https://127.0.0.1/vacancy/123"} {
		if u, _ := core.VacancyPreviewURL(raw); u != "" {
			t.Fatalf("accepted %s", raw)
		}
	}
	canonical, _ := core.VacancyPreviewURL(" https://spb.hh.ru/vacancy/123?from=search ")
	if canonical != "https://hh.ru/vacancy/123" {
		t.Fatal(canonical)
	}
	canonical, _ = core.VacancyPreviewURL("https://www.linkedin.com/jobs/search/?currentJobId=123")
	if canonical != "https://www.linkedin.com/jobs/view/123" {
		t.Fatal(canonical)
	}
}

func TestNetworkGuards(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "0.0.0.0", "198.18.0.1", "64:ff9b::7f00:1"} {
		if publicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("accepted %s", raw)
		}
	}
	for _, raw := range []string{"8.8.8.8", "2606:4700:4700::1111"} {
		if !publicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("rejected %s", raw)
		}
	}
	via := []*http.Request{{URL: mustURL("https://hh.ru/vacancy/123")}}
	for _, raw := range []string{"http://hh.ru/vacancy/123", "https://evil.com/vacancy/123", "https://hh.ru/account/login", "https://hh.ru/vacancy/999", "https://getmatch.ru/vacancies/123", "https://127.0.0.1/"} {
		if redirect(&http.Request{URL: mustURL(raw)}, via) == nil {
			t.Fatalf("accepted redirect %s", raw)
		}
	}
	if err := redirect(&http.Request{URL: mustURL("https://spb.hh.ru/vacancy/123?from=other")}, via); err != nil {
		t.Fatal(err)
	}
	if redirect(&http.Request{URL: via[0].URL}, []*http.Request{via[0], via[0], via[0], via[0]}) == nil {
		t.Fatal("redirect limit")
	}
	if _, err := safeDial(context.Background(), "tcp", "127.0.0.1:443"); err == nil {
		t.Fatal("dialed loopback")
	}
}
func mustURL(raw string) *url.URL { u, _ := url.Parse(raw); return u }

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestFetchFailuresAndSuccess(t *testing.T) {
	for _, tc := range []struct {
		name              string
		status            int
		contentType, body string
		length            int64
		wantErr           bool
	}{
		{"success", 200, "text/html", `<h1 data-qa="vacancy-title">Role</h1>`, -1, false},
		{"missing", 404, "text/html", "", 0, true}, {"blocked", 403, "text/html", "", 0, true},
		{"json", 200, "application/json", `{}`, 2, true}, {"login", 200, "text/html", "<h1>Login</h1>", -1, true},
		{"oversized-header", 200, "text/html", "", maxBody + 1, true},
		{"oversized-stream", 200, "text/html", strings.Repeat("a", maxBody+1), -1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
					t.Fatal("credentials forwarded")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": []string{tc.contentType}}, Body: io.NopCloser(strings.NewReader(tc.body)), ContentLength: tc.length, Request: r}, nil
			})}
			_, err := fetch(context.Background(), client, "https://hh.ru/vacancy/123")
			if (err != nil) != tc.wantErr {
				t.Fatalf("unexpected error %v", err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := fetch(ctx, &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })}, "https://hh.ru/vacancy/123")
	if err == nil {
		t.Fatal("cancellation ignored")
	}
}
