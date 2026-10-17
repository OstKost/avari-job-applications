package core

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"
)

// Journal files contain only the authenticated user's journal, never credentials.
type JournalSettings struct {
	Timezone string         `json:"timezone"`
	Theme    string         `json:"theme,omitempty"`
	Table    *TableSettings `json:"table,omitempty"`
}
type TableSettings struct {
	Group      string `json:"group"`
	Cards      bool   `json:"cards"`
	Statistics bool   `json:"statistics"`
}
type Journal struct {
	Format       string          `json:"format"`
	Version      int             `json:"version"`
	ExportedAt   string          `json:"exportedAt"`
	Settings     JournalSettings `json:"settings"`
	Applications []Application   `json:"applications"`
	Fields       []Field         `json:"fields"`
	Tasks        []Task          `json:"tasks"`
	Notes        []Note          `json:"notes"`
	Events       []Event         `json:"events"`
	// Keys are kind:id. Stable opaque origins survive export/import across servers.
	Origins map[string]string `json:"origins"`
}
type ImportRequest struct {
	Journal       Journal           `json:"journal"`
	FieldMapping  map[string]string `json:"fieldMapping"`
	ApplySettings bool              `json:"applySettings"`
	Revision      string            `json:"revision,omitempty"`
}
type FieldConflict struct {
	Field      Field   `json:"field"`
	Candidates []Field `json:"candidates"`
}
type ImportReport struct {
	Ready               bool            `json:"ready"`
	Revision            string          `json:"revision"`
	NewApplications     int             `json:"newApplications"`
	MatchedApplications int             `json:"matchedApplications"`
	NewTasks            int             `json:"newTasks"`
	NewNotes            int             `json:"newNotes"`
	NewEvents           int             `json:"newEvents"`
	Unchanged           int             `json:"unchanged"`
	Conflicts           []string        `json:"conflicts"`
	FieldConflicts      []FieldConflict `json:"fieldConflicts"`
}

func digest(v any) string {
	raw, _ := json.Marshal(v)
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}
func originFor(source, user, kind, id string) string { return digest([]string{source, user, kind, id}) }
func originKey(kind, id string) string               { return kind + ":" + id }
func canonicalName(s string) string                  { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

func (s *Store) ExportJournal(user string) (Journal, error) {
	var out Journal
	err := s.transaction(func(tx *sql.Tx) error { var err error; out, err = exportJournal(tx, user); return err })
	return out, err
}
func exportJournal(tx *sql.Tx, user string) (Journal, error) {
	out := Journal{Format: "avari-journal", Version: 1, ExportedAt: now(), Origins: map[string]string{}}
	var err error
	if err = tx.QueryRow("SELECT timezone FROM users WHERE id=?", user).Scan(&out.Settings.Timezone); err != nil {
		return out, err
	}
	if out.Applications, err = list[Application](tx, user, "application"); err != nil {
		return out, err
	}
	if out.Fields, err = list[Field](tx, user, "field"); err != nil {
		return out, err
	}
	if out.Tasks, err = list[Task](tx, user, "task"); err != nil {
		return out, err
	}
	if out.Notes, err = list[Note](tx, user, "note"); err != nil {
		return out, err
	}
	if out.Events, err = list[Event](tx, user, "event"); err != nil {
		return out, err
	}
	var source string
	if err = tx.QueryRow("SELECT value FROM instance_metadata WHERE key='transfer_source'").Scan(&source); err != nil {
		return out, err
	}
	ids := map[string][]string{}
	for _, a := range out.Applications {
		ids["application"] = append(ids["application"], a.ID)
	}
	for _, a := range out.Fields {
		ids["field"] = append(ids["field"], a.ID)
	}
	for _, a := range out.Tasks {
		ids["task"] = append(ids["task"], a.ID)
	}
	for _, a := range out.Notes {
		ids["note"] = append(ids["note"], a.ID)
	}
	for _, a := range out.Events {
		ids["event"] = append(ids["event"], a.ID)
	}
	for kind, values := range ids {
		for _, id := range values {
			out.Origins[originKey(kind, id)] = originFor(source, user, kind, id)
		}
	}
	rows, err := tx.Query("SELECT kind,target_id,min(origin) FROM import_origins WHERE user_id=? GROUP BY kind,target_id", user)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, id, origin string
		if err = rows.Scan(&kind, &id, &origin); err != nil {
			return out, err
		}
		key := originKey(kind, id)
		if _, ok := out.Origins[key]; ok {
			out.Origins[key] = origin
		}
	}
	return out, rows.Err()
}

func validateJournal(j Journal) error {
	if j.Format != "avari-journal" || j.Version != 1 {
		return Fail(400, "Неподдерживаемый формат или версия файла")
	}
	if len(j.Applications) > 1000 || len(j.Fields) > 5 || len(j.Tasks)+len(j.Notes) > 50000 || len(j.Events) > 100000 {
		return Fail(400, "Файл превышает допустимые лимиты журнала")
	}
	if _, err := time.LoadLocation(j.Settings.Timezone); err != nil {
		return Fail(400, "Неизвестный часовой пояс в файле")
	}
	if !oneOf(j.Settings.Theme, "", "dark", "light") {
		return Fail(400, "Некорректная тема")
	}
	if j.Settings.Table != nil && !oneOf(j.Settings.Table.Group, "", "stage", "state", "group", "priority") {
		return Fail(400, "Некорректная группировка журнала")
	}
	if _, err := time.Parse(time.RFC3339Nano, j.ExportedAt); err != nil {
		return Fail(400, "Некорректная дата экспорта")
	}
	seen := map[string]bool{}
	origins := map[string]bool{}
	apps := map[string]bool{}
	check := func(kind, id, stamp string) error {
		if id == "" || len(id) > 128 || seen[id] {
			return Fail(400, "Пустой или повторяющийся идентификатор в файле")
		}
		seen[id] = true
		origin := j.Origins[originKey(kind, id)]
		b, e := hex.DecodeString(origin)
		if e != nil || len(b) != 32 || origins[originKey(kind, origin)] {
			return Fail(400, "Некорректное или повторяющееся происхождение записи")
		}
		origins[originKey(kind, origin)] = true
		if kind != "field" && stamp == "" {
			return Fail(400, "Отсутствует дата записи")
		}
		if stamp != "" {
			if _, e = time.Parse(time.RFC3339Nano, stamp); e != nil {
				return Fail(400, "Некорректная дата записи")
			}
		}
		return nil
	}
	priority := false
	for _, f := range j.Fields {
		if err := check("field", f.ID, ""); err != nil {
			return err
		}
		if strings.TrimSpace(f.Name) == "" || textLength(f.Name) > 100 || !oneOf(f.Type, "text", "number", "date", "flag", "select") || !oneOf(f.Role, "", "priority") {
			return Fail(400, "Некорректное дополнительное поле")
		}
		if f.Role == "priority" {
			if priority || f.Type != "select" {
				return Fail(400, "Некорректное поле приоритета")
			}
			priority = true
		}
		if f.Type == "select" {
			if len(f.Options) == 0 || len(f.Options) > 30 {
				return Fail(400, "Некорректные варианты поля")
			}
			options := map[string]bool{}
			for _, o := range f.Options {
				if strings.TrimSpace(o) == "" || textLength(o) > 100 || options[o] {
					return Fail(400, "Некорректные варианты поля")
				}
				options[o] = true
			}
		}
	}
	for _, a := range j.Applications {
		if err := check("application", a.ID, a.CreatedAt); err != nil {
			return err
		}
		if err := a.Validate(); err != nil {
			return err
		}
		if err := validateCustom(a.Custom, j.Fields); err != nil {
			return err
		}
		apps[a.ID] = true
	}
	related := func(kind, id, app, stamp string) error {
		if !apps[app] {
			return Fail(400, "Связанная запись ссылается на отсутствующую вакансию")
		}
		return check(kind, id, stamp)
	}
	for _, t := range j.Tasks {
		if err := related("task", t.ID, t.ApplicationID, t.CreatedAt); err != nil {
			return err
		}
		if err := t.Validate(); err != nil {
			return err
		}
	}
	for _, n := range j.Notes {
		if err := related("note", n.ID, n.ApplicationID, n.CreatedAt); err != nil {
			return err
		}
		if strings.TrimSpace(n.Text) == "" || textLength(n.Text) > 20000 {
			return Fail(400, "Некорректная заметка")
		}
	}
	for _, e := range j.Events {
		if err := related("event", e.ID, e.ApplicationID, e.CreatedAt); err != nil {
			return err
		}
		if e.Kind == "" || len(e.Kind) > 100 || len(e.Source) > 100 {
			return Fail(400, "Некорректная история")
		}
	}
	return nil
}

func fieldCompatible(a, b Field) bool {
	return a.Type == b.Type && (a.Type != "select" || reflect.DeepEqual(a.Options, b.Options))
}
func importRevision(tx *sql.Tx, user string, req ImportRequest, current Journal) (string, error) {
	current.ExportedAt = ""
	req.Revision = ""
	rows, err := tx.Query("SELECT kind,origin,target_id FROM import_origins WHERE user_id=? ORDER BY kind,origin", user)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	ledger := [][3]string{}
	for rows.Next() {
		var row [3]string
		if err = rows.Scan(&row[0], &row[1], &row[2]); err != nil {
			return "", err
		}
		ledger = append(ledger, row)
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	return digest([]any{user, current, ledger, req}), nil
}

func (s *Store) ImportJournal(user string, req ImportRequest, apply bool) (ImportReport, error) {
	report := ImportReport{Conflicts: []string{}, FieldConflicts: []FieldConflict{}}
	// Planning must not mutate the caller's slices, maps or nested history.
	raw, err := json.Marshal(req)
	if err != nil {
		return report, Fail(400, "Некорректные данные импорта")
	}
	var copied ImportRequest
	if err = json.Unmarshal(raw, &copied); err != nil {
		return report, Fail(400, "Некорректные данные импорта")
	}
	req = copied
	if err := validateJournal(req.Journal); err != nil {
		return report, err
	}
	err = s.transaction(func(tx *sql.Tx) error {
		current, err := exportJournal(tx, user)
		if err != nil {
			return err
		}
		report.Revision, err = importRevision(tx, user, req, current)
		if err != nil {
			return err
		}
		if apply && (req.Revision == "" || req.Revision != report.Revision) {
			return Fail(409, "Журнал или параметры изменились. Повторите предпросмотр")
		}
		writes := []struct {
			kind, id string
			value    any
		}{}
		originWrites := [][3]string{}
		references := map[string]string{}
		originTargets := map[string]string{}
		for k, o := range current.Origins {
			kind, id, _ := strings.Cut(k, ":")
			originTargets[originKey(kind, o)] = id
		}
		ledgerRows, e := tx.Query("SELECT kind,origin,target_id FROM import_origins WHERE user_id=?", user)
		if e != nil {
			return e
		}
		for ledgerRows.Next() {
			var kind, o, id string
			if e = ledgerRows.Scan(&kind, &o, &id); e != nil {
				ledgerRows.Close()
				return e
			}
			originTargets[originKey(kind, o)] = id
		}
		e = ledgerRows.Err()
		ledgerRows.Close()
		if e != nil {
			return e
		}
		remember := func(kind, sourceID, target string) {
			originWrites = append(originWrites, [3]string{kind, req.Journal.Origins[originKey(kind, sourceID)], target})
			references[sourceID] = target
		}
		lookup := func(kind, id string) (string, error) {
			return originTargets[originKey(kind, req.Journal.Origins[originKey(kind, id)])], nil
		}
		add := func(kind, id string, v any) {
			writes = append(writes, struct {
				kind, id string
				value    any
			}{kind, id, v})
		}
		fields := append([]Field{}, current.Fields...)
		fieldMap := map[string]string{}
		claimed := map[string]bool{}
		for key := range req.FieldMapping {
			found := false
			for _, f := range req.Journal.Fields {
				found = found || f.ID == key
			}
			if !found {
				return Fail(400, "Сопоставление неизвестного поля")
			}
		}
		for _, f := range req.Journal.Fields {
			target, err := lookup("field", f.ID)
			if err != nil {
				return err
			}
			explicit, has := req.FieldMapping[f.ID]
			if has {
				// "Create" is a first-import decision. Repeating the same file reuses
				// the persisted mapping rather than allocating another field.
				if explicit != "_new" || target == "" {
					target = explicit
				}
			}
			if target == "_skip" {
				fieldMap[f.ID] = ""
				continue
			}
			candidates := []Field{}
			sameName := false
			targetValid := false
			for _, c := range fields {
				if fieldCompatible(f, c) {
					candidates = append(candidates, c)
				}
				if canonicalName(c.Name) == canonicalName(f.Name) {
					sameName = true
					if target == "" && fieldCompatible(f, c) {
						target = c.ID
					}
				}
				if target == c.ID && fieldCompatible(f, c) {
					targetValid = true
				}
			}
			// Auto-matched target may be discovered after its first validation pass.
			for _, c := range fields {
				if c.ID == target && fieldCompatible(f, c) {
					targetValid = true
				}
			}
			if target == "_new" || target == "" && !sameName && len(fields) < 5 {
				if len(fields) >= 5 {
					return Fail(400, "Сопоставьте поля: можно создать не более пяти")
				}
				created := f
				created.ID = ID()
				created.Name = strings.TrimSpace(created.Name)
				for _, existing := range fields {
					if existing.Role == "priority" && created.Role == "priority" {
						created.Role = ""
					}
				}
				target = created.ID
				fields = append(fields, created)
				add("field", target, created)
				targetValid = true
			}
			if !targetValid {
				report.FieldConflicts = append(report.FieldConflicts, FieldConflict{f, candidates})
				continue
			}
			if claimed[target] {
				return Fail(400, "Два поля файла нельзя сопоставить одному полю журнала")
			}
			claimed[target] = true
			fieldMap[f.ID] = target
			remember("field", f.ID, target)
		}
		if len(report.FieldConflicts) > 0 {
			if apply {
				return Fail(400, "Сначала сопоставьте дополнительные поля")
			}
			return nil
		}
		byURL := map[string]string{}
		byID := map[string]Application{}
		names := map[string]string{}
		tags := map[string]string{}
		for _, a := range current.Applications {
			byID[a.ID] = a
			if a.URL != "" {
				canonical, _, e := NormalizeURL(a.URL)
				if e != nil {
					return e
				}
				byURL[canonical] = a.ID
			}
			for _, g := range a.Groups {
				names[canonicalName(g)] = g
			}
			for _, t := range a.Tags {
				tags[canonicalName(t)] = t
			}
		}
		appMap := map[string]string{}
		for _, a := range req.Journal.Applications {
			sourceID := a.ID
			target, e := lookup("application", sourceID)
			if e != nil {
				return e
			}
			if target != "" {
				if _, ok := byID[target]; !ok {
					return Fail(409, "Ранее импортированная вакансия удалена; её повторное создание требует отдельного файла")
				}
			}
			if target == "" && a.URL != "" {
				canonical, _, e := NormalizeURL(a.URL)
				if e != nil {
					return e
				}
				target = byURL[canonical]
			}
			if target != "" {
				report.MatchedApplications++
			} else {
				target = ID()
				a.ID = target
				a.Version = 1
				originalCustom := a.Custom
				a.Custom = map[string]any{}
				for id, value := range originalCustom {
					if mapped := fieldMap[id]; mapped != "" {
						a.Custom[mapped] = value
					}
				}
				for i, g := range a.Groups {
					key := canonicalName(g)
					if names[key] == "" {
						names[key] = strings.TrimSpace(g)
					}
					a.Groups[i] = names[key]
				}
				for i, t := range a.Tags {
					key := canonicalName(t)
					if tags[key] == "" {
						tags[key] = strings.TrimSpace(t)
					}
					a.Tags[i] = tags[key]
				}
				if err = a.Validate(); err != nil {
					return err
				}
				if err = validateCustom(a.Custom, fields); err != nil {
					return err
				}
				byID[target] = a
				if a.URL != "" {
					byURL[a.URL] = target
				}
				add("application", target, a)
				report.NewApplications++
			}
			appMap[sourceID] = target
			remember("application", sourceID, target)
		}
		if len(byID) > 1000 {
			return Fail(400, "После импорта будет превышен лимит 1000 вакансий")
		}
		// Existing versions always win. Stable origins detect edited records, not just
		// matching text, so two intentionally identical notes remain separate.
		merge := func(kind, id, app string, value any) error {
			target, e := lookup(kind, id)
			if e != nil {
				return e
			}
			raw, _ := json.Marshal(value)
			var payload map[string]any
			_ = json.Unmarshal(raw, &payload)
			payload["applicationId"] = appMap[app]
			label := map[string]string{"task": "Задача", "note": "Заметка", "event": "Событие истории"}[kind]
			if title, ok := payload["title"].(string); ok {
				label += " «" + title + "»"
			}
			if target != "" {
				remember(kind, id, target)
				var stored string
				e = tx.QueryRow("SELECT payload FROM documents WHERE user_id=? AND kind=? AND id=?", user, kind, target).Scan(&stored)
				if e == sql.ErrNoRows {
					report.Conflicts = append(report.Conflicts, label+": ранее удалённая запись сохранена удалённой")
					return nil
				}
				if e != nil {
					return e
				}
				var existing map[string]any
				if e = json.Unmarshal([]byte(stored), &existing); e != nil {
					return e
				}
				for _, key := range []string{"id", "version", "updatedAt"} {
					delete(existing, key)
					delete(payload, key)
				}
				if digest(existing) == digest(payload) {
					report.Unchanged++
				} else {
					report.Conflicts = append(report.Conflicts, label+": сохранена текущая версия")
				}
				return nil
			}
			target = ID()
			payload["id"] = target
			if kind != "event" {
				payload["version"] = 1
			}
			add(kind, target, payload)
			remember(kind, id, target)
			switch kind {
			case "task":
				report.NewTasks++
			case "note":
				report.NewNotes++
			case "event":
				report.NewEvents++
			}
			return nil
		}
		for _, v := range req.Journal.Tasks {
			if err = merge("task", v.ID, v.ApplicationID, v); err != nil {
				return err
			}
		}
		for _, v := range req.Journal.Notes {
			if err = merge("note", v.ID, v.ApplicationID, v); err != nil {
				return err
			}
		}
		// History references are remapped recursively, including custom field keys.
		idMap := map[string]string{}
		for id, target := range appMap {
			idMap[id] = target
		}
		for id, target := range fieldMap {
			idMap[id] = target
		}
		for id, target := range references {
			idMap[id] = target
		}
		var remap func(any) any
		remap = func(v any) any {
			switch x := v.(type) {
			case string:
				if t, ok := idMap[x]; ok {
					return t
				}
			case []any:
				for i, v := range x {
					x[i] = remap(v)
				}
				return x
			case map[string]any:
				out := map[string]any{}
				for k, v := range x {
					key := k
					if t, ok := idMap[k]; ok {
						key = t
					}
					out[key] = remap(v)
				}
				return out
			}
			return v
		}
		for _, v := range req.Journal.Events {
			if v.Changes != nil {
				v.Changes = remap(v.Changes).(map[string]any)
			}
			if err = merge("event", v.ID, v.ApplicationID, v); err != nil {
				return err
			}
		}
		report.Ready = true
		if !apply {
			return nil
		}
		for _, w := range writes {
			if err = put(tx, user, w.kind, w.id, w.value); err != nil {
				return err
			}
			if w.kind == "task" {
				if tMap, ok := w.value.(map[string]any); ok {
					title, _ := tMap["title"].(string)
					appID, _ := tMap["applicationId"].(string)
					if strings.TrimSpace(title) == ReminderTaskTitle && appID != "" {
						_, _ = tx.Exec("INSERT OR IGNORE INTO reminder_records(user_id, application_id, task_id, created_at) VALUES(?,?,?,?)", user, appID, w.id, now())
					}
				}
			}
		}
		for _, o := range originWrites {
			if _, err = tx.Exec("INSERT INTO import_origins(user_id,kind,origin,target_id) VALUES(?,?,?,?) ON CONFLICT(user_id,kind,origin) DO UPDATE SET target_id=excluded.target_id", user, o[0], o[1], o[2]); err != nil {
				return err
			}
		}
		if req.ApplySettings {
			if _, err = tx.Exec("UPDATE users SET timezone=? WHERE id=?", req.Journal.Settings.Timezone, user); err != nil {
				return err
			}
		}
		return audit(tx, "journal_import", user, fmt.Sprintf("applications=%d tasks=%d notes=%d", report.NewApplications, report.NewTasks, report.NewNotes))
	})
	sort.Strings(report.Conflicts)
	return report, err
}

// The transfer operates entirely inside one user-scoped transaction.
var _ queryer = (*sql.Tx)(nil)
