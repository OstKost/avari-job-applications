import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Moon,
  Sun,
  X,
  LoaderCircle,
  AlertCircle,
  Check,
  ArrowRight,
  CalendarDays,
} from "lucide-react";
import {
  type Application,
  type Field,
  type Task,
  type Proposal,
  type Transport,
  type Note,
  APIError,
  stages,
  states,
  outcomes,
  fieldLabels,
  displayValue,
  dateToday,
  dateLabel,
  sortTasks,
  companyColorIndex,
  companyInitials,
} from "./index";
const themeSnapshot = () =>
  localStorage.getItem("avari-theme") === "light" ? "light" : "dark";
const subscribeTheme = (listener: () => void) => {
  window.addEventListener("avari-theme-change", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("avari-theme-change", listener);
    window.removeEventListener("storage", listener);
  };
};
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return {
    theme,
    toggle: () => {
      const next = theme === "dark" ? "light" : "dark";
      localStorage.setItem("avari-theme", next);
      document.documentElement.dataset.theme = next;
      window.dispatchEvent(new Event("avari-theme-change"));
    },
  };
}
export function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="icon-button"
      onClick={toggle}
      title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      aria-label={
        theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"
      }
    >
      {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" size={28} />
      <p>Загружаем данные…</p>
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <CalendarDays size={28} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Badge({
  value,
  kind = "stage",
}: {
  value: string;
  kind?: string;
}) {
  return (
    <span className={"badge badge-" + value}>{displayValue(kind, value)}</span>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function FieldInput({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ id?: string; "aria-label"?: string }>,
            { id, "aria-label": label },
          )
        : children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Select({
  value,
  onChange,
  items,
  empty,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Record<string, string>;
  empty?: string;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {Object.entries(items).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
export function ConflictComparison({
  draft,
  current,
  onReload,
  label,
  fields = [],
  applications = [],
}: {
  draft: object;
  current: object;
  onReload: () => void;
  label: string;
  fields?: Field[];
  applications?: Application[];
}) {
  const mine = draft as Record<string, unknown>,
    actual = current as Record<string, unknown>;
  const keys = Object.keys(mine).filter(
    (k) =>
      !["id", "hhId", "version", "createdAt", "updatedAt"].includes(k) &&
      JSON.stringify(mine[k]) !== JSON.stringify(actual[k]),
  );
  return (
    <div className="conflict">
      <h3>Актуальное значение → ваша форма</h3>
      <div className="comparison">
        {keys.map((key) => (
          <div key={key} className="comparison-row">
            <span>{fieldLabels[key] ?? key}</span>
            <span>{displayValue(key, actual[key], fields, applications)}</span>
            <ArrowRight size={15} />
            <strong>
              {displayValue(key, mine[key], fields, applications)}
            </strong>
          </div>
        ))}
      </div>
      <button type="button" onClick={onReload}>
        {label}
      </button>
    </div>
  );
}
// Notify synchronously on edits so extension drafts survive immediate popup closure.
function useDraftState<T>(
  initial: T | (() => T),
  onDraftChange?: (value: T) => void,
) {
  const [value, update] = useState(initial);
  const latest = useRef(value);
  const set = (next: T | ((previous: T) => T)) => {
    const result =
      typeof next === "function"
        ? (next as (previous: T) => T)(latest.current)
        : next;
    latest.current = result;
    onDraftChange?.(result);
    update(result);
  };
  return [value, set] as const;
}
export function ApplicationForm({
  groupOptions = [],
  initial,
  fields,
  api,
  onSaved,
  onCancel,
  onDraftChange,
}: {
  initial: Application;
  groupOptions?: string[];
  fields: Field[];
  api: Transport;
  onSaved: (a: Application) => void;
  onCancel: () => void;
  onDraftChange?: (value: Application) => void;
}) {
  const [a, setA] = useDraftState<Application>(
    () => structuredClone(initial),
    onDraftChange,
  );
  const [error, setError] = useState<unknown>();
  const [newGroup, setNewGroup] = useState("");
  const [current, setCurrent] = useState<Application>();
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const set = <K extends keyof Application>(k: K, v: Application[K]) =>
    setA((p) => ({ ...p, [k]: v }));
  const salary = (k: string, v: unknown) =>
    setA((p) => ({ ...p, salary: { ...p.salary, [k]: v } }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body = { ...a, hhId: "" };
      onSaved(
        await api<Application>(
          a.id ? "/applications/" + a.id : "/applications",
          a.id ? "PUT" : "POST",
          body,
          requestKey.current,
        ),
      );
    } catch (e) {
      setError(e);
      if (e instanceof APIError && e.status === 409 && e.current)
        setCurrent(e.current as Application);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      <ErrorBox error={error} />
      {current && (
        <ConflictComparison
          draft={a}
          current={current}
          fields={fields}
          onReload={() => {
            setA(structuredClone(current));
            setCurrent(undefined);
            setError(undefined);
          }}
          label="Загрузить актуальную запись"
        />
      )}
      <FieldInput label="Группы вакансии">
        <div className="actions">
          {Array.from(new Set([...groupOptions, ...(a.groups ?? [])])).map(
            (group) => (
              <label className="checkbox-label" key={group}>
                <input
                  type="checkbox"
                  checked={(a.groups ?? []).includes(group)}
                  onChange={(e) =>
                    set(
                      "groups",
                      e.target.checked
                        ? [...(a.groups ?? []), group]
                        : (a.groups ?? []).filter((v) => v !== group),
                    )
                  }
                />
                {group}
              </label>
            ),
          )}
        </div>
        <div className="actions">
          <input
            aria-label="Название новой группы"
            placeholder="Например: Дизайн, Удалённая работа"
            maxLength={100}
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
          />
          <button
            type="button"
            disabled={!newGroup.trim() || (a.groups ?? []).length >= 30}
            onClick={() => {
              const group = newGroup.trim();
              if (
                !(a.groups ?? []).some(
                  (v) => v.toLocaleLowerCase() === group.toLocaleLowerCase(),
                )
              )
                set("groups", [...(a.groups ?? []), group]);
              setNewGroup("");
            }}
          >
            Добавить группу
          </button>
        </div>
        <small className="muted">
          Можно выбрать несколько групп. Названия вы задаёте сами.
        </small>
      </FieldInput>
      <div className="form-grid">
        <FieldInput label="Компания *">
          <input
            required
            maxLength={500}
            value={a.company}
            onChange={(e) => set("company", e.target.value)}
            autoFocus
          />
        </FieldInput>
        <FieldInput label="Позиция *">
          <input
            required
            maxLength={500}
            value={a.position}
            onChange={(e) => set("position", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Ссылка на вакансию">
          <input
            type="url"
            maxLength={2048}
            value={a.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="https://hh.ru/vacancy/…"
          />
        </FieldInput>
        <FieldInput label="Этап">
          <Select
            value={a.stage}
            onChange={(v) => {
              setA((p) => ({
                ...p,
                stage: v,
                appliedDate:
                  v !== "saved" && !p.appliedDate ? dateToday() : p.appliedDate,
              }));
            }}
            items={stages}
          />
        </FieldInput>
        <FieldInput label="Состояние">
          <Select
            value={a.state}
            onChange={(v) => set("state", v)}
            items={states}
          />
        </FieldInput>
        {a.state === "closed" && (
          <FieldInput label="Результат закрытия *">
            <Select
              value={a.outcome}
              onChange={(v) => set("outcome", v)}
              items={outcomes}
              empty="Выберите результат"
            />
          </FieldInput>
        )}
        <FieldInput label="Дата сохранения">
          <input
            type="date"
            required
            value={a.savedDate}
            onChange={(e) => set("savedDate", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Дата отклика">
          <input
            type="date"
            value={a.appliedDate}
            onChange={(e) => set("appliedDate", e.target.value)}
          />
        </FieldInput>
      </div>
      <h3>Условия и контакты</h3>
      <div className="form-grid">
        <FieldInput label="Зарплата от">
          <input
            type="number"
            min={0}
            step="any"
            value={a.salary.min ?? ""}
            onChange={(e) =>
              salary(
                "min",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </FieldInput>
        <FieldInput label="Зарплата до">
          <input
            type="number"
            min={0}
            step="any"
            value={a.salary.max ?? ""}
            onChange={(e) =>
              salary(
                "max",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </FieldInput>
        <FieldInput label="Валюта">
          <input
            maxLength={12}
            value={a.salary.currency}
            onChange={(e) => salary("currency", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Период">
          <Select
            value={a.salary.period}
            onChange={(v) => salary("period", v)}
            items={{
              month: "В месяц",
              year: "В год",
              hour: "В час",
              project: "За проект",
            }}
            empty="Не указан"
          />
        </FieldInput>
        <FieldInput label="Налоги">
          <Select
            value={a.salary.tax}
            onChange={(v) => salary("tax", v)}
            items={{ gross: "До вычета налогов", net: "На руки" }}
            empty="Не указано"
          />
        </FieldInput>
        <FieldInput label="Локация">
          <input
            maxLength={500}
            value={a.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Формат работы">
          <input
            maxLength={500}
            value={a.workFormat}
            onChange={(e) => set("workFormat", e.target.value)}
            placeholder="Удалённо, офис, гибрид"
          />
        </FieldInput>
        <FieldInput label="Контакт рекрутера">
          <input
            maxLength={2000}
            value={a.recruiter}
            onChange={(e) => set("recruiter", e.target.value)}
          />
        </FieldInput>
      </div>
      {fields.length > 0 && (
        <>
          <h3>Мои критерии</h3>
          <div className="form-grid">
            {fields.map((f) => (
              <FieldInput key={f.id} label={f.name}>
                {f.type === "flag" ? (
                  <div className="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label={f.name}
                      checked={!!a.custom[f.id]}
                      onChange={(e) =>
                        set("custom", { ...a.custom, [f.id]: e.target.checked })
                      }
                    />
                    Да
                  </div>
                ) : f.type === "select" ? (
                  <Select
                    value={String(a.custom[f.id] ?? "")}
                    onChange={(v) => set("custom", { ...a.custom, [f.id]: v })}
                    items={Object.fromEntries(f.options.map((v) => [v, v]))}
                    empty="Не выбрано"
                  />
                ) : (
                  <input
                    type={f.type === "text" ? "text" : f.type}
                    maxLength={f.type === "text" ? 5000 : undefined}
                    step={f.type === "number" ? "any" : undefined}
                    value={String(a.custom[f.id] ?? "")}
                    onChange={(e) =>
                      set("custom", {
                        ...a.custom,
                        [f.id]:
                          f.type === "number" && e.target.value !== ""
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </FieldInput>
            ))}
          </div>
        </>
      )}
      <footer className="form-actions">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary" disabled={busy || !!current}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </footer>
    </form>
  );
}
export function TaskForm({
  initial,
  applications,
  api,
  onSaved,
  onCancel,
  onDraftChange,
}: {
  initial: Partial<Task>;
  applications: Application[];
  api: Transport;
  onSaved: () => void;
  onCancel: () => void;
  onDraftChange?: (value: Partial<Task>) => void;
}) {
  const [task, setTask] = useDraftState<Partial<Task>>(
    {
      title: "",
      date: dateToday(),
      time: "",
      kind: "task",
      state: "open",
      applicationId: "",
      ...initial,
    },
    onDraftChange,
  );
  const [error, setError] = useState<unknown>();
  const [current, setCurrent] = useState<Task>();
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const set = (k: string, v: string) => setTask((p) => ({ ...p, [k]: v }));
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(
            task.id ? "/tasks/" + task.id : "/tasks",
            task.id ? "PUT" : "POST",
            task,
            key.current,
          );
          onSaved();
        } catch (e) {
          setError(e);
          if (e instanceof APIError && e.status === 409 && e.current)
            setCurrent(e.current as Task);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBox error={error} />
      {current && (
        <ConflictComparison
          draft={task}
          current={current}
          applications={applications}
          label="Загрузить актуальную задачу"
          onReload={() => {
            setTask(current);
            setCurrent(undefined);
            setError(undefined);
          }}
        />
      )}
      <FieldInput label="Название *">
        <input
          required
          maxLength={500}
          autoFocus
          value={task.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Написать рекрутеру, подготовиться к интервью…"
        />
      </FieldInput>
      <div className="form-grid">
        <FieldInput label="Тип">
          <Select
            value={task.kind!}
            onChange={(v) => set("kind", v)}
            items={{ task: "Задача", interview: "Интервью" }}
          />
        </FieldInput>
        <FieldInput label="Вакансия">
          <Select
            value={task.applicationId!}
            onChange={(v) => set("applicationId", v)}
            items={Object.fromEntries(
              applications.map((a) => [a.id, a.company + " · " + a.position]),
            )}
            empty="Без привязки"
          />
        </FieldInput>
        <FieldInput label="Дата *">
          <input
            type="date"
            required
            value={task.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Время">
          <input
            type="time"
            value={task.time}
            onChange={(e) => set("time", e.target.value)}
          />
        </FieldInput>
        {task.id && (
          <FieldInput label="Состояние">
            <Select
              value={task.state!}
              onChange={(v) => set("state", v)}
              items={{ open: "Открыта", done: "Выполнена" }}
            />
          </FieldInput>
        )}
      </div>
      <footer className="form-actions">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary" disabled={busy || !!current}>
          {busy ? "Сохраняем…" : "Сохранить задачу"}
        </button>
      </footer>
    </form>
  );
}
export function NoteForm({
  applicationId,
  initial,
  api,
  onSaved,
  onCancel,
  draftText,
  onDraftChange,
}: {
  applicationId: string;
  initial?: Note;
  api: Transport;
  onSaved: (n: Note) => void;
  onCancel: () => void;
  draftText?: string;
  onDraftChange?: (text: string) => void;
}) {
  const [base, setBase] = useState(initial);
  const [text, setText] = useDraftState(
    draftText ?? initial?.text ?? "",
    onDraftChange,
  );
  const [current, setCurrent] = useState<Note>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onSaved(
            await api<Note>(
              base ? "/notes/" + base.id : "/notes",
              base ? "PUT" : "POST",
              base ? { ...base, text } : { applicationId, text },
              key.current,
            ),
          );
        } catch (e) {
          setError(e);
          if (e instanceof APIError && e.status === 409 && e.current)
            setCurrent(e.current as Note);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBox error={error} />
      {current && (
        <ConflictComparison
          draft={{ text }}
          current={current}
          label="Загрузить актуальный текст"
          onReload={() => {
            setBase(current);
            setText(current.text);
            setCurrent(undefined);
            setError(undefined);
          }}
        />
      )}
      <FieldInput label="Заметка">
        <textarea
          required
          rows={7}
          maxLength={20000}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что стоит помнить об этой вакансии?"
        />
      </FieldInput>
      <footer className="form-actions">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary" disabled={busy || !!current}>
          {base ? "Сохранить заметку" : "Добавить заметку"}
        </button>
      </footer>
    </form>
  );
}
export function TaskCard({
  task,
  application,
  onToggle,
  onEdit,
}: {
  task: Task;
  application?: Application;
  onToggle: () => void | Promise<void>;
  onEdit?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <article
      className={"task-card " + (task.state === "done" ? "task-done" : "")}
    >
      <button
        className="task-check"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onToggle();
          } finally {
            setBusy(false);
          }
        }}
        aria-label={
          task.state === "open"
            ? "Отметить выполнение: " + task.title
            : "Вернуть задачу: " + task.title
        }
      >
        {task.state === "done" && <Check size={15} />}
      </button>
      <div className="task-content">
        <div className="task-meta">
          {task.time || "Без времени"}
          {task.kind === "interview" && (
            <span className="badge badge-interview">Интервью</span>
          )}
        </div>
        <button className="task-title" onClick={onEdit} disabled={!onEdit}>
          {task.title}
        </button>
        {application && (
          <p>
            {application.company}
            <span>{application.position}</span>
          </p>
        )}
      </div>
    </article>
  );
}
export function ProposalCard({
  proposal,
  application,
  api,
  onResolved,
}: {
  proposal: Proposal;
  application?: Application;
  api: Transport;
  onResolved: () => void;
}) {
  const [p, setP] = useState(proposal);
  const [edit, setEdit] = useState(false);
  const [patch, setPatch] = useState({ ...proposal.changes });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (edit) return;
    setP(proposal);
    setPatch({ ...proposal.changes });
  }, [
    proposal.id,
    proposal.current.version,
    proposal.status,
    proposal.detectedStatus,
  ]);
  const change = (key: string, value: string) =>
    setPatch((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "state" && value !== "closed" ? { outcome: "" } : {}),
    }));
  const resolve = async (action: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/proposals/" + p.id, "POST", {
        action,
        version: p.current.version,
        ...(edit ? { changes: patch } : {}),
      });
      onResolved();
    } catch (e) {
      setError(e);
      if (e instanceof APIError && e.current) {
        const v = e.current as Proposal;
        setP(v);
        if (!edit) setPatch({ ...v.changes });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="proposal-card">
      <div className="eyebrow">
        Обнаружено расширением ·{" "}
        {dateLabel(p.createdAt, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <h3>{application?.company ?? p.current.company}</h3>
      <p className="muted">{application?.position ?? p.current.position}</p>
      {p.kind === "create" && (
        <p className="muted">
          Отклик за последний месяц отсутствует в журнале. Добавить вакансию?
        </p>
      )}
      {p.kind === "create" && (
        <a href={p.current.url} target="_blank" rel="noopener noreferrer">
          Открыть вакансию на hh.ru
        </a>
      )}
      <ErrorBox error={error} />
      <div className="comparison">
        {Object.entries(edit ? patch : p.changes).map(([key, value]) => (
          <div className="comparison-row" key={key}>
            <span>{fieldLabels[key] ?? key}</span>
            <span>
              {p.kind === "create"
                ? "—"
                : displayValue(key, p.current[key as keyof Application])}
            </span>
            <ArrowRight size={15} />
            <strong>
              {edit && ["stage", "state", "outcome"].includes(key) ? (
                <Select
                  value={String(value)}
                  onChange={(v) => change(key, v)}
                  items={
                    key === "stage"
                      ? stages
                      : key === "state"
                        ? states
                        : outcomes
                  }
                  empty={key === "outcome" ? "Не выбран" : undefined}
                />
              ) : edit && key === "appliedDate" ? (
                <input
                  type="date"
                  value={String(value)}
                  onChange={(e) => change(key, e.target.value)}
                />
              ) : (
                displayValue(key, value)
              )}
            </strong>
          </div>
        ))}
      </div>
      {edit && (
        <div className="form-grid">
          <FieldInput label="Этап">
            <Select
              value={String(patch.stage ?? p.current.stage)}
              onChange={(v) => change("stage", v)}
              items={stages}
            />
          </FieldInput>
          <FieldInput label="Состояние">
            <Select
              value={String(patch.state ?? p.current.state)}
              onChange={(v) => change("state", v)}
              items={states}
            />
          </FieldInput>
          {String(patch.state ?? p.current.state) === "closed" && (
            <FieldInput label="Результат закрытия">
              <Select
                value={String(patch.outcome ?? p.current.outcome)}
                onChange={(v) => change("outcome", v)}
                items={outcomes}
                empty="Выберите результат"
              />
            </FieldInput>
          )}
          <FieldInput label="Дата отклика">
            <input
              type="date"
              value={String(patch.appliedDate ?? p.current.appliedDate)}
              onChange={(e) => change("appliedDate", e.target.value)}
            />
          </FieldInput>
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => resolve("apply")}
        >
          {p.kind === "create" ? "Добавить в журнал" : "Применить"}
        </button>
        <button disabled={busy} onClick={() => setEdit((v) => !v)}>
          {edit ? "Сравнение" : "Изменить"}
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => resolve("dismiss")}
        >
          Отклонить
        </button>
      </div>
    </article>
  );
}
export function TaskList({
  tasks,
  applications,
  api,
  onChanged,
  onEdit,
}: {
  tasks: Task[];
  applications: Application[];
  api: Transport;
  onChanged: () => void;
  onEdit: (t: Task) => void;
}) {
  const [error, setError] = useState<unknown>();
  return (
    <>
      <ErrorBox error={error} />
      {sortTasks(tasks).map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          application={applications.find((a) => a.id === t.applicationId)}
          onEdit={() => onEdit(t)}
          onToggle={async () => {
            try {
              await api("/tasks/" + t.id, "PUT", {
                ...t,
                state: t.state === "open" ? "done" : "open",
              });
              onChanged();
            } catch (e) {
              setError(e);
            }
          }}
        />
      ))}
    </>
  );
}

export function CompanyAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const colorIndex = companyColorIndex(name);
  const initials = companyInitials(name);
  const classes = ["company-avatar", className].filter(Boolean).join(" ");
  return (
    <span className={classes} data-color={colorIndex} aria-hidden="true">
      {initials}
    </span>
  );
}
