import React, { useEffect, useState } from "react";
import { APIError, type Transport, type User } from "@avari/shared";

type Challenge = {
  id: string;
  purpose: string;
  status: string;
  expiresAt: string;
  code: string;
  telegramId?: number;
  username?: string;
  displayName?: string;
};
type Link = {
  telegramId: number;
  username: string;
  displayName: string;
  morning: boolean;
  evening: boolean;
  deliveryEnabled: boolean;
};
type Status = { enabled: boolean; link: Link | null };
type Request = { challenge: Challenge; url: string };

export function TelegramConnect({
  api,
  purpose,
  onComplete,
}: {
  api: Transport;
  purpose: "registration" | "link";
  onComplete?: () => void;
}) {
  const [request, setRequest] = useState<Request>();
  const [state, setState] = useState<Challenge>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<Status>("/telegram")
      .then((s) => {
        if (alive) setEnabled(s.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);
  useEffect(() => {
    if (!request) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const c = await api<Challenge>(
          `/telegram/challenges/${request.challenge.id}`,
        );
        if (!alive) return;
        setState(c);
        if (["completed", "cancelled", "expired"].includes(c.status))
          window.clearInterval(timer);
        if (c.status === "completed") onComplete?.();
      } catch (e) {
        if (alive) {
          setError(String(e));
          if (e instanceof APIError && [404, 409, 410].includes(e.status))
            window.clearInterval(timer);
        }
      }
    }, 6000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [request, api, onComplete]);
  if (!enabled) return null;
  return (
    <div className="telegram-connect">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await api<Request>("/telegram/challenges", "POST", {
              purpose,
            });
            setRequest(r);
            setState(r.challenge);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {purpose === "registration"
          ? "Подтвердить через Telegram"
          : "Подключить Telegram"}
      </button>
      {request && state && ["pending", "approved"].includes(state.status) && (
        <p>
          <a href={request.url} target="_blank" rel="noreferrer">
            Открыть бота и подтвердить
          </a>{" "}
          · до {new Date(state.expiresAt).toLocaleTimeString()}
        </p>
      )}
      {state?.status === "approved" && purpose === "link" && (
        <div role="status">
          <p>
            Подключить {state.displayName}{" "}
            {state.username ? `(@${state.username})` : ""} · ID{" "}
            {state.telegramId}?
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(
                  `/telegram/challenges/${state.id}/complete`,
                  "POST",
                  {},
                );
                setRequest(undefined);
                setState(undefined);
                onComplete?.();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Подтвердить этот аккаунт на сайте
          </button>
        </div>
      )}
      {state?.status === "completed" && <p role="status">Подтверждено.</p>}
      {state && ["cancelled", "expired"].includes(state.status) && (
        <p role="status">Запрос отменён или истёк. Создайте новый.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function TelegramLogin({
  api,
  onLogin,
}: {
  api: Transport;
  onLogin: (user: User) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [request, setRequest] = useState<Request>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<{ enabled: boolean }>("/auth/telegram/config")
      .then((s) => {
        if (alive) setEnabled(s.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);
  useEffect(() => {
    if (!request) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const c = await api<Challenge>(
          `/auth/telegram/requests/${request.challenge.id}`,
        );
        if (!alive) return;
        if (c.status === "approved") {
          window.clearInterval(timer);
          const result = await api<{ user: User }>(
            `/auth/telegram/requests/${c.id}/complete`,
            "POST",
            {},
          );
          if (alive) onLogin(result.user);
        } else if (["cancelled", "expired", "completed"].includes(c.status)) {
          window.clearInterval(timer);
          setError("Запрос отменён или истёк. Начните вход заново.");
          setRequest(undefined);
        }
      } catch (e) {
        if (alive) {
          window.clearInterval(timer);
          setError(String(e));
        }
      }
    }, 6000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [request, api, onLogin]);
  if (!enabled) return null;
  return (
    <div className="telegram-login">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setRequest(
              await api<Request>("/auth/telegram/requests", "POST", {}),
            );
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Войти через Telegram
      </button>
      {request && (
        <div role="status">
          <p>
            Код: <strong>{request.challenge.code}</strong>. Сверьте его в боте
            перед подтверждением входа.
          </p>
          <a href={request.url} target="_blank" rel="noreferrer">
            Открыть Telegram
          </a>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function TelegramSettings({ api }: { api: Transport }) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const refresh = React.useCallback(() => {
    void api<Status>("/telegram")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, [api]);
  useEffect(refresh, [refresh]);
  if (!status?.enabled) return null;
  const link = status.link;
  return (
    <section className="panel">
      <h2>Telegram</h2>
      {link ? (
        <>
          <p>
            {link.displayName} {link.username ? `(@${link.username})` : ""} · ID{" "}
            {link.telegramId}
          </p>
          <p>Сводки по будням в 09:00 и 18:00 по часовому поясу аккаунта.</p>
          {!link.deliveryEnabled && (
            <p>
              Доставка отключена. Разблокируйте бота и включите нужную сводку.
            </p>
          )}
          {(["morning", "evening"] as const).map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={link[kind]}
                disabled={busy}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setStatus({ ...status, link: { ...link, [kind]: checked } });
                  setBusy(true);
                  setError("");
                  try {
                    await api("/telegram/preferences", "PATCH", {
                      morning: link.morning,
                      evening: link.evening,
                      [kind]: checked,
                    });
                    refresh();
                  } catch (e) {
                    setError(String(e));
                    refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              {kind === "morning" ? "Утренняя сводка" : "Вечерняя сводка"}
            </label>
          ))}
          <p>
            <button type="button" onClick={() => setDisconnect(true)}>
              Отключить Telegram
            </button>
          </p>
          {disconnect && (
            <div>
              <p>Отключить Telegram и сводки? Текущие веб-сессии сохранятся.</p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api("/telegram", "DELETE", {});
                    setDisconnect(false);
                    refresh();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Подтвердить отключение
              </button>
              <button type="button" onClick={() => setDisconnect(false)}>
                Отмена
              </button>
            </div>
          )}
        </>
      ) : (
        <TelegramConnect api={api} purpose="link" onComplete={refresh} />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
