package vacancy

import (
	"encoding/json"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/PuerkitoBio/goquery"
)

var invisible = strings.NewReplacer("\u200b", "", "\u200c", "", "\u200d", "", "\ufeff", "")

func clean(s string) string { return strings.Join(strings.Fields(invisible.Replace(s)), " ") }
func bounded(s string) string {
	r := []rune(clean(s))
	if len(r) > 500 {
		r = r[:500]
	}
	return string(r)
}
func text(doc *goquery.Document, selectors ...string) string {
	for _, selector := range selectors {
		var value string
		doc.Find(selector).EachWithBreak(func(_ int, node *goquery.Selection) bool {
			if node.Closest(`[hidden], [aria-hidden="true"]`).Length() > 0 {
				return true
			}
			clone := node.Clone()
			clone.Find("script,style,[hidden],[aria-hidden='true']").Remove()
			value = bounded(clone.Text())
			return value == ""
		})
		if value != "" {
			return value
		}
	}
	return ""
}

type selectors struct{ position, company, location, salary, format []string }

var sites = map[string]selectors{
	"hh.ru": {
		position: []string{`[data-qa="vacancy-title"]`, "h1"},
		company:  []string{`[data-qa="vacancy-company-name"]`, `[data-qa="vacancy-company-name-wrapper"]`},
		location: []string{`[data-qa="vacancy-view-raw-address"]`, `[data-qa="vacancy-view-location"]`, `[data-qa="vacancy-view-location-name"]`},
		salary:   []string{`[data-qa="vacancy-salary"]`, `[data-qa="vacancy-salary-compensation-type-net"]`, `[data-qa="vacancy-salary-compensation-type-gross"]`},
		format:   []string{`[data-qa="work-formats-text"]`, `[data-qa="vacancy-work-format"]`, `[data-qa="vacancy-work-schedule"]`},
	},
	"linkedin.com": {
		position: []string{".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", ".top-card-layout__title"},
		company:  []string{".job-details-jobs-unified-top-card__company-name", ".topcard__org-name-link"},
		location: []string{".job-details-jobs-unified-top-card__primary-description-container .tvm__text:first-child", ".topcard__flavor--bullet"},
		salary:   []string{".salary.compensation__salary", ".compensation__salary"},
	},
	"getmatch.ru": {
		position: []string{".b-vacancy-header h1"}, company: []string{`.b-vacancy-header h2 a[href^="/companies/"]`},
		location: []string{".b-vacancy-locations"}, salary: []string{".b-vacancy-header h3"},
	},
	"hirify.me": {position: []string{".vacancy-header h1"}, company: []string{".vacancy-header .company-name"}},
	"geekjob.ru": {
		position: []string{".vacancy h1", "h1"}, company: []string{".vacancy .company-name a[href*='/company/']", ".company-name a", ".vacancy .company-name"},
		location: []string{".vacancy .location"}, salary: []string{".vacancy .salary", ".serp-list .salary"},
	},
	"career.habr.com": {
		position: []string{".page-title__title", ".vacancy-header__title h1", "h1"}, company: []string{".company_name a[href*='/companies/']", ".company_name", ".company-name"},
		location: []string{".vacancy-header .location", ".basic-section .location"}, salary: []string{".vacancy-header__salary .basic-salary", ".basic-salary", ".vacancy-header__salary"},
	},
}

func str(v any) string         { s, _ := v.(string); return bounded(s) }
func obj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func array(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{v}
}
func structured(doc *goquery.Document, canonical string) map[string]any {
	var found map[string]any
	doc.Find(`script[type="application/ld+json"]`).EachWithBreak(func(_ int, s *goquery.Selection) bool {
		var v any
		if json.Unmarshal([]byte(s.Text()), &v) != nil {
			return true
		}
		queue := array(v)
		for len(queue) > 0 {
			n := obj(queue[0])
			queue = queue[1:]
			if n == nil {
				continue
			}
			for _, kind := range array(n["@type"]) {
				if kind == "JobPosting" {
					if raw, ok := n["url"].(string); ok {
						other, _ := core.VacancyPreviewURL(raw)
						if other != "" && other != canonical {
							continue
						}
					}
					found = n
					return false
				}
			}
			if graph, ok := n["@graph"].([]any); ok {
				queue = append(queue, graph...)
			}
		}
		return true
	})
	return found
}
func number(v any) *float64 {
	n, ok := v.(float64)
	if !ok || n < 0 || math.IsInf(n, 0) || math.IsNaN(n) {
		return nil
	}
	return &n
}
func structuredSalary(job map[string]any) *Salary {
	base := obj(job["baseSalary"])
	if base == nil {
		return nil
	}
	value := obj(base["value"])
	s := &Salary{Min: number(base["value"]), Currency: strings.ToUpper(str(base["currency"]))}
	if s.Currency == "RUR" {
		s.Currency = "RUB"
	}
	if value != nil {
		s.Min = number(value["minValue"])
		if s.Min == nil {
			s.Min = number(value["value"])
		}
		s.Max = number(value["maxValue"])
		s.Period = map[string]string{"HOUR": "hour", "MONTH": "month", "YEAR": "year"}[strings.ToUpper(str(value["unitText"]))]
	}
	if s.Min == nil && s.Max == nil && s.Currency == "" && s.Period == "" {
		return nil
	}
	return s
}

var workFormat = regexp.MustCompile(`(?i)удален|удалён|гибрид|офис|релокац|remote|hybrid|onsite|on-site|relocation`)

var amounts = regexp.MustCompile(`\d+(?:[ .,]\d{3})*(?:[.,]\d{1,2})?`)

func salaryText(raw string) *Salary {
	raw = strings.ToLower(clean(raw))
	s := &Salary{}
	for _, c := range []struct {
		code  string
		words []string
	}{{"RUB", []string{"₽", "руб", "rur", "rub"}}, {"USD", []string{"$", "usd"}}, {"EUR", []string{"€", "eur"}}, {"KZT", []string{"₸", "kzt", "тенге"}}} {
		for _, word := range c.words {
			if strings.Contains(raw, word) {
				s.Currency = c.code
				break
			}
		}
		if s.Currency != "" {
			break
		}
	}
	// Restrict numbers to the salary portion, excluding durations and other header metadata.
	part := raw
	for _, marker := range []string{" за ", " в месяц", "/month", "/year", "/hour", " per ", " на руки", " до вычета", " before tax", " after tax"} {
		if i := strings.Index(part, marker); i >= 0 {
			part = part[:i]
		}
	}
	matches := amounts.FindAllString(part, 2)
	nums := []float64{}
	for _, m := range matches {
		normalized := strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, m)
		last := strings.LastIndexAny(normalized, ",.")
		if last >= 0 && len(normalized)-last-1 <= 2 {
			whole := strings.ReplaceAll(strings.ReplaceAll(normalized[:last], ",", ""), ".", "")
			normalized = whole + "." + normalized[last+1:]
		} else {
			normalized = strings.ReplaceAll(strings.ReplaceAll(normalized, ",", ""), ".", "")
		}

		n, err := strconv.ParseFloat(normalized, 64)
		if err == nil {
			nums = append(nums, n)
		}
	}
	if len(nums) == 0 {
		return nil
	}
	if len(nums) > 1 {
		s.Min = &nums[0]
		s.Max = &nums[1]
	} else if strings.HasPrefix(part, "до ") || strings.Contains(part, "up to") {
		s.Max = &nums[0]
	} else {
		s.Min = &nums[0]
		if !strings.HasPrefix(part, "от ") && !strings.Contains(part, "from ") {
			s.Max = &nums[0]
		}
	}
	switch {
	case strings.Contains(raw, "за проект"):
		s.Period = "project"
	case strings.Contains(raw, "час") || strings.Contains(raw, "hour") || strings.Contains(raw, "/hr"):
		s.Period = "hour"
	case strings.Contains(raw, "год") || strings.Contains(raw, "year") || strings.Contains(raw, "/yr"):
		s.Period = "year"
	case strings.Contains(raw, "мес") || strings.Contains(raw, "month"):
		s.Period = "month"
	}
	if strings.Contains(raw, "на руки") || strings.Contains(raw, "after tax") || strings.Contains(raw, "net") {
		s.Tax = "net"
	} else if strings.Contains(raw, "до вычета") || strings.Contains(raw, "before tax") || strings.Contains(raw, "gross") {
		s.Tax = "gross"
	}
	return s
}

func Parse(reader io.Reader, canonical string) (Preview, error) {
	_, site := core.VacancyPreviewURL(canonical)
	sel, ok := sites[site]
	if !ok {
		return Preview{}, ErrNoData
	}
	doc, err := goquery.NewDocumentFromReader(reader)
	if err != nil {
		return Preview{}, ErrNoData
	}
	job := structured(doc, canonical)
	org := obj(job["hiringOrganization"])
	f := Fields{Company: text(doc, sel.company...), Position: text(doc, sel.position...), Location: text(doc, sel.location...), WorkFormat: text(doc, sel.format...), Salary: structuredSalary(job)}
	if f.Company == "" {
		f.Company = str(org["name"])
	}
	if f.Position == "" {
		f.Position = str(job["title"])
	}
	if f.Location == "" {
		locations := []string{}
		for _, item := range array(job["jobLocation"]) {
			if loc := str(obj(obj(item)["address"])["addressLocality"]); loc != "" {
				locations = append(locations, loc)
			}
		}
		f.Location = bounded(strings.Join(locations, ", "))
	}
	f.WorkFormat = strings.TrimSpace(strings.TrimPrefix(f.WorkFormat, "Формат работы:"))
	if f.WorkFormat == "" && job["jobLocationType"] == "TELECOMMUTE" {
		f.WorkFormat = "Удалённо"
	}
	if site == "hirify.me" {
		doc.Find(".vacancy-header .common-detail-item").Each(func(_ int, row *goquery.Selection) {
			label := strings.ToLower(clean(row.Find(".label").Text()))
			value := bounded(row.Find(".value").Text())
			if value == "" {
				return
			}
			if label == "локация" || label == "location" || label == "страна" || label == "country" {
				f.Location = value
			}
			if label == "формат работы" || label == "work format" {
				f.WorkFormat = value
			}
		})
	}
	if site == "getmatch.ru" {
		locations, formats := []string{}, []string{}
		doc.Find(".b-vacancy-locations__group [class*='__title']").Each(func(_ int, tag *goquery.Selection) {
			if tag.Closest("[hidden],[aria-hidden='true']").Length() > 0 {
				return
			}
			value := clean(tag.Text())
			if strings.HasPrefix(value, "📍") {
				locations = append(locations, strings.TrimSpace(strings.TrimPrefix(value, "📍")))
			}
			if workFormat.MatchString(value) {
				formats = append(formats, value)
			}
		})
		if len(locations) > 0 {
			f.Location = bounded(strings.Join(locations, ", "))
		}
		if len(formats) > 0 {
			f.WorkFormat = bounded(strings.Join(formats, ", "))
		}
	}
	if site == "career.habr.com" || site == "geekjob.ru" {
		selector := ".vacancy-meta .basic-chip, .basic-chip"
		if site == "geekjob.ru" {
			selector = ".vacancy .jobformat"
		}
		formats := []string{}
		doc.Find(selector).Each(func(_ int, chip *goquery.Selection) {
			if chip.Closest("[hidden],[aria-hidden='true']").Length() > 0 {
				return
			}
			copy := chip.Clone()
			copy.Find("br").ReplaceWithHtml("\n")
			for _, part := range strings.FieldsFunc(copy.Text(), func(r rune) bool { return r == '•' || r == '\n' || r == ',' }) {
				if value := clean(part); workFormat.MatchString(value) {
					formats = append(formats, value)
				}
			}
		})
		if len(formats) > 0 {
			f.WorkFormat = bounded(strings.Join(formats, ", "))
		}
	}
	if raw := text(doc, sel.salary...); raw != "" {
		if parsed := salaryText(raw); parsed != nil {
			if f.Salary == nil {
				f.Salary = parsed
			} else {
				if parsed.Min != nil {
					f.Salary.Min = parsed.Min
				}
				if parsed.Max != nil {
					f.Salary.Max = parsed.Max
				}
				if parsed.Currency != "" {
					f.Salary.Currency = parsed.Currency
				}
				if parsed.Period != "" {
					f.Salary.Period = parsed.Period
				}
				if parsed.Tax != "" {
					f.Salary.Tax = parsed.Tax
				}
			}
		}
	}
	rawLogo, _ := org["logo"].(string)
	if rawLogo == "" {
		rawLogo, _ = obj(org["logo"])["url"].(string)
	}
	f.CompanyLogo = logoURL(rawLogo, canonical)
	if rawLogo == "" {
		f.CompanyLogo = ""
	}
	if f.CompanyLogo == "" {
		doc.Find(`[data-qa="vacancy-company-logo"] img, .vacancy-company-logo img, .job-details-jobs-unified-top-card__company-logo img, .topcard__org-name-link img, .b-vacancy-header img, .company-logo img, .company_logo img, .vacancy-header img`).EachWithBreak(func(_ int, img *goquery.Selection) bool {
			for _, attr := range []string{"data-src", "data-lazy-src", "data-original", "src"} {
				if raw, exists := img.Attr(attr); exists && raw != "" {
					if logo := logoURL(raw, canonical); logo != "" {
						f.CompanyLogo = logo
						return false
					}
				}
			}
			return true
		})
	}
	// Generic login/challenge headings must never be mistaken for a vacancy title.
	if f.Company == "" && job == nil && (site == "hh.ru" || site == "geekjob.ru" || site == "career.habr.com") && text(doc, sel.position[0]) == "" {
		return Preview{}, ErrNoData
	}
	if f.Company == "" && f.Position == "" {
		return Preview{}, ErrNoData
	}
	return Preview{URL: canonical, Fields: f}, nil
}
