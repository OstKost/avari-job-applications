/**
 * UI Components for Offline status banner, opt-in settings panel, and draft restore prompt.
 * Conforms to existing visual style and Russian user UI.
 */

import React, { useSyncExternalStore } from "react";
import { isOfflineOrReadOnly, subscribeTransportPolicy } from "./policy";
import {
  WifiOff,
  CloudOff,
  RefreshCw,
  HardDrive,
  Trash2,
  FileEdit,
  AlertTriangle,
} from "lucide-react";
import type { User } from "@avari/shared";
import { useIsOnline, useOfflineSettings } from "./hooks";
import { clearOfflineCache } from "./db";
import { offlineManager } from "./manager";

export interface OfflineNoticeProps {
  lastUpdated?: number | null;
  onRefresh?: () => void;
  isCached?: boolean;
}

/**
 * Banner shown when network is unavailable or user is viewing offline data.
 */
export function OfflineNotice({ lastUpdated, onRefresh, isCached = false }: OfflineNoticeProps) {
  const isOnline = useIsOnline();
  const readOnly = useSyncExternalStore(subscribeTransportPolicy, isOfflineOrReadOnly);

  if (isOnline && !isCached && !readOnly) return null;

  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : null;

  return (
    <div className="update-notice offline-banner offline-notice" role="status" aria-live="polite">
      <WifiOff size={18} className="text-warning" />
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>Автономный режим (офлайн).</strong>{" "}
        <span>
          Данные доступны только для чтения.
          {formattedTime && ` Копия от ${formattedTime}.`}
        </span>
      </div>
      {onRefresh && (
        <button
          type="button"
          className="text-button"
          onClick={onRefresh}
          title="Попробовать обновить данные"
        >
          <RefreshCw size={14} /> Повторить
        </button>
      )}
    </div>
  );
}

export interface OfflineSettingsPanelProps {
  userKey: string;
  user?: User;
  data?: {
    applications?: any[];
    tasks?: any[];
    fields?: any[];
    proposals?: any[];
  };
  onCleared?: () => void;
}

/**
 * Panel inside Settings for toggling offline data saving and clearing local cache.
 */
export function OfflineSettingsPanel({ userKey, user, data, onCleared }: OfflineSettingsPanelProps) {
  const { optIn, setOptIn } = useOfflineSettings(userKey);
  const [clearing, setClearing] = React.useState(false);
  const [clearedNotice, setClearedNotice] = React.useState(false);

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    await setOptIn(enabled);
    if (enabled && user && data) {
      void offlineManager.recordSuccessfulFetch(userKey, user, data);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm("Очистить все сохранённые локальные копии вакансий и задач? Черновики не будут удалены.")) {
      return;
    }
    setClearing(true);
    try {
      await clearOfflineCache(userKey, false);
      setClearedNotice(true);
      onCleared?.();
      setTimeout(() => setClearedNotice(false), 3000);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="panel offline-settings-panel">
      <div className="panel-head">
        <h2>
          <HardDrive size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />
          Автономный режим (PWA)
        </h2>
        <p>
          Сохранение копии журнала и задач в браузере для чтения без интернета.
          По умолчанию отключено для защиты данных.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={optIn}
            onChange={handleToggle}
          />
          <span>Разрешить чтение журнала офлайн (Opt-in)</span>
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={handleClearCache}
          disabled={clearing}
          className="text-button"
          style={{ color: "var(--danger, #ff9a9a)" }}
        >
          <Trash2 size={14} /> Очистить локальный кэш
        </button>
        {clearedNotice && (
          <span className="text-muted" style={{ fontSize: "0.9em" }}>
            Локальный кэш очищен
          </span>
        )}
      </div>
    </section>
  );
}

export interface DraftRestoreBannerProps {
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Small alert shown inside forms when an unsaved local draft is discovered.
 */
export function DraftRestoreBanner({ onRestore, onDiscard }: DraftRestoreBannerProps) {
  return (
    <div
      className="draft-restore-banner"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 14px",
        marginBottom: 12,
        background: "var(--panel-2, #204354)",
        border: "1px solid var(--accent, #57c8ed)",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <FileEdit size={16} color="var(--accent, #57c8ed)" />
        <span style={{ fontSize: "0.9em" }}>Обнаружен сохранённый черновик</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="primary"
          style={{ padding: "4px 10px", fontSize: "0.85em" }}
          onClick={onRestore}
        >
          Восстановить
        </button>
        <button
          type="button"
          className="text-button"
          style={{ padding: "4px 8px", fontSize: "0.85em" }}
          onClick={onDiscard}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}
