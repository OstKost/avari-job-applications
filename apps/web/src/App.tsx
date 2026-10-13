import {
  FilterPresence,
  FilterModalMotion,
  TableRowsMotion,
} from "./FilterMotion";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
  Fragment,
} from "react";
import { createPortal } from "react-dom";
import {
  NavLink,
  Link,
  Routes,
  Route,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { initGoogleAnalytics, trackPageView } from "./analytics";
import {
  CalendarDays,
  BriefcaseBusiness,
  GitCompareArrows,
  Settings,
  Plus,
  Search,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  LogOut,
  Monitor,
  CheckCircle2,
  Pencil,
  LayoutDashboard,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListFilter,
  FolderClosed,
  LayoutGrid,
  PanelRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Clock3,
  Target,
  Sparkles,
  ArrowUpDown,
  SlidersHorizontal,
  Download,
  FileSpreadsheet,
  Calendar as CalendarIcon,
  Puzzle,
  User as UserIcon,
  Sliders,
  FolderKanban,
  Check,
  Layers,
  Tag,
  ShieldCheck,
  Compass,
  RotateCcw,
} from "lucide-react";
import {
  createAPI,
  APIError,
  type User,
  type Application,
  type Task,
  type Note,
  type Field,
  type Proposal,
  type Detail,
  type Session,
  type CalendarSubscription,
  type ExtensionDownload,
  dateToday,
  dateLabel,
  emptyApplication,
  sortTasks,
  stages,
  states,
  externalStatuses,
  displayValue,
  fieldLabels,
  jobSite,
  jobSitesLabel,
  tagColorIndex,
  tagLabel,
  pluralTasks,
  pluralApplications,
  exportApplicationsToCSV,
  downloadCSV,
} from "@avari/shared";
import {
  ThemeButton,
  Loading,
  ErrorBox,
  Empty,
  Badge,
  Modal,
  ApplicationForm,
  TaskForm,
  NoteForm,
  ProposalCard,
  TaskList,
  FieldInput,
  Select,
  CompanyAvatar,
  UserAvatar,
  handleFormSubmitShortcut,
  SubmitShortcutHint,
} from "@avari/shared/ui";
import { PageTransition } from "./PageTransition";

const api = createAPI();
function clearSession(client: ReturnType<typeof useQueryClient>) {
  void client.cancelQueries();
  client.setQueryData(["me"], null);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
}

type Data = {
  applications: Application[];
  tasks: Task[];
  fields: Field[];
  proposals: Proposal[];
};
type Actions = {
  user: User;
  data: Data;
  refresh: () => void;
  logout: () => Promise<void>;
  editApplication: (a?: Application) => void;
  editTask: (t?: Partial<Task>) => void;
  addNote: (id: string, note?: Note) => void;
};
const Context = createContext<Actions>(null!);
const useApp = () => useContext(Context);
function PageTracking() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);

    let title = "Avari.Jobs — журнал откликов на вакансии";
    if (pathname === "/calendar") {
      title = "Календарь — Avari.Jobs";
    } else if (pathname === "/applications") {
      title = "Отклики — Avari.Jobs";
    } else if (pathname.startsWith("/applications/")) {
      title = "Детали отклика — Avari.Jobs";
    } else if (pathname === "/proposals") {
      title = "Предложения расширения — Avari.Jobs";
    } else if (pathname === "/settings") {
      title = "Настройки — Avari.Jobs";
    } else if (pathname === "/extension") {
      title = "Расширение Avari.Jobs для Chrome";
    } else if (pathname === "/privacy") {
      title = "Конфиденциальность — Avari.Jobs";
    }
    document.title = title;
    trackPageView(pathname, title);
  }, [pathname]);
  return null;
}
export default function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    initGoogleAnalytics();
  }, []);

  if (pathname === "/privacy") {
    return (
      <>
        <PageTracking />
        <PublicPage privacy={true} />
      </>
    );
  }

  if (pathname === "/extension") {
    return (
      <>
        <PageTracking />
        <PublicPage privacy={false} />
      </>
    );
  }

  return (
    <>
      <PageTracking />
      <AuthenticatedApp />
    </>
  );
}

function NotFoundPage({
  insideWorkspace = false,
}: {
  insideWorkspace?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <div
      className={`not-found-page ${insideWorkspace ? "inside-workspace" : "auth-page"}`}
    >
      <section className="not-found-card">
        <div className="not-found-glitch-badge">
          <Compass size={14} />
          <span>Код 404 • Ошибка навигации</span>
        </div>
        <h1 className="not-found-code">404</h1>
        <h2 className="not-found-title">Страница не найдена</h2>
        <p className="not-found-desc">
          Возможно, этот раздел был перемещён, удалён или в адресе допущена
          опечатка. Проверьте правильность ссылки или вернитесь в журнал.
        </p>
        <div className="not-found-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate("/");
              }
            }}
          >
            <ArrowLeft size={16} />
            Назад
          </button>
          <Link to="/calendar" className="primary">
            <CalendarDays size={16} />
            Календарь
          </Link>
          <Link to="/applications" className="btn-secondary">
            <BriefcaseBusiness size={16} />
            Отклики
          </Link>
          <Link to="/" className="btn-secondary">
            <LayoutDashboard size={16} />
            Дашборд
          </Link>
        </div>
      </section>
    </div>
  );
}

function PublicPage({ privacy }: { privacy: boolean }) {
  const [version, setVersion] = useState("");
  const chromeStore = import.meta.env.VITE_CHROME_STORE_URL || "";
  useEffect(() => {
    fetch("/release.json")
      .then((response) => response.json())
      .then((data) => setVersion(data.version))
      .catch(() => {});
  }, []);
  return (
    <div className="auth-page">
      <section className="auth-card public-card">
        <Brand />
        {privacy ? (
          <>
            <h1>Конфиденциальность</h1>
            <p>
              Avari.Jobs хранит введённые вами вакансии, задачи, заметки и
              учётные данные на выбранном вами сервере. Доступ к журналу требует
              входа; новые аккаунты одобряет администратор сервера.
            </p>
            <p>
              Расширение читает открытую вами страницу вакансии или список
              откликов на hh.ru, LinkedIn, Getmatch, Hirify, Geekjob и Habr
              Career. Оно извлекает сведения о вакансиях и откликах и отправляет
              их только в настроенный вами Avari.Jobs. Пароли, cookies и
              переписку площадок расширение не собирает.
            </p>
            <p>
              Токен входа расширения хранится локально в Chrome. Для работы на
              jobs.avari.dev расширение получает доступ при установке; для
              другого сервера разрешение запрашивается отдельно; системные
              уведомления включаются отдельно. Данные журнала не передаются
              рекламным сервисам.
            </p>
            <p>
              При включённой Google Analytics сайт передаёт Google сведения о
              посещениях страниц, браузере и устройстве. Расширение не содержит
              Google Analytics. Полная политика:{" "}
              <a href="/privacy.html">
                Политика конфиденциальности / Privacy Policy
              </a>
              .
            </p>
            <p>
              Удалить записи можно в приложении, а для удаления аккаунта и
              данных обратитесь к администратору вашего сервера.
            </p>
            <p>
              Для отображения аватара сайт обращается к Gravatar. В адресе
              запроса используется SHA-256 хеш email; запрос выполняется вашим
              браузером к внешнему сервису. Переход по ссылке изменения аватара
              открывает Gravatar с вашим email.
            </p>
          </>
        ) : (
          <>
            <h1>Расширение Avari.Jobs</h1>
            <p>
              Добавляйте вакансии с hh.ru, LinkedIn, Getmatch и Hirify в ваш
              журнал откликов.
            </p>
            <p>Версия: {version || "загрузка…"}</p>
            {chromeStore ? (
              <p>
                <a
                  className="primary public-download"
                  href={chromeStore}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Установить из Chrome Web Store
                </a>
              </p>
            ) : (
              <p className="notice">
                Расширение находится на публикации в Chrome Web Store.
              </p>
            )}
            <ol className="instructions">
              <li>
                Установите расширение из официального каталога Chrome Web Store.
              </li>
              <li>
                Войдите в ваш аккаунт Avari.Jobs. Расширение по умолчанию
                подключено к <code>https://jobs.avari.dev</code>.
              </li>
              <li>
                Для персонального сервера или ручной установки архива войдите в
                аккаунт и перейдите в <strong>Настройки → Расширение</strong>.
              </li>
            </ol>
          </>
        )}
        <p>
          <a href="/">Войти в Avari.Jobs</a> ·{" "}
          <a href="/extension">Расширение</a> ·{" "}
          <a href="/privacy">Конфиденциальность</a>
        </p>
      </section>
    </div>
  );
}
function AuthenticatedApp() {
  const client = useQueryClient();
  useEffect(() => {
    const expired = () => {
      clearSession(client);
    };
    window.addEventListener("avari-session-expired", expired);
    return () => window.removeEventListener("avari-session-expired", expired);
  }, [client]);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/me"),
    refetchInterval: (q) =>
      q.state.data?.status === "pending" ? 10000 : false,
  });
  if (me.isPending) return <Loading />;
  if (me.error || !me.data)
    return <Auth onLogin={(u) => client.setQueryData(["me"], u)} />;
  if (me.data.status !== "active")
    return (
      <AccountStatus
        user={me.data}
        refresh={() => me.refetch()}
        logout={async () => {
          await api("/auth/logout", "POST", {});
          clearSession(client);
        }}
      />
    );
  return <Workspace user={me.data} />;
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark brand-logo" aria-hidden="true">
        <img src="/brand/avari-jobs-logo.png" alt="" />
        <div className="brand-water" />
      </div>
      <span className="brand-name" data-text="Avari.Jobs">
        Avari<span className="primary-text">.Jobs</span>
      </span>
    </div>
  );
}
function Auth({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "recovery">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  return (
    <div className="auth-page">
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
            <span className="eyebrow">Каждый шаг имеет значение</span>
            <h2>
              Новая глава.
              <br />
              Ваши правила.
            </h2>
            <p>
              Сохраняйте возможности, планируйте встречи и двигайтесь к работе,
              которая вам подходит.
            </p>
          </div>
          <div className="auth-story-footer">
            <span className="brand-mark">
              <BriefcaseBusiness size={20} />
            </span>
            <span>
              Меньше хаоса.
              <br />
              <strong>Больше ясности.</strong>
            </span>
          </div>
        </aside>
        <div className="auth-form-pane">
          <span className="eyebrow">Ваше карьерное пространство</span>
          <h1>
            {mode === "login"
              ? "С возвращением"
              : mode === "register"
                ? "Начните свою историю"
                : "Восстановление доступа"}
          </h1>
          <p>
            {mode === "recovery"
              ? "Укажите email и новый пароль. Администратор одобрит смену вручную."
              : "Отклики, встречи и следующие шаги — в одном месте."}
          </p>
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
                  setSuccess(
                    "Аккаунт создан. Войдите, чтобы отслеживать одобрение.",
                  );
                  setMode("login");
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
            {mode === "login" && (
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
              ? "Доступ открывается после ручного одобрения администратором."
              : mode === "recovery"
                ? "Администратор одобряет смену пароля через TUI-консоль, не видя сам пароль."
                : "Для начала работы используйте вашу учётную запись."}
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
function AccountStatus({
  user,
  refresh,
  logout,
}: {
  user: User;
  refresh: () => void;
  logout: () => void;
}) {
  return (
    <div className="auth-page">
      <div className="auth-theme">
        <ThemeButton />
      </div>
      <section className="auth-card">
        <Brand />
        <h1>
          {user.status === "pending"
            ? "Заявка отправлена"
            : "Аккаунт заблокирован"}
        </h1>
        <p>
          {user.status === "pending"
            ? "Администратор проверит регистрацию и откроет доступ. Статус обновляется автоматически."
            : "Для восстановления доступа обратитесь к администратору."}
        </p>
        <p>{user.email}</p>
        <div className="actions">
          <button className="primary" onClick={refresh}>
            Проверить статус
          </button>
          <button onClick={logout}>Выйти</button>
        </div>
      </section>
    </div>
  );
}
function Workspace({ user }: { user: User }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<{
    kind: "application" | "task" | "note";
    value?: Application | Partial<Task> | Note | string;
  }>();
  const [notice, setNotice] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("avari-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem("avari-sidebar-collapsed", String(next));
      } catch {
        /* Storage may be unavailable. */
      }
      return next;
    });
  };
  const query = useQuery({
    queryKey: ["data"],
    queryFn: async () => {
      const [applications, tasks, fields, proposals] = await Promise.all([
        api<Application[]>("/applications"),
        api<Task[]>("/tasks"),
        api<Field[]>("/fields"),
        api<Proposal[]>("/proposals"),
      ]);
      return { applications, tasks, fields, proposals };
    },
    refetchInterval: 30000,
  });
  const data = query.data ?? {
    applications: [],
    tasks: [],
    fields: [],
    proposals: [],
  };
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["data"] });
    client.invalidateQueries({ queryKey: ["detail"] });
    client.invalidateQueries({ queryKey: ["calendar"] });
  };
  const saved = () => {
    setForm(undefined);
    refresh();
    setNotice("Сохранено");
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice, form]);
  const pending = data.proposals.filter((p) => p.status === "pending");
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api("/auth/logout", "POST", {});
    } catch {
      /* End the local session even if the server cannot be reached. */
    } finally {
      clearSession(client);
    }
  };
  const context: Actions = {
    user,
    data,
    refresh,
    logout: async () => {
      setConfirmLogout(true);
    },
    editApplication: (a) =>
      setForm({
        kind: "application",
        value: a ?? {
          ...emptyApplication(),
          savedDate: dateToday(user.timezone),
        },
      }),
    editTask: (t) =>
      setForm({
        kind: "task",
        value: { date: dateToday(user.timezone), ...t },
      }),
    addNote: (id, note) => setForm({ kind: "note", value: note ?? id }),
  };
  return (
    <Context.Provider value={context}>
      <div
        className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      >
        <aside className="sidebar">
          <Brand />
          <div className="brand-caption">
            Ваш следующий
            <br />
            карьерный шаг
          </div>
          <nav id="workspace-navigation" aria-label="Основное меню">
            {[
              {
                title: "Рабочее пространство",
                links: [
                  { path: "/", label: "Главная", icon: LayoutDashboard },
                  {
                    path: "/applications",
                    label: "Отклики",
                    icon: BriefcaseBusiness,
                  },
                  { path: "/calendar", label: "Календарь", icon: CalendarDays },
                ],
              },
              {
                title: "Управление",
                links: [
                  {
                    path: "/proposals",
                    label: "Предложения",
                    icon: GitCompareArrows,
                  },
                  { path: "/settings", label: "Настройки", icon: Settings },
                ],
              },
            ].map(({ title, links }) => (
              <div className="nav-section" key={title}>
                <div className="nav-heading">{title}</div>
                {links.map(({ path, label, icon: Icon }) => (
                  <RowActionHint
                    key={path}
                    label={label}
                    placement="right"
                    className="sidebar-nav-hint"
                    enabled={sidebarCollapsed}
                  >
                    <NavLink to={path} end={path === "/"} aria-label={label}>
                      <Icon size={18} />
                      <span>{label}</span>
                      {path === "/proposals" && pending.length > 0 && (
                        <span className="nav-count">{pending.length}</span>
                      )}
                    </NavLink>
                  </RowActionHint>
                ))}
              </div>
            ))}
            <div className="sidebar-meta-section">
              <RowActionHint
                label="Конфиденциальность"
                placement="right"
                className="sidebar-nav-hint"
                enabled={sidebarCollapsed}
              >
                <Link
                  to="/privacy"
                  className="sidebar-privacy-link"
                  aria-label="Конфиденциальность"
                >
                  <ShieldCheck size={14} />
                  <span>Конфиденциальность</span>
                </Link>
              </RowActionHint>
            </div>
          </nav>
          <div className="sidebar-footer">
            <RowActionHint
              label={`Настройки аккаунта (${user.email})`}
              placement="right"
              enabled={sidebarCollapsed}
            >
              <Link
                to="/settings"
                className="sidebar-account"
                aria-label={`Настройки аккаунта (${user.email})`}
              >
                <UserAvatar email={user.email} size={32} />
                <span className="account-label">{user.email}</span>
              </Link>
            </RowActionHint>
            <div className="sidebar-footer-actions">
              <RowActionHint label="Переключить тему" placement="right">
                <ThemeButton />
              </RowActionHint>
              <RowActionHint label="Выйти из аккаунта" placement="right">
                <button
                  type="button"
                  className="icon-button text-button"
                  aria-label="Выйти из аккаунта"
                  onClick={() => setConfirmLogout(true)}
                >
                  <LogOut size={15} />
                </button>
              </RowActionHint>
              <RowActionHint
                label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
                placement="right"
                className="sidebar-toggle-hint"
              >
                <button
                  type="button"
                  className="icon-button sidebar-toggle"
                  onClick={toggleSidebar}
                  aria-label={
                    sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"
                  }
                  aria-expanded={!sidebarCollapsed}
                  aria-controls="workspace-navigation"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen size={18} />
                  ) : (
                    <PanelLeftClose size={18} />
                  )}
                </button>
              </RowActionHint>
            </div>
          </div>
        </aside>
        <main className="main">
          {notice && (
            <div className="toast toast-success" role="status">
              <span className="toast-icon">
                <CheckCircle2 size={22} />
              </span>
              <div>
                <strong>Изменения сохранены</strong>
                <p>Ваш журнал обновлён.</p>
              </div>
              <button
                className="icon-button text-button"
                aria-label="Закрыть уведомление"
                onClick={() => setNotice("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {query.isPending ? (
            <Loading />
          ) : query.error ? (
            <ErrorBox error={query.error} retry={() => query.refetch()} />
          ) : (
            <PageTransition>
              {(location) => (
                <Routes location={location}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/applications" element={<Applications />} />
                  <Route
                    path="/applications/:id"
                    element={<ApplicationDetail />}
                  />
                  <Route path="/proposals" element={<Proposals />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route
                    path="/privacy"
                    element={<PublicPage privacy={true} />}
                  />
                  <Route
                    path="/extension"
                    element={<PublicPage privacy={false} />}
                  />
                  <Route
                    path="*"
                    element={<NotFoundPage insideWorkspace={true} />}
                  />
                </Routes>
              )}
            </PageTransition>
          )}
        </main>
      </div>
      {confirmLogout && (
        <Modal
          title="Выйти из аккаунта?"
          className="logout-modal"
          onClose={() => {
            if (!loggingOut) setConfirmLogout(false);
          }}
        >
          <div className="logout-water">
            <span className="logout-symbol" aria-hidden="true">
              <LogOut size={28} />
            </span>
            <p>
              Ваши отклики и планы сохранены. Вы сможете продолжить после входа.
            </p>
          </div>
          <div className="actions logout-actions">
            <button
              autoFocus
              disabled={loggingOut}
              onClick={() => setConfirmLogout(false)}
            >
              Остаться
            </button>
            <button
              className="primary"
              disabled={loggingOut}
              onClick={handleLogout}
            >
              <LogOut size={16} />
              {loggingOut ? "Выходим…" : "Выйти"}
            </button>
          </div>
        </Modal>
      )}
      {form && (
        <Modal
          title={
            form.kind === "application"
              ? !!(form.value as Application).id
                ? "Редактировать вакансию"
                : "Добавить вакансию"
              : form.kind === "task"
                ? "Задача или интервью"
                : typeof form.value === "string"
                  ? "Добавить заметку"
                  : "Редактировать заметку"
          }
          onClose={() => setForm(undefined)}
        >
          {form.kind === "application" ? (
            <ApplicationForm
              groupOptions={Array.from(
                new Set(data.applications.flatMap((a) => a.groups ?? [])),
              ).sort((a, b) => a.localeCompare(b, "ru"))}
              tagOptions={Array.from(
                new Set(data.applications.flatMap((a) => a.tags ?? [])),
              ).sort((a, b) => a.localeCompare(b, "ru"))}
              initial={form.value as Application}
              fields={data.fields}
              api={api}
              onCancel={() => setForm(undefined)}
              onSaved={(a) => {
                saved();
                navigate("/applications/" + a.id);
              }}
            />
          ) : form.kind === "task" ? (
            <TaskForm
              initial={form.value as Partial<Task>}
              applications={data.applications}
              api={api}
              onCancel={() => setForm(undefined)}
              onSaved={saved}
            />
          ) : (
            <NoteForm
              applicationId={
                typeof form.value === "string"
                  ? form.value
                  : (form.value as Note).applicationId
              }
              initial={
                typeof form.value === "string"
                  ? undefined
                  : (form.value as Note)
              }
              api={api}
              onCancel={() => setForm(undefined)}
              onSaved={saved}
            />
          )}
        </Modal>
      )}
    </Context.Provider>
  );
}
function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">Журнал поиска работы</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">
        <span className="mobile-theme">
          <ThemeButton />
        </span>
        {children}
      </div>
    </header>
  );
}
function StageBreakdown({ applications }: { applications: Application[] }) {
  const largest = Math.max(
    1,
    ...Object.keys(stages).map(
      (s) => applications.filter((a) => a.stage === s).length,
    ),
  );
  return (
    <div className="stage-breakdown">
      {Object.entries(stages).map(([key, label]) => {
        const count = applications.filter((a) => a.stage === key).length;
        return (
          <div className="stage-meter" key={key}>
            <div>
              <span>
                <i className={"stage-dot dot-" + key} />
                {label}
              </span>
              <strong>{count}</strong>
            </div>
            <div className="meter-track">
              <span
                className={"meter-fill fill-" + key}
                style={{ width: `${(count / largest) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
function Dashboard() {
  const { user, data, refresh, editTask, editApplication } = useApp();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const today = dateToday(user.timezone);
  const openTasks = sortTasks(data.tasks.filter((t) => t.state === "open"));
  const todaysTasks = data.tasks.filter((t) => t.date === today);
  const overdue = openTasks.filter((t) => t.date < today);
  const recent = [...data.applications]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const active = data.applications.filter((a) => a.state === "active");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: user.timezone,
    }).format(now),
  );
  const greeting =
    hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const pending = data.proposals.filter((p) => p.status === "pending").length;
  const timeFormatted = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: user.timezone,
  }).format(now);
  const [clockHours, clockMinutes] = timeFormatted.split(":");
  return (
    <>
      <PageHeader
        title="Главная"
        subtitle="Всё важное для вашего следующего шага"
      >
        <button
          className="primary water-interaction"
          onClick={() => editApplication()}
        >
          <Plus size={17} />
          Добавить вакансию
        </button>
      </PageHeader>
      <section className="dashboard-hero">
        <div className="auth-water-canvas" aria-hidden="true">
          <div className="water-wave wave-1" />
          <div className="water-wave wave-2" />
          <div className="water-wave wave-3" />
          <div className="water-caustics" />
        </div>
        <div className="hero-copy">
          <span className="greeting">
            <Sparkles size={15} />
            {greeting}
          </span>
          <h2>
            Хороший день
            <br />
            для нового шага.
          </h2>
          <p>
            {todaysTasks.filter((t) => t.state === "open").length
              ? `На сегодня запланировано ${pluralTasks(todaysTasks.filter((t) => t.state === "open").length)}. Начните с самого важного.`
              : "Сегодня можно выбрать свой темп. Сохраните интересную вакансию или запланируйте следующий шаг."}
          </p>
          <Link to="/calendar" className="hero-link">
            Открыть календарь <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="hero-clock">
          <strong>
            {clockHours}
            <span className="hero-clock-colon">:</span>
            {clockMinutes}
          </strong>
          <span>
            {new Intl.DateTimeFormat("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: user.timezone,
            }).format(now)}
          </span>
          <small>{user.timezone}</small>
        </div>
      </section>
      <section className="panel quick-access">
        <h2>Быстрый доступ</h2>
        <div className="quick-links">
          <Link to="/applications">
            <BriefcaseBusiness />
            <strong>Отклики</strong>
            <small>Все возможности</small>
          </Link>
          <Link to="/calendar">
            <CalendarDays />
            <strong>Календарь</strong>
            <small>Встречи и задачи</small>
          </Link>
          <Link to="/proposals">
            <div className="quick-link-top">
              <GitCompareArrows />
              {pending > 0 && (
                <span
                  className="quick-link-badge"
                  title={`${pending} ожидают проверки`}
                >
                  {pending}
                </span>
              )}
            </div>
            <strong>Предложения</strong>
            <small>{pending ? "Ожидают проверки" : "Всё актуально"}</small>
          </Link>
          <button onClick={() => editTask()}>
            <Plus />
            <strong>Новая задача</strong>
            <small>Следующий шаг</small>
          </button>
        </div>
      </section>
      <div className="dashboard-metrics">
        {[
          {
            label: "Активные отклики",
            value: active.length,
            icon: BriefcaseBusiness,
            hint: "В вашем поиске",
          },
          {
            label: "Интервью впереди",
            value: openTasks.filter(
              (t) => t.kind === "interview" && t.date >= today,
            ).length,
            icon: CalendarDays,
            hint: "Запланированные встречи",
          },
          {
            label: "Офферы",
            value: active.filter((a) => a.stage === "offer").length,
            icon: Target,
            hint: "На этапе предложения",
          },
          {
            label: "Ожидают внимания",
            value: overdue.length + pending,
            icon: Clock3,
            hint: "Просроченные задачи и предложения",
          },
        ].map(({ label, value, icon: Icon, hint }) => (
          <div className="metric-card" key={label}>
            <span className="metric-icon">
              <Icon size={19} />
            </span>
            <span className="stat-label">{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel dashboard-tasks">
          <div className="section-head">
            <h2>
              План на сегодня{" "}
              <span className="count-chip">{todaysTasks.length}</span>
            </h2>
            <button
              className="icon-button"
              aria-label="Добавить задачу"
              onClick={() => editTask()}
            >
              <Plus size={17} />
            </button>
          </div>
          {todaysTasks.length ? (
            <TaskList
              tasks={todaysTasks}
              applications={data.applications}
              api={api}
              onChanged={refresh}
              onEdit={editTask}
            />
          ) : (
            <Empty title="День без расписания">
              Добавьте задачу, чтобы не потерять следующий шаг.
            </Empty>
          )}
          {overdue.length > 0 && (
            <Link className="attention-link" to="/calendar">
              {pluralTasks(overdue.length, "просроченная")}
              <ArrowUpRight size={14} />
            </Link>
          )}
        </section>
        <section className="panel">
          <div className="section-head">
            <h2>Последние отклики</h2>
            <Link to="/applications" className="subtle-link">
              Все <ArrowUpRight size={14} />
            </Link>
          </div>
          {recent.length ? (
            recent.map((a) => (
              <Link
                className="recent-application"
                to={"/applications/" + a.id}
                key={a.id}
              >
                <CompanyAvatar name={a.company} />
                <div>
                  <strong>{a.company}</strong>
                  <small>{a.position}</small>
                </div>
                <Badge value={a.stage} />
              </Link>
            ))
          ) : (
            <Empty
              title="Здесь начинается ваш поиск"
              action={
                <button onClick={() => editApplication()}>
                  Сохранить вакансию
                </button>
              }
            >
              Интересные возможности будут под рукой.
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="section-head">
            <h2>Ваш прогресс</h2>
            <BriefcaseBusiness size={18} className="primary-text" />
          </div>
          <StageBreakdown applications={active} />
          <small>Этапы активных откликов</small>
        </section>
      </div>
    </>
  );
}
function calendarDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
function Calendar() {
  const { user, data, refresh, editTask } = useApp();
  const today = dateToday(user.timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const first = new Date(month + "-01T12:00:00Z");
  const offset = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - offset);
  const days = Array.from(
    {
      length:
        Math.ceil(
          (offset +
            new Date(
              Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
            ).getUTCDate()) /
            7,
        ) * 7,
    },
    (_, i) => {
      const d = new Date(gridStart);
      d.setUTCDate(d.getUTCDate() + i);
      return calendarDate(d);
    },
  );
  const selectedTasks = data.tasks.filter((t) => t.date === selected);
  const overdue = data.tasks.filter(
    (t) => t.state === "open" && t.date < today,
  );
  const monthTasks = data.tasks.filter(
    (t) => t.date.startsWith(month) && t.state === "open",
  );
  const moveMonth = (delta: number) => {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + delta);
    const date = calendarDate(d);
    setMonth(date.slice(0, 7));
    setSelected(date);
  };
  return (
    <>
      <PageHeader
        title="Календарь"
        subtitle="Место для встреч, планов и следующих шагов"
      >
        <button onClick={() => setSubscriptionOpen(true)}>
          <CalendarDays size={17} />
          Подписаться
        </button>
        <button
          className="primary"
          onClick={() => editTask({ date: selected })}
        >
          <Plus size={17} />
          Добавить задачу
        </button>
      </PageHeader>
      {subscriptionOpen && (
        <Modal
          title="Подписка на календарь"
          onClose={() => setSubscriptionOpen(false)}
        >
          <CalendarSubscriptionPanel />
        </Modal>
      )}
      <div className="calendar-layout">
        <section className="panel month-panel">
          <div className="month-toolbar">
            <div>
              <h2>
                {dateLabel(month + "-01", { month: "long", year: "numeric" })}
              </h2>
              <small>
                {pluralTasks(monthTasks.length, "открытая")} · {user.timezone}
              </small>
            </div>
            <div className="actions">
              <button
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setSelected(today);
                }}
              >
                Сегодня
              </button>
              <button
                className="icon-button"
                aria-label="Предыдущий месяц"
                onClick={() => moveMonth(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Следующий месяц"
                onClick={() => moveMonth(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="month-weekdays">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="month-grid">
            {days.map((d) => {
              const tasks = sortTasks(data.tasks.filter((t) => t.date === d));
              return (
                <button
                  key={d}
                  aria-label={dateLabel(d, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  aria-pressed={selected === d}
                  className={
                    "month-day " +
                    (!d.startsWith(month) ? "outside " : "") +
                    (d === today ? "today " : "") +
                    (d === selected ? "selected" : "")
                  }
                  onClick={() => setSelected(d)}
                >
                  <span className="date-number">{Number(d.slice(-2))}</span>
                  <div className="calendar-events">
                    {tasks.slice(0, 2).map((t) => (
                      <span
                        className={
                          "calendar-event " +
                          (t.kind === "interview" ? "event-interview " : "") +
                          (t.state === "done" ? "event-done" : "")
                        }
                        key={t.id}
                      >
                        <i />
                        {t.time && <b>{t.time}</b>}
                        {t.title}
                      </span>
                    ))}
                    {tasks.length > 2 && (
                      <small>+ ещё {tasks.length - 2}</small>
                    )}
                  </div>
                  {tasks.length > 0 && (
                    <span className="mobile-event-dots" aria-hidden="true">
                      {tasks.slice(0, 3).map((t) => (
                        <i
                          key={t.id}
                          className={t.kind === "interview" ? "interview" : ""}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="calendar-legend">
            <span>
              <i />
              Задача
            </span>
            <span>
              <i className="interview" />
              Интервью
            </span>
            <small>Выберите день, чтобы увидеть повестку</small>
          </div>
        </section>
        <aside className="calendar-agenda panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Повестка дня</span>
              <h2>{dateLabel(selected, { day: "numeric", month: "long" })}</h2>
              <small>{dateLabel(selected, { weekday: "long" })}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Задача на выбранный день"
              onClick={() => editTask({ date: selected })}
            >
              <Plus size={18} />
            </button>
          </div>
          {selectedTasks.length ? (
            <div className="agenda-timeline">
              {sortTasks(selectedTasks).map((task) => (
                <div
                  key={task.id}
                  className={
                    "agenda-event " +
                    (task.kind === "interview"
                      ? "agenda-interview"
                      : "agenda-task")
                  }
                >
                  <span className="agenda-time">
                    {task.time || "Без времени"}
                  </span>
                  <TaskList
                    tasks={[task]}
                    applications={data.applications}
                    api={api}
                    onChanged={refresh}
                    onEdit={editTask}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Время для новых планов"
              action={
                <button onClick={() => editTask({ date: selected })}>
                  <Plus size={15} />
                  Задача
                </button>
              }
            >
              На этот день задач пока нет.
            </Empty>
          )}
          <div className="agenda-summary">
            <span>Выполнено</span>
            <strong>
              {selectedTasks.filter((t) => t.state === "done").length} /{" "}
              {selectedTasks.length}
            </strong>
          </div>
        </aside>
      </div>
      {overdue.length > 0 && (
        <section className="panel overdue">
          <div className="section-head">
            <h3>{pluralTasks(overdue.length, "просроченная")}</h3>
            <Clock3 size={18} />
          </div>
          <div className="overdue-list">
            <TaskList
              tasks={overdue}
              applications={data.applications}
              api={api}
              onChanged={refresh}
              onEdit={editTask}
            />
          </div>
        </section>
      )}
    </>
  );
}
function RowActionHint({
  label,
  children,
  placement = "top",
  className = "",
  enabled = true,
}: {
  label: string;
  children: ReactNode;
  placement?: "top" | "right";
  className?: string;
  enabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (element: HTMLElement) =>
    enabled && setAnchor(element.getBoundingClientRect());
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor]);
  return (
    <span
      className={`row-action-hint ${className}`}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAnchor(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setAnchor(null);
      }}
    >
      {children}
      {enabled &&
        anchor &&
        createPortal(
          <span
            className={`row-action-tooltip${placement === "right" ? " sidebar-tooltip" : ""}`}
            role="tooltip"
            style={{
              ...(placement === "right"
                ? {
                    top: anchor.top + anchor.height / 2,
                    left: anchor.right + 12,
                  }
                : {
                    top: anchor.top - 8,
                    right: Math.max(12, window.innerWidth - anchor.right),
                  }),
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

function GroupChipsBar({
  selectedGroup,
  onSelectGroup,
  baseCount,
  groups,
}: {
  selectedGroup: string;
  onSelectGroup: (key: string) => void;
  baseCount: number;
  groups: { key: string; count: number; label: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0); // 0 to 1
  const [thumbRatio, setThumbRatio] = useState(0.3);
  const [showScrollbar, setShowScrollbar] = useState(false);

  const resetHideTimer = () => {
    setShowScrollbar(true);
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowScrollbar(false);
    }, 1000);
  };

  const handleMouseEnter = () => {
    resetHideTimer();
  };

  const handleMouseMove = () => {
    resetHideTimer();
  };

  const handleMouseLeave = () => {
    resetHideTimer();
  };

  const updateScrollState = () => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;

    const hasOverflow = maxScroll > 4;
    setIsScrollable(hasOverflow);
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);

    if (hasOverflow) {
      setScrollProgress(Math.max(0, Math.min(1, scrollLeft / maxScroll)));
      // Comfortable thumb size: between 18% and 45% of track width
      setThumbRatio(
        Math.max(0.18, Math.min(0.45, (clientWidth / scrollWidth) * 0.75)),
      );
    } else {
      setScrollProgress(0);
      setThumbRatio(1);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    updateScrollState();

    const handleScroll = () => {
      updateScrollState();
      resetHideTimer();
    };
    el.addEventListener("scroll", handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateScrollState());
      resizeObserver.observe(el);
      for (const child of el.children) {
        resizeObserver.observe(child);
      }
    }

    const handleResize = () => updateScrollState();
    window.addEventListener("resize", handleResize);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [groups, baseCount]);

  const scrollByAmount = (direction: -1 | 1) => {
    const el = containerRef.current;
    if (!el) return;
    const amount = Math.max(160, Math.floor(el.clientWidth * 0.6));
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
    resetHideTimer();
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const el = containerRef.current;
    if (!track || !el) return;
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const maxScroll = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: ratio * maxScroll, behavior: "smooth" });
    resetHideTimer();
  };

  return (
    <div
      className="group-chips-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="group-chips-scroll-area">
        <button
          type="button"
          className={`group-chips-arrow left ${showScrollbar && canScrollLeft ? "visible" : ""}`}
          onClick={() => scrollByAmount(-1)}
          tabIndex={showScrollbar && canScrollLeft ? 0 : -1}
          aria-label="Прокрутить фильтры влево"
        >
          <ChevronLeft size={16} />
        </button>

        <div
          className="group-chips"
          ref={containerRef}
          role="region"
          aria-label="Фильтры групп"
        >
          <button
            type="button"
            className={!selectedGroup ? "active" : ""}
            aria-pressed={!selectedGroup}
            onClick={() => onSelectGroup("")}
          >
            <FolderClosed size={15} />
            Все вакансии
            <span className="count-chip">{baseCount}</span>
          </button>
          {groups.map(({ key, count, label }) => (
            <button
              key={key}
              type="button"
              className={selectedGroup === key ? "active" : ""}
              aria-pressed={selectedGroup === key}
              onClick={() => onSelectGroup(key)}
            >
              <FolderClosed size={15} />
              {label}
              <span className="count-chip">{count}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`group-chips-arrow right ${showScrollbar && canScrollRight ? "visible" : ""}`}
          onClick={() => scrollByAmount(1)}
          tabIndex={showScrollbar && canScrollRight ? 0 : -1}
          aria-label="Прокрутить фильтры вправо"
        >
          <ChevronRight size={16} />
        </button>

        {isScrollable && (
          <div
            className={`group-chips-custom-scrollbar ${showScrollbar ? "visible" : ""}`}
            ref={trackRef}
            onClick={handleTrackClick}
          >
            <div
              className="group-chips-custom-thumb"
              style={{
                width: `${thumbRatio * 100}%`,
                left: `${scrollProgress * (1 - thumbRatio) * 100}%`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface SpotlightDropdownOption {
  value: string;
  label: string;
  icon?: typeof FolderClosed;
}

function SpotlightFilterDropdown({
  label,
  value,
  onChange,
  options,
  emptyLabel = "Все",
  icon: DefaultIcon,
  ariaLabel,
}: {
  label?: string;
  value: string;
  onChange: (val: string) => void;
  options: SpotlightDropdownOption[];
  emptyLabel?: string;
  icon?: typeof FolderClosed;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedOpt = options.find((o) => o.value === value);
  const displayLabel = selectedOpt ? selectedOpt.label : emptyLabel;
  const ActiveIcon = selectedOpt?.icon || DefaultIcon;

  return (
    <div
      className={`spotlight-dropdown-wrapper ${open ? "is-open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`group-dropdown-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        {ActiveIcon && (
          <ActiveIcon size={15} className="dropdown-trigger-icon" />
        )}
        <span className="dropdown-trigger-text">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`dropdown-chevron ${open ? "rotated" : ""}`}
        />
      </button>
      {open && (
        <div
          className="group-dropdown-menu"
          role="listbox"
          aria-label={ariaLabel}
        >
          <div className="group-dropdown-list">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`group-dropdown-item ${!value ? "selected" : ""}`}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {DefaultIcon && (
                <span className="item-icon-box">
                  <DefaultIcon size={15} />
                </span>
              )}
              <span className="item-label">{emptyLabel}</span>
              {!value && <Check size={14} className="item-check" />}
            </button>
            {options.map((opt) => {
              const isSelected = value === opt.value;
              const Icon = opt.icon || DefaultIcon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`group-dropdown-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {Icon && (
                    <span className="item-icon-box">
                      <Icon size={15} />
                    </span>
                  )}
                  <span className="item-label">{opt.label}</span>
                  {isSelected && <Check size={14} className="item-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Applications() {
  const { user, data, editApplication } = useApp();
  const [vacancyGroup, setVacancyGroup] = useState("");
  const vacancyGroups = Array.from(
    new Set(data.applications.flatMap((a) => a.groups ?? [])),
  ).sort((a, b) => a.localeCompare(b, "ru"));
  const [vacancyTag, setVacancyTag] = useState("");
  const vacancyTags = Array.from(
    new Set(data.applications.flatMap((a) => a.tags ?? [])),
  ).sort((a, b) => a.localeCompare(b, "ru"));
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [state, setState] = useState("");
  const [priority, setPriority] = useState("");
  const [hasTask, setHasTask] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [showModalFilters, setShowModalFilters] = useState(false);
  const preferencesKey = "avari-table:" + user.id;
  const [preferences, setPreferences] = useState<{
    group: string;
    cards: boolean;
    statistics: boolean;
  }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
      return {
        group: ["stage", "state", "group", "priority"].includes(stored?.group)
          ? stored.group
          : "",
        cards: stored?.cards === true,
        statistics: stored?.statistics !== false,
      };
    } catch {
      return { group: "", cards: false, statistics: true };
    }
  });
  const [selectedGroup, setSelectedGroup] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState("recent");
  const [page, setPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportFlyStyle, setExportFlyStyle] = useState<CSSProperties | null>(
    null,
  );
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!groupDropdownOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        groupDropdownRef.current &&
        !groupDropdownRef.current.contains(e.target as Node)
      ) {
        setGroupDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setGroupDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [groupDropdownOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch {
      /* View preferences are optional. */
    }
  }, [preferencesKey, preferences]);
  useEffect(() => {
    setPage(0);
    setCollapsed(new Set());
    setSelectedGroup("");
  }, [
    search,
    stage,
    state,
    priority,
    hasTask,
    order,
    preferences.group,
    vacancyGroup,
  ]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          // If already in input outside our modal, let standard behavior work unless wanted
        }
        e.preventDefault();
        setShowModalFilters(false);
        setFilterModalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const pf = data.fields.find((f) => f.role === "priority");

  const groupOptions: {
    value: string;
    label: string;
    icon: typeof FolderClosed;
  }[] = [
    { value: "", label: "Без группировки", icon: Layers },
    { value: "stage", label: "По этапу", icon: Target },
    { value: "state", label: "По состоянию", icon: Clock3 },
    { value: "group", label: "По группам", icon: FolderKanban },
    ...(pf
      ? [{ value: "priority", label: "По приоритету", icon: Sparkles }]
      : []),
  ];

  const currentGroupOption =
    groupOptions.find((opt) => opt.value === preferences.group) ??
    groupOptions[0];

  const next = (id: string) =>
    sortTasks(
      data.tasks.filter((t) => t.applicationId === id && t.state === "open"),
    )[0];
  const baseList = data.applications
    .filter(
      (a) =>
        (a.company + " " + a.position)
          .toLocaleLowerCase("ru")
          .includes(search.toLocaleLowerCase("ru")) &&
        (!vacancyGroup ||
          (vacancyGroup === "__ungrouped"
            ? !a.groups?.length
            : a.groups?.includes(vacancyGroup))) &&
        (!vacancyTag || a.tags?.includes(vacancyTag)) &&
        (!stage || a.stage === stage) &&
        (!state || a.state === state) &&
        (!priority || (pf && a.custom[pf.id] === priority)) &&
        (!hasTask || !!next(a.id)),
    )
    .sort((a, b) =>
      order === "company"
        ? a.company.localeCompare(b.company, "ru")
        : order === "task"
          ? (next(a.id)?.date ?? "9999").localeCompare(
              next(b.id)?.date ?? "9999",
            )
          : b.savedDate.localeCompare(a.savedDate) ||
            b.createdAt.localeCompare(a.createdAt),
    );
  const groupKey = (a: Application) =>
    preferences.group === "group"
      ? (a.groups?.[0] ?? "Без группы")
      : preferences.group === "priority"
        ? String(pf ? (a.custom[pf.id] ?? "Без приоритета") : "Без приоритета")
        : preferences.group === "state"
          ? a.state
          : a.stage;
  const groupCounts = new Map<string, number>();
  if (preferences.group)
    for (const application of baseList) {
      const key = groupKey(application);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
  const list = selectedGroup
    ? baseList.filter((a) => groupKey(a) === selectedGroup)
    : baseList;
  const pageCount = Math.max(1, Math.ceil(list.length / 20));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = list.slice(currentPage * 20, currentPage * 20 + 20);
  const grouped = preferences.group
    ? [
        ...visible.reduce((groups, a) => {
          const key = groupKey(a);
          groups.set(key, [...(groups.get(key) ?? []), a]);
          return groups;
        }, new Map<string, Application[]>()),
      ].sort(([a], [b]) =>
        preferences.group === "stage"
          ? Object.keys(stages).indexOf(a) - Object.keys(stages).indexOf(b)
          : preferences.group === "group"
            ? a === "Без группы"
              ? 1
              : b === "Без группы"
                ? -1
                : a.localeCompare(b, "ru")
            : a.localeCompare(b, "ru"),
      )
    : [["", visible] as [string, Application[]]];
  const groupLabel = (key: string) =>
    preferences.group === "stage"
      ? stages[key]
      : preferences.group === "state"
        ? states[key]
        : key;
  const toggle = (key: string) =>
    setCollapsed((previous) => {
      const updated = new Set(previous);
      updated.has(key) ? updated.delete(key) : updated.add(key);
      return updated;
    });
  const reset = () => {
    setVacancyGroup("");
    setVacancyTag("");
    setSearch("");
    setStage("");
    setState("");
    setPriority("");
    setHasTask(false);
    setSelectedGroup("");
  };
  const filterCount =
    (vacancyGroup ? 1 : 0) +
    (vacancyTag ? 1 : 0) +
    (stage ? 1 : 0) +
    (priority ? 1 : 0) +
    (hasTask ? 1 : 0) +
    (search ? 1 : 0);
  const activeFilters = !!(
    vacancyGroup ||
    vacancyTag ||
    search ||
    stage ||
    state ||
    priority ||
    hasTask ||
    selectedGroup
  );
  const active = list.filter((a) => a.state === "active").length;
  const advanced = list.filter((a) =>
    ["hr", "interview", "final", "offer"].includes(a.stage),
  ).length;
  const rate = list.length ? Math.round((advanced / list.length) * 100) : 0;
  const renderRow = (a: Application) => {
    const task = next(a.id);
    const site = a.url ? jobSite(a.url) : undefined;
    const siteLabel =
      site === "hh"
        ? "hh.ru"
        : site === "linkedin"
          ? "LinkedIn"
          : site === "getmatch"
            ? "Getmatch"
            : site === "hirify"
              ? "Hirify"
              : site === "geekjob"
                ? "Geekjob"
                : site === "habr"
                  ? "Хабр Карьера"
                  : "Вакансия";

    return (
      <tr
        key={a.id}
        className="application-data-row"
        style={
          {
            "--row-delay": `${Math.round(100 * (1 - Math.exp(-visible.findIndex((item) => item.id === a.id) / 3)))}ms`,
          } as CSSProperties
        }
      >
        <td>
          <div className="company-cell company-grid">
            <CompanyAvatar name={a.company} />
            <Link
              className="company-link"
              title={a.company}
              to={"/applications/" + a.id}
            >
              {a.company}
            </Link>
            <div className="position-sub" title={a.position}>
              {a.position}
            </div>
            <span className="company-salary" title={salaryLabel(a)}>
              {salaryLabel(a).split(" в ")[0].split(" за ")[0] || "—"}
            </span>
            {!!(a.groups?.length || a.tags?.length) && (
              <div className="company-taxonomy">
                {!!a.groups?.length && (
                  <span title={a.groups.join(" · ")}>
                    {a.groups.join(" · ")}
                  </span>
                )}
                {!!a.tags?.length && (
                  <span
                    className="company-tags"
                    title={a.tags.map(tagLabel).join(" ")}
                  >
                    {a.tags.map((t) => (
                      <span className={`tag-color-${tagColorIndex(t)}`} key={t}>
                        {tagLabel(t)}{" "}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>
        </td>
        <td>
          <Badge value={a.stage} />
        </td>
        <td className="date-cell">
          {dateLabel(a.appliedDate || a.savedDate)}
          <small>{a.appliedDate ? "Отклик" : "Сохранена"}</small>
        </td>
        <td className="next-task">
          {task ? (
            <>
              <span>{task.title}</span>
              <small>
                {dateLabel(task.date)} {task.time}
              </small>
            </>
          ) : (
            <span className="muted">Не запланировано</span>
          )}
        </td>
        <td>
          <Badge value={a.state} kind="state" />
        </td>
        <td>
          <div className="row-actions">
            <RowActionHint label="Открыть карточку отклика">
              <Link
                className="row-action-btn row-action-detail"
                to={"/applications/" + a.id}
                aria-label={"Открыть карточку: " + a.company}
              >
                <ArrowRight size={14} />
              </Link>
            </RowActionHint>
            {a.url && (
              <RowActionHint label={`Открыть вакансию на ${siteLabel}`}>
                <a
                  className={`row-action-btn row-action-site ${site ? `site-${site}` : ""}`}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Открыть вакансию на ${siteLabel}: ${a.company}`}
                >
                  <ExternalLink size={14} />
                </a>
              </RowActionHint>
            )}
          </div>
        </td>
      </tr>
    );
  };
  const renderCard = (a: Application) => {
    const task = next(a.id);
    return (
      <Link
        className="application-card"
        key={a.id}
        style={
          {
            "--row-delay": `${Math.round(100 * (1 - Math.exp(-visible.findIndex((item) => item.id === a.id) / 3)))}ms`,
          } as CSSProperties
        }
        to={"/applications/" + a.id}
      >
        <header>
          <div className="application-card-company">
            <CompanyAvatar name={a.company} />
            <strong title={a.company}>{a.company}</strong>
          </div>
          <Badge value={a.stage} />
        </header>
        <p className="application-card-position">{a.position}</p>
        <div className="application-card-salary">
          {salaryLabel(a) || "Зарплата не указана"}
        </div>
        <div className="application-card-location">
          {[a.location, a.workFormat].filter(Boolean).join(" · ") ||
            "Локация не указана"}
        </div>
        {!!(a.groups?.length || a.tags?.length) && (
          <div className="company-taxonomy">
            {!!a.groups?.length && (
              <span title={a.groups.join(" · ")}>{a.groups.join(" · ")}</span>
            )}
            {!!a.tags?.length && (
              <span
                className="company-tags"
                title={a.tags.map(tagLabel).join(" ")}
              >
                {a.tags.map((t) => (
                  <span className={`tag-color-${tagColorIndex(t)}`} key={t}>
                    {tagLabel(t)}{" "}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        <div className="application-card-task">
          <small>Ближайшее действие</small>
          <span>{task ? task.title : "Не запланировано"}</span>
          {task && (
            <small>
              {dateLabel(task.date)} {task.time}
            </small>
          )}
        </div>
        <footer>
          <Badge value={a.state} kind="state" />
          <span>
            {dateLabel(a.appliedDate || a.savedDate)} ·{" "}
            {a.appliedDate ? "Отклик" : "Сохранена"}
          </span>
          <ArrowUpRight size={15} />
        </footer>
      </Link>
    );
  };
  return (
    <>
      <PageHeader
        title="Отклики"
        subtitle={`${data.applications.length} вакансий · Все возможности в одном месте`}
      >
        <div className="table-view-buttons">
          <button
            className={preferences.cards ? "active icon-button" : "icon-button"}
            aria-label="Карточки откликов"
            aria-pressed={preferences.cards}
            data-tooltip={
              preferences.cards ? "Показать таблицу" : "Показать карточки"
            }
            onClick={() =>
              setPreferences({ ...preferences, cards: !preferences.cards })
            }
          >
            <LayoutGrid size={17} />
          </button>
          <button
            className={
              preferences.statistics ? "active icon-button" : "icon-button"
            }
            aria-label="Статистика справа"
            aria-pressed={preferences.statistics}
            data-tooltip="Статистика справа"
            onClick={() =>
              setPreferences({
                ...preferences,
                statistics: !preferences.statistics,
              })
            }
          >
            <PanelRight size={17} />
          </button>
          <button
            ref={exportBtnRef}
            className={`icon-button ${isExporting ? "exporting" : ""}`}
            aria-label="Экспорт в CSV"
            data-tooltip={`Экспорт в CSV (${list.length})`}
            onClick={() => {
              if (isExporting) return;
              if (exportBtnRef.current) {
                const rect = exportBtnRef.current.getBoundingClientRect();
                setExportFlyStyle({
                  top: `${rect.top}px`,
                  left: `${rect.left}px`,
                });
                setIsExporting(true);
                setTimeout(() => {
                  setIsExporting(false);
                  setExportFlyStyle(null);
                }, 850);
              }
              const csv = exportApplicationsToCSV(
                list,
                data.fields,
                data.tasks,
              );
              downloadCSV(csv, `avari-applications-${dateToday()}.csv`);
            }}
            disabled={list.length === 0}
          >
            <Download size={17} />
          </button>
        </div>
        {isExporting && exportFlyStyle && (
          <div
            className="flying-file-icon"
            style={exportFlyStyle}
            aria-hidden="true"
          >
            <FileSpreadsheet size={22} />
          </div>
        )}
        <button
          className="primary water-interaction"
          onClick={() => editApplication()}
        >
          <Plus size={17} />
          Добавить
        </button>
      </PageHeader>
      <div className="group-navigation" aria-label="Группы откликов">
        <div className="group-mode" ref={groupDropdownRef}>
          <button
            type="button"
            className={`group-dropdown-trigger ${groupDropdownOpen ? "open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={groupDropdownOpen}
            aria-label="Группировка"
            onClick={() => setGroupDropdownOpen((prev) => !prev)}
          >
            <currentGroupOption.icon
              size={16}
              className="dropdown-trigger-icon"
            />
            <span className="dropdown-trigger-text">
              {currentGroupOption.label}
            </span>
            <ChevronDown
              size={15}
              className={`dropdown-chevron ${groupDropdownOpen ? "rotated" : ""}`}
            />
          </button>
          {groupDropdownOpen && (
            <div
              className="group-dropdown-menu"
              role="listbox"
              aria-label="Выбор группировки"
            >
              <div className="group-dropdown-list">
                {groupOptions.map((opt) => {
                  const isSelected = preferences.group === opt.value;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`group-dropdown-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setPreferences({ ...preferences, group: opt.value });
                        setGroupDropdownOpen(false);
                      }}
                    >
                      <span className="item-icon-box">
                        <Icon size={16} />
                      </span>
                      <span className="item-label">{opt.label}</span>
                      {isSelected && <Check size={15} className="item-check" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <GroupChipsBar
          selectedGroup={selectedGroup}
          onSelectGroup={(key) => {
            setSelectedGroup(key);
            setPage(0);
            if (key) {
              setCollapsed(new Set());
            }
          }}
          baseCount={baseList.length}
          groups={[...groupCounts].map(([key, count]) => ({
            key,
            count,
            label: groupLabel(key),
          }))}
        />
      </div>
      <div
        className={
          "applications-layout " +
          (preferences.statistics ? "with-statistics" : "")
        }
      >
        <section
          className={
            "application-register panel " +
            (preferences.cards ? "card-view compact-rows" : "compact-rows")
          }
        >
          <div className="register-tabs-row">
            <div className="register-tabs" aria-label="Состояние откликов">
              {[["", "Все отклики"], ...Object.entries(states)].map(
                ([key, label]) => (
                  <button
                    key={key}
                    className={state === key ? "active" : ""}
                    onClick={() => setState(key)}
                  >
                    {label}
                    <span className="count-chip">
                      {
                        data.applications.filter((a) => !key || a.state === key)
                          .length
                      }
                    </span>
                  </button>
                ),
              )}
            </div>
            <div className="register-toolbar-actions">
              {activeFilters && (
                <div className="register-filter-status">
                  <span className="register-filter-count">
                    Найдено: <strong>{list.length}</strong>
                  </span>
                  <button
                    type="button"
                    className="text-button register-filter-reset"
                    onClick={reset}
                    title="Сбросить все фильтры"
                  >
                    <X size={13} />
                    Сбросить
                  </button>
                </div>
              )}
              <button
                type="button"
                className={
                  "register-filter-trigger" + (activeFilters ? " active" : "")
                }
                onClick={() => {
                  setShowModalFilters(false);
                  setFilterModalOpen(true);
                }}
                aria-label="Поиск и фильтры"
                title="Поиск и фильтры (⌘K / Ctrl+K)"
              >
                <Search size={15} />
                <span className="trigger-label">
                  {search ? `«${search}»` : "Поиск и фильтры"}
                </span>
                {filterCount > 0 && (
                  <span className="filter-badge-chip">{filterCount}</span>
                )}
                <span className="shortcut-hint">
                  <kbd>
                    {navigator.platform.toUpperCase().includes("MAC")
                      ? "⌘"
                      : "Ctrl"}
                  </kbd>
                  <kbd>K</kbd>
                </span>
              </button>
            </div>
          </div>
          {filterModalOpen && (
            <dialog
              ref={(node) => {
                if (node && !node.open) {
                  node.showModal();
                }
              }}
              className="modal spotlight-modal"
              onCancel={() => setFilterModalOpen(false)}
              onClick={(e) => {
                if (e.target === e.currentTarget) setFilterModalOpen(false);
              }}
            >
              <FilterModalMotion>
                <div className="spotlight-bar">
                  <Search size={20} className="spotlight-icon" />
                  <input
                    autoFocus
                    type="text"
                    className="spotlight-input"
                    aria-label="Поиск по компании и позиции"
                    placeholder="Поиск по компании или позиции…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        setShowModalFilters((prev) => !prev);
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        setFilterModalOpen(false);
                      } else if (e.key === "Escape") {
                        setFilterModalOpen(false);
                      }
                    }}
                  />
                  {search && (
                    <button
                      type="button"
                      className="icon-button spotlight-clear"
                      onClick={() => setSearch("")}
                      aria-label="Очистить поисковый запрос"
                      title="Очистить"
                    >
                      <X size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={
                      "spotlight-toggle-filters" +
                      (showModalFilters ? " active" : "") +
                      (filterCount > 0 ? " has-filters" : "")
                    }
                    onClick={() => setShowModalFilters((prev) => !prev)}
                    title={
                      showModalFilters
                        ? "Скрыть фильтры (Tab)"
                        : "Показать фильтры (Tab)"
                    }
                    aria-label="Переключить отображение фильтров"
                    aria-expanded={showModalFilters}
                  >
                    <SlidersHorizontal size={15} />
                    <span className="toggle-label">Фильтры</span>
                    {filterCount > 0 && (
                      <span className="filter-badge-chip">{filterCount}</span>
                    )}
                    <kbd className="key-hint">Tab</kbd>
                  </button>
                  <button
                    type="button"
                    className="icon-button spotlight-close"
                    onClick={() => setFilterModalOpen(false)}
                    aria-label="Закрыть"
                    title="Закрыть (Esc)"
                  >
                    <X size={18} />
                  </button>
                </div>

                <FilterPresence show={showModalFilters} block>
                  <div className="spotlight-drawer">
                    <div className="spotlight-filters-grid">
                      <div className="spotlight-field">
                        <label>Группа вакансий</label>
                        <SpotlightFilterDropdown
                          ariaLabel="Фильтр по группе вакансий"
                          value={vacancyGroup}
                          onChange={setVacancyGroup}
                          emptyLabel="Все группы"
                          icon={FolderKanban}
                          options={[
                            { value: "__ungrouped", label: "Без группы" },
                            ...vacancyGroups.map((g) => ({
                              value: g,
                              label: g,
                            })),
                          ]}
                        />
                      </div>
                      <div className="spotlight-field">
                        <label>Тег</label>
                        <SpotlightFilterDropdown
                          ariaLabel="Фильтр по тегу"
                          value={vacancyTag}
                          onChange={setVacancyTag}
                          emptyLabel="Все теги"
                          icon={Tag}
                          options={vacancyTags.map((t) => ({
                            value: t,
                            label: t,
                          }))}
                        />
                      </div>
                      <div className="spotlight-field">
                        <label htmlFor="filter-stage-select">Этап отбора</label>
                        <Select
                          id="filter-stage-select"
                          value={stage}
                          onChange={setStage}
                          items={stages}
                          empty="Все этапы"
                        />
                      </div>
                      {pf && (
                        <div className="spotlight-field">
                          <label>Приоритет</label>
                          <SpotlightFilterDropdown
                            ariaLabel="Фильтр по приоритету"
                            value={priority}
                            onChange={setPriority}
                            emptyLabel="Любой приоритет"
                            icon={Sparkles}
                            options={pf.options.map((p) => ({
                              value: p,
                              label: p,
                            }))}
                          />
                        </div>
                      )}
                      <div className="spotlight-field spotlight-sort-field">
                        <label>Сортировка</label>
                        <SpotlightFilterDropdown
                          ariaLabel="Сортировка вакансий"
                          value={order}
                          onChange={(val) => setOrder(val || "recent")}
                          emptyLabel="Сначала новые"
                          icon={ArrowUpDown}
                          options={[
                            { value: "recent", label: "Сначала новые" },
                            { value: "company", label: "По компании" },
                            { value: "task", label: "По ближайшей задаче" },
                          ]}
                        />
                      </div>
                      <div className="spotlight-field">
                        <label htmlFor="filter-has-task">Задачи</label>
                        <label className="spotlight-checkbox">
                          <input
                            id="filter-has-task"
                            type="checkbox"
                            checked={hasTask}
                            onChange={(e) => setHasTask(e.target.checked)}
                          />
                          <span
                            className="spotlight-checkbox-mark"
                            aria-hidden="true"
                          >
                            <Check size={13} strokeWidth={3} />
                          </span>
                          <span>Только с запланированными задачами</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </FilterPresence>

                <FilterPresence show={filterCount > 0} block>
                  <div className="spotlight-active-tags">
                    <span className="spotlight-tags-label">
                      Активные фильтры:
                    </span>
                    <FilterPresence show={Boolean(search)}>
                      <span className="filter-summary-tag">
                        Поиск: «{search}»
                        <button
                          type="button"
                          aria-label="Очистить поиск"
                          onClick={() => setSearch("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(vacancyGroup)}>
                      <span className="filter-summary-tag">
                        {vacancyGroup === "__ungrouped"
                          ? "Без группы"
                          : vacancyGroup}
                        <button
                          type="button"
                          aria-label="Сбросить группу"
                          onClick={() => setVacancyGroup("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(vacancyTag)}>
                      <span className="filter-summary-tag">
                        Тег: {vacancyTag}
                        <button
                          type="button"
                          aria-label="Сбросить тег"
                          onClick={() => setVacancyTag("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(stage)}>
                      <span className="filter-summary-tag">
                        Этап: {stages[stage] || stage}
                        <button
                          type="button"
                          aria-label="Сбросить этап"
                          onClick={() => setStage("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(priority)}>
                      <span className="filter-summary-tag">
                        Приоритет: {priority}
                        <button
                          type="button"
                          aria-label="Сбросить приоритет"
                          onClick={() => setPriority("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(hasTask)}>
                      <span className="filter-summary-tag">
                        С задачами
                        <button
                          type="button"
                          aria-label="Сбросить фильтр задач"
                          onClick={() => setHasTask(false)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                  </div>
                </FilterPresence>

                <div className="spotlight-footer">
                  <div className="spotlight-hints">
                    <span>
                      Найдено вакансий: <strong>{list.length}</strong>
                    </span>
                    <span className="spotlight-sep">·</span>
                    <span className="hint-keys">
                      <kbd>Tab</kbd> фильтры
                    </span>
                    <span className="hint-keys">
                      <kbd>↵</kbd> применить
                    </span>
                    <span className="hint-keys">
                      <kbd>Esc</kbd> закрыть
                    </span>
                  </div>
                  <div className="spotlight-actions">
                    {activeFilters && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={reset}
                      >
                        <X size={13} />
                        Сбросить всё
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setFilterModalOpen(false)}
                    >
                      Готово
                    </button>
                  </div>
                </div>
              </FilterModalMotion>
            </dialog>
          )}
          {!data.applications.length ? (
            <Empty
              title={
                data.applications.length
                  ? "Ничего не найдено"
                  : "Первый шаг — сохранить вакансию"
              }
              action={
                data.applications.length ? (
                  <button onClick={reset}>Сбросить фильтры</button>
                ) : (
                  <button
                    className="primary water-interaction"
                    onClick={() => editApplication()}
                  >
                    Добавить вакансию
                  </button>
                )
              }
            >
              {data.applications.length
                ? "Попробуйте изменить поиск или фильтры."
                : "Добавьте её вручную или воспользуйтесь расширением для " +
                  jobSitesLabel +
                  "."}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table-page-layer">
                  <colgroup>
                    <col style={{ width: "33%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "21%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "10%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Компания и позиция</th>
                      <th>Этап</th>
                      <th>Дата</th>
                      <th>Ближайшее действие</th>
                      <th>Состояние</th>
                      <th>
                        <span className="sr-only">Открыть</span>
                      </th>
                    </tr>
                  </thead>
                  <TableRowsMotion
                    key={String(preferences.cards)}
                    transitionKey={JSON.stringify([
                      currentPage,
                      state,
                      stage,
                      priority,
                      order,
                      selectedGroup,
                      search,
                      hasTask,
                      vacancyGroup,
                      vacancyTag,
                      preferences.group,
                    ])}
                  >
                    {!list.length && (
                      <tr>
                        <td colSpan={6}>
                          <Empty
                            title="Ничего не найдено"
                            action={
                              <button onClick={reset}>Сбросить фильтры</button>
                            }
                          >
                            Попробуйте изменить поиск или фильтры.
                          </Empty>
                        </td>
                      </tr>
                    )}
                    {grouped.map(([key, apps]) => {
                      const isCollapsed = collapsed.has(key);
                      return (
                        <Fragment key={key}>
                          {preferences.group && (
                            <tr className="group-row">
                              <td colSpan={6}>
                                <button
                                  aria-expanded={!isCollapsed}
                                  onClick={() => toggle(key)}
                                >
                                  <ChevronDown
                                    size={15}
                                    className={isCollapsed ? "collapsed" : ""}
                                  />
                                  {groupLabel(key)}
                                  <span className="count-chip">
                                    {apps.length}
                                  </span>
                                </button>
                              </td>
                            </tr>
                          )}
                          {preferences.group ? (
                            <tr className="group-collapsible-row">
                              <td colSpan={6}>
                                <div
                                  className={
                                    "group-collapsible-wrapper" +
                                    (isCollapsed ? " collapsed" : "")
                                  }
                                >
                                  <div className="group-collapsible-inner">
                                    <table>
                                      <colgroup>
                                        <col style={{ width: "33%" }} />
                                        <col style={{ width: "13%" }} />
                                        <col style={{ width: "12%" }} />
                                        <col style={{ width: "21%" }} />
                                        <col style={{ width: "11%" }} />
                                        <col style={{ width: "10%" }} />
                                      </colgroup>
                                      <tbody>{apps.map(renderRow)}</tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            apps.map(renderRow)
                          )}
                        </Fragment>
                      );
                    })}
                  </TableRowsMotion>
                </table>
              </div>
              <TableRowsMotion
                cards
                key={String(preferences.cards)}
                transitionKey={JSON.stringify([
                  currentPage,
                  state,
                  stage,
                  priority,
                  order,
                  selectedGroup,
                  search,
                  hasTask,
                  vacancyGroup,
                  vacancyTag,
                  preferences.group,
                ])}
              >
                {!list.length && (
                  <Empty
                    title="Ничего не найдено"
                    action={<button onClick={reset}>Сбросить фильтры</button>}
                  >
                    Попробуйте изменить поиск или фильтры.
                  </Empty>
                )}
                {grouped.map(([key, apps]) => {
                  const isCollapsed = collapsed.has(key);
                  return (
                    <Fragment key={key}>
                      {preferences.group && (
                        <button
                          className="mobile-group"
                          aria-expanded={!isCollapsed}
                          onClick={() => toggle(key)}
                        >
                          <ChevronDown
                            size={15}
                            className={isCollapsed ? "collapsed" : ""}
                          />
                          {groupLabel(key)}
                          <span className="count-chip">{apps.length}</span>
                        </button>
                      )}
                      {preferences.group ? (
                        <div
                          className={
                            "mobile-group-collapsible" +
                            (isCollapsed ? " collapsed" : "")
                          }
                        >
                          <div className="group-collapsible-inner">
                            {apps.map(renderCard)}
                          </div>
                        </div>
                      ) : (
                        apps.map(renderCard)
                      )}
                    </Fragment>
                  );
                })}
              </TableRowsMotion>
              <div className="table-pagination">
                <small>
                  {currentPage * 20 + 1}–
                  {Math.min(list.length, currentPage * 20 + 20)} из{" "}
                  {list.length}
                </small>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Предыдущая страница"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: pageCount }, (_, index) => index)
                    .filter(
                      (index) =>
                        index === 0 ||
                        index === pageCount - 1 ||
                        Math.abs(index - currentPage) <= 1,
                    )
                    .map((index, offset, pages) => (
                      <Fragment key={index}>
                        {offset > 0 && index - pages[offset - 1] > 1 && (
                          <span
                            className="pagination-ellipsis"
                            aria-hidden="true"
                          >
                            …
                          </span>
                        )}
                        <button
                          className={
                            index === currentPage
                              ? "page-number active"
                              : "page-number"
                          }
                          aria-label={"Страница " + (index + 1)}
                          aria-current={
                            index === currentPage ? "page" : undefined
                          }
                          onClick={() => setPage(index)}
                        >
                          {index + 1}
                        </button>
                      </Fragment>
                    ))}
                  <span className="sr-only" role="status">
                    {currentPage + 1} / {pageCount}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Следующая страница"
                    disabled={currentPage + 1 === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        <div
          className={
            "application-statistics-wrapper" +
            (preferences.statistics ? " is-open" : "")
          }
          aria-hidden={!preferences.statistics}
        >
          <aside className="application-statistics">
            <section className="panel">
              <span className="eyebrow">Текущая выборка</span>
              <h2>Статистика</h2>
              <div className="summary-total">
                <strong>{list.length}</strong>
                <span>
                  вакансий
                  <br />
                  <small>{active} активных</small>
                </span>
              </div>
              <StageBreakdown applications={list} />
            </section>
            <section className="panel response-panel">
              <h3>Продвижение по этапам</h3>
              <div
                className="progress-ring"
                style={{ "--progress": `${rate * 3.6}deg` } as CSSProperties}
              >
                <div>
                  <strong>{rate}%</strong>
                  <small>дошли до HR и дальше</small>
                </div>
              </div>
              <p>
                {advanced} из {list.length} вакансий на этапах HR, интервью,
                финала или оффера.
              </p>
            </section>
            <section className="panel">
              <span className="metric-icon">
                <Clock3 size={20} />
              </span>
              <h3>Следующий шаг</h3>
              <p className="muted">
                Без открытых задач:{" "}
                {pluralApplications(
                  list.filter((a) => a.state === "active" && !next(a.id))
                    .length,
                  "активный",
                )}
                .
              </p>
              <button
                className="text-button"
                onClick={() => {
                  setHasTask(true);
                  setState("active");
                }}
              >
                Посмотреть запланированные <ArrowUpRight size={14} />
              </button>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
function ApplicationDetail() {
  const { id } = useParams();
  const { data, refresh, editTask, addNote } = useApp();
  const [editing, setEditing] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagEditorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tagDropdownOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!tagEditorRef.current?.contains(event.target as Node))
        setTagDropdownOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTagDropdownOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tagDropdownOpen]);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState<unknown>();
  const q = useQuery({
    queryKey: ["detail", id],
    queryFn: () => api<Detail>("/applications/" + id),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const a = d.application;
  const saveTags = async (tags: string[]) => {
    setTagBusy(true);
    setTagError(undefined);
    try {
      await api<Application>("/applications/" + a.id, "PUT", { ...a, tags });
      setNewTag("");
      setTagDropdownOpen(false);
      await refresh();
      await q.refetch();
    } catch (error) {
      setTagError(error);
    } finally {
      setTagBusy(false);
    }
  };
  const tag = newTag.trim();
  const canAddTag =
    !!tag &&
    (a.tags ?? []).length < 30 &&
    !(a.tags ?? []).some(
      (t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase(),
    );
  const tagOptions = Array.from(
    new Set(data.applications.flatMap((v) => v.tags ?? [])),
  )
    .filter(
      (t) =>
        !(a.tags ?? []).some(
          (existing) => existing.toLocaleLowerCase() === t.toLocaleLowerCase(),
        ),
    )
    .filter((t) => t.toLocaleLowerCase().includes(tag.toLocaleLowerCase()));
  let vacancySiteLabel = "Вакансия";
  let vacancyFavicon: string | undefined;
  if (a.url) {
    try {
      const url = new URL(a.url);
      const site = jobSite(a.url);
      vacancySiteLabel = site
        ? {
            hh: "hh.ru",
            linkedin: "LinkedIn",
            getmatch: "Getmatch",
            hirify: "Hirify",
            geekjob: "Geekjob",
            habr: "Хабр Карьера",
          }[site]
        : url.hostname.replace(/^www\./, "");
      if (["https:", "http:"].includes(url.protocol))
        vacancyFavicon = `${url.origin}/favicon.ico`;
    } catch {}
  }
  const facts: Record<string, unknown> = {
    salary: salaryLabel(a),
    location: a.location,
    workFormat: a.workFormat,
    recruiter: a.recruiter,
    savedDate: dateLabel(a.savedDate),
    appliedDate: dateLabel(a.appliedDate),
    externalStatus: a.externalStatus,
    outcome: a.outcome,
  };
  return (
    <>
      <Link className="back-link" to="/applications">
        <ArrowLeft size={15} />
        Все отклики
      </Link>
      <PageHeader title={a.company} subtitle={a.position} />
      <div className="detail-meta-row">
        <div className="detail-badges">
          {(a.groups ?? []).map((group) => (
            <span className="count-chip" key={group}>
              {group}
            </span>
          ))}
          <Badge value={a.stage} />
          <Badge value={a.state} kind="state" />
          {a.url && (
            <a
              className="detail-vacancy-link"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {vacancyFavicon && (
                <img
                  src={vacancyFavicon}
                  alt=""
                  width={16}
                  height={16}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}
              Вакансия на {vacancySiteLabel} <ExternalLink size={13} />
            </a>
          )}
        </div>
        <section className="detail-tags" aria-label="Теги вакансии">
          <label htmlFor="detail-tag-input">Теги</label>
          <div
            className={`tag-editor-box${tagBusy ? " is-busy" : ""}`}
            ref={tagEditorRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setTagDropdownOpen(false);
            }}
            onClick={(e) => {
              // Focus the input when clicking anywhere inside the box except on buttons
              if (
                (e.target as HTMLElement).tagName !== "BUTTON" &&
                (e.target as HTMLElement).closest("button") === null
              ) {
                document.getElementById("detail-tag-input")?.focus();
              }
            }}
          >
            {(a.tags ?? []).map((t) => (
              <span
                className={`tag-chip tag-color-${tagColorIndex(t)}`}
                key={t}
              >
                {tagLabel(t)}
                <button
                  type="button"
                  className="tag-chip-remove"
                  aria-label={`Удалить тег ${t}`}
                  disabled={tagBusy || editing}
                  onClick={(e) => {
                    e.stopPropagation();
                    void saveTags((a.tags ?? []).filter((v) => v !== t));
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              id="detail-tag-input"
              role="combobox"
              aria-expanded={tagDropdownOpen}
              aria-controls="detail-tag-options"
              aria-autocomplete="list"
              onFocus={() => setTagDropdownOpen(true)}
              placeholder={
                (a.tags ?? []).length === 0 ? "Добавить тег…" : "Добавить…"
              }
              maxLength={100}
              value={newTag}
              disabled={tagBusy || editing}
              onChange={(e) => {
                setNewTag(e.target.value);
                setTagDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setTagDropdownOpen(true);
                  requestAnimationFrame(() =>
                    tagEditorRef.current
                      ?.querySelector<HTMLButtonElement>(".group-dropdown-item")
                      ?.focus(),
                  );
                } else if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  if (canAddTag && !tagBusy && !editing) {
                    void saveTags([...(a.tags ?? []), tag]);
                  }
                } else if (
                  e.key === "Backspace" &&
                  !newTag &&
                  (a.tags ?? []).length > 0 &&
                  !tagBusy &&
                  !editing
                ) {
                  // If input is empty, backspace removes the last tag
                  const currentTags = a.tags ?? [];
                  void saveTags(currentTags.slice(0, -1));
                }
              }}
            />
            <button
              type="button"
              className="tag-dropdown-toggle"
              aria-label="Показать теги"
              aria-haspopup="listbox"
              aria-expanded={tagDropdownOpen}
              aria-controls="detail-tag-options"
              disabled={tagBusy || editing}
              onClick={() => setTagDropdownOpen((open) => !open)}
            >
              <ChevronDown
                size={14}
                className={`dropdown-chevron${tagDropdownOpen ? " rotated" : ""}`}
              />
            </button>
            {tagDropdownOpen && !tagBusy && !editing && (
              <div
                className="group-dropdown-menu"
                id="detail-tag-options"
                role="listbox"
                aria-label="Доступные теги"
              >
                <div
                  className="group-dropdown-list"
                  onKeyDown={(event) => {
                    const buttons = Array.from(
                      event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        "button",
                      ),
                    );
                    const index = buttons.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      buttons[
                        (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                          buttons.length
                      ]?.focus();
                    }
                  }}
                >
                  {tagOptions.map((t) => (
                    <button
                      type="button"
                      className="group-dropdown-item"
                      role="option"
                      aria-selected={false}
                      disabled={(a.tags ?? []).length >= 30}
                      key={t}
                      onClick={() => void saveTags([...(a.tags ?? []), t])}
                    >
                      <Tag size={14} />
                      {tagLabel(t)}
                    </button>
                  ))}
                  {canAddTag &&
                    !tagOptions.some(
                      (t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase(),
                    ) && (
                      <button
                        type="button"
                        className="group-dropdown-item"
                        role="option"
                        aria-selected={false}
                        onClick={() => void saveTags([...(a.tags ?? []), tag])}
                      >
                        <Plus size={14} />
                        Добавить «{tag}»
                      </button>
                    )}
                  {!tagOptions.length && !canAddTag && (
                    <span className="tag-dropdown-empty">
                      {tag ? "Нет подходящих тегов" : "Введите новый тег"}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <ErrorBox error={tagError} />
        </section>
      </div>
      <div className="detail-grid" style={{ marginTop: 24 }}>
        <div>
          <section className="panel">
            <div className="section-head">
              <h2>О вакансии</h2>
              {!editing && (
                <button onClick={() => setEditing(true)}>
                  <Pencil size={15} />
                  Редактировать
                </button>
              )}
            </div>
            <div
              className="detail-editor-transition"
              key={editing ? "edit" : "view"}
            >
              {editing ? (
                <ApplicationForm
                  initial={a}
                  fields={data.fields}
                  groupOptions={Array.from(
                    new Set(data.applications.flatMap((v) => v.groups ?? [])),
                  )}
                  tagOptions={Array.from(
                    new Set(data.applications.flatMap((v) => v.tags ?? [])),
                  )}
                  api={api}
                  actionsAtTop
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    void refresh();
                    void q.refetch();
                  }}
                />
              ) : (
                <dl className="facts">
                  {Object.entries(facts).map(([key, value]) => (
                    <div className="fact" key={key}>
                      <dt>{fieldLabels[key]}</dt>
                      <dd>{displayValue(key, value)}</dd>
                    </div>
                  ))}
                  {data.fields.map((f) => (
                    <div className="fact" key={f.id}>
                      <dt>{f.name}</dt>
                      <dd>{displayValue("custom", a.custom[f.id])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>История</h2>
              {d.events.length > 2 && (
                <button
                  aria-expanded={historyExpanded}
                  onClick={() => setHistoryExpanded((v) => !v)}
                >
                  {historyExpanded
                    ? "Свернуть"
                    : `Показать всю (${d.events.length})`}
                  <ChevronDown
                    size={15}
                    style={{
                      transform: historyExpanded ? "rotate(180deg)" : undefined,
                    }}
                  />
                </button>
              )}
            </div>
            <div className="history">
              {(historyExpanded ? d.events : d.events.slice(0, 2)).map((e) => (
                <article className="history-event" key={e.id}>
                  <strong>
                    {{
                      created: "Вакансия добавлена",
                      updated: "Запись обновлена",
                      task: "Изменение задачи",
                      note: "Добавлена заметка",
                      note_updated: "Заметка отредактирована",
                      proposal: "Применено предложение",
                    }[e.kind] ?? e.kind}
                  </strong>
                  <br />
                  <small>
                    {dateLabel(e.createdAt, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {e.source === "extension" ? "Расширение" : "Вручную"}
                  </small>
                  {Object.entries(e.changes)
                    .filter(([k]) => k !== "noteId")
                    .map(([k, v]) => (
                      <div className="history-diff" key={k}>
                        {fieldLabels[k] ?? k}:{" "}
                        {displayValue(
                          k,
                          v.before,
                          data.fields,
                          data.applications,
                        )}{" "}
                        →{" "}
                        {displayValue(
                          k,
                          v.after,
                          data.fields,
                          data.applications,
                        )}
                      </div>
                    ))}
                </article>
              ))}
            </div>
          </section>
        </div>
        <div>
          {d.proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              application={a}
              api={api}
              onResolved={refresh}
            />
          ))}
          <section className="panel">
            <div className="section-head">
              <h2>Заметки</h2>
              <button onClick={() => addNote(a.id)}>
                <Plus size={15} />
                Заметка
              </button>
            </div>
            {d.notes.length ? (
              d.notes.map((n) => (
                <article className="note" key={n.id}>
                  <p>{n.text}</p>
                  <small>
                    {dateLabel(n.createdAt, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                  <button
                    className="text-button"
                    aria-label="Редактировать заметку"
                    onClick={() => addNote(a.id, n)}
                  >
                    <Pencil size={14} />
                    Изменить
                  </button>
                </article>
              ))
            ) : (
              <p className="muted">
                Контекст встречи, впечатления и вопросы — всё можно записать
                здесь.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>Следующие действия</h2>
              <button
                className="icon-button"
                aria-label="Добавить задачу"
                onClick={() => editTask({ applicationId: a.id })}
              >
                <Plus size={18} />
              </button>
            </div>
            {d.tasks.length ? (
              <TaskList
                tasks={d.tasks}
                applications={data.applications}
                api={api}
                onChanged={refresh}
                onEdit={editTask}
              />
            ) : (
              <p className="muted">Запланируйте следующий шаг.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
function salaryLabel(a: Application) {
  const s = a.salary;
  if (s.min === null && s.max === null) return "";
  const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  return (
    (s.min !== null && s.max !== null
      ? number(s.min) + "–" + number(s.max)
      : s.min !== null
        ? "от " + number(s.min)
        : "до " + number(s.max!)) +
    " " +
    s.currency +
    " " +
    ({ month: "в месяц", year: "в год", hour: "в час", project: "за проект" }[
      s.period
    ] ?? "") +
    " " +
    ({ gross: "до налогов", net: "на руки" }[s.tax] ?? "")
  );
}
function Proposals() {
  const { data, refresh } = useApp();
  const proposals = data.proposals.filter((p) => p.status === "pending");
  return (
    <>
      <PageHeader
        title="Предложения"
        subtitle="Вы решаете, какие изменения попадут в журнал"
      />
      {proposals.length ? (
        <div className="proposals-grid">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              application={data.applications.find(
                (a) => a.id === p.applicationId,
              )}
              api={api}
              onResolved={refresh}
            />
          ))}
        </div>
      ) : (
        <Empty title="Всё актуально">
          Здесь появятся изменения, обнаруженные расширением на поддерживаемых
          сайтах. Каждое из них требует вашего подтверждения.
        </Empty>
      )}
    </>
  );
}
function CalendarSubscriptionPanel() {
  const client = useQueryClient();
  const subscription = useQuery({
    queryKey: ["calendar-subscription"],
    queryFn: () => api<CalendarSubscription>("/calendar/subscription"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"PUT" | "DELETE" | null>(null);
  const url = subscription.data?.url ?? "";
  const change = async (method: "POST" | "PUT" | "DELETE") => {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const result = await api<CalendarSubscription>(
        "/calendar/subscription",
        method,
        {},
      );
      client.setQueryData(["calendar-subscription"], result);
      setConfirm(null);
      setNotice(
        method === "DELETE"
          ? "Подписка отключена. Старая ссылка больше не работает."
          : method === "PUT"
            ? "Ссылка изменена. Добавьте новую ссылку в ваш календарь."
            : "Ссылка готова. Добавьте её в ваш календарь.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form calendar-subscription">
      <p className="muted">
        Открытые задачи и интервью в вашем календаре Apple, Google или Яндекс.
        Переносы и изменения обновляются автоматически, выполненные задачи
        исчезают.
      </p>
      <ErrorBox
        error={error ?? subscription.error}
        retry={subscription.error ? () => subscription.refetch() : undefined}
      />
      {notice && (
        <div className="success notice" role="status">
          {notice}
        </div>
      )}
      {subscription.isPending ? (
        <Loading />
      ) : (
        subscription.data &&
        (url ? (
          <>
            <FieldInput
              label="Личная ссылка календаря"
              hint="Ссылка даёт доступ к вашим событиям. Передавайте её только своему календарному сервису."
            >
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
              />
            </FieldInput>
            <div className="actions">
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setNotice("Ссылка скопирована");
                    setError(undefined);
                  } catch {
                    setError(
                      new Error(
                        "Не удалось скопировать. Выделите ссылку и скопируйте её вручную.",
                      ),
                    );
                  }
                }}
              >
                Скопировать ссылку
              </button>
              <a
                className="button"
                href={url.replace(/^https?:/, "webcal:")}
                rel="noreferrer"
              >
                Apple Календарь <ExternalLink size={14} />
              </a>
              <a
                className="button"
                href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
                target="_blank"
                rel="noreferrer"
              >
                Google Календарь <ExternalLink size={14} />
              </a>
              <a
                className="button"
                href="https://calendar.yandex.ru/"
                target="_blank"
                rel="noreferrer"
              >
                Яндекс Календарь <ExternalLink size={14} />
              </a>
            </div>
            <details className="calendar-help">
              <summary>Как подключить календарь</summary>
              <p>
                <strong>Apple:</strong> нажмите кнопку выше или выберите
                «Добавить подписной календарь» в приложении и вставьте ссылку.
              </p>
              <p>
                <strong>Google:</strong> откройте календарь в браузере на
                компьютере, выберите «Другие календари» → «Добавить по URL» и
                вставьте ссылку.
              </p>
              <p>
                <strong>Яндекс:</strong> в разделе «Подписки» нажмите «Добавить»
                и вставьте ссылку в поле «Адрес календаря».
              </p>
              <p>
                Добавляйте календарь по ссылке как подписку. Скачанный и
                импортированный файл не получает обновления.
              </p>
            </details>
            <div className="actions">
              <button
                disabled={busy || !!confirm}
                onClick={() => setConfirm("PUT")}
              >
                Сменить ссылку
              </button>
              <button
                disabled={busy || !!confirm}
                onClick={() => setConfirm("DELETE")}
              >
                Отключить подписку
              </button>
            </div>
            {confirm && (
              <div className="notice">
                <p>
                  {confirm === "PUT"
                    ? "Старая ссылка перестанет работать. Календарные сервисы нужно будет подключить заново."
                    : "Календарные сервисы перестанут получать события. Уже загруженные события могут оставаться до удаления подписки в сервисе."}
                </p>
                <div className="actions">
                  <button disabled={busy} onClick={() => change(confirm)}>
                    Подтвердить
                  </button>
                  <button disabled={busy} onClick={() => setConfirm(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => change("POST")}
            >
              Создать ссылку подписки
            </button>
          </div>
        ))
      )}
      <p className="muted calendar-help">
        Изменяйте события в Avari.Jobs. Календарный сервис сам проверяет
        обновления; изменения могут появиться через несколько часов. В Яндексе
        задержка может достигать двух дней.
      </p>
    </div>
  );
}
function ExtensionDownloadPanel() {
  const client = useQueryClient();
  const download = useQuery({
    queryKey: ["extension-download"],
    queryFn: () => api<ExtensionDownload>("/extension/download"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const url = download.data?.url ?? "";
  const generate = async () => {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const result = await api<ExtensionDownload>(
        "/extension/download",
        "POST",
        {},
      );
      client.setQueryData(["extension-download"], result);
      setNotice("Новая ссылка создана");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="extension-download-box">
      <ErrorBox error={error} />
      {notice && (
        <div className="success notice" role="status">
          {notice}
        </div>
      )}
      {download.isPending ? (
        <Loading />
      ) : url ? (
        <>
          <FieldInput
            label="Индивидуальная ссылка на ZIP-архив"
            hint="Ссылка привязана к вашей учётной записи. Не публикуйте её в открытом доступе."
          >
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </FieldInput>
          <div className="actions">
            <a className="button primary" href={url} download>
              <Download size={14} /> Скачать ZIP расширения
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setNotice("Ссылка скопирована");
                  setError(undefined);
                } catch {
                  setError(
                    new Error(
                      "Не удалось скопировать. Выделите ссылку и скопируйте её вручную.",
                    ),
                  );
                }
              }}
            >
              Скопировать ссылку
            </button>
            <button type="button" disabled={busy} onClick={generate}>
              Сменить ссылку
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={generate}
          >
            Создать персональную ссылку скачивания
          </button>
        </div>
      )}
    </div>
  );
}
function SettingsPage() {
  const { user, data, refresh, logout } = useApp();
  const client = useQueryClient();
  const [fields, setFields] = useState<Field[]>(() =>
    structuredClone(data.fields),
  );
  const [timezone, setTimezone] = useState(user.timezone);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState<unknown>();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<Session[]>("/sessions"),
  });
  const setField = (index: number, key: string, value: unknown) =>
    setFields((fs) =>
      fs.map((f, i) => (i === index ? { ...f, [key]: value } : f)),
    );
  const saveFields = async (confirm = false) => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api<Field[]>("/fields", "PUT", {
        fields,
        confirmDelete: confirm,
      });
      setFields(saved);
      setConfirmDelete(false);
      refresh();
      setSuccess("Дополнительные поля сохранены");
    } catch (e) {
      setError(e);
      if (e instanceof APIError && e.status === 409) setConfirmDelete(true);
    } finally {
      setBusy(false);
    }
  };
  const [activeTab, setActiveTab] = useState<
    "general" | "calendar" | "fields" | "extension"
  >("general");
  const connectedExtensionsCount =
    sessions.data?.filter((s) => s.kind === "extension").length ?? 0;

  return (
    <>
      <PageHeader
        title="Настройки"
        subtitle="Настройте журнал под свой поиск"
      />
      <div
        className="settings-tabs-bar"
        role="tablist"
        aria-label="Разделы настроек"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "general"}
          className={activeTab === "general" ? "active" : ""}
          onClick={() => setActiveTab("general")}
        >
          <UserIcon size={15} />
          Общие
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "calendar"}
          className={activeTab === "calendar" ? "active" : ""}
          onClick={() => setActiveTab("calendar")}
        >
          <CalendarIcon size={15} />
          Календарь
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "fields"}
          className={activeTab === "fields" ? "active" : ""}
          onClick={() => setActiveTab("fields")}
        >
          <Sliders size={15} />
          Критерии и поля
          <span className="count-chip">{fields.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "extension"}
          className={activeTab === "extension" ? "active" : ""}
          onClick={() => setActiveTab("extension")}
        >
          <Puzzle size={15} />
          Расширение
          {connectedExtensionsCount > 0 && (
            <span className="count-chip">{connectedExtensionsCount}</span>
          )}
        </button>
      </div>
      <div className="settings">
        <ErrorBox error={error} />
        {success && (
          <div className="success notice" role="status">
            {success}
          </div>
        )}
        <div key={activeTab} className="settings-tab-pane">
          {activeTab === "general" && (
            <>
              <section className="panel">
                <div className="panel-head account-panel-head">
                  <div className="account-profile-row">
                    <UserAvatar email={user.email} size={54} />
                    <div className="account-profile-info">
                      <h2>Аккаунт</h2>
                      <p className="account-email">{user.email}</p>
                    </div>
                    <a
                      href={`https://gravatar.com/connect/?email=${encodeURIComponent(user.email)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="account-avatar-edit-link"
                      title="Изменить аватарку в Gravatar"
                    >
                      <span>Изменить аватарку на Gravatar</span>
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
                <form
                  className="form"
                  onKeyDown={handleFormSubmitShortcut}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const u = await api<User>("/me", "PUT", { timezone });
                      client.setQueryData(["me"], u);
                      refresh();
                      setSuccess("Часовой пояс сохранён");
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  <FieldInput label="Часовой пояс календаря">
                    <input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Europe/Moscow"
                    />
                  </FieldInput>
                  <div className="actions">
                    <button>
                      Сохранить часовой пояс
                      <SubmitShortcutHint />
                    </button>
                    <button type="button" onClick={logout}>
                      <LogOut size={15} />
                      Выйти
                    </button>
                  </div>
                </form>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Безопасность и смена пароля</h2>
                  <p>Пароль должен содержать от 10 до 256 символов.</p>
                </div>
                <ErrorBox error={passwordError} />
                {passwordSuccess && (
                  <div className="success notice" role="status">
                    {passwordSuccess}
                  </div>
                )}
                <form
                  className="form"
                  onKeyDown={handleFormSubmitShortcut}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPasswordError(undefined);
                    setPasswordSuccess("");
                    if (newPassword !== confirmPassword) {
                      setPasswordError(new Error("Новые пароли не совпадают"));
                      return;
                    }
                    if (newPassword.length < 10) {
                      setPasswordError(
                        new Error(
                          "Новый пароль должен содержать минимум 10 символов",
                        ),
                      );
                      return;
                    }
                    setPasswordBusy(true);
                    try {
                      await api("/auth/password", "POST", {
                        currentPassword,
                        newPassword,
                      });
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setPasswordSuccess(
                        "Пароль успешно изменён. Другие сессии отозваны.",
                      );
                    } catch (e) {
                      setPasswordError(e);
                    } finally {
                      setPasswordBusy(false);
                    }
                  }}
                >
                  <FieldInput label="Текущий пароль">
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </FieldInput>
                  <div className="form-grid">
                    <FieldInput
                      label="Новый пароль"
                      hint="От 10 до 256 символов"
                    >
                      <input
                        type="password"
                        required
                        minLength={10}
                        maxLength={256}
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </FieldInput>
                    <FieldInput label="Подтвердите новый пароль">
                      <input
                        type="password"
                        required
                        minLength={10}
                        maxLength={256}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </FieldInput>
                  </div>
                  <div className="actions">
                    <button className="primary" disabled={passwordBusy}>
                      {passwordBusy ? "Сохранение…" : "Сменить пароль"}
                      <SubmitShortcutHint />
                    </button>
                  </div>
                </form>
              </section>
            </>
          )}

          {activeTab === "calendar" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Подписка на календарь</h2>
              </div>
              <CalendarSubscriptionPanel />
            </section>
          )}

          {activeTab === "fields" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Мои критерии</h2>
                <p>До пяти полей для того, что важно именно вам.</p>
              </div>
              {fields.map((f, i) => (
                <div className="custom-editor" key={f.id || "new-" + i}>
                  <div className="custom-editor-header">
                    <strong>Поле {i + 1}</strong>
                    <button
                      className="text-button"
                      style={{ marginLeft: "auto" }}
                      onClick={() =>
                        setFields((fs) => fs.filter((_, index) => index !== i))
                      }
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="form-grid">
                    <FieldInput label="Название">
                      <input
                        value={f.name}
                        maxLength={100}
                        onChange={(e) => setField(i, "name", e.target.value)}
                      />
                    </FieldInput>
                    <FieldInput label="Тип">
                      <Select
                        value={f.type}
                        onChange={(v) => {
                          setField(i, "type", v);
                          if (v === "select" && !f.options.length)
                            setField(i, "options", [
                              "Высокий",
                              "Средний",
                              "Низкий",
                            ]);
                          if (v !== "select") setField(i, "role", "");
                        }}
                        items={{
                          text: "Текст",
                          number: "Число",
                          date: "Дата",
                          flag: "Флаг",
                          select: "Выбор",
                        }}
                      />
                    </FieldInput>
                  </div>
                  {f.type === "select" && (
                    <>
                      <FieldInput label="Варианты — по одному на строке">
                        <textarea
                          rows={3}
                          value={f.options.join("\n")}
                          onChange={(e) =>
                            setField(i, "options", e.target.value.split("\n"))
                          }
                        />
                      </FieldInput>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={f.role === "priority"}
                          onChange={(e) => {
                            setFields((fs) =>
                              fs.map((v, index) => ({
                                ...v,
                                role:
                                  index === i && e.target.checked
                                    ? "priority"
                                    : v.role === "priority"
                                      ? ""
                                      : v.role,
                              })),
                            );
                          }}
                        />
                        Использовать как фильтр приоритета
                      </label>
                    </>
                  )}
                </div>
              ))}
              <div className="actions">
                {fields.length < 5 && (
                  <button
                    onClick={() =>
                      setFields((fs) => [
                        ...fs,
                        {
                          id: "",
                          name: "Новое поле",
                          type: "text",
                          options: [],
                          role: "",
                        },
                      ])
                    }
                  >
                    <Plus size={15} />
                    Добавить поле
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => saveFields()}
                >
                  Сохранить поля
                </button>
              </div>
            </section>
          )}

          {activeTab === "extension" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h2>Расширение для Chromium</h2>
                  <p>
                    Добавляйте вакансии с {jobSitesLabel} без копирования полей.
                  </p>
                </div>
                {import.meta.env.VITE_CHROME_STORE_URL ? (
                  <div style={{ marginBottom: 20 }}>
                    <p>
                      Рекомендуемый способ: официальная установка из Chrome Web
                      Store.
                    </p>
                    <a
                      className="button primary"
                      href={import.meta.env.VITE_CHROME_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={14} /> Установить из Chrome Web Store
                    </a>
                  </div>
                ) : (
                  <p className="notice">
                    Расширение находится на проверке и публикации в Chrome Web
                    Store.
                  </p>
                )}
                <div className="panel-head" style={{ marginTop: 20 }}>
                  <h3>Ручная установка (для разработчиков и тестирования)</h3>
                  <p>
                    Архив расширения для загрузки в распакованном виде в{" "}
                    <code>chrome://extensions</code>.
                  </p>
                </div>
                <ExtensionDownloadPanel />
                <ol className="instructions" style={{ marginTop: 16 }}>
                  <li>
                    Скачайте ZIP-архив по индивидуальной ссылке выше и
                    распакуйте его в удобную папку.{" "}
                    <a href="/extension">Подробная инструкция</a>.
                  </li>
                  <li>
                    Откройте <code>chrome://extensions</code> и включите режим
                    разработчика.
                  </li>
                  <li>
                    Нажмите «Загрузить распакованное расширение» и выберите
                    папку расширения.
                  </li>
                  <li>
                    Войдите в аккаунт Avari.Jobs. Расширение с сайта уже
                    подключено к <code>https://jobs.avari.dev</code>. Другой
                    сервер можно выбрать опцией «Использовать свой сервер» на
                    экране входа.
                  </li>
                  <li>
                    Откройте карточку вакансии на {jobSitesLabel} или список
                    откликов hh.ru, Getmatch или Hirify. Изменения попадут в
                    журнал только после подтверждения.
                  </li>
                </ol>
                <small>
                  Сайт работает и без расширения. Для восстановления пароля
                  обратитесь к администратору.
                </small>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Подключённые расширения</h2>
                  <p>Отзыв отключает выбранное устройство.</p>
                </div>
                {sessions.isPending ? (
                  <Loading />
                ) : sessions.error ? (
                  <ErrorBox
                    error={sessions.error}
                    retry={() => sessions.refetch()}
                  />
                ) : sessions.data?.filter((s) => s.kind === "extension")
                    .length ? (
                  sessions.data
                    .filter((s) => s.kind === "extension")
                    .map((s) => (
                      <div className="session" key={s.id}>
                        <Monitor size={20} />
                        <div style={{ flex: 1 }}>
                          {s.name}
                          <small>Подключено {dateLabel(s.createdAt)}</small>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await api("/sessions/" + s.id, "DELETE");
                              sessions.refetch();
                            } catch (e) {
                              setError(e);
                            }
                          }}
                        >
                          Отозвать
                        </button>
                      </div>
                    ))
                ) : (
                  <p className="muted">Нет подключённых расширений.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {confirmDelete && (
        <Modal
          title="Удалить заполненное поле?"
          onClose={() => setConfirmDelete(false)}
        >
          <p>
            Значения удалённых полей исчезнут из вакансий. Изменение будет
            сохранено в истории.
          </p>
          <div className="actions">
            <button onClick={() => setConfirmDelete(false)}>Отмена</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => saveFields(true)}
            >
              Удалить значения и сохранить
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
