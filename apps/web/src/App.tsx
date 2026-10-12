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
  Rows3,
  PanelRight,
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
function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
export default function App() {
  const publicPath = window.location.pathname.replace(/\/+$/, "");
  if (publicPath === "/extension" || publicPath === "/privacy") {
    return <PublicPage privacy={publicPath === "/privacy"} />;
  }
  return <AuthenticatedApp />;
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
              откликов на hh.ru, LinkedIn, Getmatch и Hirify. Оно извлекает
              сведения о вакансиях и откликах и отправляет их только в
              настроенный вами Avari.Jobs. Пароли, cookies и переписку площадок
              расширение не собирает.
            </p>
            <p>
              Токен входа расширения хранится локально в Chrome. Для работы на
              jobs.avari.dev расширение получает доступ при установке; для
              другого сервера разрешение запрашивается отдельно; системные
              уведомления включаются отдельно. Данные журнала не передаются
              рекламным сервисам.
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
            {chromeStore && (
              <p>
                <a href={chromeStore} target="_blank" rel="noopener noreferrer">
                  Установить из Chrome Web Store
                </a>
              </p>
            )}
            <a
              className="primary public-download"
              href="/downloads/avari-extension.zip"
              download
            >
              Скачать ZIP расширения
            </a>
            <ol className="instructions">
              <li>Распакуйте архив.</li>
              <li>
                Откройте <code>chrome://extensions</code> и включите режим
                разработчика.
              </li>
              <li>
                Нажмите «Загрузить распакованное расширение» и выберите
                распакованную папку.
              </li>
              <li>
                Войдите в аккаунт Avari.Jobs. Расширение с этого сайта уже
                подключено к <code>https://jobs.avari.dev</code>.
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
      <img
        className="brand-mark brand-logo"
        src="/brand/avari-jobs-logo.png"
        alt=""
      />
      <span>
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
            <a href="/extension">Скачать расширение</a> ·{" "}
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
    try {
      await api("/auth/logout", "POST", {});
    } finally {
      clearSession(client);
    }
  };
  const context: Actions = {
    user,
    data,
    refresh,
    logout: handleLogout,
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
      <ScrollTop />
      <div className="app-shell">
        <aside className="sidebar">
          <Brand />
          <div className="brand-caption">Ваш следующий карьерный шаг</div>
          <nav aria-label="Основное меню">
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
                  <NavLink key={path} to={path} end={path === "/"}>
                    <Icon size={18} />
                    <span>{label}</span>
                    {path === "/proposals" && pending.length > 0 && (
                      <span className="nav-count">{pending.length}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <Link
              to="/settings"
              className="sidebar-account"
              title={`Настройки аккаунта (${user.email})`}
            >
              <UserAvatar email={user.email} size={32} />
              <span className="account-label">{user.email}</span>
            </Link>
            <div className="sidebar-footer-actions">
              <ThemeButton />
              <button
                type="button"
                className="icon-button text-button"
                title="Выйти из аккаунта"
                aria-label="Выйти из аккаунта"
                onClick={handleLogout}
              >
                <LogOut size={15} />
              </button>
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
                    path="*"
                    element={
                      <Empty
                        title="Страница не найдена"
                        action={<Link to="/calendar">Открыть календарь</Link>}
                      />
                    }
                  />
                </Routes>
              )}
            </PageTransition>
          )}
        </main>
      </div>
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
        <button className="primary" onClick={() => editApplication()}>
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
            <GitCompareArrows />
            <strong>Предложения</strong>
            <small>
              {pending ? `${pending} ожидают проверки` : "Всё актуально"}
            </small>
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
}: {
  label: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (element: HTMLElement) =>
    setAnchor(element.getBoundingClientRect());
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
      className="row-action-hint"
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAnchor(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setAnchor(null);
      }}
    >
      {children}
      {anchor &&
        createPortal(
          <span
            className="row-action-tooltip"
            role="tooltip"
            style={{
              top: anchor.top - 8,
              right: Math.max(12, window.innerWidth - anchor.right),
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

function Applications() {
  const { user, data, editApplication } = useApp();
  const [vacancyGroup, setVacancyGroup] = useState("");
  const vacancyGroups = Array.from(
    new Set(data.applications.flatMap((a) => a.groups ?? [])),
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
    roomy: boolean;
    statistics: boolean;
  }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
      return {
        group: ["stage", "state", "company", "priority"].includes(stored?.group)
          ? stored.group
          : "",
        roomy: stored?.roomy !== false,
        statistics: stored?.statistics !== false,
      };
    } catch {
      return { group: "", roomy: true, statistics: true };
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
    preferences.group === "company"
      ? a.company
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
    setSearch("");
    setStage("");
    setState("");
    setPriority("");
    setHasTask(false);
    setSelectedGroup("");
  };
  const filterCount =
    (vacancyGroup ? 1 : 0) +
    (stage ? 1 : 0) +
    (priority ? 1 : 0) +
    (hasTask ? 1 : 0) +
    (search ? 1 : 0);
  const activeFilters = !!(
    vacancyGroup ||
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
              : "Вакансия";

    return (
      <tr
        key={a.id}
        className="application-data-row"
        style={
          {
            "--row-index": visible.findIndex((item) => item.id === a.id),
          } as CSSProperties
        }
      >
        <td>
          <div className="company-cell">
            <CompanyAvatar name={a.company} />
            <div>
              <Link className="company-link" to={"/applications/" + a.id}>
                {a.company}
              </Link>
              <div className="position-sub">{a.position}</div>
              {!!a.groups?.length && (
                <small className="row-context">{a.groups.join(" · ")}</small>
              )}
              <small
                className={`row-context row-context-location ${preferences.roomy ? "is-expanded" : "is-collapsed"}`}
              >
                {[a.location, a.workFormat].filter(Boolean).join(" · ") ||
                  "Локация не указана"}
              </small>
            </div>
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
  return (
    <>
      <PageHeader
        title="Отклики"
        subtitle={`${data.applications.length} вакансий · Все возможности в одном месте`}
      >
        <div className="table-view-buttons">
          <button
            className={preferences.roomy ? "active icon-button" : "icon-button"}
            aria-label="Высокие строки"
            aria-pressed={preferences.roomy}
            title="Высокие строки"
            onClick={() =>
              setPreferences({ ...preferences, roomy: !preferences.roomy })
            }
          >
            <Rows3 size={17} />
          </button>
          <button
            className={
              preferences.statistics ? "active icon-button" : "icon-button"
            }
            aria-label="Статистика справа"
            aria-pressed={preferences.statistics}
            title="Статистика справа"
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
            title={`Экспорт в CSV (${list.length})`}
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
        <button className="primary" onClick={() => editApplication()}>
          <Plus size={17} />
          Добавить
        </button>
      </PageHeader>
      <div className="group-navigation" aria-label="Группы откликов">
        <div className="group-mode">
          <label>
            <ListFilter size={16} />
            <span className="sr-only">Группировка</span>
            <select
              aria-label="Группировка"
              value={preferences.group}
              onChange={(e) =>
                setPreferences({ ...preferences, group: e.target.value })
              }
            >
              <option value="">Без группировки</option>
              <option value="stage">По этапу</option>
              <option value="state">По состоянию</option>
              <option value="company">По компании</option>
              {pf && <option value="priority">По приоритету</option>}
            </select>
          </label>
        </div>
        <div className="group-chips">
          <button
            className={!selectedGroup ? "active" : ""}
            aria-pressed={!selectedGroup}
            onClick={() => {
              setSelectedGroup("");
              setPage(0);
            }}
          >
            <FolderClosed size={15} />
            Все вакансии
            <span className="count-chip">{baseList.length}</span>
          </button>
          {[...groupCounts].map(([key, count]) => (
            <button
              key={key}
              className={selectedGroup === key ? "active" : ""}
              aria-pressed={selectedGroup === key}
              onClick={() => {
                setSelectedGroup(key);
                setPage(0);
                setCollapsed(new Set());
              }}
            >
              <FolderClosed size={15} />
              {groupLabel(key)}
              <span className="count-chip">{count}</span>
            </button>
          ))}
        </div>
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
            (preferences.roomy ? "roomy-rows" : "compact-rows")
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
              <div className="spotlight-container">
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

                {showModalFilters && (
                  <div className="spotlight-drawer">
                    <div className="spotlight-filters-grid">
                      <div className="spotlight-field">
                        <label htmlFor="filter-group-select">
                          Группа вакансий
                        </label>
                        <Select
                          id="filter-group-select"
                          value={vacancyGroup}
                          onChange={setVacancyGroup}
                          items={Object.fromEntries([
                            ["__ungrouped", "Без группы"],
                            ...vacancyGroups.map((v) => [v, v]),
                          ])}
                          empty="Все группы"
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
                          <label htmlFor="filter-priority-select">
                            Приоритет
                          </label>
                          <Select
                            id="filter-priority-select"
                            value={priority}
                            onChange={setPriority}
                            items={Object.fromEntries(
                              pf.options.map((v) => [v, v]),
                            )}
                            empty="Любой приоритет"
                          />
                        </div>
                      )}
                      <div className="spotlight-field">
                        <label htmlFor="filter-sort-select">Сортировка</label>
                        <div className="sort-control">
                          <ArrowUpDown size={14} className="sort-icon" />
                          <select
                            id="filter-sort-select"
                            aria-label="Сортировка"
                            value={order}
                            onChange={(e) => setOrder(e.target.value)}
                          >
                            <option value="recent">Сначала новые</option>
                            <option value="company">По компании</option>
                            <option value="task">По ближайшей задаче</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="spotlight-checkbox-row">
                      <label className="checkbox-label spotlight-checkbox">
                        <input
                          type="checkbox"
                          checked={hasTask}
                          onChange={(e) => setHasTask(e.target.checked)}
                        />
                        <span>Только с запланированными задачами</span>
                      </label>
                    </div>
                  </div>
                )}

                {filterCount > 0 && (
                  <div className="spotlight-active-tags">
                    <span className="spotlight-tags-label">
                      Активные фильтры:
                    </span>
                    {search && (
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
                    )}
                    {vacancyGroup && (
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
                    )}
                    {stage && (
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
                    )}
                    {priority && (
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
                    )}
                    {hasTask && (
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
                    )}
                  </div>
                )}

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
              </div>
            </dialog>
          )}
          {!list.length ? (
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
                  <button className="primary" onClick={() => editApplication()}>
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
                <table
                  key={JSON.stringify([
                    currentPage,
                    state,
                    stage,
                    priority,
                    order,
                    selectedGroup,
                    search,
                    hasTask,
                    vacancyGroup,
                    preferences.group,
                  ])}
                  className="table-page-layer"
                >
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
                  <tbody>
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
                  </tbody>
                </table>
              </div>
              <div
                key={JSON.stringify([
                  currentPage,
                  state,
                  stage,
                  priority,
                  order,
                  selectedGroup,
                  search,
                  hasTask,
                  vacancyGroup,
                  preferences.group,
                ])}
                className="application-cards cards-page-layer"
              >
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
                            {apps.map((a) => (
                              <Link
                                className="application-card"
                                key={a.id}
                                to={"/applications/" + a.id}
                              >
                                <header>
                                  <strong>{a.company}</strong>
                                  <Badge value={a.stage} />
                                </header>
                                <p>{a.position}</p>
                                <footer>
                                  <Badge value={a.state} kind="state" />
                                  <span>
                                    {next(a.id)
                                      ? dateLabel(next(a.id).date) +
                                        " · " +
                                        next(a.id).title
                                      : "Нет задач"}
                                  </span>
                                </footer>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : (
                        apps.map((a) => (
                          <Link
                            className="application-card"
                            key={a.id}
                            to={"/applications/" + a.id}
                          >
                            <header>
                              <strong>{a.company}</strong>
                              <Badge value={a.stage} />
                            </header>
                            <p>{a.position}</p>
                            <footer>
                              <Badge value={a.state} kind="state" />
                              <span>
                                {next(a.id)
                                  ? dateLabel(next(a.id).date) +
                                    " · " +
                                    next(a.id).title
                                  : "Нет задач"}
                              </span>
                            </footer>
                          </Link>
                        ))
                      )}
                    </Fragment>
                  );
                })}
              </div>
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
  const { data, refresh, editApplication, editTask, addNote } = useApp();
  const q = useQuery({
    queryKey: ["detail", id],
    queryFn: () => api<Detail>("/applications/" + id),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const a = d.application;
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
      <PageHeader title={a.company} subtitle={a.position}>
        <button onClick={() => editApplication(a)}>
          <Pencil size={15} />
          Редактировать
        </button>
      </PageHeader>
      <div className="detail-badges">
        {(a.groups ?? []).map((group) => (
          <span className="count-chip" key={group}>
            {group}
          </span>
        ))}
        <Badge value={a.stage} />
        <Badge value={a.state} kind="state" />
        {a.url && (
          <a href={a.url} target="_blank" rel="noopener noreferrer">
            Открыть вакансию <ExternalLink size={13} />
          </a>
        )}
      </div>
      <div className="detail-grid" style={{ marginTop: 24 }}>
        <div>
          <section className="panel">
            <h2>О вакансии</h2>
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
          </section>
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
            <h2>История</h2>
            <div className="history">
              {d.events.map((e) => (
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
function SettingsPage() {
  const { user, data, refresh } = useApp();
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
                    <button>Сохранить часовой пояс</button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api("/auth/logout", "POST", {});
                          clearSession(client);
                        } catch (e) {
                          setError(e);
                        }
                      }}
                    >
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
                <ol className="instructions">
                  <li>
                    <a href="/downloads/avari-extension.zip" download>
                      Скачайте архив расширения
                    </a>{" "}
                    и распакуйте его.{" "}
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
