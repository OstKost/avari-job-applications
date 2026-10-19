// Package telegram implements the private-chat Telegram Bot API integration.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/vacancy"
)

type Client struct {
	Token   string
	BaseURL string
	HTTP    *http.Client
}

type response struct {
	OK         bool            `json:"ok"`
	Code       int             `json:"error_code"`
	Result     json.RawMessage `json:"result"`
	Parameters struct {
		Retry int `json:"retry_after"`
	} `json:"parameters"`
}

func (c *Client) exchange(ctx context.Context, method string, body any) (response, error) {
	var result response
	base := c.BaseURL
	if base == "" {
		base = "https://api.telegram.org"
	}
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	raw, e := json.Marshal(body)
	if e != nil {
		return result, e
	}
	req, e := http.NewRequestWithContext(ctx, "POST", base+"/bot"+c.Token+"/"+method, bytes.NewReader(raw))
	if e != nil {
		return result, errors.New("invalid Telegram endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := client.Do(req)
	if e != nil {
		return result, errors.New("Telegram transport unavailable")
	}
	defer res.Body.Close()
	if e = json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&result); e != nil {
		return result, errors.New("invalid Telegram response")
	}
	if result.OK {
		result.Code = 200
	} else if result.Code == 0 {
		result.Code = res.StatusCode
	}
	return result, nil
}
func (c *Client) Call(ctx context.Context, method string, body any) (int, int, error) {
	r, e := c.exchange(ctx, method, body)
	return r.Code, r.Parameters.Retry, e
}
func (c *Client) Configure(ctx context.Context, origin, secret string, modes ...string) error {
	mode := "webhook"
	if len(modes) > 0 {
		mode = modes[0]
	}
	if mode != "webhook" && mode != "polling" {
		return errors.New("invalid Telegram delivery mode")
	}
	if !strings.HasPrefix(origin, "https://") {
		return errors.New("Telegram requires an HTTPS origin")
	}
	method := "setWebhook"
	body := map[string]any{"url": origin + "/api/v1/telegram/webhook", "secret_token": secret, "allowed_updates": []string{"message", "callback_query"}, "drop_pending_updates": false}
	if mode == "polling" {
		method = "deleteWebhook"
		body = map[string]any{"drop_pending_updates": false}
	}
	code, _, e := c.Call(ctx, method, body)
	if e != nil {
		return e
	}
	if code != 200 {
		return fmt.Errorf("%s failed: %d", method, code)
	}
	commands := []map[string]string{}
	for _, v := range [][2]string{{"start", "Главное меню"}, {"help", "Помощь"}, {"add", "Добавить вакансию"}, {"search", "Журнал и поиск"}, {"today", "Сегодня"}, {"week", "Ближайшие семь дней"}, {"settings", "Настройки"}, {"cancel", "Отмена"}} {
		commands = append(commands, map[string]string{"command": v[0], "description": v[1]})
	}
	code, _, e = c.Call(ctx, "setMyCommands", map[string]any{"commands": commands, "scope": map[string]string{"type": "all_private_chats"}})
	if e != nil {
		return e
	}
	if code != 200 {
		return fmt.Errorf("setMyCommands failed: %d", code)
	}
	return nil
}

type Service struct {
	Polling bool
	Store   *core.Store
	Client  *Client
	Origin  string
	Preview func(context.Context, string) (vacancy.Preview, error)
}

func (s *Service) Tick(ctx context.Context) error {
	if err := s.Store.ExpireTelegramDrafts(); err != nil {
		return err
	}
	for i := 0; i < 100; i++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		u, ok, e := s.Store.NextTelegramUpdate()
		if e != nil {
			return e
		}
		if !ok {
			break
		}
		var a *core.Application
		if u.Message != nil && u.Message.Chat.Type == "private" && u.Message.From.ID == u.Message.Chat.ID {
			urls := core.TelegramMessageURLs(u.Message)
			_, accessErr := s.Store.TelegramUser(u.Message.From.ID)
			if len(urls) == 1 && accessErr == nil {
				fetch := s.Preview
				if fetch == nil {
					fetch = vacancy.Fetch
				}
				p, e := fetch(ctx, urls[0])
				if e == nil {
					a = &core.Application{Company: p.Fields.Company, Position: p.Fields.Position, Location: p.Fields.Location, WorkFormat: p.Fields.WorkFormat, CompanyLogo: p.Fields.CompanyLogo}
					if p.Fields.Salary != nil {
						v := p.Fields.Salary
						a.Salary = core.Salary{Min: v.Min, Max: v.Max, Currency: v.Currency, Period: v.Period, Tax: v.Tax}
					}
				}
			}
		}
		if u.Callback != nil && u.Callback.Message != nil && u.Callback.Message.Chat.Type == "private" && u.Callback.From.ID == u.Callback.Message.Chat.ID {
			var d struct {
				Nonce string
				URLs  []string
			}
			if err := s.Store.TelegramDraft(u.Callback.From.ID, &d); err != nil {
				return err
			}
			prefix := d.Nonce + ":url:"
			if d.Nonce != "" && strings.HasPrefix(u.Callback.Data, prefix) {
				i, err := strconv.Atoi(strings.TrimPrefix(u.Callback.Data, prefix))
				if err == nil && i >= 0 && i < len(d.URLs) {
					fetch := s.Preview
					if fetch == nil {
						fetch = vacancy.Fetch
					}
					p, err := fetch(ctx, d.URLs[i])
					if err == nil {
						a = &core.Application{Company: p.Fields.Company, Position: p.Fields.Position, Location: p.Fields.Location, WorkFormat: p.Fields.WorkFormat, CompanyLogo: p.Fields.CompanyLogo}
						if p.Fields.Salary != nil {
							v := p.Fields.Salary
							a.Salary = core.Salary{Min: v.Min, Max: v.Max, Currency: v.Currency, Period: v.Period, Tax: v.Tax}
						}
					}
				}
			}
		}
		if e = s.Store.ProcessTelegramUpdate(u, s.Origin, a); e != nil {
			return e
		}
		if u.Callback != nil {
			_, _, _ = s.Client.Call(ctx, "answerCallbackQuery", map[string]string{"callback_query_id": u.Callback.ID})
		}
	}
	if e := s.Store.ReconcileTelegramDigests(time.Now().UTC(), s.Origin); e != nil {
		return e
	}
	out, e := s.Store.TelegramPending(time.Now().UTC())
	if e != nil {
		return e
	}
	for _, o := range out {
		// Recheck account state and binding immediately before every network call.
		{
			u, e := s.Store.TelegramDeliveryAllowed(o.ID)
			if e != nil {
				return e
			}
			if !u {
				continue
			}
		}
		var payload any
		if e = json.Unmarshal([]byte(o.Payload), &payload); e != nil {
			return e
		}
		code, retry, e := s.Client.Call(ctx, "sendMessage", payload)
		if e != nil {
			code = 0
		}
		if e = s.Store.TelegramDelivery(o, code, retry, time.Now().UTC()); e != nil {
			return e
		}
		if code == 429 {
			break
		}
	}
	return nil
}
func (s *Service) Run(ctx context.Context) {
	if s.Polling {
		done := make(chan struct{})
		go func() { defer close(done); s.poll(ctx) }()
		defer func() { <-done }()
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if e := s.Tick(ctx); e != nil && ctx.Err() == nil {
			slog.Error("telegram worker failed", "error", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func Validate(enabled, personal bool, origin, token, username, secret string) error {
	if !enabled {
		return nil
	}
	u, e := url.Parse(origin)
	if personal || e != nil || u.Scheme != "https" || u.Host != "jobs.avari.dev" || u.Path != "" {
		return errors.New("Telegram integration is only available on https://jobs.avari.dev")
	}
	if token == "" || !regexp.MustCompile(`^[A-Za-z0-9_]{5,32}$`).MatchString(username) || !regexp.MustCompile(`^[A-Za-z0-9_-]{32,256}$`).MatchString(secret) {
		return errors.New("Telegram token, bot username and webhook secret (32–256 URL-safe characters) are required")
	}
	return nil
}
