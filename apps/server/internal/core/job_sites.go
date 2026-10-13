package core

import (
	"net/url"
	"regexp"
	"strings"
)

var linkedinPath = regexp.MustCompile(`^/jobs/view/(?:[^/]+-)?(\d+)/?$`)
var getmatchPath = regexp.MustCompile(`^/vacancies/(\d+)(?:-[^/]+)?/?$`)
var hirifyPath = regexp.MustCompile(`^/jobs/(\d+)(?:-[^/]+)?/?$`)
var geekjobPath = regexp.MustCompile(`^/vacancy/([a-zA-Z0-9]+)/?$`)
var habrPath = regexp.MustCompile(`^/vacancies/(\d+)/?$`)
var linkedinSelectionPath = regexp.MustCompile(`^/jobs/(?:search|search-results|collections)(?:/|$)`)

func jobSiteURL(u *url.URL) string {
	if u == nil || u.User != nil || u.Port() != "" || !oneOf(u.Scheme, "http", "https") {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	for _, domain := range []string{"hh.ru", "linkedin.com", "getmatch.ru", "hirify.me", "geekjob.ru", "career.habr.com"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return domain
		}
	}
	return ""
}

func canonicalJobURL(u *url.URL) (string, string) {
	site := jobSiteURL(u)
	var pattern *regexp.Regexp
	var prefix string
	switch site {
	case "hh.ru":
		pattern, prefix = hhPath, "https://hh.ru/vacancy/"
	case "linkedin.com":
		pattern, prefix = linkedinPath, "https://www.linkedin.com/jobs/view/"
	case "getmatch.ru":
		pattern, prefix = getmatchPath, "https://getmatch.ru/vacancies/"
	case "hirify.me":
		pattern, prefix = hirifyPath, "https://hirify.me/jobs/"
	case "geekjob.ru":
		pattern, prefix = geekjobPath, "https://geekjob.ru/vacancy/"
	case "career.habr.com":
		pattern, prefix = habrPath, "https://career.habr.com/vacancies/"
	default:
		return "", ""
	}
	id := ""
	if match := pattern.FindStringSubmatch(u.Path); len(match) > 0 {
		id = match[1]
	}
	if id == "" && site == "linkedin.com" && linkedinSelectionPath.MatchString(u.Path) && hhIDPattern.MatchString(u.Query().Get("currentJobId")) {
		id = u.Query().Get("currentJobId")
	}
	if id == "" {
		return "", ""
	}
	return prefix + id, site
}

func trackedJobURL(raw string) string {
	u, e := url.Parse(raw)
	if e != nil {
		return ""
	}
	canonical, _ := canonicalJobURL(u)
	return canonical
}

func jobResponsesSite(u *url.URL) string {
	site := jobSiteURL(u)
	if site == "hh.ru" && (u.Path == "/applicant/negotiations" || u.Path == "/applicant/negotiations/") {
		return site
	}
	if (site == "getmatch.ru" || site == "hirify.me") && (u.Path == "/applications" || u.Path == "/applications/") {
		return site
	}
	return ""
}
