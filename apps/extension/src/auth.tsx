import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBox, ThemeButton, useTheme } from "@avari/shared/ui";
import type { TelegramLoginState } from "./telegram-auth";
import "@avari/shared/styles.css";
import "./auth.css";

async function send(
  type: "TELEGRAM_STATUS" | "TELEGRAM_START",
  server?: string,
  restart = false,
): Promise<TelegramLoginState> {
  const result = await chrome.runtime.sendMessage({ type, server, restart });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function Auth() {
  useTheme();
  const server = useRef<string | undefined>(undefined);
  const [state, setState] = useState<TelegramLoginState>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    async function poll(initial = false) {
      setBusy(true);
      try {
        let next = await send(
          initial && attempt > 0 ? "TELEGRAM_START" : "TELEGRAM_STATUS",
          server.current,
          initial && attempt > 0,
        );
        server.current ??= next.server;
        if (initial && next.status === "idle")
          next = await send("TELEGRAM_START", server.current);
        if (!alive) return;
        setState(next);
        setError(undefined);
        if (next.status === "pending")
          timer = window.setTimeout(() => void poll(), 6000);
        if (next.status === "idle")
          setError(
            new Error("Сервер изменён. Начните вход заново из расширения."),
          );
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setBusy(false);
      }
    }
    void poll(true);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [attempt]);
  const success = state?.status === "completed";
  const terminal = state?.status === "cancelled" || state?.status === "expired";
  return (
    <main className="telegram-auth">
      <header>
        <span className="eyebrow">Avari.Jobs · Расширение</span>
        <ThemeButton />
      </header>
      <h1>{success ? "Вы вошли" : "Вход через Telegram"}</h1>
      {state && (
        <p className="muted">
          Сервис: <strong>{state.server}</strong>
        </p>
      )}
      <ErrorBox error={error} />
      {success ? (
        <p role="status">
          Можно вернуться к вакансии. Эту вкладку можно закрыть.
        </p>
      ) : (
        <>
          <p>
            Для входа нужен активный аккаунт с Telegram, подключённым на сайте.
          </p>
          {state?.status === "pending" && !error && (
            <section role="status">
              <p>
                Код:{" "}
                <strong className="telegram-code">
                  {state.challenge?.code}
                </strong>
              </p>
              <p>Откройте бота, сверьте код и подтвердите вход в расширение.</p>
              <a
                className="button primary"
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть Telegram
              </a>
              <p className="muted">
                Ожидаем подтверждение. Запрос действует пять минут.
              </p>
            </section>
          )}
          {terminal && (
            <p role="status">
              {state.status === "cancelled"
                ? "Вход отменён."
                : "Срок запроса истёк."}{" "}
              Начните заново.
            </p>
          )}
          {(terminal || !!error) && state?.status !== "idle" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAttempt((v) => v + 1)}
            >
              Начать заново
            </button>
          )}
          {!state && !error && <p role="status">Подготавливаем вход…</p>}
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Auth />);
