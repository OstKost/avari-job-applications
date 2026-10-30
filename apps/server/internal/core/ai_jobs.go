package core

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"
)

func isNoRows(e error) bool { return errors.Is(e, sql.ErrNoRows) }
func (s *Store) StartAI() error {
	s.aiMu.Lock()
	defer s.aiMu.Unlock()
	if s.aiWake != nil {
		return nil
	}
	lock, e := os.OpenFile(s.Path+".ai.lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	if e = lockShared(lock); e == nil {
		e = lockExclusive(lock)
	}
	if e != nil {
		lock.Close()
		return Fail(503, "Обработчик ИИ уже запущен другим процессом")
	}
	if _, e = s.DB.Exec("UPDATE ai_jobs SET status='error',error='Обработка прервана перезапуском сервера. Повторите вручную',updated_at=? WHERE status IN ('running','queued')", now()); e != nil {
		unlockFile(lock)
		lock.Close()
		return e
	}
	s.aiLock = lock
	s.aiWake = make(chan struct{}, 1)
	s.aiStop = make(chan struct{})
	s.aiDone = make(chan struct{})
	go s.aiWorker(s.aiStop, s.aiDone)
	return nil
}
func (s *Store) stopAI() {
	s.aiMu.Lock()
	stop, done := s.aiStop, s.aiDone
	s.aiStop = nil
	s.aiMu.Unlock()
	if stop != nil {
		close(stop)
		<-done
		if s.aiLock != nil {
			_ = unlockFile(s.aiLock)
			_ = s.aiLock.Close()
		}
	}
}
func (s *Store) aiWorker(stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		select {
		case <-stop:
			cancel()
		case <-ctx.Done():
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		job, user, e := s.nextAIJob()
		if e != nil || job.ID == "" {
			select {
			case <-ctx.Done():
				return
			case <-s.aiWake:
			case <-time.After(time.Second):
			}
			continue
		}
		s.runAIJob(ctx, user, job)
	}
}

const aiJobColumns = "id,kind,target_id,status,input_hash,result,error,provider,model,created_at,updated_at"

func scanAIJob(row interface{ Scan(...any) error }) (AIJob, error) {
	var v AIJob
	e := row.Scan(&v.ID, &v.Kind, &v.TargetID, &v.Status, &v.InputHash, &v.Result, &v.Error, &v.Provider, &v.Model, &v.CreatedAt, &v.UpdatedAt)
	return v, e
}
func (s *Store) nextAIJob() (AIJob, string, error) {
	var v AIJob
	var user string
	e := s.transaction(func(tx *sql.Tx) error {
		e := tx.QueryRow("SELECT user_id FROM ai_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").Scan(&user)
		if isNoRows(e) {
			return nil
		}
		if e != nil {
			return e
		}
		v, e = scanAIJob(tx.QueryRow("SELECT "+aiJobColumns+" FROM ai_jobs WHERE user_id=? AND status='queued' ORDER BY created_at,id LIMIT 1", user))
		if e != nil {
			return e
		}
		_, e = tx.Exec("UPDATE ai_jobs SET status='running',updated_at=? WHERE id=? AND status='queued'", now(), v.ID)
		return e
	})
	return v, user, e
}
func (s *Store) AIJobs(user string) ([]AIJob, error) {
	rows, e := s.DB.Query("SELECT "+aiJobColumns+" FROM ai_jobs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 150", user)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []AIJob{}
	for rows.Next() {
		v, e := scanAIJob(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) AIJob(user, id string) (AIJob, error) {
	v, e := scanAIJob(s.DB.QueryRow("SELECT "+aiJobColumns+" FROM ai_jobs WHERE user_id=? AND id=?", user, id))
	if isNoRows(e) {
		return v, Fail(404, "Задание не найдено")
	}
	return v, e
}
func (s *Store) QueueAI(user, kind, target string) (AIJob, error) {
	var v AIJob
	if e := s.StartAI(); e != nil {
		return v, e
	}
	e := s.transaction(func(tx *sql.Tx) error {
		var active int
		if e := tx.QueryRow("SELECT count(*) FROM ai_jobs WHERE user_id=? AND status IN ('queued','running')", user).Scan(&active); e != nil {
			return e
		}
		existing, e := scanAIJob(tx.QueryRow("SELECT "+aiJobColumns+" FROM ai_jobs WHERE user_id=? AND kind=? AND target_id=? AND status IN ('queued','running')", user, kind, target))
		if e == nil {
			v = existing
			return nil
		}
		if !isNoRows(e) {
			return e
		}
		if active >= 100 {
			return Fail(429, "В очереди уже 100 заданий")
		}
		var provider, model string
		if e := tx.QueryRow("SELECT provider,model FROM ai_settings WHERE user_id=?", user).Scan(&provider, &model); e != nil {
			if isNoRows(e) {
				return Fail(400, "Сначала настройте подключение ИИ")
			}
			return e
		}
		_, _, hash, e := aiInput(tx, user, kind, target)
		if e != nil {
			return e
		}
		v = AIJob{ID: ID(), Kind: kind, TargetID: target, Status: "queued", InputHash: hash, Provider: provider, Model: model, CreatedAt: now(), UpdatedAt: now()}
		_, e = tx.Exec("INSERT INTO ai_jobs(id,user_id,kind,target_id,status,input_hash,provider,model,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", v.ID, user, kind, target, v.Status, hash, provider, model, v.CreatedAt, v.UpdatedAt)
		return e
	})
	if e == nil {
		select {
		case s.aiWake <- struct{}{}:
		default:
		}
	}
	return v, e
}
func aiInput(tx *sql.Tx, user, kind, target string) (string, map[string]any, string, error) {
	var status string
	if e := tx.QueryRow("SELECT status FROM users WHERE id=?", user).Scan(&status); e != nil {
		return "", nil, "", e
	}
	if status != "active" {
		return "", nil, "", Fail(403, "Аккаунт неактивен")
	}
	var prompt string
	var schema map[string]any
	guard := ""
	switch kind {
	case "extract":
		a, e := get[Application](tx, user, "application", target)
		if e != nil {
			return "", nil, "", e
		}
		if a.AI == nil || strings.TrimSpace(a.AI.Text) == "" {
			return "", nil, "", Fail(400, "Сначала добавьте полный текст вакансии")
		}
		catalog, e := skillsTx(tx, user)
		if e != nil {
			return "", nil, "", e
		}
		data, _ := json.Marshal(map[string]any{"position": a.Position, "text": a.AI.Text, "catalog": catalog})
		prompt = "Составь краткое описание вакансии до 400 символов, включая пробелы: обязанности, важные требования и условия. Извлеки только явно упомянутые профессиональные навыки (hard), мягкие навыки (soft), языки (language), максимум 100. Сопоставляй названия и синонимы со словарём, используй каноническое имя. Для нового навыка id оставь пустым. Никаких оценок владения. Данные:\n" + string(data)
		schema = extractionSchema()
		guard = digest([]any{a.AI, a.Position})
	case "directions":
		apps, e := list[Application](tx, user, "application")
		if e != nil {
			return "", nil, "", e
		}
		sort.Slice(apps, func(i, j int) bool {
			if apps[i].CreatedAt == apps[j].CreatedAt {
				return apps[i].ID > apps[j].ID
			}
			return apps[i].CreatedAt > apps[j].CreatedAt
		})
		if len(apps) > 45 {
			apps = apps[:45]
		}
		ready := []Application{}
		for _, a := range apps {
			if AIReady(a) {
				ready = append(ready, a)
			}
		}
		if len(ready) == 0 {
			return "", nil, "", Fail(400, "Среди последних 45 вакансий нет обработанных")
		}
		data, _ := json.Marshal(compactApplications(ready))
		prompt = "Предложи ровно три различных целевых карьерных направления на основе вакансий. Для каждого title (до 200 символов) и description (до 1000 символов). Это варианты для выбора пользователя, а не утверждение его опыта. Данные:\n" + string(data)
		schema = suggestionsSchema()
	case "profile":
		p, e := get[Profile](tx, user, "profile", target)
		if e != nil {
			return "", nil, "", e
		}
		if e = validateProfile(p); e != nil {
			return "", nil, "", e
		}
		apps := []Application{}
		for _, id := range p.ApplicationIDs {
			a, e := get[Application](tx, user, "application", id)
			if e != nil {
				return "", nil, "", e
			}
			if !AIReady(a) {
				return "", nil, "", Fail(400, "Выберите вакансии с актуальным результатом обработки")
			}
			apps = append(apps, a)
		}
		if len(apps) == 0 {
			return "", nil, "", Fail(400, "Выберите от 1 до 15 вакансий")
		}
		skills, e := skillsTx(tx, user)
		if e != nil {
			return "", nil, "", e
		}
		contextText, e := candidateContextTx(tx, user)
		if e != nil {
			return "", nil, "", e
		}
		counts := map[string]int{}
		for _, a := range apps {
			for _, v := range a.AI.Skills {
				counts[v.ID]++
			}
		}
		data, _ := json.Marshal(map[string]any{"direction": p.Title, "vacancies": compactApplications(apps), "skills": skills, "frequency": counts, "candidateContext": contextText})
		prompt = "Составь целевой профиль по выбранному направлению. Верни content: обычный текст до 15000 символов с разделами: описание направления; типичные задачи и требования; ключевые навыки с частотностью из frequency; соответствие самооценке; пробелы и приоритеты развития; рекомендации для содержания резюме. Отсутствующая оценка не означает отсутствие навыка. Не приписывай кандидату неподтверждённый опыт, не превращай требования вакансий в его достижения. Данные:\n" + string(data)
		schema = profileSchema()
		guard = digest(p)
	case "test":
		prompt = "Верни content со значением OK."
		schema = profileSchema()
	default:
		return "", nil, "", Fail(400, "Неизвестный вид задания")
	}
	if len(prompt) > 500000 {
		return "", nil, "", Fail(400, "Слишком большой контекст: сократите текст или словарь навыков")
	}
	var provider, model, base string
	var secret []byte
	if e := tx.QueryRow("SELECT provider,model,base_url,secret FROM ai_settings WHERE user_id=?", user).Scan(&provider, &model, &base, &secret); e != nil {
		return "", nil, "", Fail(400, "Сначала настройте подключение ИИ")
	}
	hashPrompt := prompt
	if kind == "extract" {
		hashPrompt = ""
	}
	return prompt, schema, digest([]any{hashPrompt, guard, provider, model, base, secret}), nil
}
func compactApplications(apps []Application) []map[string]any {
	out := []map[string]any{}
	for _, a := range apps {
		out = append(out, map[string]any{"id": a.ID, "position": a.Position, "summary": a.AI.Summary, "skills": a.AI.Skills, "location": a.Location, "workFormat": a.WorkFormat, "salary": a.Salary})
	}
	return out
}
func (s *Store) runAIJob(ctx context.Context, user string, j AIJob) {
	finish := func(status, result, message string) {
		_, _ = s.DB.Exec("UPDATE ai_jobs SET status=?,result=?,error=?,updated_at=? WHERE id=? AND user_id=?", status, result, message, now(), j.ID, user)
	}
	var prompt, hash string
	var schema map[string]any
	e := s.transaction(func(tx *sql.Tx) error {
		var e error
		prompt, schema, hash, e = aiInput(tx, user, j.Kind, j.TargetID)
		return e
	})
	if e != nil {
		finish("error", "", safeAIError(e))
		return
	}
	if hash != j.InputHash {
		finish("error", "", "Данные изменились до начала обработки. Запустите заново")
		return
	}
	credentials, e := s.aiCredentials(user)
	if e != nil {
		finish("error", "", safeAIError(e))
		return
	}
	if credentials.Provider != j.Provider || credentials.Model != j.Model {
		finish("error", "", "Настройки ИИ изменились. Запустите заново")
		return
	}
	callCtx, cancel := context.WithTimeout(ctx, 100*time.Second)
	result, e := s.generateAI(callCtx, credentials, prompt, schema)
	cancel()
	if e != nil {
		finish("error", "", safeAIError(e))
		return
	}
	if e = validateAIResult(j.Kind, result); e != nil {
		finish("error", "", safeAIError(e))
		return
	}
	e = s.transaction(func(tx *sql.Tx) error {
		_, _, current, e := aiInput(tx, user, j.Kind, j.TargetID)
		if e != nil {
			return e
		}
		if current != j.InputHash {
			return Fail(409, "Данные изменились во время обработки. Запустите заново")
		}
		status := "ready"
		if j.Kind == "extract" {
			a, e := get[Application](tx, user, "application", j.TargetID)
			if e != nil {
				return e
			}
			if a.AI.Summary == "" && len(a.AI.Skills) == 0 {
				if e = applyExtraction(tx, user, j, result); e != nil {
					return e
				}
			} else {
				status = "awaiting"
			}
		}
		if j.Kind == "profile" {
			status = "awaiting"
		}
		_, e = tx.Exec("UPDATE ai_jobs SET status=?,result=?,updated_at=? WHERE id=? AND user_id=?", status, result, now(), j.ID, user)
		return e
	})
	if e != nil {
		finish("error", "", safeAIError(e))
	}
}
func safeAIError(e error) string {
	var ce *Error
	if errors.As(e, &ce) {
		return ce.Message
	}
	return "Ошибка обработки ИИ. Повторите запрос"
}
func validateAIResult(kind, result string) error {
	if len(result) > 200000 {
		return Fail(502, "Ответ ИИ слишком большой")
	}
	bad := func() error {
		return Fail(502, "ИИ вернул результат неверного формата или длины")
	}
	decoder := func(v any) error {
		d := json.NewDecoder(strings.NewReader(result))
		d.DisallowUnknownFields()
		if e := d.Decode(v); e != nil {
			return e
		}
		var extra any
		if d.Decode(&extra) != io.EOF {
			return fmt.Errorf("extra JSON")
		}
		return nil
	}
	switch kind {
	case "extract":
		var v AIExtraction
		if decoder(&v) != nil || strings.TrimSpace(v.Summary) == "" || textLength(v.Summary) > 400 || v.Skills == nil || len(v.Skills) > 100 {
			return bad()
		}
		for _, x := range v.Skills {
			if validSkill(x) != nil {
				return bad()
			}
		}
	case "directions":
		var v struct {
			Directions []DirectionSuggestion `json:"directions"`
		}
		if decoder(&v) != nil || len(v.Directions) != 3 {
			return bad()
		}
		for _, x := range v.Directions {
			if strings.TrimSpace(x.Title) == "" || textLength(x.Title) > 200 || strings.TrimSpace(x.Description) == "" || textLength(x.Description) > 1000 {
				return bad()
			}
		}
	default:
		var v struct {
			Content string `json:"content"`
		}
		if decoder(&v) != nil || strings.TrimSpace(v.Content) == "" || textLength(v.Content) > 15000 {
			return bad()
		}
	}
	return nil
}
func applyExtraction(tx *sql.Tx, user string, j AIJob, result string) error {
	a, e := get[Application](tx, user, "application", j.TargetID)
	if e != nil {
		return e
	}
	var v AIExtraction
	if e = json.Unmarshal([]byte(result), &v); e != nil {
		return e
	}
	old := a
	copyAI := *a.AI
	a.AI = &copyAI
	a.AI.Summary = v.Summary
	a.AI.Skills = v.Skills
	a.AI.Provider = j.Provider
	a.AI.Model = j.Model
	a.AI.ProcessedAt = now()
	a.AI.TextHash = digest(a.AI.Text)
	a.AI.Stale = false
	a.Version++
	a.UpdatedAt = now()
	if e = syncApplicationSkills(tx, user, &a); e != nil {
		return e
	}
	if e = put(tx, user, "application", a.ID, a); e != nil {
		return e
	}
	return event(tx, user, a.ID, "ai_processed", "manual", changes(old, a))
}
func (s *Store) ApplyAIJob(user, id string) error {
	return s.transaction(func(tx *sql.Tx) error {
		j, e := scanAIJob(tx.QueryRow("SELECT "+aiJobColumns+" FROM ai_jobs WHERE user_id=? AND id=?", user, id))
		if isNoRows(e) {
			return Fail(404, "Задание не найдено")
		}
		if e != nil {
			return e
		}
		if j.Status != "awaiting" {
			return Fail(409, "Результат уже применён или недоступен")
		}
		_, _, hash, e := aiInput(tx, user, j.Kind, j.TargetID)
		if e != nil {
			return e
		}
		if hash != j.InputHash {
			return Fail(409, "Данные изменились. Создайте новый результат")
		}
		if j.Kind == "extract" {
			if e = applyExtraction(tx, user, j, j.Result); e != nil {
				return e
			}
		} else if j.Kind == "profile" {
			p, e := get[Profile](tx, user, "profile", j.TargetID)
			if e != nil {
				return e
			}
			var v struct {
				Content string `json:"content"`
			}
			if e = json.Unmarshal([]byte(j.Result), &v); e != nil {
				return e
			}
			p.Content = v.Content
			p.GeneratedAt = now()
			p.UpdatedAt = now()
			p.Version++
			if e = put(tx, user, "profile", p.ID, p); e != nil {
				return e
			}
		} else {
			return Fail(400, "Этот результат не требует применения")
		}
		_, e = tx.Exec("UPDATE ai_jobs SET status='ready',updated_at=? WHERE user_id=? AND id=?", now(), user, id)
		return e
	})
}
func validateProfile(p Profile) error {
	if strings.TrimSpace(p.Title) == "" || textLength(p.Title) > 200 || textLength(p.Content) > 15000 || len(p.ApplicationIDs) > 15 {
		return Fail(400, "Название до 200 символов, профиль до 15000, до 15 вакансий")
	}
	seen := map[string]bool{}
	for _, id := range p.ApplicationIDs {
		if seen[id] {
			return Fail(400, "Повторяющиеся вакансии")
		}
		seen[id] = true
	}
	return nil
}
func (s *Store) Profiles(user string) ([]Profile, error) { return list[Profile](s.DB, user, "profile") }
func (s *Store) SaveProfile(user string, p Profile) (Profile, error) {
	e := s.transaction(func(tx *sql.Tx) error {
		if e := validateProfile(p); e != nil {
			return e
		}
		if p.ID == "" {
			all, e := list[Profile](tx, user, "profile")
			if e != nil {
				return e
			}
			if len(all) >= 3 {
				return Fail(400, "Можно создать не больше трёх направлений")
			}
			p.ID = ID()
			p.Version = 1
			p.GeneratedAt = ""
		} else {
			old, e := get[Profile](tx, user, "profile", p.ID)
			if e != nil {
				return e
			}
			if p.Version != old.Version {
				return Fail(409, "Профиль изменился. Обновите страницу")
			}
			p.Version++
			p.GeneratedAt = old.GeneratedAt
		}
		for _, id := range p.ApplicationIDs {
			if _, e := get[Application](tx, user, "application", id); e != nil {
				return e
			}
		}
		if p.ApplicationIDs == nil {
			p.ApplicationIDs = []string{}
		}
		p.UpdatedAt = now()
		return put(tx, user, "profile", p.ID, p)
	})
	return p, e
}
func (s *Store) DeleteProfile(user, id string) error {
	return s.transaction(func(tx *sql.Tx) error { return remove(tx, user, "profile", id) })
}
func candidateContextTx(tx *sql.Tx, user string) (string, error) {
	var v struct {
		Text string `json:"text"`
	}
	e := tx.QueryRow("SELECT payload FROM documents WHERE user_id=? AND kind='candidate_context'", user).Scan(new(string))
	if isNoRows(e) {
		return "", nil
	}
	if e != nil {
		return "", e
	}
	rows, e := list[struct {
		Text string `json:"text"`
	}](tx, user, "candidate_context")
	if e != nil {
		return "", e
	}
	if len(rows) > 0 {
		v = rows[0]
	}
	return v.Text, nil
}
func (s *Store) CandidateContext(user string) (string, error) {
	var text string
	e := s.transaction(func(tx *sql.Tx) error { var e error; text, e = candidateContextTx(tx, user); return e })
	return text, e
}
func (s *Store) SaveCandidateContext(user, text string) error {
	if textLength(text) > 10000 {
		return Fail(400, "Опыт и цели: до 10000 символов")
	}
	return s.transaction(func(tx *sql.Tx) error {
		return put(tx, user, "candidate_context", "candidate-context-"+user, map[string]string{"text": text})
	})
}
