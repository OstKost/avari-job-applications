package core

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

func sourceOK(source string) bool { return oneOf(source, "manual", "extension") }
func (s *Store) SaveApplication(user string, a Application, idempotency, source string) (Application, error) {
	var result Application
	if !sourceOK(source) {
		return result, Fail(400, "Неизвестный источник")
	}
	if len(idempotency) > 200 {
		return result, Fail(400, "Слишком длинный ключ запроса")
	}
	e := s.transaction(func(tx *sql.Tx) error {
		if a.ID == "" && idempotency != "" {
			var id string
			e := tx.QueryRow("SELECT resource FROM requests WHERE user_id=? AND key=?", user, "application:"+idempotency).Scan(&id)
			if e == nil {
				v, e := get[Application](tx, user, "application", id)
				result = v
				return e
			}
			if e != sql.ErrNoRows {
				return e
			}
		}
		var old Application
		isNew := a.ID == ""
		if isNew {
			a.ID = ID()
			a.Version = 1
			a.CreatedAt = now()
			a.ExternalStatus = ""
			if a.Stage == "" {
				a.Stage = "saved"
			}
			if a.State == "" {
				a.State = "active"
			}
			if a.SavedDate == "" {
				a.SavedDate = localDate(tx, user)
			}
			if a.Stage != "saved" && a.AppliedDate == "" {
				a.AppliedDate = localDate(tx, user)
			}
		} else {
			v, e := get[Application](tx, user, "application", a.ID)
			if e != nil {
				return e
			}
			old = v
			if a.Version != old.Version {
				return &Error{Status: 409, Message: "Запись изменилась. Сравните актуальные значения", Current: old}
			}
			if a.CompanyLogo == "" && old.CompanyLogo != "" {
				a.CompanyLogo = old.CompanyLogo
			}
			a.CreatedAt = old.CreatedAt
			a.ExternalStatus = old.ExternalStatus
			a.Version++
		}
		if a.Custom != nil {
			delete(a.Custom, "lastActivityAt")
			delete(a.Custom, "stale")
		}
		a.LastActivityAt = ""
		a.Stale = false
		if e := a.Validate(); e != nil {
			return e
		}
		fields, e := list[Field](tx, user, "field")
		if e != nil {
			return e
		}
		if e = validateCustom(a.Custom, fields); e != nil {
			return e
		}
		if canonical := trackedJobURL(a.URL); canonical != "" {
			applications, e := list[Application](tx, user, "application")
			if e != nil {
				return e
			}
			for _, v := range applications {
				if v.ID == a.ID || trackedJobURL(v.URL) != canonical {
					continue
				}
				if isNew {
					result = v
					return nil
				}
				return &Error{Status: 409, Message: "Эта вакансия уже есть в журнале", Current: v}
			}
		}
		if isNew {
			var count int
			if e = tx.QueryRow("SELECT count(*) FROM documents WHERE user_id=? AND kind='application'", user).Scan(&count); e != nil {
				return e
			}
			if count >= 1000 {
				return Fail(400, "Достигнут лимит 1000 вакансий")
			}
		}
		a.UpdatedAt = now()
		if e = put(tx, user, "application", a.ID, a); e != nil {
			return e
		}
		kind := "updated"
		if isNew {
			kind = "created"
		}
		if e = event(tx, user, a.ID, kind, source, changes(old, a)); e != nil {
			return e
		}
		if e = s.OnApplicationStateOrStageChanged(tx, user, a); e != nil {
			return e
		}
		if isNew && idempotency != "" {
			if _, e = tx.Exec("INSERT INTO requests(user_id,key,resource) VALUES(?,?,?)", user, "application:"+idempotency, a.ID); e != nil {
				return e
			}
		}
		if isNew {
			if _, e = tx.Exec("INSERT OR IGNORE INTO reminder_eligibility(user_id, application_id, created_at) VALUES(?,?,?)", user, a.ID, now()); e != nil {
				return e
			}
			localToday := s.localDate(tx, user)
			if e = s.recordGoalAction(tx, user, a.ID, "created", localToday, 1, a.CreatedAt); e != nil {
				return e
			}
			if a.Stage != "saved" || a.AppliedDate != "" {
				if e = s.recordGoalAction(tx, user, a.ID, "applied", localToday, 1, a.CreatedAt); e != nil {
					return e
				}
			}
		} else {
			if (old.Stage == "saved" && old.AppliedDate == "") && (a.Stage != "saved" || a.AppliedDate != "") {
				localToday := s.localDate(tx, user)
				if e = s.recordGoalAction(tx, user, a.ID, "applied", localToday, 1, a.UpdatedAt); e != nil {
					return e
				}
			}
		}
		events, err := related[Event](tx, user, "event", a.ID)
		if err != nil {
			return err
		}
		result = EnrichApplication(a, events, time.Now().UTC())
		return nil
	})
	return result, e
}
func (s *Store) SaveTask(user string, t Task, key, source string) (Task, error) {
	var result Task
	if !sourceOK(source) {
		return result, Fail(400, "Неизвестный источник")
	}
	e := s.transaction(func(tx *sql.Tx) error {
		isNew := t.ID == ""
		if isNew && key != "" {
			var id string
			e := tx.QueryRow("SELECT resource FROM requests WHERE user_id=? AND key=?", user, "task:"+key).Scan(&id)
			if e == nil {
				v, e := get[Task](tx, user, "task", id)
				result = v
				return e
			}
			if e != sql.ErrNoRows {
				return e
			}
		}
		var old Task
		if isNew {
			t.ID = ID()
			t.Version = 1
			t.CreatedAt = now()
			if t.State == "" {
				t.State = "open"
			}
			if t.Kind == "" {
				t.Kind = "task"
			}
		} else {
			v, e := get[Task](tx, user, "task", t.ID)
			if e != nil {
				return e
			}
			old = v
			if old.Version != t.Version {
				return &Error{Status: 409, Message: "Задача изменилась", Current: old}
			}
			t.Version++
			t.CreatedAt = old.CreatedAt
		}
		if t.ApplicationID != "" {
			if _, e := get[Application](tx, user, "application", t.ApplicationID); e != nil {
				return e
			}
		}
		if e := t.Validate(); e != nil {
			return e
		}
		t.UpdatedAt = now()
		if e := put(tx, user, "task", t.ID, t); e != nil {
			return e
		}
		if t.ApplicationID != "" {
			if e := event(tx, user, t.ApplicationID, "task", source, changes(old, t)); e != nil {
				return e
			}
		}
		if t.State == "done" && (isNew || old.State != "done") {
			action := "task_completed"
			if t.Kind == "interview" {
				action = "interview_completed"
			}
			localToday := s.localDate(tx, user)
			stamp := t.UpdatedAt
			if isNew {
				stamp = t.CreatedAt
			}
			if e := s.recordGoalAction(tx, user, t.ID, action, localToday, 1, stamp); e != nil {
				return e
			}
		}
		if isNew && key != "" {
			if _, e := tx.Exec("INSERT INTO requests(user_id,key,resource) VALUES(?,?,?)", user, "task:"+key, t.ID); e != nil {
				return e
			}
		}
		result = t
		return nil
	})
	return result, e
}
func (s *Store) AddNote(user string, n Note, key, source string) (Note, error) {
	var result Note
	if !sourceOK(source) {
		return result, Fail(400, "Неизвестный источник")
	}
	n.Text = strings.TrimSpace(n.Text)
	if n.Text == "" || textLength(n.Text) > 20000 {
		return result, Fail(400, "Заметка должна содержать от 1 до 20000 символов")
	}
	e := s.transaction(func(tx *sql.Tx) error {
		if key != "" {
			var id string
			e := tx.QueryRow("SELECT resource FROM requests WHERE user_id=? AND key=?", user, "note:"+key).Scan(&id)
			if e == nil {
				v, e := get[Note](tx, user, "note", id)
				result = v
				return e
			}
			if e != sql.ErrNoRows {
				return e
			}
		}
		if _, e := get[Application](tx, user, "application", n.ApplicationID); e != nil {
			return e
		}
		n.ID = ID()
		n.CreatedAt = now()
		n.Version = 1
		if e := put(tx, user, "note", n.ID, n); e != nil {
			return e
		}
		if e := event(tx, user, n.ApplicationID, "note", source, map[string]any{"noteId": n.ID}); e != nil {
			return e
		}
		if key != "" {
			if _, e := tx.Exec("INSERT INTO requests(user_id,key,resource) VALUES(?,?,?)", user, "note:"+key, n.ID); e != nil {
				return e
			}
		}
		result = n
		return nil
	})
	return result, e
}
func (s *Store) UpdateNote(user string, n Note, source string) (Note, error) {
	if !sourceOK(source) {
		return Note{}, Fail(400, "Неизвестный источник")
	}
	n.Text = strings.TrimSpace(n.Text)
	if n.Text == "" || textLength(n.Text) > 20000 {
		return Note{}, Fail(400, "Заметка должна содержать от 1 до 20000 символов")
	}
	var result Note
	e := s.transaction(func(tx *sql.Tx) error {
		old, e := get[Note](tx, user, "note", n.ID)
		if e != nil {
			return e
		}
		if n.Version != old.Version {
			return &Error{Status: 409, Message: "Заметка изменилась. Проверьте актуальный текст", Current: old}
		}
		if n.ApplicationID != old.ApplicationID {
			return Fail(400, "Нельзя переносить заметку в другую вакансию")
		}
		n.CreatedAt = old.CreatedAt
		n.Version++
		if e = put(tx, user, "note", n.ID, n); e != nil {
			return e
		}
		if e = event(tx, user, n.ApplicationID, "note_updated", source, changes(old, n)); e != nil {
			return e
		}
		result = n
		return nil
	})
	return result, e
}
func (s *Store) SaveFields(user string, fields []Field, confirmDelete bool) ([]Field, error) {
	if len(fields) > 5 {
		return nil, Fail(400, "Можно создать не более пяти полей")
	}
	e := s.transaction(func(tx *sql.Tx) error {
		old, e := list[Field](tx, user, "field")
		if e != nil {
			return e
		}
		apps, e := list[Application](tx, user, "application")
		if e != nil {
			return e
		}
		oldMap := map[string]Field{}
		for _, f := range old {
			oldMap[f.ID] = f
		}
		seen := map[string]bool{}
		priority := false
		for i := range fields {
			f := &fields[i]
			f.Name = strings.TrimSpace(f.Name)
			if f.Name == "" || textLength(f.Name) > 100 || !oneOf(f.Type, "text", "number", "date", "flag", "select") {
				return Fail(400, "Проверьте название и тип поля")
			}
			if f.ID == "" {
				f.ID = ID()
			} else if _, ok := oldMap[f.ID]; !ok {
				return Fail(400, "Неизвестное поле")
			}
			if seen[f.ID] {
				return Fail(400, "Повторяющееся поле")
			}
			seen[f.ID] = true
			if !oneOf(f.Role, "", "priority") || f.Role == "priority" && (priority || f.Type != "select") {
				return Fail(400, "Приоритет может быть только одним полем типа «Выбор»")
			}
			priority = priority || f.Role == "priority"
			if f.Type == "select" {
				if len(f.Options) == 0 || len(f.Options) > 30 {
					return Fail(400, "Укажите от 1 до 30 вариантов выбора")
				}
				options := map[string]bool{}
				for _, option := range f.Options {
					if strings.TrimSpace(option) == "" || textLength(option) > 100 || options[option] {
						return Fail(400, "Варианты должны быть непустыми и уникальными")
					}
					options[option] = true
				}
			} else {
				f.Options = []string{}
			}
			for _, a := range apps {
				v, filled := a.Custom[f.ID]
				filled = filled && v != nil && v != ""
				if !filled {
					continue
				}
				if oldMap[f.ID].Type != f.Type {
					return Fail(400, "Нельзя менять тип заполненного поля")
				}
				if f.Type == "select" {
					str, ok := v.(string)
					if !ok || !oneOf(str, f.Options...) {
						return Fail(400, "Нельзя удалить вариант, используемый в вакансии")
					}
				}
			}
		}
		for _, f := range old {
			if seen[f.ID] {
				continue
			}
			for i := range apps {
				a := &apps[i]
				v, ok := a.Custom[f.ID]
				if !ok {
					continue
				}
				if v != nil && v != "" && !confirmDelete {
					return Fail(409, "Удаление поля удалит его значения. Подтвердите удаление")
				}
				before := *a
				before.Custom = map[string]any{}
				for k, v := range a.Custom {
					before.Custom[k] = v
				}
				delete(a.Custom, f.ID)
				a.Version++
				a.UpdatedAt = now()
				if e = put(tx, user, "application", a.ID, a); e != nil {
					return e
				}
				if e = event(tx, user, a.ID, "updated", "manual", changes(before, a)); e != nil {
					return e
				}
			}
			if e = remove(tx, user, "field", f.ID); e != nil {
				return e
			}
		}
		for _, f := range fields {
			if e = put(tx, user, "field", f.ID, f); e != nil {
				return e
			}
		}
		return nil
	})
	return fields, e
}
func applyPatch(a Application, patch map[string]any) (Application, error) {
	allowed := map[string]bool{"favorite": true, "stage": true, "state": true, "outcome": true, "externalStatus": true, "appliedDate": true}
	for k := range patch {
		if !allowed[k] {
			return a, Fail(400, "Неподдерживаемое изменение предложения")
		}
	}
	raw, _ := json.Marshal(a)
	var values map[string]any
	_ = json.Unmarshal(raw, &values)
	for k, v := range patch {
		values[k] = v
	}
	raw, e := json.Marshal(values)
	if e != nil {
		return a, e
	}
	var out Application
	if e = json.Unmarshal(raw, &out); e != nil {
		return a, Fail(400, "Неверные типы значений")
	}
	return out, nil
}
