package core

import (
	"database/sql"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Store) Backup(dir string) (string, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	path, e := filepath.Abs(filepath.Join(dir, "avari-"+time.Now().UTC().Format("20060102-150405")+"-"+ID()[:8]+".db"))
	if e != nil {
		return "", e
	}
	_, e = s.DB.Exec("VACUUM INTO '" + strings.ReplaceAll(path, "'", "''") + "'")
	if e != nil {
		return "", e
	}
	if e = os.Chmod(path, 0600); e != nil {
		return "", e
	}
	if e = CheckBackup(path); e != nil {
		_ = os.Remove(path)
		return "", e
	}
	if e = audit(s.DB, "backup", "", filepath.Base(path)); e != nil {
		return "", e
	}
	return path, nil
}
func CheckBackup(path string) error {
	info, e := os.Stat(path)
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("копия должна быть обычным файлом")
	}
	db, e := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if e != nil {
		return e
	}
	defer db.Close()
	var check string
	if e = db.QueryRow("PRAGMA integrity_check").Scan(&check); e != nil || check != "ok" {
		return fmt.Errorf("резервная копия повреждена: %s %v", check, e)
	}
	var version int
	if e = db.QueryRow("SELECT max(version) FROM schema_migrations").Scan(&version); e != nil || (version < 1 || version > SchemaVersion) {
		return fmt.Errorf("несовместимая версия резервной копии")
	}
	var count int
	return db.QueryRow("SELECT count(*) FROM users").Scan(&count)
}

// Restore releases this TUI's shared lock and requires all other processes to be stopped.
// The caller must reopen the store after Restore, whether it succeeds or fails.
func (s *Store) Restore(path, dir string) error {
	if e := CheckBackup(path); e != nil {
		return e
	}
	target, _ := filepath.Abs(path)
	if target == s.Path {
		return fmt.Errorf("нельзя восстановить базу из самой себя")
	}
	if e := s.DB.Close(); e != nil {
		return e
	}
	if e := unix.Flock(int(s.lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); e != nil {
		return fmt.Errorf("остановите сервер и другие TUI перед восстановлением: %w", e)
	}
	defer s.Close()
	old, e := sql.Open("sqlite", s.Path+"?_pragma=busy_timeout(10000)")
	if e != nil {
		return e
	}
	s.DB = old
	if _, e = s.Backup(dir); e != nil {
		return e
	}
	if _, e = s.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); e != nil {
		return e
	}
	if e = s.DB.Close(); e != nil {
		return e
	}
	temp := s.Path + ".restore-" + ID()
	source, e := os.Open(path)
	if e != nil {
		return e
	}
	defer source.Close()
	output, e := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = io.Copy(output, source)
	closeErr := output.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	defer os.Remove(temp)
	// Remove restored credentials before the replacement becomes visible.
	candidate, e := sql.Open("sqlite", temp+"?_pragma=journal_mode(DELETE)")
	if e != nil {
		return e
	}
	tx, e := candidate.Begin()
	if e != nil {
		candidate.Close()
		return e
	}
	if _, e = tx.Exec("DELETE FROM sessions"); e == nil {
		var version int
		e = tx.QueryRow("SELECT max(version) FROM schema_migrations").Scan(&version)
		if e == nil && version >= 3 {
			_, e = tx.Exec("DELETE FROM calendar_subscriptions")
		}
	}
	if e == nil {
		e = audit(tx, "restore", "", filepath.Base(path))
	}
	if e != nil {
		tx.Rollback()
		candidate.Close()
		return e
	}
	if e = tx.Commit(); e != nil {
		candidate.Close()
		return e
	}
	if e = candidate.Close(); e != nil {
		return e
	}
	f, e := os.OpenFile(temp, os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	e = f.Sync()
	f.Close()
	if e != nil {
		return e
	}
	_ = os.Remove(s.Path + "-wal")
	_ = os.Remove(s.Path + "-shm")
	if e = os.Rename(temp, s.Path); e != nil {
		return e
	}
	parent, e := os.Open(filepath.Dir(s.Path))
	if e != nil {
		return e
	}
	e = parent.Sync()
	parent.Close()
	if e != nil {
		return e
	}
	return nil
}
