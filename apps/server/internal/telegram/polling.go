package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// PollOnce acknowledges a Telegram batch only after its updates and next offset
// are durably stored together. The next getUpdates request performs the remote ACK.
func (s *Service) PollOnce(ctx context.Context) (int, error) {
	offset, e := s.Store.TelegramPollOffset()
	if e != nil {
		return 2, e
	}
	r, e := s.Client.exchange(ctx, "getUpdates", map[string]any{"offset": offset, "timeout": 20, "limit": 10, "allowed_updates": []string{"message", "callback_query"}})
	if e != nil {
		return 2, e
	}
	if !r.OK {
		return max(r.Parameters.Retry, 2), fmt.Errorf("Telegram getUpdates failed (%d)", r.Code)
	}
	var batch []json.RawMessage
	if e = json.Unmarshal(r.Result, &batch); e != nil {
		return 2, fmt.Errorf("invalid Telegram update batch")
	}
	if len(batch) > 10 {
		return 2, fmt.Errorf("oversized Telegram update batch")
	}
	return 0, s.Store.EnqueueTelegramBatch(batch)
}
func (s *Service) poll(ctx context.Context) {
	for ctx.Err() == nil {
		retry, e := s.PollOnce(ctx)
		if e == nil {
			continue
		}
		if ctx.Err() != nil {
			return
		}
		slog.Error("telegram polling failed", "error", e)
		timer := time.NewTimer(time.Duration(max(retry, 2)) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
