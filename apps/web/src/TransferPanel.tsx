import { useState } from "react";
import {
  createAPI,
  type Journal,
  type ImportReport,
  type Field,
  type User,
} from "@avari/shared";
import { ErrorBox } from "@avari/shared/ui";

const api = createAPI();
export function TransferPanel({
  user,
  onImported,
}: {
  user: User;
  onImported: () => void;
}) {
  const [journal, setJournal] = useState<Journal>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [applySettings, setApplySettings] = useState(false);
  const [report, setReport] = useState<ImportReport>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const invalidate = () =>
    setReport((r) => (r ? { ...r, ready: false, revision: "" } : r));
  const run = async (apply: boolean) => {
    if (!journal) return;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const result = await api<ImportReport>(
        apply ? "/journal/import" : "/journal/import/preview",
        "POST",
        {
          journal,
          fieldMapping: mapping,
          applySettings,
          ...(apply ? { revision: report?.revision } : {}),
        },
      );
      setReport(result);
      if (apply) {
        if (applySettings) {
          if (journal.settings.table)
            localStorage.setItem(
              "avari-table:" + user.id,
              JSON.stringify(journal.settings.table),
            );
          if (journal.settings.theme) {
            localStorage.setItem("avari-theme", journal.settings.theme);
            window.dispatchEvent(new Event("avari-theme-change"));
          }
        }
        setNotice("Импорт завершён. Текущие версии записей сохранены.");
        setJournal(undefined);
        setMapping({});
        onImported();
      }
    } catch (e) {
      setError(e);
      invalidate();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel transfer-panel">
      <div className="panel-head">
        <h2>Импорт и экспорт</h2>
        <p>
          Полная копия личного журнала: вакансии, задачи, заметки, история и
          критерии. Пароли, секретные ссылки и файлы резюме в экспорт JSON не входят
          (файлы резюме сохраняются в полной резервной копии базы данных).
        </p>
      </div>
      <ErrorBox error={error} />
      {notice && (
        <p className="success notice" role="status">
          {notice}
        </p>
      )}
      <div className="form">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const data = await api<Journal>("/journal/export");
              const theme = localStorage.getItem("avari-theme");
              if (theme === "dark" || theme === "light")
                data.settings.theme = theme;
              const stored = JSON.parse(
                localStorage.getItem("avari-table:" + user.id) ?? "null",
              );
              if (
                stored &&
                ["", "stage", "state", "group", "priority"].includes(
                  stored.group,
                )
              ) {
                data.settings.table = {
                  group: stored.group,
                  cards: stored.cards === true,
                  statistics: stored.statistics !== false,
                };
              }
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download =
                "avari-journal-" +
                new Date().toISOString().slice(0, 10) +
                ".json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Скачать журнал JSON
        </button>
        <label>
          Импортировать журнал JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              setJournal(undefined);
              setReport(undefined);
              setMapping({});
              setApplySettings(false);
              setNotice("");
              setError(undefined);
              if (!file) return;
              setBusy(true);
              try {
                if (file.size > 31 * 1024 * 1024)
                  throw new Error("Файл слишком большой: максимум 31 МБ.");
                const data: Journal = JSON.parse(await file.text());
                if (
                  data.format !== "avari-journal" ||
                  data.version !== 1 ||
                  !data.settings
                )
                  throw new Error(
                    "Выберите полный JSON-экспорт Avari.Jobs версии 1.",
                  );
                const existing = await api<Field[]>("/fields");
                const preview = await api<ImportReport>(
                  "/journal/import/preview",
                  "POST",
                  { journal: data, fieldMapping: {}, applySettings: false },
                );
                setFields(existing);
                setJournal(data);
                setReport(preview);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {journal && (
          <>
            <p>
              Импорт дополняет существующий журнал. Поля сохранённых вакансий и
              изменённые задачи или заметки остаются текущими. Повторный импорт
              не создаёт дубли.
            </p>
            <details open={report?.fieldConflicts.length ? true : undefined}>
              <summary>Сопоставление дополнительных полей</summary>
              {journal.fields.map((field) => (
                <label key={field.id}>
                  Поле «{field.name}» (
                  {
                    (
                      {
                        text: "Текст",
                        number: "Число",
                        date: "Дата",
                        flag: "Флаг",
                        select: "Выбор",
                      } as Record<string, string>
                    )[field.type]
                  }
                  )
                  <select
                    value={mapping[field.id] ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value) next[field.id] = e.target.value;
                        else delete next[field.id];
                        return next;
                      });
                      invalidate();
                    }}
                  >
                    <option value="">Сопоставить автоматически</option>
                    {fields
                      .filter(
                        (f) =>
                          f.type === field.type &&
                          (f.type !== "select" ||
                            JSON.stringify(f.options) ===
                              JSON.stringify(field.options)),
                      )
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    {fields.length < 5 && (
                      <option value="_new">Создать отдельное поле</option>
                    )}
                    <option value="_skip">
                      Не переносить поле и его значения
                    </option>
                  </select>
                </label>
              ))}{" "}
            </details>

            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={applySettings}
                disabled={busy}
                onChange={(e) => {
                  setApplySettings(e.target.checked);
                  invalidate();
                }}
              />
              Применить часовой пояс, тему и настройки отображения из файла
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(false)}
              >
                Проверить импорт
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !report?.ready || !report.revision}
                onClick={() => void run(true)}
              >
                {busy ? "Обработка…" : "Применить импорт"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setJournal(undefined);
                  setReport(undefined);
                }}
              >
                Отмена
              </button>
            </div>
          </>
        )}
        {report && (
          <div aria-live="polite">
            {report.fieldConflicts.length > 0 && (
              <p className="notice">
                Сопоставьте поля:{" "}
                {report.fieldConflicts.map((c) => c.field.name).join(", ")}.
                Затем повторите проверку.
              </p>
            )}
            <ul>
              <li>Новые вакансии: {report.newApplications}</li>
              <li>Совпавшие вакансии: {report.matchedApplications}</li>
              <li>
                Новые задачи: {report.newTasks}; заметки: {report.newNotes};
                события истории: {report.newEvents}
              </li>
              <li>
                Без изменений: {report.unchanged}; конфликты:{" "}
                {report.conflicts.length}
              </li>
            </ul>
            {report.conflicts.length > 0 && (
              <details>
                <summary>Сохранённые текущие записи</summary>
                <ul>
                  {report.conflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
