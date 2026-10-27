package core

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"time"
)

const SchemaVersion = 14

type Store struct {
	DB   *sql.DB
	Path string
	lock *os.File
	Now  func() time.Time
}

func (s *Store) nowTime() time.Time {
	if s != nil && s.Now != nil {
		return s.Now()
	}
	return time.Now().UTC()
}

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func ID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func decode(raw string, v any) error { return json.Unmarshal([]byte(raw), v) }
func Open(path string) (*Store, error) {
	path, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	} else if !os.IsNotExist(err) {
		return nil, err
	} else {
		parent, err := filepath.EvalSymlinks(filepath.Dir(path))
		if err != nil {
			return nil, err
		}
		path = filepath.Join(parent, filepath.Base(path))
	}
	file, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = file.Chmod(0600); e != nil {
		file.Close()
		return nil, e
	}
	if e = file.Close(); e != nil {
		return nil, e
	}
	lock, e := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = lockShared(lock); e != nil {
		lock.Close()
		return nil, fmt.Errorf("база занята восстановлением: %w", e)
	}
	db, e := sql.Open("sqlite", path+"?_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)")
	if e != nil {
		lock.Close()
		return nil, e
	}
	db.SetMaxOpenConns(1)
	s := &Store{DB: db, Path: path, lock: lock}
	// Back up existing databases before applying a newer schema.
	var exists int
	if e = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='schema_migrations'").Scan(&exists); e != nil {
		s.Close()
		return nil, e
	}
	if exists != 0 {
		var version int
		if e = db.QueryRow("SELECT coalesce(max(version),0) FROM schema_migrations").Scan(&version); e != nil {
			s.Close()
			return nil, e
		}
		if version > 0 && version < SchemaVersion {
			if _, e = s.Backup(filepath.Join(filepath.Dir(path), "backups")); e != nil {
				s.Close()
				return nil, fmt.Errorf("резервная копия перед обновлением: %w", e)
			}
		}
	}
	if e = s.migrate(); e != nil {
		s.Close()
		return nil, e
	}
	_ = os.Chmod(path, 0600)
	return s, nil
}
func (s *Store) Close() error {
	e := s.DB.Close()
	if s.lock != nil {
		_ = unlockFile(s.lock)
		_ = s.lock.Close()
		s.lock = nil
	}
	return e
}
func (s *Store) migrate() error {
	ctx := context.Background()
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)"); e != nil {
		return e
	}
	var version int
	if e = tx.QueryRowContext(ctx, "SELECT coalesce(max(version),0) FROM schema_migrations").Scan(&version); e != nil {
		return e
	}
	if version > SchemaVersion {
		return fmt.Errorf("база создана более новой версией приложения (схема %d)", version)
	}
	migrations := []string{` CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','active','blocked')),timezone TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS documents_owner ON documents(user_id,kind,created_at);
 CREATE UNIQUE INDEX IF NOT EXISTS unique_hh ON documents(user_id,json_extract(payload,'$.hhId')) WHERE kind='application' AND json_extract(payload,'$.hhId')!='';
 CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,resource TEXT NOT NULL,PRIMARY KEY(user_id,key));
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,action TEXT NOT NULL,user_id TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
`, `CREATE INDEX IF NOT EXISTS documents_application ON documents(user_id,kind,json_extract(payload,'$.applicationId'),created_at); CREATE INDEX IF NOT EXISTS documents_status ON documents(user_id,kind,json_extract(payload,'$.status'),created_at);`, `CREATE TABLE IF NOT EXISTS calendar_subscriptions(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token TEXT NOT NULL UNIQUE);`, `CREATE TABLE IF NOT EXISTS password_resets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,password_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id,status);`, `CREATE TABLE IF NOT EXISTS extension_download_tokens(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token TEXT NOT NULL UNIQUE);`, `
UPDATE documents SET payload = json_set(payload,
  '$.groups', json_array(json_extract(payload, '$.groups[0]')),
  '$.tags', json((SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(documents.payload, '$.tags')
    UNION
    SELECT value FROM json_each(documents.payload, '$.groups') WHERE key > 0
  ))),
  '$.version', json_extract(payload, '$.version') + 1
) WHERE kind = 'application' AND json_array_length(payload, '$.groups') > 1;
`, `CREATE TABLE instance_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO instance_metadata VALUES('transfer_source',lower(hex(randomblob(32))));
CREATE TABLE import_origins(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,origin TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(user_id,kind,origin));
CREATE INDEX import_origins_target ON import_origins(user_id,kind,target_id);`, `CREATE TABLE IF NOT EXISTS resumes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,next_version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS resumes_user ON resumes(user_id,created_at);
CREATE TABLE IF NOT EXISTS resume_versions(id TEXT PRIMARY KEY,resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,version_number INTEGER NOT NULL,filename TEXT NOT NULL,format TEXT NOT NULL,size INTEGER NOT NULL,checksum TEXT NOT NULL,content BLOB NOT NULL,created_at TEXT NOT NULL,UNIQUE(resume_id,version_number));
CREATE INDEX IF NOT EXISTS resume_versions_resume ON resume_versions(resume_id,version_number);
CREATE INDEX IF NOT EXISTS resume_versions_user ON resume_versions(user_id);
CREATE TABLE IF NOT EXISTS reminder_records(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,application_id TEXT NOT NULL,task_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,application_id));
INSERT OR IGNORE INTO instance_metadata(key,value) VALUES('rollout_cutoff',datetime('now'));`, `CREATE TABLE IF NOT EXISTS reminder_eligibility(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,application_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,application_id));
CREATE INDEX IF NOT EXISTS reminder_eligibility_user ON reminder_eligibility(user_id);`, `CREATE TABLE IF NOT EXISTS daily_goal_ledger(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('created', 'applied', 'task_completed', 'interview_completed')),
  object_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, object_id, action)
);
CREATE INDEX IF NOT EXISTS daily_goal_ledger_user_date ON daily_goal_ledger(user_id, local_date);
CREATE UNIQUE INDEX IF NOT EXISTS daily_goal_ledger_completion ON daily_goal_ledger(user_id, object_id) WHERE action IN ('task_completed', 'interview_completed');
INSERT OR IGNORE INTO daily_goal_ledger(id, user_id, action, object_id, local_date, points, created_at)
  SELECT lower(hex(randomblob(16))), user_id, 'created', id, coalesce(json_extract(payload, '$.savedDate'), ''), 0, created_at
  FROM documents WHERE kind='application';
INSERT OR IGNORE INTO daily_goal_ledger(id, user_id, action, object_id, local_date, points, created_at)
  SELECT lower(hex(randomblob(16))), user_id, 'applied', id, coalesce(json_extract(payload, '$.appliedDate'), ''), 0, created_at
  FROM documents WHERE kind='application' AND (json_extract(payload, '$.stage') != 'saved' OR coalesce(json_extract(payload, '$.appliedDate'), '') != '');
INSERT OR IGNORE INTO daily_goal_ledger(id, user_id, action, object_id, local_date, points, created_at)
  SELECT lower(hex(randomblob(16))), user_id,
    CASE WHEN json_extract(payload, '$.kind') = 'interview' THEN 'interview_completed' ELSE 'task_completed' END,
    id, coalesce(json_extract(payload, '$.date'), ''), 0, created_at
  FROM documents WHERE kind='task' AND json_extract(payload, '$.state') = 'done';`, `CREATE TABLE IF NOT EXISTS push_subscriptions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_session ON push_subscriptions(session_id);
CREATE TABLE IF NOT EXISTS push_outbox(
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  digest_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  tag TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'expired', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_token TEXT NOT NULL DEFAULT '',
  leased_until TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscription_id, local_date, digest_type)
);
CREATE INDEX IF NOT EXISTS push_outbox_claim ON push_outbox(status, next_attempt_at, leased_until);
CREATE INDEX IF NOT EXISTS push_outbox_user ON push_outbox(user_id);`, telegramMigration, `ALTER TABLE telegram_challenges ADD COLUMN client_kind TEXT NOT NULL DEFAULT 'web' CHECK(client_kind IN ('web','extension'));`, mcpMigration}
	for i, migration := range migrations {
		if i+1 <= version {
			continue
		}
		if _, e = tx.ExecContext(ctx, migration); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(?)", i+1); e != nil {
			return e
		}
	}

	var colCount int
	_ = tx.QueryRowContext(ctx, "SELECT count(*) FROM pragma_table_info('resumes') WHERE name='next_version'").Scan(&colCount)
	if colCount == 0 {
		var tblCount int
		_ = tx.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='resumes'").Scan(&tblCount)
		if tblCount > 0 {
			_, _ = tx.ExecContext(ctx, "ALTER TABLE resumes ADD COLUMN next_version INTEGER NOT NULL DEFAULT 1")
		}
	}

	return tx.Commit()
}
func get[T any](q queryer, user, kind, id string) (T, error) {
	var out T
	var raw string
	e := q.QueryRowContext(context.Background(), "SELECT payload FROM documents WHERE id=? AND user_id=? AND kind=?", id, user, kind).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return out, Fail(404, "Запись не найдена")
	}
	if e != nil {
		return out, e
	}
	e = json.Unmarshal([]byte(raw), &out)
	return out, e
}
func list[T any](q queryer, user, kind string) ([]T, error) {
	order := "DESC"
	if kind == "field" {
		order = "ASC"
	}
	rows, e := q.QueryContext(context.Background(), "SELECT payload FROM documents WHERE user_id=? AND kind=? ORDER BY created_at "+order+",id", user, kind)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var raw string
		var v T
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(raw), &v); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func put(q queryer, user, kind, id string, v any) error {
	raw, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = q.ExecContext(context.Background(), `INSERT INTO documents(id,user_id,kind,payload,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE documents.user_id=excluded.user_id AND documents.kind=excluded.kind`, id, user, kind, string(raw), now())
	return e
}
func remove(q queryer, user, kind, id string) error {
	r, e := q.ExecContext(context.Background(), "DELETE FROM documents WHERE id=? AND user_id=? AND kind=?", id, user, kind)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return Fail(404, "Запись не найдена")
	}
	return nil
}
func event(q queryer, user, app, kind, source string, diff map[string]any) error {
	e := Event{ID: ID(), ApplicationID: app, Kind: kind, Source: source, Changes: diff, CreatedAt: now()}
	return put(q, user, "event", e.ID, e)
}
func (s *Store) transaction(fn func(*sql.Tx) error) error {
	tx, e := s.DB.BeginTx(context.Background(), nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = fn(tx); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Fields(user string) ([]Field, error) { return list[Field](s.DB, user, "field") }
func (s *Store) Applications(user string) ([]Application, error) {
	apps, err := list[Application](s.DB, user, "application")
	if err != nil {
		return nil, err
	}
	events, err := list[Event](s.DB, user, "event")
	if err != nil {
		return nil, err
	}
	currentTime := time.Now().UTC()
	for i := range apps {
		apps[i] = EnrichApplication(apps[i], events, currentTime)
	}
	return apps, nil
}
func (s *Store) Application(user, id string) (Application, error) {
	app, err := get[Application](s.DB, user, "application", id)
	if err != nil {
		return app, err
	}
	events, err := s.Events(user)
	if err != nil {
		return app, err
	}
	return EnrichApplication(app, events, time.Now().UTC()), nil
}
func (s *Store) Tasks(user string) ([]Task, error)   { return list[Task](s.DB, user, "task") }
func (s *Store) Notes(user string) ([]Note, error)   { return list[Note](s.DB, user, "note") }
func (s *Store) Events(user string) ([]Event, error) { return list[Event](s.DB, user, "event") }
func (s *Store) Proposals(user string) ([]Proposal, error) {
	return list[Proposal](s.DB, user, "proposal")
}
func (s *Store) User(id string) (User, error) {
	var u User
	e := s.DB.QueryRow("SELECT id,email,status,timezone,created_at FROM users WHERE id=?", id).Scan(&u.ID, &u.Email, &u.Status, &u.Timezone, &u.CreatedAt)
	return u, e
}
func (s *Store) localDate(q queryer, user string) string {
	var tz string
	_ = q.QueryRowContext(context.Background(), "SELECT timezone FROM users WHERE id=?", user).Scan(&tz)
	loc, e := time.LoadLocation(tz)
	if e != nil {
		loc = time.UTC
	}
	return s.nowTime().In(loc).Format("2006-01-02")
}
func localDate(q queryer, user string) string {
	var tz string
	_ = q.QueryRowContext(context.Background(), "SELECT timezone FROM users WHERE id=?", user).Scan(&tz)
	loc, e := time.LoadLocation(tz)
	if e != nil {
		loc = time.UTC
	}
	return time.Now().In(loc).Format("2006-01-02")
}

func related[T any](q queryer, user, kind, appID string) ([]T, error) {
	rows, e := q.QueryContext(context.Background(), "SELECT payload FROM documents WHERE user_id=? AND kind=? AND json_extract(payload,'$.applicationId')=? ORDER BY created_at DESC,id", user, kind, appID)
	if e != nil {
		return nil, e
	}
	return documentsFromRows[T](rows)
}
func documentsFromRows[T any](rows *sql.Rows) ([]T, error) {
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var raw string
		var value T
		if e := rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e := decode(raw, &value); e != nil {
			return nil, e
		}
		out = append(out, value)
	}
	return out, rows.Err()
}
func (s *Store) PendingProposals(user string) ([]Proposal, error) {
	rows, e := s.DB.Query("SELECT payload FROM documents WHERE user_id=? AND kind='proposal' AND json_extract(payload,'$.status')='pending' ORDER BY created_at DESC,id", user)
	if e != nil {
		return nil, e
	}
	return documentsFromRows[Proposal](rows)
}
func (s *Store) Detail(user, id string) (Detail, error) {
	var d Detail
	e := s.transaction(func(tx *sql.Tx) error {
		var e error
		d.Application, e = get[Application](tx, user, "application", id)
		if e != nil {
			return e
		}
		d.Notes, e = related[Note](tx, user, "note", id)
		if e != nil {
			return e
		}
		d.Events, e = related[Event](tx, user, "event", id)
		if e != nil {
			return e
		}
		d.Application = EnrichApplication(d.Application, d.Events, time.Now().UTC())
		d.Tasks, e = related[Task](tx, user, "task", id)
		if e != nil {
			return e
		}
		proposals, e := related[Proposal](tx, user, "proposal", id)
		if e != nil {
			return e
		}
		d.Proposals = []Proposal{}
		for _, p := range proposals {
			if p.Status == "pending" {
				d.Proposals = append(d.Proposals, p)
			}
		}
		return nil
	})
	return d, e
}
