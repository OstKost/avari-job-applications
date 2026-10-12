package main

import (
	"fmt"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"path/filepath"
	"strings"
	"testing"
)

func TestApprovalRequiresConfirmation(t *testing.T) {
	s, e := core.Open(filepath.Join(t.TempDir(), "avari.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	u, e := s.Register("tui@example.com", "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	m := model{store: s, dbPath: s.Path, backupDir: filepath.Join(filepath.Dir(s.Path), "backups"), height: 40, width: 110}
	next, _ := m.Update(m.load()())
	m = next.(model)
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	m = next.(model)
	if cmd != nil || m.action != "approve" || m.prompt == "" {
		t.Fatal("approval not gated")
	}
	pending, _ := s.User(u.ID)
	if pending.Status != "pending" {
		t.Fatal("changed before confirmation")
	}
	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if cmd == nil || !m.busy {
		t.Fatal("missing operation")
	}
	msg := cmd()
	if result, ok := msg.(result); !ok || result.err != nil {
		t.Fatal(msg)
	}
	active, _ := s.User(u.ID)
	if active.Status != "active" {
		t.Fatal("not approved")
	}
}

func TestPasswordResetTUIApprovalAndRejection(t *testing.T) {
	s, e := core.Open(filepath.Join(t.TempDir(), "avari.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	u, e := s.Register("reset-tui@example.com", "original-password-123", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	_ = s.Admin("approve", u.ID, "")

	if e = s.RequestPasswordReset(u.Email, "approved-new-password"); e != nil {
		t.Fatal(e)
	}

	m := model{store: s, dbPath: s.Path, backupDir: filepath.Join(filepath.Dir(s.Path), "backups"), height: 40, width: 110}
	next, _ := m.Update(m.load()())
	m = next.(model)

	// Switch to subtab 1 (password resets)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}})
	m = next.(model)
	if m.subtab != 1 || len(m.visibleResets()) != 1 {
		t.Fatalf("subtab not 1 or resets empty: subtab=%d, count=%d", m.subtab, len(m.visibleResets()))
	}

	// Verify plaintext password is NEVER in View
	view := m.View()
	if strings.Contains(view, "approved-new-password") {
		t.Fatal("plaintext password leaked in TUI view!")
	}

	// Press 'a' to approve
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	m = next.(model)
	if cmd != nil || m.action != "approve_reset" || m.prompt == "" {
		t.Fatal("approval not gated")
	}
	// Confirm with Enter
	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if cmd == nil || !m.busy {
		t.Fatal("execute not triggered")
	}
	msg := cmd()
	if res, ok := msg.(result); !ok || res.err != nil {
		t.Fatal("execution error:", msg)
	}

	// User can now log in with approved new password
	if _, _, _, e = s.Login(u.Email, "approved-new-password", "web", ""); e != nil {
		t.Fatal("could not login with approved password:", e)
	}
}

func TestSearchAndCancel(t *testing.T) {
	m := model{users: []core.User{{ID: "a", Email: "alice@example.com", Status: "pending", CreatedAt: "2026-10-09"}, {ID: "b", Email: "bob@example.com", Status: "active", CreatedAt: "2026-10-09"}}, height: 30, width: 100, section: 1}
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	m = next.(model)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("alice")})
	m = next.(model)
	if len(m.visibleUsers()) != 1 {
		t.Fatal("search failed")
	}
	m.prompt = "confirmation"
	m.action = "block"
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	m = next.(model)
	if cmd != nil || m.action != "" || m.prompt != "" {
		t.Fatal("cancel failed")
	}
}

func TestOperationErrorSurvivesRefresh(t *testing.T) {
	m := model{message: "Old success"}
	next, _ := m.Update(result{err: fmt.Errorf("Stop the server"), message: "Restored successfully"})
	m = next.(model)
	next, _ = m.Update(loaded{users: []core.User{}, audit: []core.Audit{}, backups: []string{}})
	m = next.(model)
	if m.err == nil || m.message != "" || !strings.Contains(m.View(), "Stop the server") {
		t.Fatal("operation error replaced by success")
	}
}

func TestCobraRootCommand(t *testing.T) {
	cmd := buildRootCommand()
	if cmd == nil {
		t.Fatal("nil command")
	}
	if cmd.Use != "avari-admin" {
		t.Fatalf("unexpected use: %s", cmd.Use)
	}
	dbFlag := cmd.Flag("db")
	if dbFlag == nil || dbFlag.Shorthand != "d" {
		t.Fatal("missing --db / -d flag")
	}
	backupFlag := cmd.Flag("backups")
	if backupFlag == nil || backupFlag.Shorthand != "b" {
		t.Fatal("missing --backups / -b flag")
	}
}

func TestLayoutFitsTerminal(t *testing.T) {
	for _, size := range [][2]int{{120, 40}, {110, 30}, {80, 30}, {52, 24}} {
		for section := 0; section < 4; section++ {
			m := model{width: size[0], height: size[1], section: section}
			for i := 0; i < 60; i++ {
				m.users = append(m.users, core.User{ID: "user-id", Email: fmt.Sprintf("user-%d@example.com", i), Status: "pending", Timezone: "Europe/Moscow", CreatedAt: "2026-10-11"})
				m.audits = append(m.audits, core.Audit{Action: "approve", Detail: "Registration approved", CreatedAt: "2026-10-11T10:00:00Z"})
				m.backups = append(m.backups, "backup-2026-10-11.db")
			}
			view := m.View()
			if lipgloss.Width(view) > m.width || lipgloss.Height(view) > m.height {
				t.Errorf("section %d at %dx%d: rendered %dx%d", section, m.width, m.height, lipgloss.Width(view), lipgloss.Height(view))
			}
		}
	}
}

func TestTableDoesNotWrapDates(t *testing.T) {
	for w := 52; w <= 180; w += 8 {
		m := model{
			width:   w,
			height:  30,
			section: 1,
			users: []core.User{
				{ID: "02d20652efb0455a49304c7363f98f49", Email: "test1@test.test", Status: "active", CreatedAt: "2026-10-11T12:00:00Z"},
				{ID: "other-id", Email: "test@test.test", Status: "active", CreatedAt: "2026-10-11T12:00:00Z"},
			},
		}
		view := m.View()
		for _, line := range strings.Split(view, "\n") {
			if strings.Contains(line, "2026-10-") && !strings.Contains(line, "2026-10-11") {
				t.Fatalf("date wrapped at width %d:\n%s", w, line)
			}
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "│ 11") {
				t.Fatalf("date day wrapped at width %d:\n%s", w, line)
			}
		}

		mAudit := model{
			width:   w,
			height:  30,
			section: 2,
			audits: []core.Audit{
				{Action: "approve", Detail: "Approved", UserID: "1", CreatedAt: "2026-10-11 12:00:00"},
			},
		}
		viewAudit := mAudit.View()
		for _, line := range strings.Split(viewAudit, "\n") {
			if strings.Contains(line, "2026-10-11") && !strings.Contains(line, "12:00:00") && w >= 60 {
				t.Fatalf("audit timestamp broken at width %d:\n%s", w, line)
			}
		}
	}
}

func TestActionMenuSelection(t *testing.T) {
	s, e := core.Open(filepath.Join(t.TempDir(), "avari.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	u, e := s.Register("menu-test@example.com", "secure-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	m := model{store: s, dbPath: s.Path, backupDir: filepath.Join(filepath.Dir(s.Path), "backups"), height: 35, width: 110}
	next, _ := m.Update(m.load()())
	m = next.(model)

	// Press Enter to open action menu
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if !m.actionMenuOpen {
		t.Fatal("action menu did not open on Enter")
	}
	view := m.View()
	if !strings.Contains(view, "Выберите действие") || !strings.Contains(view, "Одобрить регистрацию") {
		t.Fatal("action menu not visible in View")
	}

	// Press Enter to trigger selected action (1. Одобрить регистрацию)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if m.actionMenuOpen {
		t.Fatal("action menu remained open")
	}
	if m.action != "approve" || m.target != u.ID || m.prompt == "" {
		t.Fatalf("unexpected action triggered: %s, prompt: %s", m.action, m.prompt)
	}
}

func TestVerifyZeroBackgroundLeaks(t *testing.T) {
	origProfile := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(0) // TrueColor
	defer lipgloss.SetColorProfile(origProfile)

	for _, w := range []int{52, 80, 110, 120} {
		for section := 0; section < 4; section++ {
			m := model{width: w, height: 35, section: section}
			m.users = append(m.users, core.User{ID: "02d20652efb0455a49304c7363f98f49", Email: "test1@test.test", Status: "pending", Timezone: "Europe/Moscow", CreatedAt: "2026-10-11"})
			m.audits = append(m.audits, core.Audit{Action: "approve", Detail: "detail", CreatedAt: "2026-10-11 12:00:00"})
			m.backups = append(m.backups, "backup.db")

			v := m.View()
			lines := strings.Split(v, "\n")
			for lineIdx, l := range lines {
				currentBg := ""
				for j := 0; j < len(l); {
					if l[j:j+1] == "\x1b" {
						end := strings.Index(l[j:], "m")
						seq := l[j : j+end+1]
						if seq == "\x1b[0m" || seq == "\x1b[m" {
							currentBg = ""
						} else if strings.Contains(seq, "48;2;") || strings.Contains(seq, "48;5;") {
							currentBg = seq
						}
						j += end + 1
						continue
					}
					ch := l[j : j+1]
					if currentBg == "" && ch != "\r" && ch != "" {
						t.Fatalf("Background leak at width %d section %d line %d col %d (char %q): %s", w, section, lineIdx, j, ch, l)
					}
					j++
				}
			}
		}
	}
}



