package core

import (
	"database/sql"
	"net"
	"net/url"
	"strings"
	"time"
)

const mcpMigration = `CREATE TABLE IF NOT EXISTS mcp_tokens(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, last_used_at TEXT NOT NULL DEFAULT ''
); CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens(user_id);`

type MCPToken struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	ExpiresAt  string `json:"expiresAt"`
	LastUsedAt string `json:"lastUsedAt"`
}

func (s *Store) CreateMCPToken(user, name string) (MCPToken, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || textLength(name) > 200 {
		return MCPToken{}, "", Fail(400, "Укажите название подключения (до 200 символов)")
	}
	t := MCPToken{ID: ID(), Name: name, CreatedAt: now(), ExpiresAt: time.Now().UTC().Add(90 * 24 * time.Hour).Format(timestampLayout)}
	secret := "avari_mcp_" + ID() + ID()
	err := s.transaction(func(tx *sql.Tx) error {
		var status string
		if err := tx.QueryRow("SELECT status FROM users WHERE id=?", user).Scan(&status); err != nil {
			return err
		}
		if status != "active" {
			return Fail(403, "Аккаунт недоступен")
		}
		var count int
		if err := tx.QueryRow("SELECT count(*) FROM mcp_tokens WHERE user_id=?", user).Scan(&count); err != nil {
			return err
		}
		if count >= 20 {
			return Fail(400, "Можно создать до 20 MCP-токенов. Отзовите неиспользуемые")
		}
		_, err := tx.Exec("INSERT INTO mcp_tokens(id,user_id,token_hash,name,created_at,expires_at) VALUES(?,?,?,?,?,?)", t.ID, user, tokenHash(secret), name, t.CreatedAt, t.ExpiresAt)
		return err
	})
	return t, secret, err
}

func (s *Store) MCPTokens(user string) ([]MCPToken, error) {
	rows, err := s.DB.Query("SELECT id,name,created_at,expires_at,last_used_at FROM mcp_tokens WHERE user_id=? ORDER BY created_at DESC,id", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MCPToken{}
	for rows.Next() {
		var t MCPToken
		if err = rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.ExpiresAt, &t.LastUsedAt); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}
func (s *Store) RevokeMCPToken(user, id string) error {
	_, err := s.DB.Exec("DELETE FROM mcp_tokens WHERE user_id=? AND id=?", user, id)
	return err
}
func (s *Store) AuthenticateMCP(secret string) (string, string, error) {
	if !strings.HasPrefix(secret, "avari_mcp_") || len(secret) > 200 {
		return "", "", Fail(401, "Неверный MCP-токен")
	}
	var user, id string
	err := s.transaction(func(tx *sql.Tx) error {
		err := tx.QueryRow("SELECT t.user_id,t.id FROM mcp_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>? AND u.status='active'", tokenHash(secret), now()).Scan(&user, &id)
		if err == sql.ErrNoRows {
			return Fail(401, "MCP-токен истёк, отозван или аккаунт недоступен")
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec("UPDATE mcp_tokens SET last_used_at=? WHERE id=?", now(), id)
		return err
	})
	return user, id, err
}

// MCPVacancyURL preserves meaningful query parameters for arbitrary job sites.
// It never fetches the URL. Known sites retain the application's canonical identity.
func MCPVacancyURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return "", Fail(400, "Укажите ссылку на вакансию (до 2048 символов)")
	}
	normalized, _, err := NormalizeURL(raw)
	if err != nil {
		return "", err
	}
	if canonical := trackedJobURL(normalized); canonical != "" {
		return canonical, nil
	}
	u, _ := url.Parse(normalized)
	u.Scheme = strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "80" && u.Scheme == "http" || port == "443" && u.Scheme == "https" {
		port = ""
	}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	u.Fragment = ""
	u.RawFragment = ""
	if u.Path == "" {
		u.Path = "/"
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", Fail(400, "Некорректные параметры ссылки")
	}
	for key := range query {
		k := strings.ToLower(key)
		if strings.HasPrefix(k, "utm_") || oneOf(k, "gclid", "fbclid", "yclid", "_openstat", "mc_cid", "mc_eid") {
			query.Del(key)
		}
	}
	u.RawQuery = query.Encode()
	u.ForceQuery = false
	return u.String(), nil
}

func mcpDuplicate(q queryer, user, raw string) (*Application, error) {
	target, err := MCPVacancyURL(raw)
	if err != nil {
		return nil, err
	}
	apps, err := list[Application](q, user, "application")
	if err != nil {
		return nil, err
	}
	for _, a := range apps {
		identity, e := MCPVacancyURL(a.URL)
		if e == nil && identity == target {
			return &a, nil
		}
	}
	return nil, nil
}
func (s *Store) MCPDuplicate(user, raw string) (*Application, error) {
	return mcpDuplicate(s.DB, user, raw)
}

// The idempotency lookup, duplicate check and creation share one transaction.
func (s *Store) SaveMCPApplication(user string, a Application, key string) (Application, bool, error) {
	var result Application
	created := false
	if key == "" || len(key) > 200 {
		return result, false, Fail(400, "Укажите ключ сохранения (до 200 символов)")
	}
	if a.ID != "" {
		return result, false, Fail(400, "MCP может только добавлять вакансии")
	}
	normalized, err := MCPVacancyURL(a.URL)
	if err != nil {
		return result, false, err
	}
	a.URL = normalized
	err = s.transaction(func(tx *sql.Tx) error {
		var id string
		err := tx.QueryRow("SELECT resource FROM requests WHERE user_id=? AND key=?", user, "application:mcp:"+key).Scan(&id)
		if err == nil {
			result, err = get[Application](tx, user, "application", id)
			return err
		}
		if err != sql.ErrNoRows {
			return err
		}
		duplicate, err := mcpDuplicate(tx, user, a.URL)
		if err != nil {
			return err
		}
		if duplicate != nil {
			result = *duplicate
			_, err = tx.Exec("INSERT INTO requests(user_id,key,resource) VALUES(?,?,?)", user, "application:mcp:"+key, result.ID)
			return err
		}
		result, err = s.saveApplicationTx(tx, user, a, "mcp:"+key, "mcp")
		created = err == nil
		return err
	})
	return result, created, err
}
