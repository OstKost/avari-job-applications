import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  type Application,
  type AIJob,
  type AISettings,
  type Skill,
  type SkillRef,
  type Profile,
  type SkillStatistics,
  emptyAIFields,
  isAIReady,
} from "@avari/shared";
import { ErrorBox, FieldInput, Modal } from "@avari/shared/ui";
import { offlineManager } from "./offline/manager";
import { getUserGeneration } from "./offline/db";
import { isNetworkError } from "./offline/policy";
import { createWebAPI } from "./offline/policy";
import type { VacancyPreview } from "../../../packages/shared/src/vacancy-preview";
import "./ai.css";

const api = createWebAPI();
async function cachedAI<T>(path: string, userId: string): Promise<T> {
  const epoch = getUserGeneration(userId);
  const cacheId = "ai:" + path;
  try {
    const data = await api<T>(path);
    if (userId)
      void offlineManager.recordDetailFetch(userId, cacheId, data, epoch);
    return data;
  } catch (error) {
    if (userId && isNetworkError(error)) {
      const cached = await offlineManager.getCachedDetail(userId, cacheId);
      if (cached) return cached.detail as T;
    }
    throw error;
  }
}
const categories: Record<string, string> = {
  hard: "Профессиональные",
  soft: "Мягкие",
  language: "Языки",
};
const statusLabels: Record<string, string> = {
  queued: "В очереди",
  running: "Обрабатывается",
  ready: "Готово",
  awaiting: "Ожидает применения",
  error: "Ошибка",
};
export function useAIJobs() {
  const client = useQueryClient();
  const handled = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ["ai", "jobs"],
    queryFn: () => api<AIJob[]>("/ai/jobs"),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j) => ["queued", "running"].includes(j.status))
        ? 1500
        : false,
  });
  useEffect(() => {
    let changed = false;
    for (const job of query.data ?? []) {
      const key = job.id + job.status;
      if (
        ["ready", "awaiting", "error"].includes(job.status) &&
        !handled.current.has(key)
      ) {
        handled.current.add(key);
        if (job.status === "ready") changed = true;
      }
    }
    if (changed) {
      for (const key of [
        ["data"],
        ["applications"],
        ["detail"],
        ["ai", "skills"],
        ["ai", "statistics"],
      ])
        void client.invalidateQueries({ queryKey: key });
    }
  }, [query.data, client]);
  return query;
}
function useAIAction() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  return {
    error,
    busy,
    run: async (work: () => Promise<unknown>) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setError(undefined);
      try {
        await work();
        await client.invalidateQueries({ queryKey: ["ai"] });
        await client.invalidateQueries({ queryKey: ["data"] });
      } catch (e) {
        setError(e);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
async function queue(kind: AIJob["kind"], targetId = "") {
  return api<AIJob>("/ai/jobs", "POST", { kind, targetId });
}
function JobResult({ job, onApplied }: { job: AIJob; onApplied?: () => void }) {
  const action = useAIAction();
  const client = useQueryClient();
  let result: unknown;
  try {
    result = job.result ? JSON.parse(job.result) : null;
  } catch {
    result = job.result;
  }
  const extraction = result as {
    summary?: string;
    skills?: SkillRef[];
    content?: string;
  } | null;
  return (
    <article className="ai-job" aria-live="polite">
      <strong>{statusLabels[job.status]}</strong>{" "}
      <small>
        {job.provider} · {job.model}
      </small>
      {job.error && <p role="alert">{job.error}</p>}
      {job.status === "awaiting" && (
        <>
          <h4>Предлагаемый результат</h4>
          {extraction?.summary && <p>{extraction.summary}</p>}
          <SkillTags skills={extraction?.skills ?? []} />
          {extraction?.content && (
            <pre className="ai-prose">{extraction.content}</pre>
          )}
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/ai/jobs/${job.id}/apply`, "POST", {});
                await client.invalidateQueries({ queryKey: ["detail"] });
                await client.invalidateQueries({ queryKey: ["data"] });
                await client.invalidateQueries({ queryKey: ["applications"] });
                onApplied?.();
              })
            }
          >
            Применить с заменой текущего результата
          </button>
        </>
      )}
      <ErrorBox error={action.error} />
    </article>
  );
}
export function SkillTags({ skills }: { skills: SkillRef[] }) {
  return (
    <div className="ai-tags">
      {skills.map((s) => (
        <span className="count-chip" key={s.id || s.name}>
          #{s.name}
        </span>
      ))}
    </div>
  );
}
export function AISettingsPanel() {
  const q = useQuery({
    queryKey: ["ai", "settings"],
    queryFn: () => api<AISettings>("/ai/settings"),
  });
  const jobs = useAIJobs();
  const action = useAIAction();
  const [settings, setSettings] = useState({
    provider: "openai",
    model: "",
    baseUrl: "",
    apiKey: "",
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (q.data)
      setSettings({
        provider: q.data.provider || "openai",
        model: q.data.model,
        baseUrl: q.data.baseUrl,
        apiKey: "",
      });
  }, [q.data]);
  const test = jobs.data?.find((j) => j.kind === "test");
  return (
    <section className="panel ai-panel">
      <h2>Подключение ИИ</h2>
      <p>
        Ваш API-ключ и расходы по нему индивидуальны. При запуске текст вакансий
        и указанные вами данные отправляются выбранному провайдеру.
      </p>
      <ErrorBox error={q.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api("/ai/settings", "PUT", settings);
            setSettings((s) => ({ ...s, apiKey: "" }));
            setMessage("Подключение сохранено");
          });
        }}
      >
        <div className="form-grid">
          <FieldInput label="Провайдер">
            <select
              value={settings.provider}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  provider: e.target.value,
                  apiKey: "",
                })
              }
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </FieldInput>
          <FieldInput label="Идентификатор модели">
            <input
              required
              maxLength={200}
              value={settings.model}
              onChange={(e) =>
                setSettings({ ...settings, model: e.target.value })
              }
              placeholder="Идентификатор из кабинета провайдера"
            />
          </FieldInput>
          <FieldInput
            label={
              q.data?.hasKey
                ? "Новый API-ключ (оставьте пустым, чтобы сохранить прежний)"
                : "API-ключ"
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={settings.apiKey}
              onChange={(e) =>
                setSettings({ ...settings, apiKey: e.target.value })
              }
            />
          </FieldInput>
          <FieldInput label="Базовый адрес API (необязательно)">
            <input
              type="url"
              value={settings.baseUrl}
              onChange={(e) =>
                setSettings({ ...settings, baseUrl: e.target.value })
              }
              placeholder="HTTPS URL с /v1 или /v1beta"
            />
          </FieldInput>
        </div>
        <p className="muted">
          Пустой адрес означает официальный API. Свой адрес должен поддерживать
          протокол выбранного провайдера. Разрешены публичные HTTPS-адреса.
        </p>
        <div className="ai-actions">
          <button disabled={action.busy || q.isPending}>
            Сохранить подключение
          </button>
          <button
            type="button"
            disabled={action.busy || !q.data?.hasKey}
            onClick={() =>
              void action.run(async () => {
                await queue("test");
                setMessage("Тестовый запрос поставлен в очередь");
              })
            }
          >
            Проверить сохранённое подключение
          </button>
          <button
            type="button"
            disabled={action.busy || !q.data?.hasKey}
            onClick={() =>
              void action.run(async () => {
                await api("/ai/settings", "DELETE");
                setMessage("Подключение удалено");
              })
            }
          >
            Удалить ключ
          </button>
        </div>
      </form>
      <ErrorBox error={action.error} />
      {message && <p role="status">{message}</p>}
      {test && <JobResult job={test} />}
    </section>
  );
}
export function AIVacancyPanel({
  application: a,
  onChanged,
}: {
  application: Application;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(a.ai ?? emptyAIFields());
  const [newSkill, setNewSkill] = useState("");
  const [category, setCategory] = useState("hard");
  const action = useAIAction();
  const jobs = useAIJobs();
  const skills = useQuery({
    queryKey: ["ai", "skills"],
    queryFn: () => api<Skill[]>("/ai/skills"),
  });
  const baseline = useRef(a.ai ?? emptyAIFields());
  useEffect(() => {
    const previous = baseline.current;
    const next = a.ai ?? emptyAIFields();
    baseline.current = next;
    setDraft((current) =>
      JSON.stringify(current) === JSON.stringify(previous) ? next : current,
    );
  }, [a.version, a.ai]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current);
  const ownJob = jobs.data?.find(
    (j) => j.kind === "extract" && j.targetId === a.id,
  );
  const active = ownJob && ["queued", "running"].includes(ownJob.status);
  const save = async () => {
    const saved = await api<Application>(`/applications/${a.id}`, "PUT", {
      ...a,
      ai: draft,
    });
    baseline.current = saved.ai ?? emptyAIFields();
    setDraft(baseline.current);
    onChanged();
  };
  return (
    <section className="panel ai-panel">
      <h2>Описание и навыки</h2>
      {a.ai?.summary && <p>{a.ai.summary}</p>}
      <SkillTags skills={a.ai?.skills ?? []} />
      {a.ai?.stale && (
        <p className="notice">Текст изменился: результат ИИ устарел.</p>
      )}
      {a.ai?.processedAt && (
        <small>
          {a.ai.provider} · {a.ai.model} ·{" "}
          {new Date(a.ai.processedAt).toLocaleString()}
        </small>
      )}
      <details>
        <summary>Редактировать текст, описание и навыки</summary>
        <FieldInput label="Полный текст вакансии">
          <textarea
            rows={8}
            maxLength={100000}
            value={draft.text}
            onChange={(e) =>
              setDraft({ ...draft, text: e.target.value, source: "manual" })
            }
          />
        </FieldInput>
        <button
          type="button"
          disabled={action.busy || !a.url}
          onClick={() =>
            void action.run(async () => {
              const preview = await api<VacancyPreview>(
                "/vacancies/preview",
                "POST",
                { url: a.url },
              );
              if (!preview.fields.vacancyText)
                throw Error(
                  "На странице не найден текст. Вставьте его вручную",
                );
              setDraft({
                ...draft,
                text: preview.fields.vacancyText,
                source: "url",
              });
            })
          }
        >
          Загрузить текст по ссылке в редактор
        </button>
        <FieldInput
          label={`Краткое описание (${Array.from(draft.summary).length}/400)`}
        >
          <textarea
            rows={3}
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </FieldInput>
        <div className="ai-tags">
          {draft.skills.map((s, i) => (
            <button
              type="button"
              key={s.id || s.name}
              onClick={() =>
                setDraft({
                  ...draft,
                  skills: draft.skills.filter((_, n) => n !== i),
                })
              }
              aria-label={`Удалить навык ${s.name}`}
            >
              #{s.name} ×
            </button>
          ))}
        </div>
        <div className="ai-actions">
          <input
            aria-label="Добавить навык"
            list={`skills-${a.id}`}
            maxLength={100}
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
          />
          <datalist id={`skills-${a.id}`}>
            {skills.data?.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
          <select
            aria-label="Категория нового навыка"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!newSkill.trim() || draft.skills.length >= 100}
            onClick={() => {
              const match = skills.data?.find(
                (s) =>
                  s.name.toLocaleLowerCase() ===
                  newSkill.trim().toLocaleLowerCase(),
              );
              setDraft({
                ...draft,
                skills: [
                  ...draft.skills,
                  match ?? {
                    id: "",
                    name: newSkill.trim(),
                    category: category as SkillRef["category"],
                  },
                ],
              });
              setNewSkill("");
            }}
          >
            Добавить навык
          </button>
        </div>
        <button
          type="button"
          disabled={action.busy || Array.from(draft.summary).length > 400}
          onClick={() => void action.run(save)}
        >
          Сохранить текст и правки
        </button>
      </details>
      <div className="ai-actions">
        <button
          type="button"
          disabled={action.busy || !!active || dirty || !a.ai?.text.trim()}
          onClick={() =>
            void action.run(async () => {
              await queue("extract", a.id);
            })
          }
        >
          {a.ai?.processedAt
            ? "Перегенерировать описание и навыки"
            : "Выделить описание и навыки через ИИ"}
        </button>
        <Link to="/settings#ai">Настроить ИИ</Link>
      </div>
      <p className="muted">
        Перед запуском сохраните изменения текста. Повторный результат можно
        проверить перед заменой.
      </p>
      <ErrorBox error={action.error} />
      {ownJob && <JobResult job={ownJob} onApplied={onChanged} />}
    </section>
  );
}
type Filters = {
  group: string;
  state: string;
  from: string;
  to: string;
  search: string;
};
const emptyFilters: Filters = {
  group: "",
  state: "",
  from: "",
  to: "",
  search: "",
};
function matches(a: Application, f: Filters) {
  return (
    (!f.group ||
      (f.group === "__none__"
        ? !a.groups?.length
        : a.groups?.includes(f.group))) &&
    (!f.state || a.state === f.state) &&
    (!f.from || a.savedDate >= f.from) &&
    (!f.to || a.savedDate <= f.to) &&
    (!f.search ||
      `${a.company} ${a.position}`
        .toLocaleLowerCase()
        .includes(f.search.toLocaleLowerCase()))
  );
}
function FilterFields({
  value: f,
  onChange,
  applications,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  applications: Application[];
}) {
  return (
    <div className="form-grid">
      <FieldInput label="Поиск">
        <input
          value={f.search}
          onChange={(e) => onChange({ ...f, search: e.target.value })}
        />
      </FieldInput>
      <FieldInput label="Группа">
        <select
          value={f.group}
          onChange={(e) => onChange({ ...f, group: e.target.value })}
        >
          <option value="">Все группы</option>
          <option value="__none__">Без группы</option>
          {[...new Set(applications.flatMap((a) => a.groups ?? []))]
            .sort()
            .map((g) => (
              <option key={g}>{g}</option>
            ))}
        </select>
      </FieldInput>
      <FieldInput label="Состояние">
        <select
          value={f.state}
          onChange={(e) => onChange({ ...f, state: e.target.value })}
        >
          <option value="">Все</option>
          <option value="active">Активные</option>
          <option value="paused">Приостановленные</option>
          <option value="closed">Закрытые</option>
        </select>
      </FieldInput>
      <FieldInput label="Добавлены с">
        <input
          type="date"
          value={f.from}
          onChange={(e) => onChange({ ...f, from: e.target.value })}
        />
      </FieldInput>
      <FieldInput label="Добавлены до">
        <input
          type="date"
          value={f.to}
          onChange={(e) => onChange({ ...f, to: e.target.value })}
        />
      </FieldInput>
    </div>
  );
}
function VacancyPicker({
  applications,
  selected,
  onChange,
  limit = 15,
  readyOnly = false,
}: {
  applications: Application[];
  selected: string[];
  onChange: (ids: string[]) => void;
  limit?: number;
  readyOnly?: boolean;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const visible = applications.filter((a) => matches(a, filters));
  return (
    <div>
      <FilterFields
        value={filters}
        onChange={setFilters}
        applications={applications}
      />
      <p>
        Выбрано {selected.length}/{limit}.{" "}
        {readyOnly
          ? "Доступны вакансии с актуальными выжимками."
          : "Сохраните исходные тексты перед обработкой."}
      </p>
      <div className="ai-picker">
        {visible.map((a) => {
          const unavailable = readyOnly ? !isAIReady(a) : !a.ai?.text.trim();
          return (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={
                  unavailable ||
                  (!selected.includes(a.id) && selected.length >= limit)
                }
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, a.id]
                      : selected.filter((id) => id !== a.id),
                  )
                }
              />
              <span>
                {a.company} · {a.position}
                <small>
                  {unavailable
                    ? readyOnly
                      ? "Нет актуальной выжимки"
                      : "Нет исходного текста"
                    : isAIReady(a)
                      ? "Обработана"
                      : "Не обработана"}
                </small>
              </span>
            </label>
          );
        })}
        {!visible.length && <p>Вакансий по фильтрам нет.</p>}
      </div>
    </div>
  );
}
export function AIWorkspace({
  applications,
  userId,
}: {
  applications: Application[];
  userId: string;
}) {
  const [tab, setTab] = useState("skills");
  const jobs = useAIJobs();
  const action = useAIAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState("");
  return (
    <>
      <h1>Навыки и ИИ</h1>
      <div className="ai-actions">
        <button
          onClick={() => setTab("skills")}
          aria-pressed={tab === "skills"}
        >
          Навыки и статистика
        </button>
        <button onClick={() => setTab("batch")} aria-pressed={tab === "batch"}>
          Обработать вакансии
        </button>
        <Link to="/resumes">Целевые профили</Link>
        <Link to="/settings#ai">Настройки ИИ</Link>
      </div>
      {tab === "skills" ? (
        <SkillsPanel applications={applications} userId={userId} />
      ) : (
        <section className="panel ai-panel">
          <h2>Обработка выбранных вакансий</h2>
          <VacancyPicker
            applications={applications}
            selected={selected}
            onChange={setSelected}
            limit={100}
          />
          <button
            disabled={action.busy || !selected.length}
            onClick={() =>
              void action.run(async () => {
                const results = await Promise.allSettled(
                  selected.map((id) => queue("extract", id)),
                );
                const errors = results.filter(
                  (r): r is PromiseRejectedResult => r.status === "rejected",
                );
                setReport(
                  `Поставлено в очередь: ${results.length - errors.length}; ошибок: ${errors.length}`,
                );
                if (errors.length) throw errors[0].reason;
                setSelected([]);
              })
            }
          >
            Обработать выбранные ({selected.length})
          </button>
          <p role="status">{report}</p>
          <ErrorBox error={action.error} />
          <h3>Последние задания</h3>
          {jobs.data
            ?.filter((j) => j.kind === "extract")
            .slice(0, 30)
            .map((j) => (
              <div key={j.id}>
                <Link to={`/applications/${j.targetId}`}>
                  {applications.find((a) => a.id === j.targetId)?.position ??
                    "Вакансия"}
                </Link>
                <JobResult job={j} />
              </div>
            ))}
        </section>
      )}
    </>
  );
}
function SkillsPanel({
  applications,
  userId,
}: {
  applications: Application[];
  userId: string;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Skill>();
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeLevel, setMergeLevel] = useState("");
  const action = useAIAction();
  const params = new URLSearchParams({
    group: filters.group,
    state: filters.state,
    from: filters.from,
    to: filters.to,
    category,
  });
  const stats = useQuery({
    queryKey: ["ai", "statistics", params.toString()],
    queryFn: () =>
      cachedAI<SkillStatistics>(`/ai/skills/statistics?${params}`, userId),
  });
  const all = useQuery({
    queryKey: ["ai", "skills"],
    queryFn: () => api<Skill[]>("/ai/skills"),
  });
  return (
    <section className="panel ai-panel">
      <h2>Востребованность и самооценка</h2>
      <p>
        Частота показывает спрос в вашем журнале вакансий. Неоценённый навык и
        уровень 0 учитываются отдельно.
      </p>
      <FilterFields
        value={filters}
        onChange={setFilters}
        applications={applications}
      />
      <FieldInput label="Категория навыков">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все категории</option>
          {Object.entries(categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </FieldInput>
      <p role="status">
        Обработано {stats.data?.processed ?? 0} из {stats.data?.total ?? 0}{" "}
        вакансий выбранной выборки.
      </p>
      <ErrorBox error={stats.error} />
      <button
        onClick={() =>
          setEditing({
            id: "",
            name: "",
            category: "hard",
            aliases: [],
            level: null,
            base: false,
          })
        }
      >
        Добавить личный навык
      </button>
      <div className="ai-skill-list">
        {stats.data?.skills
          .filter(
            (s) =>
              !filters.search ||
              s.name
                .toLocaleLowerCase()
                .includes(filters.search.toLocaleLowerCase()),
          )
          .map((s) => (
            <article key={s.id}>
              <div>
                <strong>#{s.name}</strong>
                <small>
                  {categories[s.category]} · {s.count} вакансий ·{" "}
                  {Math.round(s.share * 100)}%
                </small>
              </div>
              <div>
                <span>{s.level === null ? "Не оценён" : `${s.level}/10`}</span>
                {s.count > 0 && (s.level === null || s.level <= 4) && (
                  <small>
                    {s.level === null
                      ? "Оцените владение"
                      : "Возможный приоритет развития"}
                  </small>
                )}
              </div>
              <button onClick={() => setEditing(s)}>Изменить</button>
            </article>
          ))}
      </div>
      <details>
        <summary>Объединить дубли навыков</summary>
        <p>
          Связи и синонимы будут перенесены в итоговый навык. Выберите итоговую
          самооценку.
        </p>
        <div className="form-grid">
          <FieldInput label="Объединить навык">
            <select
              value={mergeSource}
              onChange={(e) => setMergeSource(e.target.value)}
            >
              <option value="">Выберите</option>
              {all.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FieldInput>
          <FieldInput label="В итоговый навык">
            <select
              value={mergeTarget}
              onChange={(e) => {
                setMergeTarget(e.target.value);
                setMergeLevel(
                  String(
                    all.data?.find((s) => s.id === e.target.value)?.level ?? "",
                  ),
                );
              }}
            >
              <option value="">Выберите</option>
              {all.data
                ?.filter((s) => s.id !== mergeSource)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </FieldInput>
          <LevelInput value={mergeLevel} onChange={setMergeLevel} />
        </div>
        <button
          disabled={
            action.busy ||
            !mergeSource ||
            !mergeTarget ||
            mergeSource === mergeTarget
          }
          onClick={() =>
            void action.run(async () => {
              await api("/ai/skills/merge", "POST", {
                source: mergeSource,
                target: mergeTarget,
                level: mergeLevel === "" ? null : Number(mergeLevel),
              });
              setMergeSource("");
              setMergeTarget("");
            })
          }
        >
          Объединить с выбранной оценкой
        </button>
      </details>
      <ErrorBox error={action.error} />
      {editing && (
        <Modal title="Навык и самооценка" onClose={() => setEditing(undefined)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await api("/ai/skills", "PUT", {
                  id: editing.id,
                  name: editing.name,
                  category: editing.category,
                  base: editing.base,
                  level: editing.level,
                  aliases: editing.aliases.map((a) => a.trim()).filter(Boolean),
                });
                setEditing(undefined);
              });
            }}
          >
            <FieldInput label="Название">
              <input
                required
                maxLength={100}
                disabled={editing.base}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </FieldInput>
            <FieldInput label="Категория">
              <select
                disabled={editing.base}
                value={editing.category}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    category: e.target.value as Skill["category"],
                  })
                }
              >
                {Object.entries(categories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </FieldInput>
            <FieldInput label="Синонимы (через запятую)">
              <input
                value={editing.aliases.join(",")}
                onChange={(e) =>
                  setEditing({ ...editing, aliases: e.target.value.split(",") })
                }
              />
            </FieldInput>
            <LevelInput
              value={editing.level === null ? "" : String(editing.level)}
              onChange={(v) =>
                setEditing({ ...editing, level: v === "" ? null : Number(v) })
              }
            />
            <ErrorBox error={action.error} />
            <button disabled={action.busy}>Сохранить навык</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
function LevelInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldInput label="Уровень владения">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Не оценён</option>
        {Array.from({ length: 11 }, (_, n) => (
          <option key={n} value={String(n)}>
            {n}/10
          </option>
        ))}
      </select>
    </FieldInput>
  );
}
export function AIProfiles({
  applications = [],
  userId = "",
}: {
  applications?: Application[];
  userId?: string;
}) {
  const profiles = useQuery({
    queryKey: ["ai", "profiles"],
    queryFn: () => cachedAI<Profile[]>("/ai/profiles", userId),
  });
  const context = useQuery({
    queryKey: ["ai", "context"],
    queryFn: () => cachedAI<{ text: string }>("/ai/context", userId),
  });
  const [text, setText] = useState("");
  const contextLoaded = useRef(false);
  const [title, setTitle] = useState("");
  const action = useAIAction();
  const jobs = useAIJobs();
  useEffect(() => {
    if (context.data && !contextLoaded.current) {
      setText(context.data.text);
      contextLoaded.current = true;
    }
  }, [context.data]);
  const latest = [...applications]
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
    .slice(0, 45);
  const ready = latest.filter(isAIReady);
  const suggestion = jobs.data?.find((j) => j.kind === "directions");
  let suggestions: { title: string; description: string }[] = [];
  try {
    if (suggestion?.status === "ready")
      suggestions = JSON.parse(suggestion.result).directions ?? [];
  } catch {
    /* server validates result */
  }
  const create = async (name: string) => {
    await api("/ai/profiles", "PUT", {
      id: "",
      title: name,
      applicationIds: [],
      content: "",
      version: 0,
      generatedAt: "",
      updatedAt: "",
    });
  };
  return (
    <section className="ai-panel">
      <h2>Целевые направления</h2>
      <p>
        Создайте от одного до трёх направлений. ИИ предлагает варианты, названия
        и выбор вакансий утверждаете вы.
      </p>
      <details>
        <summary>Мой опыт и карьерные цели</summary>
        <FieldInput label="Опыт и цели">
          <textarea
            rows={6}
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </FieldInput>
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(() => api("/ai/context", "PUT", { text }))
          }
        >
          Сохранить опыт и цели
        </button>
        <p className="muted">
          Разбор файлов резюме запланирован для будущей версии.
        </p>
      </details>
      <p>
        Для предложения направлений: {ready.length} обработанных из{" "}
        {latest.length} последних добавленных вакансий; пропущено{" "}
        {latest.length - ready.length}.
      </p>
      <button
        disabled={
          action.busy ||
          !ready.length ||
          (!!suggestion && ["queued", "running"].includes(suggestion.status))
        }
        onClick={() =>
          void action.run(async () => {
            await queue("directions");
          })
        }
      >
        Предложить три варианта через ИИ
      </button>
      {suggestion && <JobResult job={suggestion} />}
      <div className="ai-suggestions">
        {suggestions.map((s, i) => (
          <article className="panel" key={i}>
            <h3>{s.title}</h3>
            <p>{s.description}</p>
            <button onClick={() => setTitle(s.title)}>
              Выбрать и отредактировать название
            </button>
          </article>
        ))}
      </div>
      {(profiles.data?.length ?? 0) < 3 && (
        <form
          className="ai-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await create(title.trim());
              setTitle("");
            });
          }}
        >
          <input
            aria-label="Название нового направления"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Введите или измените название направления"
          />
          <button disabled={action.busy || !title.trim()}>
            Утвердить направление
          </button>
        </form>
      )}
      <ErrorBox error={action.error || profiles.error || context.error} />
      {profiles.data?.map((p) => (
        <ProfileEditor
          key={`${p.id}-${p.version}`}
          profile={p}
          applications={applications}
          jobs={jobs.data ?? []}
        />
      ))}
    </section>
  );
}
function ProfileEditor({
  profile: p,
  applications,
  jobs,
}: {
  profile: Profile;
  applications: Application[];
  jobs: AIJob[];
}) {
  const [draft, setDraft] = useState(p);
  const [deleting, setDeleting] = useState(false);
  const action = useAIAction();
  const job = jobs.find((j) => j.kind === "profile" && j.targetId === p.id);
  const active = job && ["queued", "running"].includes(job.status);
  const dirty = JSON.stringify(draft) !== JSON.stringify(p);
  return (
    <article className="panel ai-panel">
      <h3>{p.title}</h3>
      <FieldInput label="Название направления">
        <input
          maxLength={200}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </FieldInput>
      <VacancyPicker
        applications={applications}
        selected={draft.applicationIds}
        onChange={(ids) => setDraft({ ...draft, applicationIds: ids })}
        readyOnly
      />
      <FieldInput label="Профиль (можно редактировать)">
        <textarea
          rows={12}
          maxLength={15000}
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
      </FieldInput>
      <div className="ai-actions">
        <button
          disabled={action.busy || !dirty}
          onClick={() =>
            void action.run(() => api("/ai/profiles", "PUT", draft))
          }
        >
          Сохранить направление и правки
        </button>
        <button
          disabled={
            action.busy ||
            !!active ||
            dirty ||
            !p.applicationIds.length ||
            p.applicationIds.some(
              (id) =>
                !isAIReady(
                  applications.find((a) => a.id === id) ?? ({} as Application),
                ),
            )
          }
          onClick={() =>
            void action.run(async () => {
              await queue("profile", p.id);
            })
          }
        >
          Сгенерировать профиль через ИИ
        </button>
        <button onClick={() => setDeleting(true)}>Удалить направление</button>
      </div>
      {dirty && (
        <p className="muted">
          Сохраните выбор вакансий и правки перед генерацией.
        </p>
      )}
      {p.generatedAt && (
        <small>Сгенерирован {new Date(p.generatedAt).toLocaleString()}</small>
      )}
      <ErrorBox error={action.error} />
      {job && <JobResult job={job} />}{" "}
      {deleting && (
        <Modal title="Удалить направление?" onClose={() => setDeleting(false)}>
          <p>Будут удалены профиль «{p.title}» и его подборка.</p>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(() => api(`/ai/profiles/${p.id}`, "DELETE"))
            }
          >
            Удалить направление
          </button>
          <ErrorBox error={action.error} />
        </Modal>
      )}
    </article>
  );
}
