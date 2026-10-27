import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Transport, MCPToken as Token } from "@avari/shared";

export function MCPSettings({ api }: { api: Transport }) {
  const client = useQueryClient();
  const tokens = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: () => api<Token[]>("/mcp/tokens"),
  });
  const [name, setName] = useState("Codex");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const config = `[mcp_servers.avari_jobs]\nurl = ${JSON.stringify(window.location.origin + "/mcp")}\nbearer_token_env_var = "AVARI_JOBS_MCP_TOKEN"`;
  const refresh = () => client.invalidateQueries({ queryKey: ["mcp-tokens"] });
  const date = (value: string) => new Date(value).toLocaleString("ru-RU");
  return (
    <section className="panel mcp-settings">
      <div className="panel-head">
        <h2>MCP / Codex</h2>
        <p>Добавляйте вакансии в журнал из диалога с агентом.</p>
      </div>
      <p>
        Отправьте ссылку: агент подготовит карточку и предложит сохранить.
        Команда «Сохрани эту вакансию» разрешает сохранение сразу, если известны
        компания и позиция.
      </p>
      <form
        className="mcp-token-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setSecret("");
          try {
            const result = await api<{ token: Token; secret: string }>(
              "/mcp/tokens",
              "POST",
              { name },
            );
            setSecret(result.secret);
            await refresh();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Не удалось создать токен",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Название подключения
          <input
            value={name}
            maxLength={200}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || !name.trim()}>
          Создать токен на 90 дней
        </button>
      </form>
      {error && (
        <p className="error notice" role="alert">
          {error}
        </p>
      )}
      {secret && (
        <div className="notice" role="status">
          <p>
            Скопируйте токен сейчас: после закрытия раздела он больше не
            отображается. Храните его как пароль.
          </p>
          <label>
            Новый MCP-токен
            <input
              readOnly
              value={secret}
              autoComplete="off"
              spellCheck={false}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
              } catch {
                setError(
                  "Не удалось скопировать. Выделите токен и скопируйте вручную.",
                );
              }
            }}
          >
            Скопировать токен
          </button>
          <button type="button" onClick={() => setSecret("")}>
            Скрыть токен
          </button>
        </div>
      )}
      <h3>Подключение</h3>
      <ol>
        <li>
          Создайте токен и задайте переменную окружения{" "}
          <code>AVARI_JOBS_MCP_TOKEN</code> на компьютере, где запускается
          Codex. Перезапустите Codex из окружения с этой переменной.
        </li>
        <li>
          Добавьте конфигурацию в <code>~/.codex/config.toml</code>:
          <pre style={{ overflowX: "auto" }}>{config}</pre>
        </li>
        <li>
          Проверьте подключение командой <code>codex mcp list</code> и отправьте
          агенту ссылку на вакансию.
        </li>
      </ol>
      <p className="muted">
        Токен разрешает подготовку и добавление вакансий. Настройки
        подтверждений Codex могут дополнительно запрашивать разрешение на
        сохранение. Для закрытой страницы агенту понадобится текст вакансии.
      </p>
      <h3>Подключения</h3>
      {tokens.isPending ? (
        <p>Загрузка…</p>
      ) : tokens.error ? (
        <div role="alert">
          <p>Не удалось загрузить подключения.</p>
          <button onClick={() => void tokens.refetch()}>Повторить</button>
        </div>
      ) : !tokens.data?.length ? (
        <p className="muted">Нет MCP-подключений.</p>
      ) : (
        tokens.data.map((token) => (
          <div className="session" key={token.id}>
            <div style={{ flex: 1 }}>
              <strong>{token.name}</strong>
              <small>
                Создан: {date(token.createdAt)} · Действует до:{" "}
                {date(token.expiresAt)}
                {Date.parse(token.expiresAt) <= Date.now() ? " · Истёк" : ""}
              </small>
              <small>
                Последнее использование:{" "}
                {token.lastUsedAt
                  ? date(token.lastUsedAt)
                  : "ещё не использовался"}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/mcp/tokens/" + token.id, "DELETE");
                  setSecret("");
                  await refresh();
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Не удалось отозвать токен",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Отозвать
            </button>
          </div>
        ))
      )}
    </section>
  );
}
