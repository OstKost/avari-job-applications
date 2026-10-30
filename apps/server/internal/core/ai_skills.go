package core

import (
	"database/sql"
	"sort"
	"strings"
)

func skillName(s string) string { return canonicalName(strings.TrimPrefix(strings.TrimSpace(s), "#")) }

var baseAliases = map[string]string{"react.js": "react", "reactjs": "react", "golang": "go", "js": "javascript", "ts": "typescript", "postgres": "postgresql", "k8s": "kubernetes", "english": "английский язык", "английский": "английский язык", "communication": "коммуникация", "teamwork": "командная работа"}

func validSkill(v SkillRef) error {
	if skillName(v.Name) == "" || textLength(v.Name) > 100 || !oneOf(v.Category, "hard", "soft", "language") {
		return Fail(400, "Укажите название навыка до 100 символов и категорию hard, soft или language")
	}
	return nil
}
func resolveSkill(tx *sql.Tx, user string, v SkillRef) (SkillRef, error) {
	var out SkillRef
	if e := validSkill(v); e != nil {
		return out, e
	}
	name := skillName(v.Name)
	e := tx.QueryRow(`SELECT s.id,s.name,s.category FROM skill_aliases a JOIN skills s ON s.id=a.skill_id WHERE a.user_id=? AND a.alias=? AND (s.user_id IS NULL OR s.user_id=?)`, user, name, user).Scan(&out.ID, &out.Name, &out.Category)
	if e == nil {
		return out, nil
	}
	if e != sql.ErrNoRows {
		return out, e
	}
	if alias := baseAliases[name]; alias != "" {
		name = alias
		e = tx.QueryRow(`SELECT s.id,s.name,s.category FROM skill_aliases a JOIN skills s ON s.id=a.skill_id WHERE a.user_id=? AND a.alias=? AND (s.user_id IS NULL OR s.user_id=?)`, user, name, user).Scan(&out.ID, &out.Name, &out.Category)
		if e == nil {
			return out, nil
		}
		if e != sql.ErrNoRows {
			return out, e
		}
	}
	e = tx.QueryRow("SELECT id,name,category FROM skills WHERE canonical=? AND (user_id=? OR user_id IS NULL) ORDER BY user_id IS NULL LIMIT 1", name, user).Scan(&out.ID, &out.Name, &out.Category)
	if e == nil {
		return out, nil
	}
	if e != sql.ErrNoRows {
		return out, e
	}
	out = SkillRef{ID: ID(), Name: strings.TrimPrefix(strings.TrimSpace(v.Name), "#"), Category: v.Category}
	_, e = tx.Exec("INSERT INTO skills(id,user_id,name,canonical,category) VALUES(?,?,?,?,?)", out.ID, user, out.Name, skillName(out.Name), out.Category)
	return out, e
}
func syncApplicationSkills(tx *sql.Tx, user string, a *Application) error {
	if _, e := tx.Exec("DELETE FROM application_skills WHERE user_id=? AND application_id=?", user, a.ID); e != nil {
		return e
	}
	refs := []SkillRef{}
	seen := map[string]bool{}
	for _, v := range a.AI.Skills {
		ref, e := resolveSkill(tx, user, v)
		if e != nil {
			return e
		}
		if seen[ref.ID] {
			continue
		}
		seen[ref.ID] = true
		if _, e = tx.Exec("INSERT INTO application_skills(user_id,application_id,skill_id) VALUES(?,?,?)", user, a.ID, ref.ID); e != nil {
			return e
		}
		refs = append(refs, ref)
	}
	a.AI.Skills = refs
	return nil
}
func skillsTx(tx *sql.Tx, user string) ([]Skill, error) {
	rows, e := tx.Query(`SELECT s.id,s.name,s.category,s.user_id IS NULL,l.level FROM skills s LEFT JOIN skill_levels l ON l.skill_id=s.id AND l.user_id=? WHERE (s.user_id IS NULL OR s.user_id=?) AND NOT EXISTS(SELECT 1 FROM skill_aliases a WHERE a.user_id=? AND a.alias=s.canonical AND a.skill_id!=s.id) ORDER BY s.name COLLATE NOCASE`, user, user, user)
	if e != nil {
		return nil, e
	}
	out := []Skill{}
	for rows.Next() {
		var v Skill
		v.Aliases = []string{}
		if e = rows.Scan(&v.ID, &v.Name, &v.Category, &v.Base, &v.Level); e != nil {
			rows.Close()
			return nil, e
		}
		out = append(out, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	aliases, e := tx.Query("SELECT skill_id,alias FROM skill_aliases WHERE user_id=? ORDER BY alias", user)
	if e != nil {
		return nil, e
	}
	defer aliases.Close()
	for aliases.Next() {
		var id, a string
		if e = aliases.Scan(&id, &a); e != nil {
			return nil, e
		}
		for i := range out {
			if out[i].ID == id {
				out[i].Aliases = append(out[i].Aliases, a)
			}
		}
	}
	return out, aliases.Err()
}
func (s *Store) Skills(user string) ([]Skill, error) {
	var out []Skill
	e := s.transaction(func(tx *sql.Tx) error { var e error; out, e = skillsTx(tx, user); return e })
	return out, e
}
func (s *Store) SaveSkill(user string, v Skill) (Skill, error) {
	var out Skill
	e := s.transaction(func(tx *sql.Tx) error {
		if e := validSkill(v.SkillRef); e != nil {
			return e
		}
		if v.Level != nil && (*v.Level < 0 || *v.Level > 10) {
			return Fail(400, "Уровень: от 0 до 10")
		}
		if len(v.Aliases) > 100 {
			return Fail(400, "До 100 синонимов")
		}
		if v.ID == "" {
			ref, e := resolveSkill(tx, user, v.SkillRef)
			if e != nil {
				return e
			}
			v.SkillRef = ref
		} else {
			var owner sql.NullString
			var name, category string
			if e := tx.QueryRow("SELECT user_id,name,category FROM skills WHERE id=? AND (user_id=? OR user_id IS NULL)", v.ID, user).Scan(&owner, &name, &category); e != nil {
				if e == sql.ErrNoRows {
					return Fail(404, "Навык не найден")
				}
				return e
			}
			if !owner.Valid {
				if name != v.Name || category != v.Category {
					return Fail(400, "Базовое название нельзя менять; создайте личный навык или синоним")
				}
			} else {
				var count int
				if e := tx.QueryRow("SELECT count(*) FROM skills WHERE id!=? AND canonical=? AND (user_id=? OR user_id IS NULL)", v.ID, skillName(v.Name), user).Scan(&count); e != nil {
					return e
				}
				if count > 0 {
					return Fail(409, "Название уже существует; объедините навыки")
				}
				if name != strings.TrimSpace(v.Name) {
					v.Aliases = append(v.Aliases, name)
				}
				if _, e := tx.Exec("UPDATE skills SET name=?,canonical=?,category=? WHERE id=? AND user_id=?", strings.TrimSpace(v.Name), skillName(v.Name), v.Category, v.ID, user); e != nil {
					return e
				}
			}
		}
		if _, e := tx.Exec("INSERT INTO skill_levels(user_id,skill_id,level) VALUES(?,?,?) ON CONFLICT(user_id,skill_id) DO UPDATE SET level=excluded.level", user, v.ID, v.Level); e != nil {
			return e
		}
		if _, e := tx.Exec("DELETE FROM skill_aliases WHERE user_id=? AND skill_id=?", user, v.ID); e != nil {
			return e
		}
		for _, alias := range v.Aliases {
			alias = skillName(alias)
			if alias == "" || textLength(alias) > 100 {
				return Fail(400, "Синоним: от 1 до 100 символов")
			}
			var other string
			e := tx.QueryRow("SELECT skill_id FROM skill_aliases WHERE user_id=? AND alias=?", user, alias).Scan(&other)
			if e == nil && other != v.ID {
				return Fail(409, "Синоним принадлежит другому навыку")
			}
			if e != nil && e != sql.ErrNoRows {
				return e
			}
			if _, e = tx.Exec("INSERT OR IGNORE INTO skill_aliases(user_id,alias,skill_id) VALUES(?,?,?)", user, alias, v.ID); e != nil {
				return e
			}
		}
		if e := refreshSkillDocuments(tx, user); e != nil {
			return e
		}
		all, e := skillsTx(tx, user)
		for _, x := range all {
			if x.ID == v.ID {
				out = x
			}
		}
		return e
	})
	return out, e
}

// References in the vacancy payload are a read projection; SQL links are authoritative.
func refreshSkillDocuments(tx *sql.Tx, user string) error {
	apps, e := list[Application](tx, user, "application")
	if e != nil {
		return e
	}
	for _, a := range apps {
		if a.AI == nil {
			continue
		}
		rows, e := tx.Query("SELECT s.id,s.name,s.category FROM application_skills a JOIN skills s ON s.id=a.skill_id WHERE a.user_id=? AND a.application_id=? ORDER BY s.name", user, a.ID)
		if e != nil {
			return e
		}
		refs := []SkillRef{}
		for rows.Next() {
			var v SkillRef
			if e = rows.Scan(&v.ID, &v.Name, &v.Category); e != nil {
				rows.Close()
				return e
			}
			refs = append(refs, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		available := map[string]SkillRef{}
		for _, ref := range refs {
			available[ref.ID] = ref
		}
		ordered := []SkillRef{}
		for _, ref := range a.AI.Skills {
			if updated, ok := available[ref.ID]; ok {
				ordered = append(ordered, updated)
				delete(available, ref.ID)
			}
		}
		for _, ref := range refs {
			if _, ok := available[ref.ID]; ok {
				ordered = append(ordered, ref)
				delete(available, ref.ID)
			}
		}
		refs = ordered
		if digest(refs) != digest(a.AI.Skills) {
			a.AI.Skills = refs
			a.Version++
			a.UpdatedAt = now()
			if e = put(tx, user, "application", a.ID, a); e != nil {
				return e
			}
		}
	}
	return nil
}
func (s *Store) MergeSkills(user, source, target string, level *int) error {
	if source == target {
		return Fail(400, "Выберите разные навыки")
	}
	if level != nil && (*level < 0 || *level > 10) {
		return Fail(400, "Уровень: от 0 до 10")
	}
	return s.transaction(func(tx *sql.Tx) error {
		var from, to SkillRef
		for id, dest := range map[string]*SkillRef{source: &from, target: &to} {
			if e := tx.QueryRow("SELECT id,name,category FROM skills WHERE id=? AND (user_id=? OR user_id IS NULL)", id, user).Scan(&dest.ID, &dest.Name, &dest.Category); e != nil {
				if e == sql.ErrNoRows {
					return Fail(404, "Навык не найден")
				}
				return e
			}
		}
		// Caller explicitly supplies the desired final level, including null (unassessed).
		if _, e := tx.Exec("INSERT INTO skill_levels(user_id,skill_id,level) VALUES(?,?,?) ON CONFLICT(user_id,skill_id) DO UPDATE SET level=excluded.level", user, target, level); e != nil {
			return e
		}
		if _, e := tx.Exec("INSERT OR IGNORE INTO application_skills SELECT user_id,application_id,? FROM application_skills WHERE user_id=? AND skill_id=?", target, user, source); e != nil {
			return e
		}
		if _, e := tx.Exec("DELETE FROM application_skills WHERE user_id=? AND skill_id=?", user, source); e != nil {
			return e
		}
		if _, e := tx.Exec("UPDATE skill_aliases SET skill_id=? WHERE user_id=? AND skill_id=?", target, user, source); e != nil {
			return e
		}
		if _, e := tx.Exec("INSERT INTO skill_aliases(user_id,alias,skill_id) VALUES(?,?,?) ON CONFLICT(user_id,alias) DO UPDATE SET skill_id=excluded.skill_id", user, skillName(from.Name), target); e != nil {
			return e
		}
		if _, e := tx.Exec("DELETE FROM skill_levels WHERE user_id=? AND skill_id=?", user, source); e != nil {
			return e
		}
		if e := refreshSkillDocuments(tx, user); e != nil {
			return e
		}
		_, e := tx.Exec("DELETE FROM skills WHERE id=? AND user_id=?", source, user)
		return e
	})
}
func (s *Store) SkillStatistics(user, group, state, from, to, category string) (SkillStatistics, error) {
	result := SkillStatistics{Skills: []SkillCount{}}
	if (from != "" && !ValidDate(from)) || (to != "" && !ValidDate(to)) || (from != "" && to != "" && from > to) {
		return result, Fail(400, "Некорректный период")
	}
	e := s.transaction(func(tx *sql.Tx) error {
		apps, e := list[Application](tx, user, "application")
		if e != nil {
			return e
		}
		skills, e := skillsTx(tx, user)
		if e != nil {
			return e
		}
		counts := map[string]int{}
		for _, a := range apps {
			if state != "" && a.State != state {
				continue
			}
			if from != "" && a.SavedDate < from || to != "" && a.SavedDate > to {
				continue
			}
			g := ""
			if len(a.Groups) > 0 {
				g = a.Groups[0]
			}
			if group != "" && ((group == "__none__" && g != "") || (group != "__none__" && g != group)) {
				continue
			}
			result.Total++
			if !AIReady(a) {
				continue
			}
			result.Processed++
			seen := map[string]bool{}
			for _, v := range a.AI.Skills {
				if !seen[v.ID] {
					counts[v.ID]++
					seen[v.ID] = true
				}
			}
		}
		for _, v := range skills {
			if category != "" && v.Category != category {
				continue
			}
			c := counts[v.ID]
			share := 0.0
			if result.Processed > 0 {
				share = float64(c) / float64(result.Processed)
			}
			result.Skills = append(result.Skills, SkillCount{Skill: v, Count: c, Share: share})
		}
		return nil
	})
	sort.SliceStable(result.Skills, func(i, j int) bool { return result.Skills[i].Count > result.Skills[j].Count })
	return result, e
}
func AIReady(a Application) bool {
	return a.AI != nil && a.AI.ProcessedAt != "" && a.AI.TextHash == digest(a.AI.Text) && a.AI.Summary != ""
}
