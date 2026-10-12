package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/spf13/cobra"
)

var (
	colorBgDark        = lipgloss.Color("#142B39") // var(--bg)
	colorPanel         = lipgloss.Color("#193546") // var(--panel)
	colorPanel2        = lipgloss.Color("#204354") // var(--panel-2)
	colorLine          = lipgloss.Color("#315363") // var(--line)
	colorText          = lipgloss.Color("#EEF6FC") // var(--text)
	colorMuted         = lipgloss.Color("#ADC3D3") // var(--muted)
	colorAccent        = lipgloss.Color("#57C8ED") // var(--accent)
	colorAccentStrong  = lipgloss.Color("#1B7FDC") // var(--accent-strong)
	colorAccentSoft    = lipgloss.Color("#164B68") // var(--accent-soft)
	colorDanger        = lipgloss.Color("#FF9A9A") // var(--danger)
	colorWarn          = lipgloss.Color("#F6C76D")
	colorSuccess       = lipgloss.Color("#57C8ED")
	styleSubtitle      = lipgloss.NewStyle().Bold(true).Foreground(colorAccent)
	styleMuted         = lipgloss.NewStyle().Foreground(colorMuted)
	styleDanger        = lipgloss.NewStyle().Foreground(colorDanger)
	styleSuccess       = lipgloss.NewStyle().Foreground(colorSuccess)
	styleWarn          = lipgloss.NewStyle().Foreground(colorWarn)
	styleKeyBadge      = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
	styleKeyAction     = lipgloss.NewStyle().Foreground(colorMuted)
	styleStatusActive  = lipgloss.NewStyle().Foreground(colorAccent)
	styleStatusPending = lipgloss.NewStyle().Foreground(colorWarn)
	styleStatusBlocked = lipgloss.NewStyle().Foreground(colorDanger)
)

type loaded struct {
	users   []core.User
	resReqs []core.PasswordResetRequest
	audit   []core.Audit
	backups []string
	err     error
}

type result struct {
	err     error
	message string
}

type model struct {
	store                                                  *core.Store
	dbPath, backupDir                                      string
	users                                                  []core.User
	resReqs                                                []core.PasswordResetRequest
	audits                                                 []core.Audit
	backups                                                []string
	section, subtab, cursor, height, width                 int
	filter, search, input, prompt, action, target, message string
	searching, busy                                        bool
	actionMenuOpen                                         bool
	actionMenuIdx                                          int
	err                                                    error
}

type actionItem struct {
	key   string
	icon  string
	label string
	act   string
}

func (m model) currentActions() []actionItem {
	var items []actionItem
	switch m.section {
	case 0:
		if m.subtab == 1 {
			if len(m.visibleResets()) > 0 {
				items = append(items,
					actionItem{key: "a", icon: "✓", label: "Одобрить смену пароля", act: "approve_reset"},
					actionItem{key: "d", icon: "✕", label: "Отклонить смену пароля", act: "reject_reset"},
				)
			}
		} else {
			if len(m.visibleUsers()) > 0 {
				items = append(items,
					actionItem{key: "a", icon: "✓", label: "Одобрить регистрацию", act: "approve"},
					actionItem{key: "b", icon: "⊘", label: "Заблокировать аккаунт", act: "block"},
					actionItem{key: "u", icon: "🔓", label: "Разблокировать аккаунт", act: "unblock"},
					actionItem{key: "p", icon: "🔑", label: "Задать новый пароль", act: "password_input"},
					actionItem{key: "x", icon: "⚡", label: "Отозвать активные сессии", act: "revoke_sessions"},
				)
			}
		}
	case 1:
		if len(m.visibleUsers()) > 0 {
			items = append(items,
				actionItem{key: "a", icon: "✓", label: "Одобрить регистрацию", act: "approve"},
				actionItem{key: "b", icon: "⊘", label: "Заблокировать аккаунт", act: "block"},
				actionItem{key: "u", icon: "🔓", label: "Разблокировать аккаунт", act: "unblock"},
				actionItem{key: "p", icon: "🔑", label: "Задать новый пароль", act: "password_input"},
				actionItem{key: "x", icon: "⚡", label: "Отозвать активные сессии", act: "revoke_sessions"},
			)
		}
	case 3:
		if len(m.visibleBackups()) > 0 {
			items = append(items,
				actionItem{key: "Enter", icon: "🔄", label: "Восстановить базу данных", act: "restore"},
			)
		}
	}
	items = append(items, actionItem{key: "n", icon: "💾", label: "Создать резервную копию", act: "backup"})
	return items
}

func renderLines(s lipgloss.Style, text string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = s.Render(l)
	}
	return strings.Join(lines, "\n")
}

func bgCodeFor(c lipgloss.Color) string {
	s := lipgloss.NewStyle().Background(c).Render("X")
	idx := strings.Index(s, "X")
	if idx > 0 {
		return s[:idx]
	}
	return ""
}

func patchBg(s string, bg lipgloss.Color) string {
	code := bgCodeFor(bg)
	if code == "" {
		return s
	}
	s = strings.ReplaceAll(s, "\x1b[0m", "\x1b[0m"+code)
	s = strings.ReplaceAll(s, "\x1b[m", "\x1b[m"+code)
	return code + s + "\x1b[0m"
}

func (m model) triggerAction(act string) (model, tea.Cmd) {
	m.err = nil
	m.message = ""
	m.actionMenuOpen = false

	switch act {
	case "backup":
		m.action = "backup"
		m.prompt = "Создать резервную копию? Enter — подтвердить, Esc — отменить"
		return m, nil
	case "restore":
		if m.section == 3 && len(m.visibleBackups()) > 0 && m.cursor < len(m.visibleBackups()) {
			m.target = m.visibleBackups()[m.cursor]
			m.action = "restore"
			m.prompt = "Восстановить " + filepath.Base(m.target) + "? Сервер должен быть остановлен. Текущая база будет скопирована. Все сессии будут отозваны. Enter — подтвердить, Esc — отменить"
		}
		return m, nil
	case "approve_reset":
		if m.section == 0 && m.subtab == 1 && len(m.visibleResets()) > 0 && m.cursor < len(m.visibleResets()) {
			pr := m.visibleResets()[m.cursor]
			m.target = pr.ID
			m.action = "approve_reset"
			m.prompt = "Одобрить новый пароль для " + pr.UserEmail + "? Пароль обновится, сессии будут отозваны. Enter — подтвердить, Esc — отменить"
		}
		return m, nil
	case "reject_reset":
		if m.section == 0 && m.subtab == 1 && len(m.visibleResets()) > 0 && m.cursor < len(m.visibleResets()) {
			pr := m.visibleResets()[m.cursor]
			m.target = pr.ID
			m.action = "reject_reset"
			m.prompt = "Отклонить запрос на смену пароля для " + pr.UserEmail + "? Enter — подтвердить, Esc — отменить"
		}
		return m, nil
	case "approve", "block", "unblock", "revoke_sessions", "password_input":
		if len(m.visibleUsers()) == 0 || m.cursor >= len(m.visibleUsers()) {
			return m, nil
		}
		u := m.visibleUsers()[m.cursor]
		m.target = u.ID
		switch act {
		case "approve":
			m.action = "approve"
			m.prompt = "Одобрить регистрацию " + u.Email + "? Enter — подтвердить, Esc — отменить"
		case "block":
			m.action = "block"
			m.prompt = "Заблокировать " + u.Email + " и отозвать сессии? Enter — подтвердить, Esc — отменить"
		case "unblock":
			m.action = "unblock"
			m.prompt = "Разблокировать " + u.Email + "? Enter — подтвердить, Esc — отменить"
		case "revoke_sessions":
			m.action = "revoke_sessions"
			m.prompt = "Отозвать все сессии " + u.Email + "? Enter — подтвердить, Esc — отменить"
		case "password_input":
			m.action = "password_input"
			m.input = ""
			m.prompt = "Новый пароль для " + u.Email + " (10–256 символов):"
		}
		return m, nil
	}
	return m, nil
}

func (m model) load() tea.Cmd {
	return func() tea.Msg {
		u, e := m.store.Users()
		if e != nil {
			return loaded{err: e}
		}
		pr, e := m.store.PendingPasswordResets()
		if e != nil {
			return loaded{err: e}
		}
		a, e := m.store.Audits()
		if e != nil {
			return loaded{err: e}
		}
		paths, e := filepath.Glob(filepath.Join(m.backupDir, "*.db"))
		sort.Sort(sort.Reverse(sort.StringSlice(paths)))
		return loaded{users: u, resReqs: pr, audit: a, backups: paths, err: e}
	}
}

func (m model) Init() tea.Cmd { return m.load() }

func (m model) visibleUsers() []core.User {
	out := []core.User{}
	for _, u := range m.users {
		if m.section == 0 && u.Status != "pending" {
			continue
		}
		if m.filter != "" && u.Status != m.filter {
			continue
		}
		if !strings.Contains(strings.ToLower(u.Email), strings.ToLower(m.search)) {
			continue
		}
		out = append(out, u)
	}
	return out
}

func (m model) visibleResets() []core.PasswordResetRequest {
	out := []core.PasswordResetRequest{}
	for _, pr := range m.resReqs {
		if !strings.Contains(strings.ToLower(pr.UserEmail), strings.ToLower(m.search)) {
			continue
		}
		out = append(out, pr)
	}
	return out
}

func actionLabel(action string) string {
	labels := map[string]string{
		"approve":               "Одобрение регистрации",
		"block":                 "Блокировка",
		"unblock":               "Разблокировка",
		"reset_password":        "Сброс пароля (вручную)",
		"approve_reset":         "Одобрение смены пароля",
		"reject_reset":          "Отклонение смены пароля",
		"revoke_sessions":       "Отзыв сессий",
		"backup":                "Резервная копия",
		"restore":               "Восстановление базы",
	}
	if name := labels[action]; name != "" {
		return name
	}
	return "Операция"
}

func (m model) userLabel(id string) string {
	for _, u := range m.users {
		if u.ID == id {
			return u.Email
		}
	}
	return id
}

func (m model) visibleAudits() []core.Audit {
	out := []core.Audit{}
	for _, a := range m.audits {
		searchCorpus := actionLabel(a.Action) + " " + a.Action + " " + a.Detail + " " + m.userLabel(a.UserID)
		if strings.Contains(strings.ToLower(searchCorpus), strings.ToLower(m.search)) {
			out = append(out, a)
		}
	}
	return out
}

func (m model) visibleBackups() []string {
	out := []string{}
	for _, p := range m.backups {
		if strings.Contains(strings.ToLower(filepath.Base(p)), strings.ToLower(m.search)) {
			out = append(out, p)
		}
	}
	return out
}

func (m model) count() int {
	if m.section == 0 {
		if m.subtab == 1 {
			return len(m.visibleResets())
		}
		return len(m.visibleUsers())
	}
	if m.section == 1 {
		return len(m.visibleUsers())
	}
	if m.section == 2 {
		return len(m.visibleAudits())
	}
	return len(m.visibleBackups())
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	case loaded:
		m.users = msg.users
		m.resReqs = msg.resReqs
		m.audits = msg.audit
		m.backups = msg.backups
		if msg.err != nil {
			m.err = msg.err
		}
		m.busy = false
		if m.cursor >= m.count() {
			m.cursor = max(0, m.count()-1)
		}
	case result:
		m.err = msg.err
		if msg.err != nil {
			m.err = fmt.Errorf("%s: %w", actionLabel(m.action), msg.err)
			m.message = ""
		} else {
			m.message = msg.message
		}
		m.busy = false
		m.prompt = ""
		m.input = ""
		m.action = ""
		return m, m.load()
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
		if m.busy {
			return m, nil
		}
		if m.prompt != "" {
			switch msg.String() {
			case "esc":
				m.prompt = ""
				m.action = ""
				m.input = ""
			case "enter":
				if m.action == "password_input" {
					if len(m.input) < 10 {
						m.err = fmt.Errorf("пароль должен содержать минимум 10 символов")
						return m, nil
					}
					m.action = "reset_password"
					m.prompt = "Сбросить пароль и отозвать все сессии? Enter — подтвердить, Esc — отменить"
					return m, nil
				}
				m.busy = true
				return m, m.execute()
			case "backspace", "ctrl+h":
				if m.action == "password_input" && m.input != "" {
					_, size := utf8.DecodeLastRuneInString(m.input)
					m.input = m.input[:len(m.input)-size]
				}
			default:
				if m.action == "password_input" && len(m.input) < 256 {
					m.input += string(msg.Runes)
				}
			}
			return m, nil
		}
		if m.searching {
			switch msg.String() {
			case "esc", "enter":
				m.searching = false
			case "backspace", "ctrl+h":
				if m.search != "" {
					_, size := utf8.DecodeLastRuneInString(m.search)
					m.search = m.search[:len(m.search)-size]
				}
			default:
				m.search += string(msg.Runes)
			}
			m.cursor = 0
			return m, nil
		}
		if m.actionMenuOpen {
			actions := m.currentActions()
			switch msg.String() {
			case "esc":
				m.actionMenuOpen = false
				return m, nil
			case "up", "k":
				if len(actions) > 0 {
					m.actionMenuIdx = (m.actionMenuIdx - 1 + len(actions)) % len(actions)
				}
				return m, nil
			case "down", "j":
				if len(actions) > 0 {
					m.actionMenuIdx = (m.actionMenuIdx + 1) % len(actions)
				}
				return m, nil
			case "enter":
				if len(actions) > 0 && m.actionMenuIdx < len(actions) {
					return m.triggerAction(actions[m.actionMenuIdx].act)
				}
				m.actionMenuOpen = false
				return m, nil
			default:
				// Number selection (1-9)
				if len(msg.String()) == 1 && msg.String()[0] >= '1' && msg.String()[0] <= '9' {
					idx := int(msg.String()[0] - '1')
					if idx < len(actions) {
						return m.triggerAction(actions[idx].act)
					}
				}
			}
		}
		switch msg.String() {
		case "q":
			return m, tea.Quit
		case "tab":
			m.section = (m.section + 1) % 4
			m.cursor = 0
			m.filter = ""
			m.search = ""
			m.actionMenuOpen = false
		case "shift+tab":
			m.section = (m.section + 3) % 4
			m.cursor = 0
			m.filter = ""
			m.search = ""
			m.actionMenuOpen = false
		case "1", "2", "3", "4":
			m.section = int(msg.String()[0] - '1')
			m.cursor = 0
			m.filter = ""
			m.search = ""
			m.actionMenuOpen = false
		case "up", "k":
			m.cursor = max(0, m.cursor-1)
			m.actionMenuOpen = false
		case "down", "j":
			m.cursor = min(max(0, m.count()-1), m.cursor+1)
			m.actionMenuOpen = false
		case "pgdown":
			m.cursor = min(max(0, m.count()-1), m.cursor+m.pageSize())
			m.actionMenuOpen = false
		case "pgup":
			m.cursor = max(0, m.cursor-m.pageSize())
			m.actionMenuOpen = false
		case "/":
			m.searching = true
			m.actionMenuOpen = false
		case "esc":
			m.search = ""
			m.filter = ""
			m.cursor = 0
			m.actionMenuOpen = false
		case "f":
			if m.section == 1 {
				switch m.filter {
				case "":
					m.filter = "pending"
				case "pending":
					m.filter = "active"
				case "active":
					m.filter = "blocked"
				default:
					m.filter = ""
				}
				m.cursor = 0
			}
		case "t":
			if m.section == 0 {
				m.subtab = (m.subtab + 1) % 2
				m.cursor = 0
				m.actionMenuOpen = false
			}
		case "r":
			m.err = nil
			m.busy = true
			m.actionMenuOpen = false
			return m, m.load()
		case "m", "space":
			actions := m.currentActions()
			if len(actions) > 0 {
				m.actionMenuOpen = !m.actionMenuOpen
				m.actionMenuIdx = 0
			}
		case "enter":
			if m.section == 3 && len(m.visibleBackups()) > 0 {
				return m.triggerAction("restore")
			}
			actions := m.currentActions()
			if len(actions) > 0 {
				m.actionMenuOpen = true
				m.actionMenuIdx = 0
			}
		case "n":
			return m.triggerAction("backup")
		case "d":
			return m.triggerAction("reject_reset")
		case "a":
			if m.section == 0 && m.subtab == 1 {
				return m.triggerAction("approve_reset")
			}
			return m.triggerAction("approve")
		case "b":
			return m.triggerAction("block")
		case "u":
			return m.triggerAction("unblock")
		case "x":
			return m.triggerAction("revoke_sessions")
		case "p":
			return m.triggerAction("password_input")
		}
	}
	return m, nil
}

func (m model) execute() tea.Cmd {
	return func() tea.Msg {
		switch m.action {
		case "backup":
			p, e := m.store.Backup(m.backupDir)
			return result{err: e, message: "Создана копия: " + p}
		case "restore":
			e := m.store.Restore(m.target, m.backupDir)
			_ = m.store.Close()
			reopened, openErr := core.Open(m.dbPath)
			if openErr != nil {
				return result{err: fmt.Errorf("восстановление: %v; открытие базы: %w", e, openErr)}
			}
			*m.store = *reopened
			return result{err: e, message: "База восстановлена; сессии отозваны"}
		case "approve_reset":
			e := m.store.ApprovePasswordReset(m.target)
			return result{err: e, message: "Смена пароля одобрена"}
		case "reject_reset":
			e := m.store.RejectPasswordReset(m.target)
			return result{err: e, message: "Запрос на смену пароля отклонён"}
		default:
			e := m.store.Admin(m.action, m.target, m.input)
			return result{err: e, message: "Операция выполнена"}
		}
	}
}

func state(s string) string {
	switch s {
	case "active":
		return styleStatusActive.Render("● Активен")
	case "pending":
		return styleStatusPending.Render("○ Ожидание")
	default:
		return styleStatusBlocked.Render("✕ Заблокирован")
	}
}

func (m model) renderTable(start, end int) string {
	tableWidth := max(10, m.contentWidth()-2)

	type cellData struct {
		text string
		fg   lipgloss.Color
		bold bool
	}

	var headers []string
	var widths []int
	var rows [][]cellData

	switch m.section {
	case 0:
		if m.subtab == 1 {
			headers = []string{"", "Email", "Запрос на смену пароля", "Дата запроса"}
			wEmail := max(8, tableWidth-47)
			widths = []int{3, wEmail, 23, 19}
			resets := m.visibleResets()
			for i := start; i < end; i++ {
				pr := resets[i]
				marker := "  "
				if i == m.cursor {
					marker = "▶"
				}
				created := pr.CreatedAt
				if len(created) >= 19 {
					created = created[:19]
				}
				rows = append(rows, []cellData{
					{text: marker, fg: colorAccent, bold: true},
					{text: truncate(pr.UserEmail, wEmail-2), fg: colorText},
					{text: "○ Ожидает одобрения", fg: colorWarn},
					{text: created, fg: colorMuted},
				})
			}
		} else {
			headers = []string{"", "Email", "Статус", "Регистрация"}
			wEmail := max(8, tableWidth-39)
			widths = []int{3, wEmail, 18, 14}
			users := m.visibleUsers()
			for i := start; i < end; i++ {
				u := users[i]
				marker := "  "
				if i == m.cursor {
					marker = "▶"
				}
				created := u.CreatedAt
				if len(created) >= 10 {
					created = created[:10]
				}
				stText := "✕ Заблокирован"
				stColor := colorDanger
				if u.Status == "active" {
					stText = "● Активен"
					stColor = colorAccent
				} else if u.Status == "pending" {
					stText = "○ Ожидание"
					stColor = colorWarn
				}
				rows = append(rows, []cellData{
					{text: marker, fg: colorAccent, bold: true},
					{text: truncate(u.Email, wEmail-2), fg: colorText},
					{text: stText, fg: stColor},
					{text: created, fg: colorMuted},
				})
			}
		}
	case 1:
		headers = []string{"", "Email", "Статус", "Регистрация"}
		wEmail := max(8, tableWidth-39)
		widths = []int{3, wEmail, 18, 14}
		users := m.visibleUsers()
		for i := start; i < end; i++ {
			u := users[i]
			marker := "  "
			if i == m.cursor {
				marker = "▶"
			}
			created := u.CreatedAt
			if len(created) >= 10 {
				created = created[:10]
			}
			stText := "✕ Заблокирован"
			stColor := colorDanger
			if u.Status == "active" {
				stText = "● Активен"
				stColor = colorAccent
			} else if u.Status == "pending" {
				stText = "○ Ожидание"
				stColor = colorWarn
			}
			rows = append(rows, []cellData{
				{text: marker, fg: colorAccent, bold: true},
				{text: truncate(u.Email, wEmail-2), fg: colorText},
				{text: stText, fg: stColor},
				{text: created, fg: colorMuted},
			})
		}
	case 2:
		headers = []string{"", "Время (UTC)", "Действие", "Пользователь", "Детали"}
		wPart := max(8, (tableWidth-35)/3)
		widths = []int{3, 21, wPart, wPart, max(8, tableWidth-24-wPart*2)}
		audits := m.visibleAudits()
		for i := start; i < end; i++ {
			a := audits[i]
			marker := "  "
			if i == m.cursor {
				marker = "▶"
			}
			rows = append(rows, []cellData{
				{text: marker, fg: colorAccent, bold: true},
				{text: truncate(a.CreatedAt, 19), fg: colorMuted},
				{text: truncate(actionLabel(a.Action), wPart-2), fg: colorText},
				{text: truncate(m.userLabel(a.UserID), wPart-2), fg: colorText},
				{text: truncate(a.Detail, widths[4]-2), fg: colorMuted},
			})
		}
	case 3:
		headers = []string{"", "Имя файла", "Размер"}
		wFile := max(8, tableWidth-24)
		widths = []int{3, wFile, 17}
		backups := m.visibleBackups()
		for i := start; i < end; i++ {
			p := backups[i]
			marker := "  "
			if i == m.cursor {
				marker = "▶"
			}
			info, e := os.Stat(p)
			size := "–"
			if e == nil {
				size = fmt.Sprintf("%.2f МБ", float64(info.Size())/(1024*1024))
			}
			rows = append(rows, []cellData{
				{text: marker, fg: colorAccent, bold: true},
				{text: truncate(filepath.Base(p), wFile-2), fg: colorText},
				{text: size, fg: colorMuted},
			})
		}
	}

	// Adjust widths so sum of column widths equals tableWidth exactly
	totalW := 0
	for _, w := range widths {
		totalW += w
	}
	if len(widths) > 1 && totalW < tableWidth {
		widths[1] += tableWidth - totalW
	}

	renderCell := func(text string, width int, bg lipgloss.Color, fg lipgloss.Color, bold bool) string {
		return lipgloss.NewStyle().
			Width(width).
			Background(bg).
			Foreground(fg).
			Bold(bold).
			Padding(0, 1).
			Render(text)
	}

	var outputLines []string

	// Header row
	var headerCells []string
	for idx, h := range headers {
		headerCells = append(headerCells, renderCell(h, widths[idx], colorPanel2, colorAccent, true))
	}
	outputLines = append(outputLines, strings.Join(headerCells, ""))

	// Data rows
	for rowIdx, r := range rows {
		actualIdx := start + rowIdx
		isCurrent := actualIdx == m.cursor
		rowBg := colorPanel
		if isCurrent {
			rowBg = colorAccentSoft
		} else if rowIdx%2 == 1 {
			rowBg = colorPanel2
		}

		var rowCells []string
		for colIdx, c := range r {
			fg := c.fg
			if isCurrent && colIdx == 1 {
				fg = colorText
			}
			bold := c.bold || isCurrent
			rowCells = append(rowCells, renderCell(c.text, widths[colIdx], rowBg, fg, bold))
		}
		outputLines = append(outputLines, strings.Join(rowCells, ""))
	}

	return strings.Join(outputLines, "\n")
}

func (m model) contentWidth() int {
	w := max(20, m.width-6)
	if m.width >= 110 {
		w -= 31
	}
	return w
}

func (m model) pageSize() int {
	reserved := 22
	if m.section == 0 && m.width >= 80 {
		reserved += 1
	}
	if m.width < 110 {
		reserved += 4
	}
	if m.width < 80 {
		reserved += 2
	}
	if m.prompt != "" {
		reserved += 8
	}
	if m.err != nil || m.message != "" || m.busy {
		reserved += 3
	}
	return max(1, m.height-reserved)
}

func hotkey(key, label string) string {
	return styleKeyBadge.Render(key) + " " + styleKeyAction.Render(label)
}

func (m model) renderActionMenu() string {
	actions := m.currentActions()
	if len(actions) == 0 {
		return ""
	}
	var lines []string
	lines = append(lines, styleSubtitle.Render("⚡ Выберите действие (↑↓ навигация · Enter подтвердить · 1–9 быстрый выбор · Esc закрыть):"))
	for i, it := range actions {
		num := fmt.Sprintf("%d.", i+1)
		prefix := "  "
		itemStyle := lipgloss.NewStyle().Foreground(colorText)
		numStyle := styleMuted
		if i == m.actionMenuIdx {
			prefix = "▶ "
			itemStyle = lipgloss.NewStyle().Foreground(colorAccent).Bold(true)
			numStyle = styleKeyBadge
		}
		hotkeyBadge := ""
		if it.key != "" {
			hotkeyBadge = "  " + styleMuted.Render("["+it.key+"]")
		}
		lines = append(lines, prefix+numStyle.Render(num)+" "+it.icon+" "+itemStyle.Render(it.label)+hotkeyBadge)
	}
	return panel(strings.Join(lines, "\n"), m.width-6, colorAccent)
}

func (m model) renderActionButtons() string {
	actions := m.currentActions()
	actionCount := len(actions)

	if m.width < 80 {
		var parts []string
		if actionCount > 0 {
			parts = append(parts, hotkey("Enter", fmt.Sprintf("⚡ Действия (%d)", actionCount)))
		}
		if m.section == 0 {
			if m.subtab == 1 {
				parts = append(parts, hotkey("t", "Регистрации"))
			} else {
				parts = append(parts, hotkey("t", "Сбросы"))
			}
		}
		return strings.Join(parts, "  ")
	}

	parts := []string{}
	if actionCount > 0 {
		parts = append(parts, hotkey("Enter / Пробел", fmt.Sprintf("⚡ Меню действий (%d)", actionCount)))
	}
	if m.section == 0 {
		if m.subtab == 1 {
			parts = append(parts, hotkey("t", "📋 Заявки на регистрацию"))
		} else {
			parts = append(parts, hotkey("t", "🔑 Запросы на сброс"))
		}
	} else if m.section == 1 {
		parts = append(parts, hotkey("f", "Фильтр"))
	}
	return strings.Join(parts, "   ")
}

func panel(content string, width int, border lipgloss.Color) string {
	return lipgloss.NewStyle().Width(width).Border(lipgloss.RoundedBorder()).BorderForeground(border).
		BorderBackground(colorBgDark).Background(colorPanel).Foreground(colorText).Padding(0, 1).Render(content)
}

func (m model) navigation() string {
	names := []string{"📋 Заявки", "👥 Пользователи", "🔒 Журнал", "💾 Резервные копии"}
	colors := []lipgloss.Color{colorAccent, colorAccentStrong, lipgloss.Color("#A78BFA"), colorWarn}
	pending := 0
	for _, u := range m.users {
		if u.Status == "pending" {
			pending++
		}
	}
	totalPending := pending + len(m.resReqs)
	counts := []int{totalPending, len(m.users), len(m.audits), len(m.backups)}
	captions := []string{"Ожидают одобрения", "Всего аккаунтов", "События безопасности", "Сохранённые копии"}
	cards := []string{}
	for i, name := range names {
		marker := " "
		border := colorLine
		if i == m.section {
			marker = "›"
			border = colors[i]
		}
		title := lipgloss.NewStyle().Foreground(colors[i]).Bold(true).Render(fmt.Sprintf("%s %d %s", marker, i+1, name))
		if m.width < 110 {
			cards = append(cards, title)
		} else {
			captionLine := renderLines(styleMuted, truncate(fmt.Sprintf("%d · %s", counts[i], captions[i]), 24))
			cards = append(cards, panel(title+"\n\n"+captionLine, 26, border))
		}
	}
	if m.width < 110 {
		return strings.Join(cards, "  ")
	}
	return strings.Join(cards, "\n")
}

func (m model) View() string {
	if m.width == 0 {
		m.width = 100
	}
	if m.height == 0 {
		m.height = 30
	}
	if m.width < 52 || m.height < 18 {
		return lipgloss.NewStyle().Width(max(1, m.width)).Render("Avari.Jobs >_\nУвеличьте терминал до 52 × 18.\n" + hotkey("q", "Выход"))
	}
	names := []string{"📋 Заявки на регистрацию и сброс", "👥 Пользователи", "🔒 Журнал безопасности", "💾 Резервные копии"}
	descriptions := []string{"Одобрение новых аккаунтов и смены паролей", "Управление доступом и сессиями", "История действий администратора · UTC", "Создание и восстановление базы"}
	header := lipgloss.NewStyle().Foreground(colorDanger).Render("●") + " " + styleWarn.Render("●") + " " + styleSuccess.Render("●") +
		"   " + styleSubtitle.Render("Avari.Jobs >_") + renderLines(styleMuted, "  ·  admin console")
	connection := styleSuccess.Render("●") + renderLines(styleMuted, " Локальная база")
	gap := max(1, m.width-6-lipgloss.Width(header)-lipgloss.Width(connection))
	header += strings.Repeat(" ", gap) + connection
	w := m.contentWidth()
	content := styleSubtitle.Render(names[m.section]) + "\n" + renderLines(styleMuted, descriptions[m.section]) + "\n\n"
	if m.section == 0 {
		tabReg := "📋 Регистрации"
		tabRes := "🔑 Сбросы"
		if m.subtab == 0 {
			tabReg = styleSubtitle.Render("[1] 📋 Регистрации (" + fmt.Sprint(len(m.visibleUsers())) + ")")
			tabRes = renderLines(styleMuted, "[2] 🔑 Сбросы ("+fmt.Sprint(len(m.resReqs))+")")
		} else {
			tabReg = renderLines(styleMuted, "[1] 📋 Регистрации")
			tabRes = styleSubtitle.Render("[2] 🔑 Сбросы (" + fmt.Sprint(len(m.visibleResets())) + ")")
		}
		if m.width >= 80 {
			content += tabReg + "  " + tabRes + "  " + renderLines(styleMuted, "(t — переключить)") + "\n\n"
		} else {
			content += tabReg + " " + tabRes + "\n"
		}
	}
	if m.section == 1 && m.filter != "" {
		content += renderLines(styleMuted, "Фильтр: ") + state(m.filter) + "\n"
	}
	start := max(0, m.cursor-m.pageSize()+1)
	end := min(m.count(), start+m.pageSize())
	if m.count() == 0 {
		empty := "Записей пока нет"
		if m.search != "" || m.filter != "" {
			empty = "По запросу ничего не найдено"
		}
		content += "\n" + renderLines(styleMuted, empty) + "\n\n" + renderLines(styleMuted, "r — обновить · Esc — сбросить поиск и фильтр")
	} else {
		content += m.renderTable(start, end)
		content += "\n" + renderLines(styleMuted, fmt.Sprintf("%d–%d из %d", start+1, end, m.count()))
	}
	if m.width >= 80 && m.height >= 32 && m.count() > 0 && m.cursor < m.count() {
		if m.section == 0 && m.subtab == 1 {
			pr := m.visibleResets()[m.cursor]
			content += "\n\n" + styleSubtitle.Render(truncate(pr.UserEmail, w-4)) + "\n" +
				renderLines(styleMuted, "ID запроса: "+pr.ID+"\nID пользователя: "+pr.UserID+"\nСтатус: Ожидает одобрения (новый пароль скрыт)")
		} else if m.section < 2 {
			u := m.visibleUsers()[m.cursor]
			content += "\n\n" + styleSubtitle.Render(truncate(u.Email, w-4)) + "\n" +
				renderLines(styleMuted, "ID: "+u.ID+"\nЧасовой пояс: "+u.Timezone)
		}
	}
	if m.width < 80 {
		content = strings.Replace(content, "\n\n", "\n", 1)
	}
	body := panel(content, w, colorLine)
	nav := m.navigation()
	if m.width >= 110 {
		body = lipgloss.JoinHorizontal(lipgloss.Top, body, " ", nav)
	} else {
		body = lipgloss.NewStyle().Width(m.width-6).Render(nav) + "\n\n" + body
	}
	if m.actionMenuOpen {
		body += "\n" + m.renderActionMenu()
	}
	search := renderLines(styleMuted, "Поиск по разделу · / начать ввод")
	if m.search != "" {
		search = styleSubtitle.Render(m.search)
	}
	if m.searching {
		search = styleSubtitle.Render(m.search+"▏") + renderLines(styleMuted, "  Enter — готово · Esc — закрыть")
	}
	body += "\n" + panel(styleSubtitle.Render("🔍 ")+search, m.width-6, colorAccent)
	if m.prompt != "" {
		title := "Подтверждение операции"
		if m.action == "password_input" {
			title = "Новый пароль"
		}
		dialog := styleWarn.Render(title) + "\n" + m.prompt
		if m.action == "password_input" {
			dialog += "\n" + strings.Repeat("•", utf8.RuneCountInString(m.input)) + "▏"
		}
		body += "\n" + panel(dialog, m.width-6, colorWarn)
	}
	if m.err != nil {
		body += "\n" + panel(styleDanger.Render("✕ "+m.err.Error()), m.width-6, colorDanger)
	} else if m.message != "" {
		body += "\n" + panel(styleSuccess.Render("✓ "+m.message), m.width-6, colorSuccess)
	}
	if m.busy {
		body += "\n" + styleWarn.Render("◌ Выполняется операция…")
	}
	actBtns := m.renderActionButtons()
	footer := ""
	if actBtns != "" {
		footer += lipgloss.NewStyle().Width(m.width-4).Render(actBtns) + "\n"
	}
	if m.width < 80 {
		footer += lipgloss.NewStyle().Width(m.width-4).Render(hotkey("↑↓", "Выбор") + "  " + hotkey("Enter", "Действие") + "  " + hotkey("1–4", "Раздел") + "  " + hotkey("/", "Поиск") + "  " + hotkey("q", "Выход"))
	} else {
		footer += lipgloss.NewStyle().Width(m.width-4).Render(hotkey("↑↓", "Выбор") + "   " + hotkey("Enter / Пробел", "Действия") + "   " + hotkey("Tab / 1–4", "Раздел") + "   " + hotkey("/", "Поиск") + "   " + hotkey("r", "Обновить") + "   " + hotkey("q", "Выход"))
	}
	rendered := lipgloss.NewStyle().Background(colorBgDark).Foreground(colorText).Width(m.width).Height(m.height-2).
		Padding(1, 2).Render(header + "\n\n" + body + "\n" + footer)
	return patchBg(rendered, colorBgDark)
}

func truncate(s string, n int) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || (r >= 127 && r < 160) {
			return ' '
		}
		return r
	}, s)
	return ansi.Truncate(s, max(1, n), "…")
}

func runTUI(dbPath, backupDir string) error {
	s, e := core.Open(dbPath)
	if e != nil {
		return fmt.Errorf("ошибка открытия базы данных: %w", e)
	}
	defer s.Close()

	m := model{
		store:     s,
		dbPath:    dbPath,
		backupDir: backupDir,
		height:    30,
		width:     100,
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	_, err := p.Run()
	return err
}

func buildRootCommand() *cobra.Command {
	var (
		dbPath    string
		backupDir string
	)

	rootCmd := &cobra.Command{
		Use:   "avari-admin",
		Short: "Интерактивная консоль администратора Avari.Jobs (TUI)",
		Long: `Avari.Jobs Admin TUI — инструмент для управления пользователями,
одобрения регистраций, просмотра журнала безопасности и создания/восстановления резервных копий.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if dbPath == "" {
				dbPath = os.Getenv("AVARI_DB")
				if dbPath == "" {
					dbPath = "data/avari.db"
				}
			}
			if backupDir == "" {
				backupDir = os.Getenv("AVARI_BACKUPS")
				if backupDir == "" {
					backupDir = filepath.Join(filepath.Dir(dbPath), "backups")
				}
			}
			return runTUI(dbPath, backupDir)
		},
	}

	rootCmd.Flags().StringVarP(&dbPath, "db", "d", "", "Путь к файлу базы данных SQLite (по умолчанию data/avari.db или $AVARI_DB)")
	rootCmd.Flags().StringVarP(&backupDir, "backups", "b", "", "Директория для резервных копий (по умолчанию backups рядом с базой или $AVARI_BACKUPS)")

	return rootCmd
}

func main() {
	if err := buildRootCommand().Execute(); err != nil {
		os.Exit(1)
	}
}
