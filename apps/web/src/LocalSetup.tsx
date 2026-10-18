import { UpdatePanel } from "./Updates";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  createAPI,
  type LocalStatus,
  type LocalSettings,
  type Session,
  type User,
  type ExtensionDownload,
} from "@avari/shared";
import { ErrorBox, Loading } from "@avari/shared/ui";
const api = createAPI();

export function LocalAutostart({ launcher }: { launcher: boolean }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["local-settings"],
    queryFn: () => api<LocalSettings>("/local/settings"),
    enabled: launcher,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!launcher) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Локальный Avari.Jobs</h2>
        <p>
          Сервис работает в фоне. Закрытие браузера его не останавливает. Выход
          доступен через значок Avari.Jobs в трее.
        </p>
      </div>
      <ErrorBox
        error={error ?? settings.error}
        retry={() => settings.refetch()}
      />
      {settings.isPending ? (
        <Loading />
      ) : (
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={settings.data?.autostart ?? false}
            disabled={busy || !settings.data}
            onChange={async (e) => {
              setBusy(true);
              setError(undefined);
              try {
                const saved = await api<LocalSettings>(
                  "/local/settings",
                  "PUT",
                  { autostart: e.target.checked },
                );
                client.setQueryData(["local-settings"], saved);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
          Запускать Avari.Jobs при входе в систему
        </label>
      )}
      <p className="muted">
        Автозапуск можно отключить здесь в любой момент. Данные хранятся на этом
        компьютере.
      </p>
      <UpdatePanel />
    </section>
  );
}

export function LocalSetup({ status }: { status: LocalStatus }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("setup") ?? "",
  );
  useEffect(() => {
    if (token)
      history.replaceState(null, "", location.pathname + location.search);
  }, [token]);
  const [ownerCreated, setOwnerCreated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState("");
  const sessions = useQuery({
    queryKey: ["setup-extension-sessions"],
    queryFn: () => api<Session[]>("/sessions"),
    enabled: created,
    refetchInterval: created ? 5000 : false,
  });
  const connected = sessions.data?.some((s) => s.kind === "extension");
  return (
    <main className="local-setup">
      <section className="panel">
        <div className="panel-head">
          <h1>Добро пожаловать в локальный Avari.Jobs</h1>
          <p>
            Ваш журнал будет храниться на этом компьютере, отдельно от
            онлайн-версии.
          </p>
        </div>
        <ul className="setup-checks">
          {status.checks?.map((c) => (
            <li key={c}>✓ {c}</li>
          ))}
        </ul>
        <ErrorBox error={error} />
        {!created ? (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(undefined);
              if (password !== confirm) {
                setError(new Error("Пароли не совпадают"));
                return;
              }
              setBusy(true);
              try {
                await api("/local/setup", "POST", {
                  email,
                  password,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  token,
                });
                setOwnerCreated(true);
                const result = await api<{ user: User }>(
                  "/auth/login",
                  "POST",
                  { email, password },
                );
                client.setQueryData(["me"], result.user);
                setPassword("");
                setConfirm("");
                setCreated(true);
                history.replaceState(null, "", location.pathname);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Создайте личный аккаунт</h2>
            {ownerCreated && (
              <button
                type="button"
                onClick={() =>
                  void client.invalidateQueries({ queryKey: ["local-status"] })
                }
              >
                Аккаунт создан — перейти ко входу
              </button>
            )}
            {!token && (
              <p className="notice">
                Для создания владельца откройте Avari.Jobs через иконку приложения.
              </p>
            )}
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                required
                minLength={10}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              Повторите пароль
              <input
                type="password"
                required
                minLength={10}
                maxLength={256}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <p>
              Сохраните пароль: он также понадобится для входа в расширение.
              Одобрение администратора не требуется.
            </p>
            <button className="primary" disabled={busy || !token}>
              {busy ? "Создание…" : "Создать аккаунт"}
            </button>
          </form>
        ) : (
          <>
            <LocalAutostart launcher={status.launcher} />
            <h2>Подключите расширение</h2>
            {import.meta.env.VITE_CHROME_STORE_URL ? (
              <p>
                <a
                  className="button"
                  href={import.meta.env.VITE_CHROME_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Установить из Chrome Web Store
                </a>
              </p>
            ) : (
              <p>Ссылка на магазин появится после публикации расширения.</p>
            )}
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  const d = await api<ExtensionDownload>(
                    "/extension/download",
                    "POST",
                    {},
                  );
                  setDownload(d.url);
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Подготовить архив для ручной установки
            </button>
            {download && (
              <p>
                <a href={download}>Скачать архив расширения</a>
              </p>
            )}
            <ol>
              <li>
                Для ручной установки распакуйте архив, откройте
                chrome://extensions, включите режим разработчика и выберите
                «Загрузить распакованное расширение».
              </li>
              <li>
                В расширении выберите «Использовать свой сервер» и укажите адрес
                ниже.
              </li>
              <li>Войдите с email и паролем созданного аккаунта.</li>
            </ol>
            <label>
              Адрес сервера
              <input
                readOnly
                value={status.origin ?? location.origin}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    status.origin ?? location.origin,
                  );
                } catch {
                  setError(new Error("Выделите и скопируйте адрес вручную"));
                }
              }}
            >
              Скопировать адрес
            </button>
            <p role="status">
              {connected
                ? "✓ Расширение подключено"
                : "Ожидаем входа в расширение. Этот шаг можно пропустить."}
            </p>
            <ErrorBox error={sessions.error} retry={() => sessions.refetch()} />
            <button
              className="primary"
              onClick={async () => {
                await client.invalidateQueries({ queryKey: ["local-status"] });
                navigate("/", { replace: true });
              }}
            >
              Открыть журнал
            </button>
          </>
        )}
      </section>
    </main>
  );
}
