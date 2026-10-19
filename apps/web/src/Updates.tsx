import { createWebAPI } from "./offline/policy";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type LocalStatus,
  type ReleaseNote,
  type UpdateStatus,
} from "@avari/shared";
import { ErrorBox, Loading } from "@avari/shared/ui";
import "./updates.css";
const api = createWebAPI();
const pendingKey = "avari-update-restart";
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    throw new Error(
      "Не удалось загрузить историю изменений. Попробуйте ещё раз.",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(
      "Не удалось загрузить историю изменений. Попробуйте ещё раз.",
    );
  }
}
function useRelease() {
  return useQuery({
    queryKey: ["release"],
    queryFn: () => json<{ version: string }>("/release.json"),
    staleTime: 60_000,
  });
}
function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled. */
  }
}
export function WhatsNewLabel({ userId }: { userId: string }) {
  const release = useRelease();
  const key = `avari-whats-new:${userId}`;
  const [seen, setSeen] = useState(() => storageGet(key));
  useEffect(() => {
    if (!release.data) return;
    setSeen(storageGet(key));
    if (storageGet(key) === null) {
      storageSet(key, release.data.version);
      setSeen(release.data.version);
    }
    const refresh = () => setSeen(storageGet(key));
    window.addEventListener("avari-release-seen", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("avari-release-seen", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [key, release.data]);
  return (
    <>
      Что нового
      {seen && release.data && seen !== release.data.version && (
        <span className="release-dot" aria-label="Есть новые изменения" />
      )}
    </>
  );
}
export function ReleaseEntries({ notes }: { notes: ReleaseNote[] }) {
  return (
    <>
      {notes.map((note) => (
        <article className="release-entry" key={note.version}>
          <h2>
            Версия {note.version} <small>{note.date}</small>
          </h2>
          <p>{note.summary}</p>
          {(
            [
              ["features", "Новое"],
              ["improvements", "Улучшения"],
              ["fixes", "Исправления"],
            ] as const
          ).map(([key, title]) =>
            note[key]?.length ? (
              <section key={key}>
                <h3>{title}</h3>
                <ul>
                  {note[key].map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </article>
      ))}
    </>
  );
}
export function WhatsNew({ userId }: { userId: string }) {
  const release = useRelease();
  const notes = useQuery({
    queryKey: ["release-notes"],
    queryFn: () => json<ReleaseNote[]>("/release-notes.json"),
  });
  useEffect(() => {
    if (release.data && notes.data) {
      storageSet(`avari-whats-new:${userId}`, release.data.version);
      window.dispatchEvent(new Event("avari-release-seen"));
    }
    document.title = "Что нового — Avari.Jobs";
  }, [userId, release.data, notes.data]);
  return (
    <section className="panel release-history">
      <h1>Что нового</h1>
      <p className="muted">Изменения в вашей версии Avari.Jobs.</p>
      <ErrorBox
        error={notes.error ?? release.error}
        retry={() => {
          void notes.refetch();
          void release.refetch();
        }}
      />
      {notes.isPending ? (
        <Loading />
      ) : (
        notes.data && <ReleaseEntries notes={notes.data} />
      )}
    </section>
  );
}
function useUpdate(enabled: boolean) {
  return useQuery({
    queryKey: ["local-update"],
    queryFn: () => api<UpdateStatus>("/local/update"),
    enabled,
    refetchInterval: (q) =>
      ["checking", "downloading", "installing"].includes(
        q.state.data?.stage ?? "",
      )
        ? 1000
        : 30_000,
    retry: false,
  });
}
export function UpdateNotice() {
  const local = useQuery({
    queryKey: ["local-status"],
    queryFn: () => api<LocalStatus>("/local/status"),
    staleTime: Infinity,
  });
  const update = useUpdate(!!local.data?.launcher);
  const client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const data = update.data;
  if (
    !data?.availableVersion ||
    data.snoozedUntil * 1000 > Date.now() ||
    !["available", "ready"].includes(data.stage)
  )
    return null;
  return (
    <aside className="update-notice" aria-label="Доступно обновление">
      <span>Доступна версия {data.availableVersion}</span>
      <Link to="/settings#updates">
        {data.stage === "ready"
          ? "Установить обновление"
          : "Подробнее и обновить"}
      </Link>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api<UpdateStatus>(
              "/local/update/snooze",
              "POST",
              {},
            );
            client.setQueryData(["local-update"], result);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Напомнить через неделю
      </button>
      <ErrorBox error={error} />
    </aside>
  );
}
export function UpdatePanel() {
  const update = useUpdate(true);
  const client = useQueryClient();
  const location = useLocation();
  const [error, setError] = useState<unknown>();
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(() => {
    try {
      return !!sessionStorage.getItem(pendingKey);
    } catch {
      return false;
    }
  });
  const [reconnected, setReconnected] = useState(false);
  const [slowRestart, setSlowRestart] = useState(false);
  useEffect(() => {
    if (restarting && update.data?.stage === "error") {
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        /* unavailable */
      }
      setRestarting(false);
    }
  }, [restarting, update.data?.stage]);
  const data = update.data;
  useEffect(() => {
    if (location.hash === "#updates")
      document
        .getElementById("updates")
        ?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash]);
  useEffect(() => {
    if (!restarting) return;
    let cancelled = false;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts++;
      if (attempts >= 60) setSlowRestart(true);
      try {
        const release = await json<{ version: string }>("/release.json");
        let expected = "";
        try {
          expected = sessionStorage.getItem(pendingKey) ?? "";
        } catch {
          /* unavailable */
        }
        if (expected && release.version !== expected) return;
        const response = await fetch("/readyz", { cache: "no-store" });
        if (response.ok && !cancelled) {
          setReconnected(true);
          window.clearInterval(timer);
        }
      } catch {
        /* Service is restarting. */
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [restarting]);
  async function command(action: string) {
    setSending(true);
    setError(undefined);
    try {
      if (action === "install") {
        // Persist before requesting: a dropped connection may mean installation has begun.
        try {
          sessionStorage.setItem(pendingKey, data?.availableVersion ?? "");
        } catch {
          /* unavailable */
        }
      }
      const result = await api<UpdateStatus>(
        `/local/update/${action}`,
        "POST",
        {},
      );
      client.setQueryData(["local-update"], result);
      if (action === "install") setRestarting(true);
    } catch (e) {
      setError(e);
      if (action === "install") {
        // Reconcile an ambiguous response with the launcher on the next successful poll.
        setRestarting(true);
      }
    } finally {
      setSending(false);
    }
  }
  const active =
    sending ||
    ["checking", "downloading", "installing"].includes(data?.stage ?? "");
  return (
    <section
      id="updates"
      className="update-panel"
      aria-labelledby="updates-title"
    >
      <h3 id="updates-title">Обновления приложения</h3>
      <p>
        Установлена версия {data?.currentVersion ?? "…"}. Новые версии
        проверяются автоматически раз в сутки.
      </p>
      <ErrorBox
        error={error ?? (!restarting ? update.error : undefined)}
        retry={() => update.refetch()}
      />
      {data?.error && (
        <p role="alert">
          {data.error}{" "}
          <a href={data.releaseUrl} target="_blank" rel="noreferrer">
            Скачать установщик
          </a>
        </p>
      )}
      {restarting ? (
        <div role="status">
          <p>
            {reconnected
              ? "Обновление установлено. Перезагрузите интерфейс, чтобы продолжить."
              : "Ожидаем запуска обновлённого приложения…"}
          </p>
          {reconnected && (
            <button
              className="primary"
              onClick={() => {
                try {
                  sessionStorage.removeItem(pendingKey);
                } catch {
                  /* unavailable */
                }
                window.location.reload();
              }}
            >
              Открыть обновлённое приложение
            </button>
          )}
          {slowRestart && !reconnected && (
            <>
              <p>
                Запуск занимает больше обычного. Откройте приложение через
                иконку и проверьте диагностику.
              </p>
              <button
                onClick={() => {
                  try {
                    sessionStorage.removeItem(pendingKey);
                  } catch {
                    /* unavailable */
                  }
                  setRestarting(false);
                  setSlowRestart(false);
                }}
              >
                Вернуться к состоянию обновления
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {data?.checkedAt ? (
            <p className="muted">
              Последняя проверка:{" "}
              {new Date(data.checkedAt * 1000).toLocaleString("ru-RU")}
            </p>
          ) : null}
          {data?.stage === "idle" && data.checkedAt > 0 && (
            <p>У вас последняя доступная версия.</p>
          )}
          <div className="actions">
            <button
              disabled={active || data?.stage === "ready"}
              onClick={() => void command("check")}
            >
              {data?.stage === "checking"
                ? "Проверяем…"
                : "Проверить обновления"}
            </button>
            {data?.availableVersion && !data.canInstall && (
              <button
                className="primary"
                disabled={active}
                onClick={() => void command("download")}
              >
                Скачать версию {data.availableVersion}
              </button>
            )}
            {data?.canInstall && (
              <div>
                <p>
                  Сохраните открытые формы, в том числе в других вкладках и
                  расширении. Приложение и локальный сервис будут перезапущены.
                </p>
                <button
                  className="primary"
                  disabled={active}
                  onClick={() => void command("install")}
                >
                  Установить и перезапустить
                </button>
              </div>
            )}
          </div>
          {data?.stage === "downloading" && (
            <div role="status">
              <p>Скачивание и проверка подписи…</p>
              <progress
                max={data.total ?? undefined}
                value={data.total ? data.downloaded : undefined}
              />
            </div>
          )}
        </>
      )}
      {!!data?.notes.length && (
        <details>
          <summary>Что нового в версии {data.availableVersion}</summary>
          <ReleaseEntries notes={data.notes} />
        </details>
      )}
    </section>
  );
}
