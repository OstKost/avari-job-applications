package core

import "database/sql"

type AIArchive struct {
	Skills   []Skill   `json:"skills"`
	Profiles []Profile `json:"profiles"`
	Context  string    `json:"context"`
}

func exportAITx(tx *sql.Tx, user string) (*AIArchive, error) {
	all, e := skillsTx(tx, user)
	if e != nil {
		return nil, e
	}
	apps, e := list[Application](tx, user, "application")
	if e != nil {
		return nil, e
	}
	used := map[string]bool{}
	hasAI := false
	for _, a := range apps {
		if a.AI != nil {
			hasAI = true
			for _, ref := range a.AI.Skills {
				used[ref.ID] = true
			}
		}
	}
	skills := []Skill{}
	for _, s := range all {
		if !s.Base || s.Level != nil || len(s.Aliases) > 0 || used[s.ID] {
			skills = append(skills, s)
		}
	}
	profiles, e := list[Profile](tx, user, "profile")
	if e != nil {
		return nil, e
	}
	text, e := candidateContextTx(tx, user)
	if e != nil {
		return nil, e
	}
	if !hasAI && len(skills) == 0 && len(profiles) == 0 && text == "" {
		return nil, nil
	}
	return &AIArchive{Skills: skills, Profiles: profiles, Context: text}, nil
}
func validateAIArchive(j Journal) error {
	if j.AI == nil {
		return nil
	}
	if len(j.AI.Skills) > 5000 || len(j.AI.Profiles) > 3 || textLength(j.AI.Context) > 10000 {
		return Fail(400, "Превышены лимиты ИИ-данных")
	}
	seen := map[string]bool{}
	for _, s := range j.AI.Skills {
		if validSkill(s.SkillRef) != nil || s.ID == "" || len(s.ID) > 128 || seen[s.ID] || len(s.Aliases) > 100 {
			return Fail(400, "Некорректный каталог навыков")
		}
		seen[s.ID] = true
		if s.Level != nil && (*s.Level < 0 || *s.Level > 10) {
			return Fail(400, "Некорректная оценка навыка")
		}
		for _, a := range s.Aliases {
			if skillName(a) == "" || textLength(a) > 100 {
				return Fail(400, "Некорректный синоним")
			}
		}
	}
	apps := map[string]bool{}
	for _, a := range j.Applications {
		apps[a.ID] = true
	}
	seen = map[string]bool{}
	for _, p := range j.AI.Profiles {
		if validateProfile(p) != nil || p.ID == "" || seen[p.ID] {
			return Fail(400, "Некорректный профиль")
		}
		seen[p.ID] = true
		for _, id := range p.ApplicationIDs {
			if !apps[id] {
				return Fail(400, "Профиль ссылается на отсутствующую вакансию")
			}
		}
	}
	return nil
}

// Called only within the import transaction. Current skills/levels/profiles win.
func importAITx(tx *sql.Tx, user string, j Journal, appMap map[string]string, report *ImportReport) error {
	if j.AI == nil {
		return nil
	}
	for _, skill := range j.AI.Skills {
		ref, e := resolveSkill(tx, user, skill.SkillRef)
		if e != nil {
			return e
		}
		if _, e = tx.Exec("INSERT OR IGNORE INTO skill_levels(user_id,skill_id,level) VALUES(?,?,?)", user, ref.ID, skill.Level); e != nil {
			return e
		}
		for _, alias := range skill.Aliases {
			if _, e = tx.Exec("INSERT OR IGNORE INTO skill_aliases(user_id,alias,skill_id) VALUES(?,?,?)", user, skillName(alias), ref.ID); e != nil {
				return e
			}
		}
	}
	profiles, e := list[Profile](tx, user, "profile")
	if e != nil {
		return e
	}
	count := len(profiles)
	var instance string
	if e = tx.QueryRow("SELECT value FROM instance_metadata WHERE key='transfer_source'").Scan(&instance); e != nil {
		return e
	}
	nativeOrigins := map[string]string{}
	for _, p := range profiles {
		nativeOrigins[originFor(instance, user, "profile", p.ID)] = p.ID
	}
	for _, p := range j.AI.Profiles {
		p.ApplicationIDs = append([]string{}, p.ApplicationIDs...)
		origin := j.Origins[originKey("profile", p.ID)]
		if origin == "" {
			origin = digest([]string{"profile", p.ID})
		}
		var existing string
		e := tx.QueryRow("SELECT target_id FROM import_origins WHERE user_id=? AND kind='profile' AND origin=?", user, origin).Scan(&existing)
		if e == nil {
			continue
		}
		if !isNoRows(e) {
			return e
		}
		if nativeOrigins[origin] != "" {
			continue
		}
		if count >= 3 {
			report.Conflicts = append(report.Conflicts, "Профиль «"+p.Title+"» пропущен: уже есть три направления")
			continue
		}
		p.ID = ID()
		p.Version = 1
		p.UpdatedAt = now()
		for i, id := range p.ApplicationIDs {
			p.ApplicationIDs[i] = appMap[id]
		}
		if e = put(tx, user, "profile", p.ID, p); e != nil {
			return e
		}
		existing = p.ID
		count++

		if _, e = tx.Exec("INSERT OR IGNORE INTO import_origins(user_id,kind,origin,target_id) VALUES(?,'profile',?,?)", user, origin, existing); e != nil {
			return e
		}
	}
	text, e := candidateContextTx(tx, user)
	if e != nil {
		return e
	}
	if text == "" && j.AI.Context != "" {
		if e = put(tx, user, "candidate_context", "candidate-context-"+user, map[string]string{"text": j.AI.Context}); e != nil {
			return e
		}
	}
	return nil
}
