import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Layers,
  CalendarDays,
} from "lucide-react";
import type { Transport, User } from "@avari/shared";
import {
  ThemeButton,
  ErrorBox,
  FieldInput,
  handleFormSubmitShortcut,
  SubmitShortcutHint,
} from "@avari/shared/ui";
import { TelegramLogin } from "./Telegram";
import { Brand } from "./Brand";

export function Auth({
  onLogin,
  api,
  personal = false,
}: {
  onLogin: (u: User) => void;
  api: Transport;
  personal?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const requestedMode = params.get("mode");
  const mode =
    !personal && (requestedMode === "register" || requestedMode === "recovery")
      ? requestedMode
      : "login";
  const setMode = (next: "login" | "register" | "recovery") => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === "login") updated.delete("mode");
        else updated.set("mode", next);
        return updated;
      },
      { replace: true },
    );
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  return (
    <div className="auth-page">
      {!personal && (
        <Link className="auth-home-link" to="/">
          <ArrowLeft size={16} /> На главную
        </Link>
      )}
      <div className="auth-theme">
        <ThemeButton />
      </div>
      <section className="auth-card auth-split">
        <aside className="auth-story">
          <div className="auth-water-canvas" aria-hidden="true">
            <div className="water-wave wave-1" />
            <div className="water-wave wave-2" />
            <div className="water-wave wave-3" />
            <div className="water-caustics" />
          </div>
          <Brand />
          <div className="auth-story-copy">
            <span className="eyebrow">Личный журнал поиска работы</span>
            <h2>
              Весь поиск работы
              <br />
              перед глазами
            </h2>
            <p>
              Храните вакансии и договорённости вместе, чтобы всегда знать, что
              делать дальше.
            </p>
            <ul className="auth-benefits">
              <li>
                <BriefcaseBusiness size={20} />
                <span>Сохранённые вакансии и история откликов</span>
              </li>
              <li>
                <Layers size={20} />
                <span>Этапы общения с каждой компанией</span>
              </li>
              <li>
                <CalendarDays size={20} />
                <span>Встречи и задачи на ближайшие дни</span>
              </li>
            </ul>
          </div>
          <div className="auth-story-footer">
            <span>
              {personal
                ? "Локальная версия · данные на этом компьютере"
                : "Начните с одной вакансии. Дополняйте журнал по ходу поиска."}
            </span>
          </div>
        </aside>
        <div className="auth-form-pane">
          <span className="eyebrow">Avari.Jobs</span>
          <h1>
            {mode === "login"
              ? "Вход в Avari.Jobs"
              : mode === "register"
                ? "Создать аккаунт"
                : "Восстановление доступа"}
          </h1>
          <p>
            {mode === "recovery"
              ? "Укажите email и новый пароль. Администратор одобрит смену вручную."
              : "Отклики, встречи и следующие шаги — в одном месте."}
          </p>
          {!personal && (
            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError(undefined);
                  setSuccess("");
                }}
              >
                Вход
              </button>
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => {
                  setMode("register");
                  setError(undefined);
                  setSuccess("");
                }}
              >
                Регистрация
              </button>
            </div>
          )}
          {!personal && mode === "login" && (
            <TelegramLogin api={api} onLogin={onLogin} />
          )}
          {success && <div className="success notice">{success}</div>}
          <form
            className="form"
            onKeyDown={handleFormSubmitShortcut}
            onSubmit={async (e) => {
              e.preventDefault();
              setError(undefined);
              if (
                (mode === "register" || mode === "recovery") &&
                password !== confirm
              ) {
                setError(new Error("Пароли не совпадают"));
                return;
              }
              if (mode === "recovery" && password.length < 10) {
                setError(
                  new Error("Пароль должен содержать от 10 до 256 символов"),
                );
                return;
              }
              setBusy(true);
              try {
                if (mode === "register") {
                  await api("/auth/register", "POST", {
                    email,
                    password,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  });
                  try {
                    const result = await api<{ user: User }>(
                      "/auth/login",
                      "POST",
                      { email, password, kind: "web" },
                    );
                    onLogin(result.user);
                  } catch (loginError) {
                    setMode("login");
                    setSuccess(
                      "Аккаунт создан. Войдите, чтобы отслеживать одобрение.",
                    );
                    throw loginError;
                  }
                } else if (mode === "recovery") {
                  await api("/auth/recovery", "POST", {
                    email,
                    password,
                  });
                  setPassword("");
                  setConfirm("");
                  setSuccess(
                    "Запрос на смену пароля отправлен администратору. После одобрения войдите с новым паролем.",
                  );
                } else {
                  const result = await api<{ user: User }>(
                    "/auth/login",
                    "POST",
                    { email, password, kind: "web", name: navigator.platform },
                  );
                  onLogin(result.user);
                }
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ErrorBox error={error} />
            <FieldInput label="Email">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FieldInput>
            <FieldInput
              label={mode === "recovery" ? "Новый пароль" : "Пароль"}
              hint={mode !== "login" ? "Не менее 10 символов" : undefined}
            >
              <input
                type="password"
                required
                minLength={mode !== "login" ? 10 : undefined}
                maxLength={256}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FieldInput>
            <div
              className={`auth-field-expand ${mode !== "login" ? "open" : ""}`}
              aria-hidden={mode === "login"}
            >
              <div className="auth-field-expand-inner">
                <FieldInput
                  label={
                    mode === "recovery"
                      ? "Подтвердите новый пароль"
                      : "Подтвердите пароль"
                  }
                >
                  <input
                    type="password"
                    required={mode !== "login"}
                    tabIndex={mode === "login" ? -1 : undefined}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </FieldInput>
              </div>
            </div>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                {busy
                  ? "Подождите…"
                  : mode === "login"
                    ? "Войти"
                    : mode === "register"
                      ? "Создать аккаунт"
                      : "Запросить сброс пароля"}
                <SubmitShortcutHint />
              </button>
            </div>
          </form>
          <div className="auth-footer-nav">
            {mode === "login" && !personal && (
              <button
                type="button"
                className="auth-link-button"
                onClick={() => {
                  setMode("recovery");
                  setError(undefined);
                  setSuccess("");
                }}
              >
                Забыли пароль?
              </button>
            )}
            {mode === "recovery" && (
              <button
                type="button"
                className="auth-link-button"
                onClick={() => {
                  setMode("login");
                  setError(undefined);
                  setSuccess("");
                }}
              >
                ← Вернуться ко входу
              </button>
            )}
          </div>
          <p className="auth-footnote">
            {mode === "register"
              ? "Регистрацию можно подтвердить через Telegram, если он доступен, или дождаться ручного одобрения администратором."
              : mode === "recovery"
                ? "Новый пароль начнёт действовать после одобрения администратором."
                : "Войдите, чтобы открыть свой журнал."}
          </p>
          <p className="auth-footnote">
            <a href="/extension">Расширение для браузера</a> ·{" "}
            <a href="/privacy">Конфиденциальность</a>
          </p>
        </div>
      </section>
    </div>
  );
}
