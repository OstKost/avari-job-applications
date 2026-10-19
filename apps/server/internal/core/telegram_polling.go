package core

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
)

func telegramOffset(q queryer) (int64, error) {
	var raw string
	e := q.QueryRowContext(context.Background(), "SELECT value FROM instance_metadata WHERE key='telegram_poll_offset'").Scan(&raw)
	if e == sql.ErrNoRows {
		return 0, nil
	}
	if e != nil {
		return 0, e
	}
	offset, e := strconv.ParseInt(raw, 10, 64)
	if e != nil || offset < 0 {
		return 0, Fail(500, "Некорректная позиция очереди Telegram")
	}
	return offset, nil
}
func (s *Store) TelegramPollOffset() (int64, error) { return telegramOffset(s.DB) }
func (s *Store) EnqueueTelegramBatch(batch []json.RawMessage) error {
	ids := make([]int64, len(batch))
	for i, raw := range batch {
		var u struct {
			ID *int64 `json:"update_id"`
		}
		if len(raw) > 256*1024 || json.Unmarshal(raw, &u) != nil || u.ID == nil || *u.ID < 0 || *u.ID == 9223372036854775807 {
			return Fail(400, "Некорректное событие Telegram")
		}
		ids[i] = *u.ID
	}
	return s.transaction(func(tx *sql.Tx) error {
		offset, e := telegramOffset(tx)
		if e != nil {
			return e
		}
		initialOffset := offset
		for i, id := range ids {
			if id < initialOffset {
				continue
			}
			if _, e = tx.Exec("INSERT OR IGNORE INTO telegram_inbox(update_id,payload,created_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM telegram_receipts WHERE update_id=?)", id, string(batch[i]), s.nowTime().UTC().Format(timestampLayout), id); e != nil {
				return e
			}
			if id >= offset {
				offset = id + 1
			}
		}
		// An empty successful response confirms the previous batch remotely.
		// Return to offset zero so Telegram's random update IDs after a week of
		// inactivity cannot be discarded by a stale numeric cursor.
		if len(batch) == 0 {
			offset = 0
		}
		_, e = tx.Exec("INSERT INTO instance_metadata(key,value) VALUES('telegram_poll_offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", strconv.FormatInt(offset, 10))
		return e
	})
}
