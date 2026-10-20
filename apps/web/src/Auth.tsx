import { useLayoutEffect, useRef, useState } from "react";
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
  const heading = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);
  const focusedMode = useRef(mode);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  useLayoutEffect(() => {
    // URL-driven transitions also clear secrets; explicit switches clear them
    // before navigation so a delayed route render cannot erase fresh input.
    if (previousMode.current !== mode) {
      setPassword("");
      setConfirm("");
      setShowPassword(false);
      setError(undefined);
      previousMode.current = mode;
    }
    if (focusedMode.current !== mode) {
      focusedMode.current = mode;
      heading.current?.focus();
    }
  }, [mode]);
  const switchMode = (next: "login" | "register" | "recovery") => {
    if (busy) return;
    previousMode.current = next;
    setPassword("");
    setConfirm("");
    setShowPassword(false);
    setError(undefined);
    setSuccess("");
    setMode(next);
  };
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
          <h1 ref={heading} tabIndex={-1}>
            {mode === "login"
              ? "Вход в Avari.Jobs"
              : mode === "register"
                ? "Создать аккаунт"
                : "Восстановление доступа"}
          </h1>
          <p>
            {mode === "recovery"
              ? "Укажите email и новый пароль. Администратор одобрит смену вручную."
              : mode === "register"
                ? "После регистрации подтвердите аккаунт через Telegram, если он доступен, или дождитесь одобрения администратора."
                : "Отклики, встречи и следующие шаги — в одном месте."}
          </p>
          {success && (
            <div className="success notice" role="status">
              {success}
            </div>
          )}
          <form
            className="form"
            onKeyDown={handleFormSubmitShortcut}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setError(undefined);
              if (mode === "recovery" && password !== confirm) {
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
                  } catch {
                    setMode("login");
                    setSuccess(
                      "Аккаунт создан. Войдите, чтобы подтвердить его.",
                    );
                    return;
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
                name="email"
                disabled={busy}
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
                type={showPassword ? "text" : "password"}
                name="password"
                disabled={busy}
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
            {mode === "recovery" && (
              <FieldInput label="Подтвердите новый пароль">
                <input
                  type={showPassword ? "text" : "password"}
                  name="confirm-password"
                  required
                  disabled={busy}
                  maxLength={256}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </FieldInput>
            )}
            <button
              type="button"
              className="auth-link-button auth-password-toggle"
              aria-pressed={showPassword}
              disabled={busy}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? "Скрыть пароль" : "Показать пароль"}
            </button>
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
          {!personal && mode === "login" && (
            <TelegramLogin
              api={api}
              onLogin={onLogin}
              busy={busy}
              onBusyChange={setBusy}
            />
          )}
          {!personal && (
            <div className="auth-footer-nav">
              {mode === "login" ? (
                <>
                  <button
                    type="button"
                    className="auth-link-button"
                    disabled={busy}
                    onClick={() => switchMode("recovery")}
                  >
                    Забыли пароль?
                  </button>
                  <button
                    type="button"
                    className="auth-link-button"
                    disabled={busy}
                    onClick={() => switchMode("register")}
                  >
                    Нет аккаунта? Создать
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="auth-link-button"
                  disabled={busy}
                  onClick={() => switchMode("login")}
                >
                  {mode === "register"
                    ? "Уже есть аккаунт? Войти"
                    : "← Вернуться ко входу"}
                </button>
              )}
            </div>
          )}
          {mode === "recovery" && (
            <p className="auth-footnote">
              Новый пароль начнёт действовать после одобрения администратором.
            </p>
          )}
          <p className="auth-footnote">
            <a href="/extension">Расширение для браузера</a> ·{" "}
            <a href="/privacy">Конфиденциальность</a>
          </p>
        </div>
      </section>
    </div>
  );
}
