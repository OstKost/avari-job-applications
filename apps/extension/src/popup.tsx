import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  ExternalLink,
  Plus,
  LogOut,
  RefreshCw,
  Settings,
  X,
  CheckCheck,
  Bookmark,
  BriefcaseBusiness,
  CalendarDays,
  Bell,
  ArrowUpRight,
  ShieldCheck,
  ArrowRight,
  Pencil,
  GripVertical,
  Clock,
  ArrowLeft,
} from "lucide-react";
import {
  APIError,
  type Transport,
  type User,
  type Application,
  type Task,
  type Field,
  type Proposal,
  type Detail,
  emptyApplication,
  dateToday,
  stages,
  jobIdentity,
  jobSite,
  jobSitesLabel,
} from "@avari/shared";
import {
  ThemeButton,
  Loading,
  ErrorBox,
  Empty,
  ApplicationForm,
  TaskForm,
  NoteForm,
  ProposalCard,
  TaskList,
  Badge,
  FieldInput,
  Select,
  handleFormSubmitShortcut,
  SubmitShortcutHint,
} from "@avari/shared/ui";
import type { Snapshot } from "./parser";
import "@avari/shared/styles.css";
import "./popup.css";
async function message<T>(body: unknown): Promise<T> {
  const reply = await chrome.runtime.sendMessage(body);
  if (!reply.ok)
    throw new APIError(reply.status ?? 500, reply.error, reply.current);
  return reply.data;
}
const api: Transport = (path, method = "GET", body, key) =>
  message({ type: "API", path, method, body, key });
type Data = {
  applications: Application[];
  fields: Field[];
  proposals: Proposal[];
  tasks: Task[];
};
type FormDraft = {
  kind: "application" | "task" | "note";
  value: Application | Partial<Task> | string;
  text?: string;
};
const embedded = new URLSearchParams(location.search).has("embedded");
function Popup() {
  const [collapsed, setCollapsed] = useState(
    embedded && new URLSearchParams(location.search).get("collapsed") === "1",
  );
  const [section, setSection] = useState<
    "page" | "applications" | "tasks" | "changes"
  >("page");
  const [server, setServer] = useState("");
  const [setup, setSetup] = useState(false);
  const [user, setUser] = useState<User>();
  const [data, setData] = useState<Data>({
    applications: [],
    fields: [],
    proposals: [],
    tasks: [],
  });
  const [snapshot, setSnapshot] = useState<Snapshot>({
    supported: false,
    kind: "unsupported",
    observations: [],
  });
  const [detail, setDetail] = useState<Detail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [form, updateForm] = useState<FormDraft>();
  const draftKey = useRef("");
  const [captureGroup, setCaptureGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastScanned, setLastScanned] = useState<Date>();
  const notifiedVacancyUrl = useRef<string>("");
  const sendToast = (
    msg: string,
    kind: "success" | "warning" | "error" | "info" = "success",
    subtitle?: string,
  ) => {
    if (!embedded) return;
    window.parent.postMessage(
      { type: "AVARI_TOAST", message: msg, kind, subtitle },
      "*",
    );
  };
  const notify = (
    msg: string,
    subtitle = "Все изменения сохранены",
    kind: "success" | "warning" | "error" | "info" = "success",
  ) => {
    if (!embedded) setNotice(msg);
    sendToast(msg, kind, subtitle);
  };
  const notifyError = (err: unknown) => {
    setError(err);
    if (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendToast(msg, "error", "Ошибка операции");
    }
  };
  const setForm = (value: FormDraft | undefined) => {
    try {
      if (draftKey.current) {
        if (value)
          localStorage.setItem(draftKey.current, JSON.stringify(value));
        else localStorage.removeItem(draftKey.current);
      }
    } catch {
      notifyError(new Error("Не удалось сохранить черновик на устройстве"));
    }
    updateForm(value);
  };
  useEffect(() => {
    if (!embedded) return;
    const observer = new ResizeObserver(() => {
      window.parent.postMessage(
        {
          type: "AVARI_RESIZE",
          height: document.querySelector("main")?.scrollHeight,
        },
        "*",
      );
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!embedded) return;
    const sendTheme = () =>
      window.parent.postMessage(
        {
          type: "AVARI_THEME",
          theme:
            document.documentElement.dataset.theme === "light"
              ? "light"
              : "dark",
        },
        "*",
      );
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    sendTheme();
    return () => observer.disconnect();
  }, []);
  const reload = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const c = await message<{
        server?: string;
        token?: string;
        notifications?: boolean;
      }>({ type: "CONFIG" });
      setServer(c.server ?? "");
      setSetup(!c.server);
      setNotifications(c.notifications ?? false);
      if (!c.server) {
        setUser(undefined);
        return;
      }
      if (!c.token) {
        setUser(undefined);
        return;
      }
      const u = await api<User>("/me");
      setUser(u);
      if (u.status !== "active") return;
      const page = await message<Snapshot>({ type: "READ_ACTIVE" });
      setSnapshot(page);
      const key =
        "avari-draft:" +
        JSON.stringify([c.server, u.id, page.vacancy?.url ?? "manual"]);
      if (draftKey.current !== key) {
        draftKey.current = key;
        try {
          const stored = localStorage.getItem(key);
          const draft = stored ? (JSON.parse(stored) as FormDraft) : undefined;
          updateForm(
            draft && ["application", "task", "note"].includes(draft.kind)
              ? draft
              : undefined,
          );
        } catch {
          updateForm(undefined);
        }
      }
      const [applications, fields, proposals, tasks] = await Promise.all([
        api<Application[]>("/applications"),
        api<Field[]>("/fields"),
        api<Proposal[]>("/proposals"),
        api<Task[]>("/tasks"),
      ]);
      setData({ applications, fields, proposals, tasks });
      const existing = page.vacancy
        ? applications.find((a) => {
            const url = jobIdentity(page.vacancy!.url)?.url;
            return !!url && jobIdentity(a.url)?.url === url;
          })
        : undefined;
      setDetail(
        existing
          ? await api<Detail>("/applications/" + existing.id)
          : undefined,
      );
      setLastScanned(new Date());

      // Notify if an existing saved vacancy was detected on the current page
      if (page.vacancy?.url && existing) {
        const canonicalUrl =
          jobIdentity(page.vacancy.url)?.url || page.vacancy.url;
        if (notifiedVacancyUrl.current !== canonicalUrl) {
          notifiedVacancyUrl.current = canonicalUrl;
          const stageName = stages[existing.stage] || existing.stage;
          sendToast(
            "Вакансия уже в журнале",
            "info",
            `Компания: ${existing.company} · Этап: ${stageName}`,
          );
        }
      } else if (!page.vacancy) {
        notifiedVacancyUrl.current = "";
      }
    } catch (e) {
      setError(e);
      if (e instanceof APIError && e.status === 401) setUser(undefined);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (!embedded) return;
    const changed = (event: MessageEvent) => {
      if (
        event.source === window.parent &&
        jobSite(event.origin) &&
        event.data?.type === "AVARI_PAGE_UPDATED" &&
        !form
      )
        void reload();
    };
    window.addEventListener("message", changed);
    return () => window.removeEventListener("message", changed);
  }, [form]);
  useEffect(() => {
    if (!embedded) return;
    const toggle = (event: MessageEvent) => {
      if (event.source !== window.parent || !jobSite(event.origin)) return;
      if (event.data?.type === "AVARI_COLLAPSE") setCollapsed(true);
      if (event.data?.type === "AVARI_EXPAND") setCollapsed(false);
    };
    window.addEventListener("message", toggle);
    return () => window.removeEventListener("message", toggle);
  }, []);
  useEffect(() => {
    if (!embedded) return;
    window.parent.postMessage({ type: "AVARI_COLLAPSED", collapsed }, "*");
    window.parent.postMessage(
      {
        type: "AVARI_RESIZE",
        height: document.querySelector("main")?.scrollHeight,
      },
      "*",
    );
  }, [collapsed]);
  const saved = (msg?: unknown) => {
    setForm(undefined);
    notify(typeof msg === "string" ? msg : "Сохранено в журнале");
    void reload();
  };
  const quickSave = async (stage = "saved") => {
    if (!snapshot.vacancy || !user || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(
        "/applications",
        "POST",
        {
          ...snapshot.vacancy,
          hhId: "",
          groups: captureGroup.trim() ? [captureGroup.trim()] : [],
          stage,
          savedDate: dateToday(user.timezone),
          appliedDate: stage === "saved" ? "" : dateToday(user.timezone),
        },
        crypto.randomUUID(),
      );
      saved(stage === "applied" ? "Отклик сохранён" : "Вакансия сохранена");
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const changeStage = async (stage: string) => {
    if (!detail || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api("/applications/" + detail.application.id, "PUT", {
        ...detail.application,
        stage,
        appliedDate:
          stage !== "saved" && !detail.application.appliedDate
            ? dateToday(user?.timezone)
            : detail.application.appliedDate,
      });
      saved("Этап успешно обновлён");
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const pending = data.proposals.filter((p) => p.status === "pending");
  const logout = async () => {
    try {
      await api("/auth/logout", "POST", {});
      updateForm(undefined);
      draftKey.current = "";
      setUser(undefined);
      setData({ applications: [], fields: [], proposals: [], tasks: [] });
    } catch (e) {
      notifyError(e);
    }
  };
  if (embedded && collapsed) {
    const relevantProposal = detail
      ? data.proposals.find(
          (p) =>
            p.applicationId === detail.application.id && p.status === "pending",
        )
      : undefined;

    let indicatorColor: "green" | "yellow" | "red" = "green";
    let indicatorTitle = "Всё актуально. Изменений нет";

    const timeStr = lastScanned
      ? lastScanned.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "";

    if (snapshot.kind === "responses") {
      const hasRedProposal = pending.some(
        (p) =>
          p.changes.state === "closed" ||
          p.changes.outcome === "employer_rejected" ||
          p.detectedStatus === "rejected" ||
          p.detectedStatus === "vacancy_closed",
      );
      if (hasRedProposal) {
        indicatorColor = "red";
        indicatorTitle = `Обработано в ${timeStr}. Требует внимания: есть отказ или закрытая вакансия!`;
      } else if (pending.length > 0) {
        indicatorColor = "yellow";
        indicatorTitle = `Обработано в ${timeStr}. Новых предложений: ${pending.length}`;
      } else {
        indicatorColor = "green";
        indicatorTitle = timeStr
          ? `Отклики обработаны в ${timeStr}. Изменений нет`
          : "Отклики обработаны. Изменений нет";
      }
    } else if (relevantProposal) {
      const isRed =
        relevantProposal.changes.state === "closed" ||
        relevantProposal.changes.outcome === "employer_rejected" ||
        relevantProposal.detectedStatus === "rejected" ||
        relevantProposal.detectedStatus === "vacancy_closed";
      if (isRed) {
        indicatorColor = "red";
        indicatorTitle = "Требует внимания: отказ или закрытие вакансии";
      } else {
        indicatorColor = "yellow";
        indicatorTitle = "Есть изменения: стоит посмотреть";
      }
    } else if (snapshot.vacancy && !detail) {
      indicatorColor = "yellow";
      indicatorTitle = "Новая вакансия — можно сохранить в журнал";
    } else if (lastScanned) {
      indicatorTitle = `Проверено в ${timeStr}. Всё актуально`;
    }

    const onDragPointerDown = (
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      const target = event.currentTarget;
      let lastX = event.screenX;
      let lastY = event.screenY;
      target.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.screenX - lastX;
        const dy = moveEvent.screenY - lastY;
        lastX = moveEvent.screenX;
        lastY = moveEvent.screenY;
        if (dx !== 0 || dy !== 0) {
          window.parent.postMessage({ type: "AVARI_MOVE", dx, dy }, "*");
        }
      };

      const onPointerUp = () => {
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
      };

      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerup", onPointerUp);
      target.addEventListener("pointercancel", onPointerUp);
    };

    return (
      <main className="popup popup-embedded popup-collapsed">
        <div className="compact-actions">
          <button
            type="button"
            className="drag-btn icon-button"
            aria-label="Переместить мини-окно"
            title="Переместить"
            onPointerDown={onDragPointerDown}
          >
            <GripVertical size={16} />
          </button>
          <button
            className="primary save-btn"
            disabled={
              busy ||
              loading ||
              !!detail ||
              !user ||
              user.status !== "active" ||
              setup ||
              !snapshot.vacancy?.company ||
              !snapshot.vacancy?.position
            }
            onClick={() => void quickSave()}
          >
            <Bookmark size={16} />
            {busy ? "Сохраняем…" : detail ? "Сохранено" : "Сохранить"}
          </button>
          <button
            type="button"
            className={`indicator-btn indicator-${indicatorColor}`}
            title={indicatorTitle}
            aria-label={indicatorTitle}
            onClick={() => setCollapsed(false)}
          >
            <span className="indicator-dot" />
          </button>
          <button
            type="button"
            className="expand-btn icon-button"
            aria-label="Раскрыть окно"
            title="Раскрыть"
            onClick={() => setCollapsed(false)}
          >
            <ArrowUpRight size={16} />
          </button>
        </div>
        <ErrorBox error={error} />
      </main>
    );
  }
  return (
    <main className={embedded ? "popup popup-embedded" : "popup"}>
      <header className="popup-header">
        <div className="brand">
          <img
            className="brand-mark brand-logo"
            src="./brand/avari-jobs-logo.png"
            alt=""
          />
          <span>
            Avari.Jobs<small>Журнал карьеры</small>
          </span>
        </div>
        <div className="actions">
          {!embedded && snapshot.supported && (
            <button
              className="icon-button"
              aria-label="Открыть мини-окно на странице"
              title="Открыть мини-окно на странице"
              onClick={async () => {
                try {
                  await message({ type: "OPEN_PANEL" });
                  window.close();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              <ExternalLink size={16} />
            </button>
          )}
          <ThemeButton />
          {embedded && (
            <button
              className="icon-button"
              aria-label="Закрыть панель"
              onClick={() =>
                window.parent.postMessage({ type: "AVARI_CLOSE" }, "*")
              }
            >
              <X size={17} />
            </button>
          )}
          {server && user && (
            <button
              className="icon-button"
              aria-label="Адрес сервиса"
              onClick={() => setSetup((v) => !v)}
            >
              <Settings size={17} />
            </button>
          )}
          {user && (
            <button className="icon-button" aria-label="Выйти" onClick={logout}>
              <LogOut size={17} />
            </button>
          )}
        </div>
      </header>
      {user?.status === "active" && (
        <nav className="popup-nav" aria-label="Разделы плагина">
          {(
            [
              ["page", "Страница", BriefcaseBusiness],
              ["applications", "Вакансии", Bookmark],
              ["tasks", "Задачи", CalendarDays],
              ["changes", "Изменения", RefreshCw],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-current={!setup && section === value ? "page" : undefined}
              disabled={!!form}
              onClick={() => {
                setSection(value);
                setSetup(false);
              }}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {form && !setup && user?.status === "active" && (
        <button
          className="text-button popup-back"
          onClick={() => setForm(undefined)}
        >
          <ArrowLeft size={16} /> Назад
        </button>
      )}
      <ErrorBox error={error} retry={() => reload()} />
      {!embedded && notice && (
        <div className="success notice" role="status">
          <CheckCheck size={20} />
          <span>
            <strong>{notice}</strong>
            <small>Все изменения сохранены</small>
          </span>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div
        className="popup-screen"
        key={
          setup
            ? "setup"
            : loading
              ? "loading"
              : !user
                ? "login"
                : user.status !== "active"
                  ? user.status
                  : form
                    ? form.kind
                    : section
        }
      >
        {setup ? (
          <ServerSetup
            initial={server}
            onCancel={server ? () => setSetup(false) : undefined}
            onSaved={() => {
              setSetup(false);
              sendToast(
                "Адрес сервера сохранён",
                "success",
                "Подключение установлено",
              );
              void reload();
            }}
          />
        ) : loading ? (
          <Loading />
        ) : !user ? (
          <Login
            server={server}
            onLogin={() => {
              sendToast(
                "Вход выполнен успешно",
                "success",
                "Сессия активирована",
              );
              void reload();
            }}
          />
        ) : user.status !== "active" ? (
          <>
            <h1>
              {user.status === "pending"
                ? "Ожидание одобрения"
                : "Аккаунт заблокирован"}
            </h1>
            <p className="muted">
              {user.status === "pending"
                ? "Администратор проверит вашу заявку."
                : "Обратитесь к администратору для восстановления доступа."}
            </p>
            <button onClick={() => reload()}>
              <RefreshCw size={16} />
              Проверить статус
            </button>
          </>
        ) : !form && section === "applications" ? (
          <>
            <div className="section-heading">
              <h2>Вакансии · {data.applications.length}</h2>
              <button
                onClick={() =>
                  setForm({
                    kind: "application",
                    value: {
                      ...emptyApplication(),
                      savedDate: dateToday(user.timezone),
                    },
                  })
                }
              >
                <Plus size={16} /> Добавить
              </button>
            </div>
            {data.applications.length ? (
              data.applications.map((application) => (
                <article
                  className="vacancy-card journal-item"
                  key={application.id}
                >
                  <h3>{application.company}</h3>
                  <p>{application.position}</p>
                  <div className="detail-badges">
                    <Badge value={application.stage} />
                    <Badge value={application.state} kind="state" />
                  </div>
                  <div className="actions">
                    <button
                      onClick={() =>
                        setForm({ kind: "application", value: application })
                      }
                    >
                      <Pencil size={15} /> Редактировать
                    </button>
                    <a
                      href={server + "/applications/" + application.id}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Подробнее <ArrowUpRight size={15} />
                    </a>
                  </div>
                </article>
              ))
            ) : (
              <Empty title="Вакансий пока нет">
                Сохраните вакансию со страницы или добавьте вручную.
              </Empty>
            )}
          </>
        ) : !form && section === "tasks" ? (
          <>
            <div className="section-heading">
              <h2>Задачи</h2>
              <button
                onClick={() =>
                  setForm({
                    kind: "task",
                    value: { date: dateToday(user.timezone) },
                  })
                }
              >
                <Plus size={16} /> Добавить
              </button>
            </div>
            {data.tasks.some((task) => task.state === "open") ? (
              <TaskList
                tasks={data.tasks.filter((task) => task.state === "open")}
                applications={data.applications}
                api={api}
                onChanged={(updated) => {
                  if (updated) {
                    if (updated.state === "done") {
                      sendToast("Задача выполнена", "success", updated.title);
                    } else {
                      sendToast(
                        "Задача возвращена в работу",
                        "info",
                        updated.title,
                      );
                    }
                  }
                  void reload();
                }}
                onEdit={(task) => setForm({ kind: "task", value: task })}
              />
            ) : (
              <Empty title="Открытых задач нет">
                Здесь будут ваши следующие действия и интервью.
              </Empty>
            )}
          </>
        ) : !form && section === "changes" ? (
          <>
            <h2>Изменения · {pending.length}</h2>
            {pending.length ? (
              pending.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  application={data.applications.find(
                    (application) => application.id === proposal.applicationId,
                  )}
                  api={api}
                  onResolved={(action) => {
                    if (action === "dismiss") {
                      sendToast(
                        "Предложение отклонено",
                        "info",
                        "Изменения не применены",
                      );
                    } else {
                      sendToast(
                        "Изменения применены",
                        "success",
                        "Данные вакансии обновлены",
                      );
                    }
                    void reload();
                  }}
                />
              ))
            ) : (
              <Empty title="Новых изменений нет">
                Все предложения обработаны.
              </Empty>
            )}
            <button
              onClick={() => {
                sendToast(
                  "Данные актуальны",
                  "info",
                  "Проверено последнее состояние",
                );
                void reload();
              }}
            >
              <RefreshCw size={16} /> Обновить
            </button>
          </>
        ) : embedded && !form ? (
          <section className="vacancy-card mini-save">
            {detail ? (
              <>
                <div className="eyebrow">Уже сохранена</div>
                <h2>{detail.application.company}</h2>
                <p>{detail.application.position}</p>
                <div className="detail-badges">
                  <Badge value={detail.application.stage} />
                  <Badge value={detail.application.state} kind="state" />
                </div>
                <FieldInput label="Этап">
                  <Select
                    value={detail.application.stage}
                    disabled={busy}
                    onChange={(value) => void changeStage(value)}
                    items={stages}
                  />
                </FieldInput>
              </>
            ) : snapshot.vacancy ? (
              <>
                <h2>{snapshot.vacancy.company}</h2>
                <p>{snapshot.vacancy.position}</p>
                <FieldInput label="Группа (необязательно)">
                  <input
                    list="capture-groups"
                    maxLength={100}
                    value={captureGroup}
                    onChange={(e) => setCaptureGroup(e.target.value)}
                    placeholder="Выберите или создайте"
                  />
                </FieldInput>
                <datalist id="capture-groups">
                  {Array.from(
                    new Set(data.applications.flatMap((a) => a.groups ?? [])),
                  ).map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !snapshot.vacancy.company ||
                    !snapshot.vacancy.position
                  }
                  onClick={() => void quickSave()}
                >
                  {busy ? "Сохраняем…" : "Сохранить вакансию"}
                </button>
                <button
                  disabled={
                    busy ||
                    !snapshot.vacancy.company ||
                    !snapshot.vacancy.position
                  }
                  onClick={() => void quickSave("applied")}
                >
                  Сохранить отклик
                </button>
              </>
            ) : snapshot.kind === "responses" ? (
              <div className="responses-summary-card">
                <div className="eyebrow">Страница «Отклики»</div>
                <h2>Страница обработана</h2>
                <p className="responses-timestamp">
                  <Clock size={15} />
                  <span>
                    {lastScanned
                      ? `Обработано в ${lastScanned.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                      : "Только что обработано"}
                  </span>
                </p>
                {pending.length > 0 ? (
                  <div className="responses-changes-badge warning">
                    <strong>Есть изменения ({pending.length})</strong>
                    <small>Найдены обновления статусов по откликам</small>
                  </div>
                ) : (
                  <div className="responses-changes-badge success">
                    <strong>Изменений нет</strong>
                    <small>Все статусы откликов актуальны</small>
                  </div>
                )}
                {pending.length > 0 && (
                  <div className="responses-preview-proposals">
                    {pending.slice(0, 3).map((p) => (
                      <div className="responses-proposal-item" key={p.id}>
                        <span>{p.current.company}</span>
                        <Badge
                          value={
                            p.changes.outcome === "employer_rejected" ||
                            p.detectedStatus === "rejected"
                              ? "closed"
                              : "interview"
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p>Откройте карточку вакансии для быстрого сохранения.</p>
            )}
          </section>
        ) : form ? (
          form.kind === "application" ? (
            <>
              <h2>
                {(form.value as Application).id
                  ? "Редактировать вакансию"
                  : "Добавить вакансию"}
              </h2>
              <ApplicationForm
                groupOptions={Array.from(
                  new Set(data.applications.flatMap((a) => a.groups ?? [])),
                ).sort((a, b) => a.localeCompare(b, "ru"))}
                tagOptions={Array.from(
                  new Set(data.applications.flatMap((a) => a.tags ?? [])),
                ).sort((a, b) => a.localeCompare(b, "ru"))}
                initial={form.value as Application}
                fields={data.fields}
                onDraftChange={(value) =>
                  setForm({ kind: "application", value })
                }
                api={api}
                onSaved={() => saved()}
                onCancel={() => setForm(undefined)}
              />
            </>
          ) : form.kind === "task" ? (
            <>
              <h2>Задача или интервью</h2>
              <TaskForm
                initial={form.value as Partial<Task>}
                applications={data.applications}
                onDraftChange={(value) => setForm({ kind: "task", value })}
                api={api}
                onSaved={() => saved()}
                onCancel={() => setForm(undefined)}
              />
            </>
          ) : (
            <>
              <h2>Добавить заметку</h2>
              <NoteForm
                applicationId={form.value as string}
                draftText={form.text}
                onDraftChange={(text) => setForm({ ...form, text })}
                api={api}
                onSaved={() => saved()}
                onCancel={() => setForm(undefined)}
              />
            </>
          )
        ) : (
          <>
            <div className="popup-overview" aria-label="Ваш журнал">
              <div>
                <span className="tile-icon">
                  <Bookmark size={17} />
                </span>
                <strong>{data.applications.length}</strong>
                <small>Вакансии</small>
              </div>
              <div>
                <span className="tile-icon">
                  <CalendarDays size={17} />
                </span>
                <strong>
                  {data.tasks.filter((task) => task.state === "open").length}
                </strong>
                <small>Задачи</small>
              </div>
              <div>
                <span className="tile-icon">
                  <RefreshCw size={17} />
                </span>
                <strong>{pending.length}</strong>
                <small>Изменения</small>
              </div>
            </div>
            <section className="vacancy-card">
              {snapshot.warning && <p className="muted">{snapshot.warning}</p>}
              {detail ? (
                <>
                  <div className="card-heading">
                    <span className="tile-icon">
                      <BriefcaseBusiness size={20} />
                    </span>
                    <div className="eyebrow">В вашем журнале</div>
                    <span className="connection-dot" />
                  </div>
                  <h1>{detail.application.company}</h1>
                  <p>{detail.application.position}</p>
                  <Badge
                    key={detail.application.stage}
                    value={detail.application.stage}
                  />
                  <Badge value={detail.application.state} kind="state" />
                  <FieldInput label="Быстрая смена этапа">
                    <Select
                      value={detail.application.stage}
                      disabled={busy}
                      onChange={(value) => void changeStage(value)}
                      items={stages}
                    />
                  </FieldInput>
                  <div className="actions detail-actions">
                    <button
                      onClick={() =>
                        setForm({
                          kind: "application",
                          value: detail.application,
                        })
                      }
                    >
                      Изменить этап
                    </button>
                    <button
                      onClick={() =>
                        setForm({ kind: "note", value: detail.application.id })
                      }
                    >
                      Заметка
                    </button>
                    <button
                      onClick={() =>
                        setForm({
                          kind: "task",
                          value: {
                            applicationId: detail.application.id,
                            date: dateToday(user.timezone),
                          },
                        })
                      }
                    >
                      <Plus size={15} />
                      Задача
                    </button>
                  </div>
                  {detail.tasks.length > 0 && (
                    <>
                      <h3>Следующие действия</h3>
                      <TaskList
                        tasks={detail.tasks.filter((t) => t.state === "open")}
                        applications={data.applications}
                        api={api}
                        onChanged={(updated) => {
                          if (updated) {
                            if (updated.state === "done") {
                              sendToast(
                                "Задача выполнена",
                                "success",
                                updated.title,
                              );
                            } else {
                              sendToast(
                                "Задача возвращена в работу",
                                "info",
                                updated.title,
                              );
                            }
                          }
                          void reload();
                        }}
                        onEdit={(t) => setForm({ kind: "task", value: t })}
                      />
                    </>
                  )}
                </>
              ) : snapshot.vacancy ? (
                <>
                  <div className="card-heading">
                    <span className="tile-icon">
                      <BriefcaseBusiness size={20} />
                    </span>
                    <div className="eyebrow">Новая вакансия</div>
                    <span className="connection-dot" />
                  </div>
                  <h1>{snapshot.vacancy.company || "Компания не найдена"}</h1>
                  <p>
                    {snapshot.vacancy.position || "Проверьте название позиции"}
                  </p>
                  <div className="actions">
                    <button
                      className="capture-action primary"
                      disabled={
                        busy ||
                        !snapshot.vacancy.company ||
                        !snapshot.vacancy.position
                      }
                      onClick={() => void quickSave()}
                    >
                      <span className="tile-icon">
                        <Bookmark size={20} />
                      </span>
                      <span className="capture-copy">
                        <strong>
                          {busy ? "Сохраняем…" : "Сохранить вакансию"}
                        </strong>
                        <small>Без редактирования</small>
                      </span>
                      <span className="capture-arrow">
                        <ArrowRight size={17} />
                      </span>
                    </button>
                    <button
                      className="capture-action"
                      disabled={
                        busy ||
                        !snapshot.vacancy.company ||
                        !snapshot.vacancy.position
                      }
                      onClick={() => void quickSave("applied")}
                    >
                      <span className="tile-icon">
                        <CheckCheck size={20} />
                      </span>
                      <span className="capture-copy">
                        <strong>Сохранить отклик</strong>
                        <small>Вы уже отправили резюме</small>
                      </span>
                      <span className="capture-arrow">
                        <ArrowRight size={17} />
                      </span>
                    </button>
                    <button
                      className="capture-action edit-vacancy"
                      onClick={() =>
                        setForm({
                          kind: "application",
                          value: {
                            ...snapshot.vacancy!,
                            savedDate: dateToday(user.timezone),
                          },
                        })
                      }
                    >
                      <span className="tile-icon">
                        <Pencil size={20} />
                      </span>
                      <span className="capture-copy">
                        <strong>Проверить данные</strong>
                        <small>Редактировать перед сохранением</small>
                      </span>
                      <span className="capture-arrow">
                        <ArrowRight size={17} />
                      </span>
                    </button>
                  </div>
                </>
              ) : !snapshot.supported ? (
                <Empty
                  title="Эта страница не поддерживается"
                  action={
                    <button
                      onClick={() =>
                        setForm({
                          kind: "application",
                          value: {
                            ...emptyApplication(),
                            savedDate: dateToday(user.timezone),
                          },
                        })
                      }
                    >
                      Добавить вручную
                    </button>
                  }
                >
                  Откройте карточку вакансии на {jobSitesLabel} или список
                  откликов hh.ru, Getmatch или Hirify.
                </Empty>
              ) : (
                <div className="responses-screen-header">
                  <h2>Отклики на открытой странице</h2>
                  <p className="responses-timestamp">
                    <Clock size={15} />
                    <span>
                      {lastScanned
                        ? `Обработано в ${lastScanned.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                        : "Только что обработано"}
                    </span>
                  </p>
                  {pending.length > 0 ? (
                    <div className="responses-changes-badge warning">
                      <strong>Обнаружены изменения: {pending.length}</strong>
                      <small>
                        Найдены обновления статусов по откликам. Подтвердите или
                        отклоните их ниже.
                      </small>
                    </div>
                  ) : (
                    <div className="responses-changes-badge success">
                      <strong>Изменений нет</strong>
                      <small>
                        Все найденные на странице отклики совпадают с данными в
                        вашем журнале.
                      </small>
                    </div>
                  )}
                </div>
              )}
            </section>
            {pending.length > 0 && (
              <>
                <h3 style={{ marginTop: 24 }}>
                  Предложения · {pending.length}
                </h3>
                {pending.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    application={data.applications.find(
                      (a) => a.id === p.applicationId,
                    )}
                    api={api}
                    onResolved={(action) => {
                      if (action === "dismiss") {
                        sendToast(
                          "Предложение отклонено",
                          "info",
                          "Изменения не применены",
                        );
                      } else {
                        sendToast(
                          "Изменения применены",
                          "success",
                          "Данные вакансии обновлены",
                        );
                      }
                      void reload();
                    }}
                  />
                ))}
              </>
            )}
            {snapshot.kind === "responses" && !pending.length && (
              <Empty title="Новых предложений нет">
                Нет изменений по сохранённым вакансиям и новых откликов с
                распознанной датой за последний месяц. Проверены только
                загруженные строки страницы.
              </Empty>
            )}
            <div className="popup-utilities">
              <label className="checkbox-label notification-setting">
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    try {
                      if (
                        enabled &&
                        !(await chrome.permissions.request({
                          permissions: ["notifications"],
                        }))
                      )
                        return;
                      await message({ type: "NOTIFICATIONS", enabled });
                      setNotifications(enabled);
                    } catch (e) {
                      setError(e);
                    }
                  }}
                />
                <Bell size={16} /> Системные уведомления
              </label>
              <button
                className="text-button refresh-button"
                onClick={() => reload()}
              >
                <RefreshCw size={14} />
                Обновить
              </button>
            </div>
          </>
        )}
      </div>
      {server && (
        <a
          className="popup-link"
          href={
            server + (detail ? "/applications/" + detail.application.id : "/")
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>Открыть полный журнал</span> <ArrowUpRight size={16} />
        </a>
      )}
    </main>
  );
}
function ServerSetup({
  initial,
  onSaved,
  onCancel,
}: {
  initial: string;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [server, setServer] = useState(
    initial ||
      import.meta.env.VITE_AVARI_DEFAULT_SERVER ||
      "http://localhost:8080",
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form server-form"
      onKeyDown={handleFormSubmitShortcut}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await connectServer(server);
          onSaved();
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="setup-emblem tile-icon">
        <Settings size={24} />
      </div>
      <div className="eyebrow">Начнём с подключения</div>
      <h2>Ваш журнал, всегда рядом</h2>
      <p className="muted">Укажите адрес вашего приложения Avari.Jobs.</p>
      <ErrorBox error={error} />
      <FieldInput label="Адрес сервиса">
        <input
          type="url"
          required
          value={server}
          onChange={(e) => setServer(e.target.value)}
        />
      </FieldInput>
      <button className="primary" disabled={busy}>
        Подключить
        <SubmitShortcutHint />
      </button>
      {onCancel && (
        <button type="button" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      )}
    </form>
  );
}
function Login({ server, onLogin }: { server: string; onLogin: () => void }) {
  const defaultServer = import.meta.env.VITE_AVARI_DEFAULT_SERVER || server;
  const [ownServer, setOwnServer] = useState(server !== defaultServer);
  const [serverAddress, setServerAddress] = useState(server);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form login-form"
      onKeyDown={handleFormSubmitShortcut}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await connectServer(ownServer ? serverAddress : defaultServer);
          await api("/auth/login", "POST", {
            email,
            password,
            kind: "extension",
            name: "Chromium · " + navigator.platform,
          });
          onLogin();
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="login-intro">
        <div className="eyebrow">Добро пожаловать</div>
        <h1>Войти в журнал</h1>
        <p className="muted">Вакансии, отклики и планы — в одном месте.</p>
      </div>
      <ErrorBox error={error} />
      <FieldInput label="Email">
        <input
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(undefined);
          }}
        />
      </FieldInput>
      <FieldInput label="Пароль">
        <input
          type="password"
          required
          maxLength={256}
          placeholder="Введите пароль"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(undefined);
          }}
        />
      </FieldInput>
      <label className="checkbox-label login-server-option">
        <input
          type="checkbox"
          checked={ownServer}
          disabled={busy}
          onChange={(event) => {
            setOwnServer(event.target.checked);
            setError(undefined);
          }}
        />
        Использовать свой сервер
      </label>
      {ownServer && (
        <FieldInput label="Адрес сервиса">
          <input
            type="url"
            required
            value={serverAddress}
            disabled={busy}
            onChange={(event) => {
              setServerAddress(event.target.value);
              setError(undefined);
            }}
          />
        </FieldInput>
      )}
      <button className="primary" disabled={busy}>
        Войти <ArrowUpRight size={17} />
        <SubmitShortcutHint />
      </button>
      <a
        className="registration-link"
        href={registrationServer(
          ownServer ? serverAddress : defaultServer,
          defaultServer,
        )}
        target="_blank"
        rel="noopener noreferrer"
      >
        Регистрация на сайте
      </a>
      <small className="login-security">
        <ShieldCheck size={15} />
        Доступ после одобрения администратором
      </small>
    </form>
  );
}
function serverOrigin(address: string): string {
  const url = new URL(address);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("Используйте HTTPS или localhost");
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Укажите только адрес сервера, без пути и параметров");
  return url.origin;
}
async function connectServer(address: string) {
  const origin = serverOrigin(address);
  const granted = await chrome.permissions.request({
    origins: [origin + "/*"],
  });
  if (!granted)
    throw new Error("Для подключения нужен доступ к выбранному сервису");
  await message({ type: "SAVE_SERVER", server: origin });
}
function registrationServer(address: string, fallback: string) {
  try {
    return serverOrigin(address);
  } catch {
    return fallback;
  }
}
createRoot(document.getElementById("root")!).render(<Popup />);
