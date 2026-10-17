package core

import (
	"database/sql"
	"net/url"
	"regexp"
	"time"
)

var hhFavoriteList = regexp.MustCompile(`^/(?:applicant/(?:vacancies|favorites?)|search/vacancy)/?$`)

var hhIDPattern = regexp.MustCompile(`^\d+$`)

func recommend(a Application, status string) map[string]any {
	if status == "favorite" {
		return map[string]any{"favorite": true}
	}
	out := map[string]any{"externalStatus": status}
	stages := []string{"saved", "applied", "hr", "interview", "final", "offer"}
	rank := func(s string) int {
		for i, v := range stages {
			if s == v {
				return i
			}
		}
		return 0
	}
	target := ""
	switch status {
	case "applied", "waiting", "viewed":
		target = "applied"
	case "invited":
		target = "hr"
	case "interview":
		target = "interview"
	case "hr", "final", "offer":
		target = status
	case "rejected":
		if a.State != "closed" {
			out["state"] = "closed"
			out["outcome"] = "employer_rejected"
		}
	case "vacancy_closed":
		if a.State != "closed" {
			out["state"] = "closed"
			out["outcome"] = "vacancy_closed"
		}
	}
	if a.State != "closed" && target != "" && rank(target) > rank(a.Stage) {
		out["stage"] = target
	}
	return out
}
func (s *Store) Observe(user string, o Observation) (*Proposal, error) {
	if o.Status == "" || len(o.Status) > 200 || (o.VacancyURL == "" && !hhIDPattern.MatchString(o.HHID)) {
		return nil, Fail(400, "Укажите ID вакансии и обнаруженное состояние")
	}
	u, urlID, e := NormalizeURL(o.URL)
	if e != nil {
		return nil, e
	}
	parsed, _ := url.Parse(u)
	original, _ := url.Parse(o.URL)
	if original == nil || original.Scheme != "https" || jobSiteURL(original) == "" {
		return nil, Fail(400, "Наблюдение должно относиться к странице поддерживаемого сайта")
	}
	lookupURL := ""
	if o.VacancyURL != "" {
		lookupURL = trackedJobURL(o.VacancyURL)
		vacancy, _ := url.Parse(lookupURL)
		matchesCard := lookupURL != "" && lookupURL == trackedJobURL(o.URL)
		matchesList := jobResponsesSite(original) != "" && jobResponsesSite(original) == jobSiteURL(vacancy)
		matchesList = matchesList || (o.Status == "favorite" && jobFavoritesSite(original) != "" && jobFavoritesSite(original) == jobSiteURL(vacancy))
		if lookupURL == "" || (!matchesCard && !matchesList) || o.HHID != "" {
			return nil, Fail(400, "Ссылка вакансии не соответствует странице наблюдения")
		}
		o.VacancyURL = lookupURL
	} else {
		if jobSiteURL(parsed) != "hh.ru" || urlID != "" && urlID != o.HHID || urlID == "" && parsed.Path != "/applicant/negotiations" && parsed.Path != "/applicant/negotiations/" && !(o.Status == "favorite" && hhFavoriteList.MatchString(parsed.Path)) {
			return nil, Fail(400, "Наблюдение hh.ru должно соответствовать вакансии или списку откликов")
		}
		lookupURL = "https://hh.ru/vacancy/" + o.HHID
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	o.URL = parsed.String()
	var result *Proposal
	e = s.transaction(func(tx *sql.Tx) error {
		applications, e := list[Application](tx, user, "application")
		if e != nil {
			return e
		}
		var a Application
		for _, candidate := range applications {
			if trackedJobURL(candidate.URL) == lookupURL {
				a = candidate
				break
			}
		}
		if a.ID == "" {
			if o.Candidate == nil || (o.Status != "favorite" && jobResponsesSite(original) != "hh.ru") {
				return nil
			}
			candidate := Application{Company: o.Candidate.Company, Position: o.Candidate.Position, URL: lookupURL, AppliedDate: o.Candidate.AppliedDate, SavedDate: localDate(tx, user), Stage: "applied", State: "active", Salary: Salary{Currency: "RUB", Period: "month"}, Custom: map[string]any{}}
			if o.Status == "favorite" {
				candidate.Stage, candidate.AppliedDate, candidate.Favorite = "saved", "", true
				candidate.Salary, candidate.Location, candidate.WorkFormat, candidate.CompanyLogo = o.Candidate.Salary, o.Candidate.Location, o.Candidate.WorkFormat, o.Candidate.CompanyLogo
			}
			if o.Status != "favorite" && !recentResponseDate(candidate.AppliedDate, candidate.SavedDate) {
				return nil
			}
			if e = candidate.Validate(); e != nil {
				return e
			}
			proposals, e := list[Proposal](tx, user, "proposal")
			if e != nil {
				return e
			}
			for _, p := range proposals {
				if p.Kind == "create" && trackedJobURL(p.Current.URL) == lookupURL && (p.DetectedStatus == "favorite") == (o.Status == "favorite") {
					if p.Status == "pending" && p.DetectedStatus != o.Status {
						p.Current, p.DetectedStatus, p.Changes = candidate, o.Status, creationChanges(candidate, o.Status)
						return put(tx, user, "proposal", p.ID, p)
					}
					return nil
				}
			}
			o.ID, o.CreatedAt = ID(), now()
			o.Candidate = &candidate
			if e = put(tx, user, "observation", o.ID, o); e != nil {
				return e
			}
			updates := creationChanges(candidate, o.Status)
			p := Proposal{ID: ID(), Kind: "create", ObservationID: o.ID, Status: "pending", DetectedStatus: o.Status, URL: o.URL, Current: candidate, Changes: updates, CreatedAt: now(), Source: "extension"}
			if e = put(tx, user, "proposal", p.ID, p); e != nil {
				return e
			}
			result = &p
			return nil
		}
		appID := a.ID
		if o.Status != "favorite" {
			var lastRaw string
			e = tx.QueryRow("SELECT payload FROM documents WHERE user_id=? AND kind='observation' AND json_extract(payload,'$.applicationId')=? AND (json_extract(payload,'$.status')='favorite')=? ORDER BY created_at DESC,id DESC LIMIT 1", user, appID, false).Scan(&lastRaw)
			if e == nil {
				var last Observation
				if e = decode(lastRaw, &last); e != nil {
					return e
				}
				if last.Status == o.Status {
					return nil
				}
			} else if e != sql.ErrNoRows {
				return e
			}
		}
		proposals, e := list[Proposal](tx, user, "proposal")
		if e != nil {
			return e
		}
		for _, p := range proposals {
			if p.Status == "pending" && p.ApplicationID == appID && p.DetectedStatus == o.Status {
				return nil
			}
		}
		o.ID = ID()
		o.ApplicationID = appID
		o.CreatedAt = now()
		if e = put(tx, user, "observation", o.ID, o); e != nil {
			return e
		}
		if (o.Status == "favorite" && a.Favorite) || (o.Status != "favorite" && a.ExternalStatus == o.Status) {
			return nil
		}
		p := Proposal{ID: ID(), ApplicationID: appID, ObservationID: o.ID, Status: "pending", DetectedStatus: o.Status, URL: o.URL, Current: a, Changes: recommend(a, o.Status), CreatedAt: now(), Source: "extension"}
		if _, ok := p.Changes["stage"]; ok && a.AppliedDate == "" {
			p.Changes["appliedDate"] = localDate(tx, user)
		}
		if e = put(tx, user, "proposal", p.ID, p); e != nil {
			return e
		}
		result = &p
		return nil
	})
	return result, e
}
func (s *Store) ResolveProposal(user, id, action string, version int, patch map[string]any) (Proposal, error) {
	var result Proposal
	e := s.transaction(func(tx *sql.Tx) error {
		p, e := get[Proposal](tx, user, "proposal", id)
		if e != nil {
			return e
		}
		if p.Status != "pending" {
			result = p
			return nil
		}
		if action == "dismiss" {
			p.Status = "dismissed"
			if e = put(tx, user, "proposal", p.ID, p); e != nil {
				return e
			}
			result = p
			return nil
		}
		if action != "apply" {
			return Fail(400, "Неизвестное действие")
		}
		if p.Kind == "create" {
			applications, e := list[Application](tx, user, "application")
			if e != nil {
				return e
			}
			for _, existing := range applications {
				if trackedJobURL(existing.URL) == trackedJobURL(p.Current.URL) {
					updates := map[string]any{}
					if p.DetectedStatus == "favorite" || (existing.Favorite && existing.Stage == "saved") {
						updates = recommend(existing, p.DetectedStatus)
					}
					if len(updates) > 0 && p.DetectedStatus != "favorite" && existing.AppliedDate == "" && p.Current.AppliedDate != "" {
						updates["appliedDate"] = p.Current.AppliedDate
					}
					out, err := applyPatch(existing, updates)
					if err != nil {
						return err
					}
					if err = out.Validate(); err != nil {
						return err
					}
					if len(changes(existing, out)) > 0 {
						out.Version++
						out.UpdatedAt = now()
						if e = put(tx, user, "application", out.ID, out); e != nil {
							return e
						}
						if e = event(tx, user, out.ID, "proposal", "extension", changes(existing, out)); e != nil {
							return e
						}
					}
					p.Status, p.ApplicationID = "applied", existing.ID
					if e = put(tx, user, "proposal", p.ID, p); e != nil {
						return e
					}
					result = p
					return nil
				}
			}
			if len(applications) >= 1000 {
				return Fail(400, "Достигнут лимит 1000 вакансий")
			}
			updates := p.Changes
			if patch != nil {
				updates = patch
			}
			if p.DetectedStatus != "favorite" {
				updates["externalStatus"] = p.DetectedStatus
			}
			out, e := applyPatch(p.Current, updates)
			if e != nil {
				return e
			}
			out.ID, out.Version, out.CreatedAt, out.UpdatedAt = ID(), 1, now(), now()
			if e = out.Validate(); e != nil {
				return e
			}
			if e = put(tx, user, "application", out.ID, out); e != nil {
				return e
			}
			if e = event(tx, user, out.ID, "created", "extension", changes(Application{}, out)); e != nil {
				return e
			}
			p.Status, p.ApplicationID, p.Changes = "applied", out.ID, updates
			if e = put(tx, user, "proposal", p.ID, p); e != nil {
				return e
			}
			result = p
			return nil
		}
		a, e := get[Application](tx, user, "application", p.ApplicationID)
		if e != nil {
			return e
		}
		if a.Version != version || p.Current.Version != a.Version {
			p.Current = a
			p.Changes = recommend(a, p.DetectedStatus)
			if _, ok := p.Changes["stage"]; ok && a.AppliedDate == "" {
				p.Changes["appliedDate"] = localDate(tx, user)
			}
			result = p
			return &Error{Status: 409, Message: "Запись изменилась. Проверьте новое сравнение", Current: p}
		}
		updates := p.Changes
		if patch != nil {
			updates = patch
		}
		if p.DetectedStatus != "favorite" {
			updates["externalStatus"] = p.DetectedStatus
		}
		out, e := applyPatch(a, updates)
		if e != nil {
			return e
		}
		if e = out.Validate(); e != nil {
			return e
		}
		out.Version++
		out.UpdatedAt = now()
		if e = put(tx, user, "application", out.ID, out); e != nil {
			return e
		}
		if e = event(tx, user, out.ID, "proposal", "extension", changes(a, out)); e != nil {
			return e
		}
		p.Status = "applied"
		p.Changes = updates
		if e = put(tx, user, "proposal", p.ID, p); e != nil {
			return e
		}
		result = p
		return nil
	})
	if err, ok := e.(*Error); ok && err.Status == 409 {
		if saveErr := put(s.DB, user, "proposal", result.ID, result); saveErr != nil {
			return result, saveErr
		}
	}
	return result, e
}

func recentResponseDate(date, today string) bool {
	if !ValidDate(date) || !ValidDate(today) {
		return false
	}
	end, _ := time.Parse("2006-01-02", today)
	start := time.Date(end.Year(), end.Month()-1, 1, 0, 0, 0, 0, time.UTC)
	lastDay := start.AddDate(0, 1, -1).Day()
	day := end.Day()
	if day > lastDay {
		day = lastDay
	}
	start = start.AddDate(0, 0, day-1)
	return date >= start.Format("2006-01-02") && date <= today
}

func creationChanges(candidate Application, status string) map[string]any {
	if status == "favorite" {
		return map[string]any{"favorite": true, "stage": "saved"}
	}
	updates := recommend(candidate, status)
	updates["appliedDate"] = candidate.AppliedDate
	if _, ok := updates["stage"]; !ok {
		updates["stage"] = "applied"
	}
	return updates
}
