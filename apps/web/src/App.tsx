import { MCPSettings } from "./MCPSettings";
import { Auth } from "./Auth";
import { Brand } from "./Brand";
import { Landing } from "./Landing";
import { TelegramConnect, TelegramSettings } from "./Telegram";
import { jobIdentity } from "@avari/shared";
import { PushSettings, disableDevicePushOnLogout } from "./pwa/PushSettings";
import { getDailySummaryQueryKey } from "./pwa/DailyGoal";
import { GoalsMenu } from "./pwa/GoalsMenu";
import type { ParsedShareData } from "./pwa/share-target";
import { createWebAPI } from "./offline/policy";
import { readVacancyClipboard } from "@avari/shared";
import { UpdateNotice, WhatsNew, WhatsNewLabel } from "./Updates";
import {
  FilterPresence,
  FilterModalMotion,
  TableRowsMotion,
} from "./FilterMotion";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  Fragment,
} from "react";
import { createPortal } from "react-dom";
import {
  Navigate,
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
  ChartNoAxesCombined,
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
  Lock,
  Compass,
  RotateCcw,
  Star,
  ClockAlert,
  FileText,
  Copy,
  RefreshCw,
  Menu,
} from "lucide-react";
import {
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
  groupColorIndex,
  tagLabel,
  pluralTasks,
  pluralApplications,
  exportApplicationsToCSV,
  downloadCSV,
  isApplicationStale,
} from "@avari/shared";
import {
  ThemeButton,
  Loading,
  ErrorBox,
  Empty,
  Badge,
  BadgeDropdown,
  OutcomeModal,
  StaleActionModal,
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
import { Statistics } from "./Statistics";
import { PageTransition } from "./PageTransition";

import { TransferPanel } from "./TransferPanel";
import { LocalSetup, LocalAutostart } from "./LocalSetup";
import { ResumeManager } from "./ResumeManager";
import { useApplicationList } from "./useApplicationList";
import type { LocalStatus } from "@avari/shared";
import {
  offlineManager,
  useIsOnline,
  useOfflineSettings,
  useOfflineHydration,
  OfflineNotice,
  OfflineSettingsPanel,
  OfflineApplicationForm,
  OfflineTaskForm,
  OfflineNoteForm,
  flushAllDrafts,
  hasDirtyDrafts,
  offlineBroadcast,
  cancelAllDraftTimers,
  isNetworkError,
  getUserGeneration,
  requireLiveVerification,
  isOfflineOrReadOnly,
} from "./offline";
import {
  usePwa,
  PwaInstallPrompt,
  PwaUpdatePrompt,
  useShareTarget,
  ShareFallbackModal,
} from "./pwa";

const api = createWebAPI();
function clearSession(client: ReturnType<typeof useQueryClient>) {
  requireLiveVerification();
  void client.cancelQueries();
  client.setQueryData(["me"], null);
  // Local installation status is public environment metadata, not account data.
  // Keep its observer stable when the login URL changes modes.
  client.removeQueries({
    predicate: (query) => !["me", "local-status"].includes(String(query.queryKey[0])),
  });
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
  pasteVacancy: () => void;
  editApplication: (a?: Application) => void;
  editTask: (t?: Partial<Task>) => void;
  addNote: (id: string, note?: Note) => void;
  openMobileMenu: () => void;
};
const Context = createContext<Actions>(null!);
const useApp = () => useContext(Context);
function PageTracking() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);

    let title = "Avari.Jobs — вакансии, отклики и собеседования в одном журнале";
    if (pathname === "/login") {
      const mode = new URLSearchParams(search).get("mode");
      title = mode === "register"
        ? "Создать аккаунт — Avari.Jobs"
        : mode === "recovery"
          ? "Восстановление доступа — Avari.Jobs"
          : "Вход — Avari.Jobs";
    } else if (pathname === "/calendar") {
      title = "Календарь — Avari.Jobs";
    } else if (pathname === "/applications") {
      title = "Отклики — Avari.Jobs";
    } else if (pathname === "/favorites") {
      title = "Избранные вакансии — Avari.Jobs";
    } else if (pathname === "/resumes") {
      title = "Резюме — Avari.Jobs";
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
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = pathname === "/login" ? "noindex, follow" : "index, follow";
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = "https://jobs.avari.dev" + pathname;
    trackPageView(pathname, title);
  }, [pathname, search]);
  return null;
}
export default function App() {
  const { pathname } = useLocation();
  const share = useShareTarget({ autoIntake: true });
  const local = useQuery({
    queryKey: ["local-status"],
    queryFn: async () => {
      try {
        return await api<LocalStatus>("/local/status");
      } catch (err) {
        if (isNetworkError(err)) {
          return { personal: false, setupNeeded: false, launcher: false };
        }
        throw err;
      }
    },
    staleTime: Infinity,
  });
  useEffect(() => {
    if (local.data && !local.data.personal) initGoogleAnalytics();
  }, [local.data]);
  if (local.isPending) return <Loading />;
  if (local.error)
    return <ErrorBox error={local.error} retry={() => local.refetch()} />;
  if (local.data?.personal && local.data.setupNeeded)
    return <LocalSetup status={local.data} />;

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
      <AuthenticatedApp personal={local.data?.personal ?? false} pendingShare={share.pendingShare} consumeShare={share.consumeShare} />
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
  const navigate = useNavigate();
  const [version, setVersion] = useState("");
  const chromeStore = import.meta.env.VITE_CHROME_STORE_URL || "";
  useEffect(() => {
    fetch("/release.json")
      .then((response) => response.json())
      .then((data) => setVersion(data.version))
      .catch(() => {});
  }, []);
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };
  return (
    <div className="auth-page">
      <section className="auth-card public-card">
        <div className="public-top-nav">
          <button
            type="button"
            className="public-back-btn"
            onClick={handleBack}
            aria-label="Вернуться назад"
          >
            <ArrowLeft size={16} />
            <span>Назад</span>
          </button>
          <div className="public-top-nav-links">
            <Link to="/">На главную</Link>
            <span>·</span>
            <Link to="/login">Вход</Link>
          </div>
        </div>
        <Brand />
        {privacy ? (
          <>
            <h1>Конфиденциальность</h1>
            <div className="public-principles">
              <div className="public-principle-card">
                <h3>
                  <ShieldCheck size={16} />
                  Минимум данных
                </h3>
                <p>
                  Не собираем лишнего: сохраняются только те вакансии, заметки и
                  задачи, которые вы вносите сами для поиска работы.
                </p>
              </div>
              <div className="public-principle-card">
                <h3>
                  <Lock size={16} />
                  Без слежки и паролей
                </h3>
                <p>
                  Расширение никогда не запрашивает и не читает пароли сайтов,
                  cookies сессий, переписку и историю вкладок.
                </p>
              </div>
              <div className="public-principle-card">
                <h3>
                  <Check size={16} />
                  Никакой рекламы
                </h3>
                <p>
                  Данные журнала не продаются и не передаются рекламным сетям
                  или аналитическим брокерам.
                </p>
              </div>
            </div>
            <p>
              Avari.Jobs хранит введённые вами вакансии, задачи, заметки и
              учётные данные на выбранном вами сервере (по умолчанию
              jobs.avari.dev либо на вашем личном сервере). Доступ к журналу
              требует входа; новые аккаунты одобряет администратор сервера либо
              подтверждаются владельцем.
            </p>
            <p>
              <strong>Принцип минимизации данных:</strong> Мы обрабатываем строго
              тот объём информации, который необходим для ведения личного учёта
              поиска работы (152-ФЗ, ст. 5). Мы не собираем избыточные сведения,
              не сканируем содержимое нерелевантных страниц и не запрашиваем
              доступ к сторонним учетным записям.
            </p>
            <p>
              Расширение читает открытую вами страницу вакансии или список
              откликов на hh.ru, LinkedIn, Getmatch, Hirify, Geekjob, Habr
              Career и Huntflow исключительно в момент вашего взаимодействия.
              Оно извлекает сведения о вакансиях (должность, компания, зарплата,
              город, описание) и откликах и отправляет их только в настроенный
              вами Avari.Jobs. Пароли, cookies и личную переписку на площадках
              расширение не собирает.
            </p>
            <p>
              Токен входа расширения хранится локально в хранилище, доступном
              только доверенному контексту расширения. Для работы на jobs.avari.dev расширение получает доступ
              при установке; для другого сервера разрешение запрашивается
              отдельно; системные уведомления включаются отдельно. Данные журнала
              не передаются рекламным сервисам.
            </p>
            <p>
              При включённой Google Analytics сайт передаёт Google сведения о
              посещениях страниц, браузере и устройстве. Расширение не содержит
              Google Analytics. Полная юридическая политика с подробным
              описанием прав и регламентов обработки:{" "}
              <a href="/privacy.html">
                Политика конфиденциальности / Privacy Policy
              </a>
              .
            </p>
            <p>
              Удалить записи можно в приложении в любой момент, а для полного
              удаления аккаунта и данных обратитесь к администратору вашего
              сервера (web@ostkost.ru).
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
          <Link to="/login">Войти в Avari.Jobs</Link> ·{" "}
          <a href="/extension">Расширение</a> ·{" "}
          <a href="/privacy">Конфиденциальность</a>
        </p>
      </section>
    </div>
  );
}
function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) {
    return "/";
  }
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/login") return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

function AuthenticatedApp({ personal = false, pendingShare, consumeShare }: {
  personal?: boolean;
  pendingShare: ParsedShareData | null;
  consumeShare: () => ParsedShareData | null;
}) {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const returnToLogin = () => {
      if (client.getQueryData(["me"])) {
        navigate(
          "/login?returnTo=" + encodeURIComponent(location.pathname + location.search + location.hash),
          { replace: true },
        );
      }
    };
    const expired = () => {
      returnToLogin();
      cancelAllDraftTimers();
      void disableDevicePushOnLogout(api, { notifyServer: false });
      void offlineManager.handleLogout();
      clearSession(client);
    };
    window.addEventListener("avari-session-expired", expired);

    const unsubscribe = offlineBroadcast.subscribe((msg) => {
      if (msg.type === "SESSION_EXPIRED") {
        returnToLogin();
        cancelAllDraftTimers();
        void disableDevicePushOnLogout(api, { notifyServer: false });
        clearSession(client);
      }
    });

    return () => {
      window.removeEventListener("avari-session-expired", expired);
      unsubscribe();
    };
  }, [client, navigate, location.pathname, location.search, location.hash]);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const u = await api<User>("/me");
        // Wire active session in production ONLY after successful live /me
        return u;
      } catch (err) {
        // Auth errors (401/403) MUST strictly reject immediately and purge persisted data
        if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
          throw err;
        }
        // Cached user fallback ONLY on true network failure (status === 0)
        if (isNetworkError(err)) {
          const offlineAccount = await offlineManager.restoreLastOptedInAccount();
          if (offlineAccount?.user) {
            return offlineAccount.user as unknown as User;
          }
        }
        throw err;
      }
    },
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.status === "pending" ? 10000 : false,
  });
  useEffect(() => {
    const reconnect = async () => {
      const result = await me.refetch();
      if (!result.error && !isOfflineOrReadOnly()) {
        await client.invalidateQueries({ queryKey: ["data"] });
        await client.invalidateQueries({ queryKey: ["detail"] });
      }
    };
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, [client, me.refetch]);
  if (me.isPending) return <Loading />;
  const params = new URLSearchParams(location.search);
  const requestedReturn = params.get("returnTo");
  // Resolve only same-origin application paths; never follow external login redirects.
  const returnTo = safeReturnPath(requestedReturn);
  if (!me.data || (me.error && (me.data.status !== "pending" ||
    (me.error instanceof APIError && [401, 403].includes(me.error.status))))) {
    const unauthorized = (!me.data && !me.error) ||
      (me.error instanceof APIError && [401, 403].includes(me.error.status));
    if (me.error && !unauthorized && !isNetworkError(me.error)) {
      return <ErrorBox error={me.error} retry={() => me.refetch()} />;
    }
    const isWorkspaceShortcut = ["#today", "#add-vacancy"].includes(location.hash);
    if (location.pathname === "/" && !personal && !pendingShare && !isWorkspaceShortcut && unauthorized) {
      return <Landing />;
    }
    if (location.pathname !== "/login") {
      const destination = location.pathname + location.search + location.hash;
      return <Navigate replace to={"/login?returnTo=" + encodeURIComponent(destination)} />;
    }
    return <Auth api={api} personal={personal} onLogin={(u) => client.setQueryData(["me"], u)} />;
  }
  if (location.pathname === "/login") return <Navigate replace to={returnTo} />;
  if (me.data.status !== "active")
    return (
      <AccountStatus
        user={me.data}
        refresh={() => me.refetch()}
        checking={me.isFetching}
        error={me.error}
        logout={async () => {
          try {
            await disableDevicePushOnLogout(api);
            await api("/auth/logout", "POST", {});
          } catch {}
          await offlineManager.handleLogout(me.data.id);
          clearSession(client);
          navigate("/login", { replace: true });
        }}
      />
    );
  return <Workspace user={me.data} personal={personal} pendingShare={pendingShare} consumeShare={consumeShare} />;
}
function AccountStatus({
  user,
  refresh,
  logout,
  checking,
  error,
}: {
  user: User;
  refresh: () => void;
  logout: () => void;
  checking: boolean;
  error: unknown;
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
            ? "Подтвердите аккаунт"
            : "Аккаунт заблокирован"}
        </h1>
        <p>
          {user.status === "pending"
            ? "Аккаунт создан. Чтобы открыть журнал, подтвердите регистрацию одним из доступных способов."
            : "Для восстановления доступа обратитесь к администратору."}
        </p>
        <p>{user.email}</p>
        {user.status === "pending" && <TelegramConnect api={api} purpose="registration" onComplete={refresh} />}
        {user.status === "pending" && <p className="muted">
          Можно дождаться одобрения администратора. Статус обновится автоматически.
        </p>}
        <ErrorBox error={error} retry={refresh} />
        <div className="actions">
          <button disabled={checking} onClick={refresh}>
            {checking ? "Проверяем…" : "Проверить статус"}
          </button>
          <button onClick={logout}>Выйти</button>
        </div>
      </section>
    </div>
  );
}
function Workspace({ user, personal = false, pendingShare, consumeShare }: {
  user: User;
  personal?: boolean;
  pendingShare: ParsedShareData | null;
  consumeShare: () => ParsedShareData | null;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [form, setForm] = useState<{
    kind: "application" | "task" | "note";
    value?: Application | Partial<Task> | Note | string;
    clipboardText?: Promise<string>;
  }>();
  const [notice, setNotice] = useState("");
  const [shareFallbackOpen, setShareFallbackOpen] = useState(false);
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
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);
  const { hydrated, lastUpdated } = useOfflineHydration(client, user.id);
  const pwa = usePwa({
    onFlushDirtyDrafts: async () => {
      if (hasDirtyDrafts()) {
        await flushAllDrafts();
      }
      return true;
    },
  });
  const [isCachedData, setIsCachedData] = useState(false);
  const query = useQuery({
    queryKey: ["data"],
    queryFn: async () => {
      try {
        const epoch = getUserGeneration(user.id);
        const [applications, tasks, fields, proposals] = await Promise.all([
          api<Application[]>("/applications"),
          api<Task[]>("/tasks"),
          api<Field[]>("/fields"),
          api<Proposal[]>("/proposals"),
        ]);
        const result = { applications, tasks, fields, proposals };
        setIsCachedData(false);
        void offlineManager.recordSuccessfulFetch(user.id, user, result, epoch);
        return result;
      } catch (err) {
        if (isNetworkError(err)) {
          const snapshot = await offlineManager.restoreLastOptedInAccount();
          if (snapshot?.journal) {
            setIsCachedData(true);
            return {
              applications: snapshot.journal.applications || [],
              tasks: snapshot.journal.tasks || [],
              fields: snapshot.journal.fields || [],
              proposals: snapshot.journal.proposals || [],
            };
          }
        }
        throw err;
      }
    },
    refetchInterval: 30000,
  });
  const data = query.data ?? {
    applications: [],
    tasks: [],
    fields: [],
    proposals: [],
  };
  const openSharedVacancy = useCallback((shared: ParsedShareData) => {
    const sharedUrl = shared.canonicalUrl || shared.rawUrl || "";
    const identity = jobIdentity(sharedUrl);
    const existing = sharedUrl && data.applications.find((application) => {
      const candidate = jobIdentity(application.url || "");
      if (identity && candidate) return candidate.site === identity.site && candidate.id === identity.id;
      try { return new URL(application.url).href === new URL(sharedUrl).href; } catch { return false; }
    });
    if (existing) {
      setForm(undefined);
      navigate("/applications/" + existing.id, { replace: true });
      setNotice("Эта вакансия уже в журнале");
      return;
    }
    setForm({ kind: "application", value: {
      ...emptyApplication(), savedDate: dateToday(user.timezone),
      url: sharedUrl, position: shared.title || "", company: "",
    } });
  }, [data.applications, user.timezone, navigate]);
  useEffect(() => {
    if (!pendingShare || !query.data) return;
    consumeShare();
    openSharedVacancy(pendingShare);
  }, [pendingShare, consumeShare, query.data, openSharedVacancy]);
  const refresh = async () => {
    if (isOfflineOrReadOnly()) await client.refetchQueries({ queryKey: ["me"] });
    client.invalidateQueries({ queryKey: ["data"] });
    client.invalidateQueries({ queryKey: ["detail"] });
    client.invalidateQueries({ queryKey: ["calendar"] });
    client.invalidateQueries({ queryKey: ["statistics-activity"] });
    client.invalidateQueries({ queryKey: getDailySummaryQueryKey(user.id) });
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
      await disableDevicePushOnLogout(api);
      await api("/auth/logout", "POST", {});
    } catch {
      /* End the local session even if the server cannot be reached. */
    } finally {
      await offlineManager.handleLogout(user.id);
      clearSession(client);
      navigate("/login", { replace: true });
    }
  };
  const context: Actions = {
    user,
    data,
    refresh,
    pasteVacancy: () => setShareFallbackOpen(true),
    logout: async () => {
      setConfirmLogout(true);
    },
    editApplication: (a) =>
      setForm({
        kind: "application",
        clipboardText: a ? undefined : readVacancyClipboard(),
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
    openMobileMenu: () => setMobileMenuOpen(true),
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
            <div className="sidebar-desktop-nav">
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
                    {
                      path: "/favorites",
                      label: "Избранные",
                      icon: Star,
                    },
                    { path: "/calendar", label: "Календарь", icon: CalendarDays },
                    {
                      path: "/statistics",
                      label: "Статистика",
                      icon: ChartNoAxesCombined,
                    },
                  ],
                },
                {
                  title: "Управление",
                  links: [
                    {
                      path: "/resumes",
                      label: "Резюме",
                      icon: FileText,
                    },
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
                      <NavLink
                        to={path}
                        end={path === "/"}
                        aria-label={label}
                        data-tone={
                          ({
                            "/": "blue",
                            "/applications": "blue",
                            "/favorites": "amber",
                            "/calendar": "violet",
                            "/statistics": "mint",
                            "/resumes": "violet",
                            "/proposals": "amber",
                            "/settings": "blue",
                          } as Record<string, string>)[path]
                        }
                      >
                        <Icon size={18} />
                        <span>{label}</span>
                        {path === "/proposals" && pending.length > 0 && (
                          <span className="nav-count">{pending.length}</span>
                        )}
                      </NavLink>
                    </RowActionHint>
                  ))}
                  {title === "Рабочее пространство" && (
                    <GoalsMenu userId={user.id} api={api} collapsed={sidebarCollapsed} />
                  )}
                </div>
              ))}
              <div className="sidebar-meta-section">
                {!personal && pwa.isInstallable && (
                  <div style={{ marginBottom: 8, padding: sidebarCollapsed ? "0" : "0 4px" }}>
                    <PwaInstallPrompt pwa={pwa} />
                  </div>
                )}
                <RowActionHint
                  label="Что нового"
                  placement="right"
                  className="sidebar-nav-hint"
                  enabled={sidebarCollapsed}
                >
                  <NavLink
                    to="/whats-new"
                    className="sidebar-privacy-link"
                    aria-label="Что нового"
                  >
                    <Sparkles size={14} />
                    <span>
                      <WhatsNewLabel userId={user.id} />
                    </span>
                  </NavLink>
                </RowActionHint>
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
            </div>

            <div className="sidebar-mobile-bar" role="navigation" aria-label="Быстрая навигация">
              <NavLink
                to="/"
                end
                className="sidebar-mobile-tab"
                aria-label="Главная"
                data-tone="blue"
              >
                <LayoutDashboard size={20} />
                <span>Главная</span>
              </NavLink>
              <NavLink
                to="/applications"
                className="sidebar-mobile-tab"
                aria-label="Отклики"
                data-tone="blue"
              >
                <BriefcaseBusiness size={20} />
                <span>Отклики</span>
              </NavLink>
              <NavLink
                to="/favorites"
                className="sidebar-mobile-tab"
                aria-label="Избранные"
                data-tone="amber"
              >
                <Star size={20} />
                <span>Избранные</span>
              </NavLink>
              <NavLink
                to="/calendar"
                className="sidebar-mobile-tab"
                aria-label="Календарь"
                data-tone="violet"
              >
                <CalendarDays size={20} />
                <span>Календарь</span>
              </NavLink>
              <button
                type="button"
                className={`sidebar-mobile-tab sidebar-more-tab${mobileMenuOpen ? " active" : ""}`}
                aria-label="Меню"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((open) => !open)}
              >
                <Menu size={20} />
                <span>Меню</span>
                {pending.length > 0 && <span className="nav-count">{pending.length}</span>}
              </button>
            </div>

            {mobileMenuOpen &&
              createPortal(
                <div className="mobile-drawer-portal">
                  <div
                    className="mobile-drawer-backdrop"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    className="mobile-drawer-sheet"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Меню приложения"
                  >
                    <div className="mobile-drawer-header">
                      <div className="mobile-drawer-user">
                        <UserAvatar email={user.email} size={36} />
                        <div className="mobile-drawer-user-info">
                          <span className="mobile-drawer-email">{user.email}</span>
                          <span className="mobile-drawer-caption">Учётная запись</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-button mobile-drawer-close"
                        aria-label="Закрыть меню"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="mobile-drawer-nav">
                      <GoalsMenu userId={user.id} api={api} mobile />
                      <NavLink
                        to="/statistics"
                        className="mobile-drawer-link"
                        onClick={() => setMobileMenuOpen(false)}
                        data-tone="mint"
                      >
                        <ChartNoAxesCombined size={20} />
                        <span>Статистика</span>
                      </NavLink>
                      <NavLink
                        to="/resumes"
                        className="mobile-drawer-link"
                        onClick={() => setMobileMenuOpen(false)}
                        data-tone="violet"
                      >
                        <FileText size={20} />
                        <span>Резюме</span>
                      </NavLink>
                      <NavLink
                        to="/proposals"
                        className="mobile-drawer-link"
                        onClick={() => setMobileMenuOpen(false)}
                        data-tone="amber"
                      >
                        <GitCompareArrows size={20} />
                        <span>Предложения</span>
                        {pending.length > 0 && (
                          <span className="nav-count">{pending.length}</span>
                        )}
                      </NavLink>
                      <NavLink
                        to="/settings"
                        className="mobile-drawer-link"
                        onClick={() => setMobileMenuOpen(false)}
                        data-tone="blue"
                      >
                        <Settings size={20} />
                        <span>Настройки</span>
                      </NavLink>
                      <NavLink
                        to="/whats-new"
                        className="mobile-drawer-link"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <Sparkles size={20} />
                        <span>
                          <WhatsNewLabel userId={user.id} />
                        </span>
                      </NavLink>
                      <Link
                        to="/privacy"
                        className="mobile-drawer-link"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <ShieldCheck size={20} />
                        <span>Конфиденциальность</span>
                      </Link>
                    </div>

                    {!personal && pwa.isInstallable && (
                      <div className="mobile-drawer-pwa">
                        <PwaInstallPrompt pwa={pwa} />
                      </div>
                    )}

                    <div className="mobile-drawer-footer">
                      <div className="mobile-drawer-theme-row">
                        <span>Тема оформления</span>
                        <ThemeButton />
                      </div>
                      <button
                        type="button"
                        className="mobile-drawer-logout-btn"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setConfirmLogout(true);
                        }}
                      >
                        <LogOut size={16} />
                        <span>Выйти из аккаунта</span>
                      </button>
                    </div>
                  </div>
                </div>,
                document.body,
              )}
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
          <PwaUpdatePrompt pwa={pwa} />
          <OfflineNotice lastUpdated={lastUpdated} onRefresh={refresh} isCached={isCachedData} />
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
          <UpdateNotice />
          {query.isPending ? (
            <Loading />
          ) : query.error && data.applications.length === 0 ? (
            <ErrorBox error={query.error} retry={() => query.refetch()} />
          ) : (
            <PageTransition>
              {(location) => (
                <Routes location={location}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route
                    path="/statistics"
                    element={
                      <Statistics
                        key={user.id}
                        user={user}
                        applications={data.applications}
                      />
                    }
                  />
                  <Route
                    path="/applications"
                    element={<Applications key={`apps:${user.id}`} />}
                  />
                  <Route
                    path="/favorites"
                    element={<Applications key={`favs:${user.id}`} favoriteOnly />}
                  />
                  <Route
                    path="/applications/:id"
                    element={<ApplicationDetail />}
                  />
                  <Route path="/resumes" element={<ResumeManager />} />
                  <Route path="/proposals" element={<Proposals />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route
                    path="/whats-new"
                    element={<WhatsNew userId={user.id} />}
                  />
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
      <ShareFallbackModal isOpen={shareFallbackOpen} onClose={() => setShareFallbackOpen(false)} onAddParsedVacancy={openSharedVacancy} />
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
            <OfflineApplicationForm
              userKey={user.id}
              autofill
              clipboardText={form.clipboardText}
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
            <OfflineTaskForm
              userKey={user.id}
              initial={form.value as Partial<Task>}
              applications={data.applications}
              api={api}
              onCancel={() => setForm(undefined)}
              onSaved={saved}
            />
          ) : (
            <OfflineNoteForm
              userKey={user.id}
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
  logo,
  children,
}: {
  title: string;
  subtitle: string;
  logo?: ReactNode;
  children?: ReactNode;
}) {
  const { openMobileMenu, data } = useApp();
  const pendingCount = data?.proposals?.filter((p) => p.status === "pending").length ?? 0;
  return (
    <header className="page-header">
      <div className={logo ? "page-header-with-logo" : undefined}>
        {logo}
        <div>
          <div className="eyebrow">Журнал поиска работы</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="icon-button mobile-burger-btn"
          onClick={openMobileMenu}
          aria-label="Открыть меню"
          title="Открыть меню"
        >
          <Menu size={18} />
          {pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
        </button>
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
  const { user, data, refresh, editTask, editApplication, pasteVacancy } = useApp();
  const moveHeroWaves = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const hero = event.currentTarget;
    const bounds = hero.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    hero.style.setProperty("--hero-pointer-x", `${x * 24}px`);
    hero.style.setProperty("--hero-pointer-y", `${y * 16}px`);
  };
  const resetHeroWaves = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.style.removeProperty("--hero-pointer-x");
    event.currentTarget.style.removeProperty("--hero-pointer-y");
  };
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
        <button onClick={pasteVacancy}>Вставить ссылку</button>
      </PageHeader>
      <section
        className="dashboard-hero"
        onPointerMove={moveHeroWaves}
        onPointerLeave={resetHeroWaves}
        onPointerCancel={resetHeroWaves}
      >
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
          <Link to="/applications" data-tone="blue">
            <BriefcaseBusiness />
            <strong>Отклики</strong>
            <small>Все возможности</small>
          </Link>
          <Link to="/calendar" data-tone="violet">
            <CalendarDays />
            <strong>Календарь</strong>
            <small>Встречи и задачи</small>
          </Link>
          <Link to="/proposals" data-tone="amber">
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
          <button data-tone="action" onClick={() => editTask()}>
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
            tone: "blue",
            value: active.length,
            icon: BriefcaseBusiness,
            hint: "В вашем поиске",
          },
          {
            label: "Интервью впереди",
            tone: "violet",
            value: openTasks.filter(
              (t) => t.kind === "interview" && t.date >= today,
            ).length,
            icon: CalendarDays,
            hint: "Запланированные встречи",
          },
          {
            label: "Офферы",
            tone: "mint",
            value: active.filter((a) => a.stage === "offer").length,
            icon: Target,
            hint: "На этапе предложения",
          },
          {
            label: "Ожидают внимания",
            tone: "amber",
            value: overdue.length + pending,
            icon: Clock3,
            hint: "Просроченные задачи и предложения",
          },
        ].map(({ label, value, icon: Icon, hint, tone }) => (
          <div className="metric-card" data-tone={tone} key={label}>
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
                <CompanyAvatar name={a.company} logoUrl={a.companyLogo} />
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

function Applications({ favoriteOnly = false }: { favoriteOnly?: boolean }) {
  const { user, data, refresh, editApplication } = useApp();
  const listState = useApplicationList({
    user,
    applications: data.applications,
    tasks: data.tasks,
    fields: data.fields,
    favoriteOnly,
    api,
    refresh,
  });

  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [showModalFilters, setShowModalFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportFlyStyle, setExportFlyStyle] = useState<CSSProperties | null>(
    null,
  );
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          // If already in input outside modal, let standard behavior work
        }
        e.preventDefault();
        setShowModalFilters(false);
        setFilterModalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groupOptions: {
    value: string;
    label: string;
    icon: typeof FolderClosed;
  }[] = [
    { value: "", label: "Без группировки", icon: Layers },
    { value: "stage", label: "По этапу", icon: Target },
    { value: "state", label: "По состоянию", icon: Clock3 },
    { value: "group", label: "По группам", icon: FolderKanban },
    ...(listState.pf
      ? [{ value: "priority", label: "По приоритету", icon: Sparkles }]
      : []),
  ];

  const currentGroupOption =
    groupOptions.find((opt) => opt.value === listState.grouping) ??
    groupOptions[0];

  const renderGroup = (a: Application) => (
    <BadgeDropdown
      value={a.groups?.[0] ?? ""}
      kind="group"
      items={Object.fromEntries([
        ["", "Без группы"],
        ...listState.vacancyGroups.map((group) => [group, group]),
      ])}
      aria-label={"Группа: " + a.company}
      disabled={listState.savingIds.has(a.id)}
      onChange={(value) => listState.handleGroupChange(a, value)}
    />
  );

  const renderRow = (a: Application) => {
    const task = listState.next(a.id);
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
                  : site === "huntflow"
                    ? "Huntflow"
                    : "Вакансия";

    return (
      <tr
        key={a.id}
        className="application-data-row"
        style={
          {
            "--row-delay": `${Math.round(100 * (1 - Math.exp(-listState.visible.findIndex((item) => item.id === a.id) / 3)))}ms`,
          } as CSSProperties
        }
      >
        <td>
          <div className="company-cell company-grid">
            <button
              type="button"
              className={`favorite-star-btn ${a.favorite ? "active" : ""}`}
              aria-label={a.favorite ? "Удалить из избранного" : "Добавить в избранное"}
              title={a.favorite ? "Удалить из избранного" : "Добавить в избранное"}
              onClick={(e) => {
                e.stopPropagation();
                void listState.toggleFavorite(a);
              }}
            >
              <Star size={14} fill={a.favorite ? "currentColor" : "none"} />
            </button>
            <CompanyAvatar name={a.company} logoUrl={a.companyLogo} />
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
            {
              <div className="company-taxonomy">
                {renderGroup(a)}
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
            }
          </div>
        </td>
        <td>
          <BadgeDropdown
            value={a.stage}
            kind="stage"
            disabled={listState.savingIds.has(a.id)}
            onChange={(val) => listState.handleStageChange(a, val)}
          />
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
          <BadgeDropdown
            value={a.state}
            kind="state"
            disabled={listState.savingIds.has(a.id)}
            onChange={(val) => listState.handleStateChange(a, val)}
          />
        </td>
        <td>
          <div className="row-actions">
            {isApplicationStale(a) && (
              <RowActionHint label="Внимание: не было активности более 10 дней">
                <button
                  type="button"
                  className="row-action-btn stale-warning-btn"
                  aria-label="Внимание: не было активности более 10 дней"
                  onClick={() => listState.setStaleModalApp(a)}
                >
                  <ClockAlert size={14} />
                </button>
              </RowActionHint>
            )}
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
    const task = listState.next(a.id);
    return (
      <div
        className="application-card"
        key={a.id}
        style={
          {
            "--row-delay": `${Math.round(100 * (1 - Math.exp(-listState.visible.findIndex((item) => item.id === a.id) / 3)))}ms`,
            cursor: "pointer",
          } as CSSProperties
        }
        tabIndex={0}
        role="article"
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(
              'button, a, input, select, [role="button"], [role="listbox"], [role="option"]',
            )
          ) {
            return;
          }
          navigate("/applications/" + a.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const target = e.target as HTMLElement | null;
            if (target?.closest("button, a, input, select")) return;
            navigate("/applications/" + a.id);
          }
        }}
      >
        <header>
          <div className="application-card-company">
            <CompanyAvatar name={a.company} logoUrl={a.companyLogo} />
            <Link
              to={"/applications/" + a.id}
              className="company-link"
              title={a.company}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <strong title={a.company}>{a.company}</strong>
            </Link>
          </div>
          <div className="card-header-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className={`favorite-star-btn ${a.favorite ? "active" : ""}`}
              aria-label={a.favorite ? "Удалить из избранного" : "Добавить в избранное"}
              title={a.favorite ? "Удалить из избранного" : "Добавить в избранное"}
              onClick={(e) => {
                e.stopPropagation();
                void listState.toggleFavorite(a);
              }}
            >
              <Star size={14} fill={a.favorite ? "currentColor" : "none"} />
            </button>
            {isApplicationStale(a) && (
              <button
                type="button"
                className="row-action-btn stale-warning-btn"
                aria-label="Внимание: не было активности более 10 дней"
                title="Внимание: не было активности более 10 дней"
                onClick={(e) => {
                  e.stopPropagation();
                  listState.setStaleModalApp(a);
                }}
              >
                <ClockAlert size={14} />
              </button>
            )}
            <BadgeDropdown
              value={a.stage}
              kind="stage"
              disabled={listState.savingIds.has(a.id)}
              onChange={(val) => listState.handleStageChange(a, val)}
            />
          </div>
        </header>
        <Link
          to={"/applications/" + a.id}
          className="application-card-position-link"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          <p className="application-card-position">{a.position}</p>
        </Link>
        <div className="application-card-salary">
          {salaryLabel(a) || "Зарплата не указана"}
        </div>
        <div className="application-card-location">
          {[a.location, a.workFormat].filter(Boolean).join(" · ") ||
            "Локация не указана"}
        </div>
        {
          <div className="company-taxonomy">
            {renderGroup(a)}
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
        }
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
          <BadgeDropdown
            value={a.state}
            kind="state"
            disabled={listState.savingIds.has(a.id)}
            onChange={(val) => listState.handleStateChange(a, val)}
          />
          <span>
            {dateLabel(a.appliedDate || a.savedDate)} ·{" "}
            {a.appliedDate ? "Отклик" : "Сохранена"}
          </span>
          <Link
            to={"/applications/" + a.id}
            className="row-action-btn row-action-detail"
            aria-label={"Открыть: " + a.company}
            style={{ marginLeft: 6 }}
          >
            <ArrowUpRight size={15} />
          </Link>
        </footer>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={favoriteOnly ? "Избранные вакансии" : "Отклики"}
        subtitle={
          favoriteOnly
            ? `${listState.baseList.length} сохранённых вакансий в избранном`
            : `${data.applications.length} вакансий · Все возможности в одном месте`
        }
      >
        <div className="table-view-buttons">
          <button
            className={listState.cards ? "active icon-button" : "icon-button"}
            aria-label="Карточки откликов"
            aria-pressed={listState.cards}
            data-tooltip={
              listState.cards ? "Показать таблицу" : "Показать карточки"
            }
            onClick={() => listState.setCards(!listState.cards)}
          >
            <LayoutGrid size={17} />
          </button>
          <button
            className={
              listState.statistics ? "active icon-button" : "icon-button"
            }
            aria-label="Статистика справа"
            aria-pressed={listState.statistics}
            data-tooltip="Статистика справа"
            onClick={() => listState.setStatistics(!listState.statistics)}
          >
            <PanelRight size={17} />
          </button>
          <button
            ref={exportBtnRef}
            className={`icon-button ${isExporting ? "exporting" : ""}`}
            aria-label="Экспорт в CSV"
            data-tooltip={`Экспорт в CSV (${listState.list.length})`}
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
                listState.list,
                data.fields,
                data.tasks,
              );
              downloadCSV(csv, `avari-applications-${dateToday()}.csv`);
            }}
            disabled={listState.list.length === 0}
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
          onClick={() =>
            editApplication(
              favoriteOnly
                ? {
                    ...emptyApplication(),
                    favorite: true,
                    savedDate: dateToday(user.timezone),
                  }
                : undefined,
            )
          }
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
                  const isSelected = listState.grouping === opt.value;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`group-dropdown-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        listState.setGrouping(opt.value);
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
          selectedGroup={listState.selectedGroup}
          onSelectGroup={(key) => {
            listState.setSelectedGroup(key);
            listState.setPage(0);
          }}
          baseCount={listState.baseList.length}
          groups={[...listState.groupCounts].map(([key, count]) => ({
            key,
            count,
            label: listState.groupLabel(key),
          }))}
        />
      </div>
      <div
        className={
          "applications-layout " +
          (listState.statistics ? "with-statistics" : "")
        }
      >
        <section
          className={
            "application-register panel " +
            (listState.cards ? "card-view compact-rows" : "compact-rows")
          }
        >
          {Boolean(listState.saveError) && (
            <div style={{ marginBottom: 16 }}>
              <ErrorBox error={listState.saveError} />
            </div>
          )}
          {listState.conflictApp && (
            <div
              className="conflict conflict-row"
              style={{
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>Конфликт изменений:</strong> Вакансия «
                {listState.conflictApp.server.company}» была изменена на сервере.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {listState.conflictApp.patch && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      void listState.retryConflict().catch(() => {});
                    }}
                  >
                    Повторить изменение
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => listState.setConflictApp(null)}
                >
                  {listState.conflictApp.patch ? "Отмена" : "Закрыть"}
                </button>
              </div>
            </div>
          )}
          <div className="register-tabs-row">
            <div className="register-tabs" aria-label="Состояние откликов">
              {[["", "Все отклики"], ...Object.entries(states)].map(
                ([key, label]) => (
                  <button
                    key={key}
                    className={listState.state === key ? "active" : ""}
                    onClick={() => listState.setState(key)}
                  >
                    {label}
                    <span className="count-chip">
                      {
                        listState.baseList.filter(
                          (a) => !key || a.state === key,
                        ).length
                      }
                    </span>
                  </button>
                ),
              )}
            </div>
            <div className="register-toolbar-actions">
              {listState.activeFilters && (
                <div className="register-filter-status">
                  <span className="register-filter-count">
                    Найдено: <strong>{listState.list.length}</strong>
                  </span>
                  <button
                    type="button"
                    className="text-button register-filter-reset"
                    onClick={listState.resetFilters}
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
                  "register-filter-trigger" +
                  (listState.activeFilters ? " active" : "")
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
                  {listState.search
                    ? `«${listState.search}»`
                    : "Поиск и фильтры"}
                </span>
                {listState.filterCount > 0 && (
                  <span className="filter-badge-chip">
                    {listState.filterCount}
                  </span>
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
                    value={listState.search}
                    onChange={(e) => listState.setSearch(e.target.value)}
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
                  {listState.search && (
                    <button
                      type="button"
                      className="icon-button spotlight-clear"
                      onClick={() => listState.setSearch("")}
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
                      (listState.filterCount > 0 ? " has-filters" : "")
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
                    {listState.filterCount > 0 && (
                      <span className="filter-badge-chip">
                        {listState.filterCount}
                      </span>
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
                          value={listState.vacancyGroup}
                          onChange={listState.setVacancyGroup}
                          emptyLabel="Все группы"
                          icon={FolderKanban}
                          options={[
                            { value: "__ungrouped", label: "Без группы" },
                            ...listState.vacancyGroups.map((g) => ({
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
                          value={listState.vacancyTag}
                          onChange={listState.setVacancyTag}
                          emptyLabel="Все теги"
                          icon={Tag}
                          options={listState.vacancyTags.map((t) => ({
                            value: t,
                            label: t,
                          }))}
                        />
                      </div>
                      <div className="spotlight-field">
                        <label htmlFor="filter-stage-select">Этап отбора</label>
                        <Select
                          id="filter-stage-select"
                          value={listState.stage}
                          onChange={listState.setStage}
                          items={stages}
                          empty="Все этапы"
                        />
                      </div>
                      {listState.pf && (
                        <div className="spotlight-field">
                          <label>Приоритет</label>
                          <SpotlightFilterDropdown
                            ariaLabel="Фильтр по приоритету"
                            value={listState.priority}
                            onChange={listState.setPriority}
                            emptyLabel="Любой приоритет"
                            icon={Sparkles}
                            options={listState.pf.options.map((p) => ({
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
                          value={listState.order}
                          onChange={(val) => listState.setOrder(val || "recent")}
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
                            checked={listState.hasTask}
                            onChange={(e) => listState.setHasTask(e.target.checked)}
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

                <FilterPresence show={listState.filterCount > 0} block>
                  <div className="spotlight-active-tags">
                    <span className="spotlight-tags-label">
                      Активные фильтры:
                    </span>
                    <FilterPresence show={Boolean(listState.search)}>
                      <span className="filter-summary-tag">
                        Поиск: «{listState.search}»
                        <button
                          type="button"
                          aria-label="Очистить поиск"
                          onClick={() => listState.setSearch("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(listState.vacancyGroup)}>
                      <span className="filter-summary-tag">
                        {listState.vacancyGroup === "__ungrouped"
                          ? "Без группы"
                          : listState.vacancyGroup}
                        <button
                          type="button"
                          aria-label="Сбросить группу"
                          onClick={() => listState.setVacancyGroup("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(listState.vacancyTag)}>
                      <span className="filter-summary-tag">
                        Тег: {listState.vacancyTag}
                        <button
                          type="button"
                          aria-label="Сбросить тег"
                          onClick={() => listState.setVacancyTag("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(listState.stage)}>
                      <span className="filter-summary-tag">
                        Этап: {stages[listState.stage] || listState.stage}
                        <button
                          type="button"
                          aria-label="Сбросить этап"
                          onClick={() => listState.setStage("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(listState.priority)}>
                      <span className="filter-summary-tag">
                        Приоритет: {listState.priority}
                        <button
                          type="button"
                          aria-label="Сбросить приоритет"
                          onClick={() => listState.setPriority("")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </FilterPresence>
                    <FilterPresence show={Boolean(listState.hasTask)}>
                      <span className="filter-summary-tag">
                        С задачами
                        <button
                          type="button"
                          aria-label="Сбросить фильтр задач"
                          onClick={() => listState.setHasTask(false)}
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
                      Найдено вакансий: <strong>{listState.list.length}</strong>
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
                    {listState.activeFilters && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={listState.resetFilters}
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
          {!listState.baseList.length ? (
            <Empty
              title={
                favoriteOnly
                  ? "Нет избранных вакансий"
                  : data.applications.length
                    ? "Ничего не найдено"
                    : "Первый шаг — сохранить вакансию"
              }
              action={
                favoriteOnly ? (
                  <Link
                    to="/applications"
                    className="button primary water-interaction"
                  >
                    Перейти ко всем откликам
                  </Link>
                ) : data.applications.length ? (
                  <button onClick={listState.resetFilters}>Сбросить фильтры</button>
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
              {favoriteOnly
                ? "Добавляйте важные вакансии в избранное с помощью звёздочки, чтобы быстро к ним возвращаться."
                : data.applications.length
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
                    key={String(listState.cards)}
                    transitionKey={JSON.stringify([
                      listState.currentPage,
                      listState.state,
                      listState.stage,
                      listState.priority,
                      listState.order,
                      listState.selectedGroup,
                      listState.search,
                      listState.hasTask,
                      listState.vacancyGroup,
                      listState.vacancyTag,
                      listState.grouping,
                    ])}
                  >
                    {!listState.list.length && (
                      <tr>
                        <td colSpan={6}>
                          <Empty
                            title="Ничего не найдено"
                            action={
                              <button onClick={listState.resetFilters}>
                                Сбросить фильтры
                              </button>
                            }
                          >
                            Попробуйте изменить поиск или фильтры.
                          </Empty>
                        </td>
                      </tr>
                    )}
                    {listState.grouped.map(([key, apps]) => {
                      const isCollapsed = listState.collapsed.has(key);
                      return (
                        <Fragment key={key}>
                          {listState.grouping && (
                            <tr className="group-row">
                              <td colSpan={6}>
                                <button
                                  aria-expanded={!isCollapsed}
                                  onClick={() => listState.toggleCollapsed(key)}
                                >
                                  <ChevronDown
                                    size={15}
                                    className={isCollapsed ? "collapsed" : ""}
                                  />
                                  {listState.groupLabel(key)}
                                  <span className="count-chip">
                                    {apps.length}
                                  </span>
                                </button>
                              </td>
                            </tr>
                          )}
                          {listState.grouping ? (
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
                key={String(listState.cards)}
                transitionKey={JSON.stringify([
                  listState.currentPage,
                  listState.state,
                  listState.stage,
                  listState.priority,
                  listState.order,
                  listState.selectedGroup,
                  listState.search,
                  listState.hasTask,
                  listState.vacancyGroup,
                  listState.vacancyTag,
                  listState.grouping,
                ])}
              >
                {!listState.list.length && (
                  <Empty
                    title="Ничего не найдено"
                    action={
                      <button onClick={listState.resetFilters}>
                        Сбросить фильтры
                      </button>
                    }
                  >
                    Попробуйте изменить поиск или фильтры.
                  </Empty>
                )}
                {listState.grouped.map(([key, apps]) => {
                  const isCollapsed = listState.collapsed.has(key);
                  return (
                    <Fragment key={key}>
                      {listState.grouping && (
                        <button
                          className="mobile-group"
                          aria-expanded={!isCollapsed}
                          onClick={() => listState.toggleCollapsed(key)}
                        >
                          <ChevronDown
                            size={15}
                            className={isCollapsed ? "collapsed" : ""}
                          />
                          {listState.groupLabel(key)}
                          <span className="count-chip">{apps.length}</span>
                        </button>
                      )}
                      {listState.grouping ? (
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
                  {listState.currentPage * 20 + 1}–
                  {Math.min(
                    listState.list.length,
                    listState.currentPage * 20 + 20,
                  )}{" "}
                  из {listState.list.length}
                </small>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Предыдущая страница"
                    disabled={listState.currentPage === 0}
                    onClick={() => listState.setPage(listState.currentPage - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from(
                    { length: listState.pageCount },
                    (_, index) => index,
                  )
                    .filter(
                      (index) =>
                        index === 0 ||
                        index === listState.pageCount - 1 ||
                        Math.abs(index - listState.currentPage) <= 1,
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
                            index === listState.currentPage
                              ? "page-number active"
                              : "page-number"
                          }
                          aria-label={"Страница " + (index + 1)}
                          aria-current={
                            index === listState.currentPage ? "page" : undefined
                          }
                          onClick={() => listState.setPage(index)}
                        >
                          {index + 1}
                        </button>
                      </Fragment>
                    ))}
                  <span className="sr-only" role="status">
                    {listState.currentPage + 1} / {listState.pageCount}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Следующая страница"
                    disabled={listState.currentPage + 1 === listState.pageCount}
                    onClick={() => listState.setPage(listState.currentPage + 1)}
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
            (listState.statistics ? " is-open" : "")
          }
          aria-hidden={!listState.statistics}
        >
          <aside className="application-statistics">
            <section className="panel">
              <span className="eyebrow">Текущая выборка</span>
              <h2>Статистика</h2>
              <div className="summary-total">
                <strong>{listState.list.length}</strong>
                <span>
                  вакансий
                  <br />
                  <small>{listState.active} активных</small>
                </span>
              </div>
              <StageBreakdown applications={listState.list} />
            </section>
            <section className="panel response-panel">
              <h3>Продвижение по этапам</h3>
              <div
                className="progress-ring"
                style={
                  {
                    "--progress": `${listState.rate * 3.6}deg`,
                  } as CSSProperties
                }
              >
                <div>
                  <strong>{listState.rate}%</strong>
                  <small>дошли до HR и дальше</small>
                </div>
              </div>
              <p>
                {listState.advanced} из {listState.list.length} вакансий на этапах
                HR, интервью, финала или оффера.
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
                  listState.list.filter(
                    (a) => a.state === "active" && !listState.next(a.id),
                  ).length,
                  "активный",
                )}
                .
              </p>
              <button
                className="text-button"
                onClick={() => {
                  listState.setHasTask(true);
                  listState.setState("active");
                }}
              >
                Посмотреть запланированные <ArrowUpRight size={14} />
              </button>
            </section>
          </aside>
        </div>
      </div>
      <OutcomeModal
        isOpen={!!listState.outcomeModalApp}
        application={listState.outcomeModalApp}
        onClose={listState.handleCancelOutcome}
        onConfirm={listState.handleConfirmOutcome}
      />
      <StaleActionModal
        isOpen={!!listState.staleModalApp}
        application={listState.staleModalApp}
        timezone={user.timezone}
        onClose={() => listState.setStaleModalApp(null)}
        onPause={listState.handleStalePause}
        onCloseOutcome={listState.handleStaleCloseOutcome}
        onCreateTask={listState.handleStaleCreateTask}
      />
    </>
  );
}
function TagEditorScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ ratio: 1, progress: 0 });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      setScroll({
        ratio: element.clientWidth / Math.max(1, element.scrollWidth),
        progress: maxScroll > 0 ? element.scrollLeft / maxScroll : 0,
      });
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [children]);

  return (
    <div className="tag-editor-scroll-wrapper">
      <div className="tag-editor-scroll" ref={scrollRef}>
        {children}
      </div>
      {scroll.ratio < 1 && (
        <div
          className="group-chips-custom-scrollbar visible tag-editor-scrollbar"
          onClick={(event) => {
            event.stopPropagation();
            const element = scrollRef.current;
            if (!element) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(
              0,
              Math.min(1, (event.clientX - rect.left) / rect.width),
            );
            element.scrollTo({
              left: ratio * (element.scrollWidth - element.clientWidth),
              behavior: "smooth",
            });
          }}
        >
          <div
            className="group-chips-custom-thumb"
            style={{
              width: `${scroll.ratio * 100}%`,
              left: `${scroll.progress * (1 - scroll.ratio) * 100}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

function ApplicationDetail() {
  const { id } = useParams();
  const { user, data, refresh, editTask, addNote } = useApp();
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
  const [detailSaving, setDetailSaving] = useState(false);
  const detailSavingRef = useRef(false);
  const [detailError, setDetailError] = useState<unknown>();
  const [detailConflict, setDetailConflict] = useState<{
    local: Application;
    server: Application;
    patch?: {
      type: "stage" | "state" | "favorite" | "tags";
      stage?: string;
      state?: string;
      outcome?: string;
      favorite?: boolean;
      tags?: string[];
    };
  } | null>(null);
  const [outcomeDetailOpen, setOutcomeDetailOpen] = useState(false);
  const [staleDetailModalOpen, setStaleDetailModalOpen] = useState(false);

  const q = useQuery({
    queryKey: ["detail", id],
    queryFn: async () => {
      try {
        const epoch = getUserGeneration(user.id);
        const detail = await api<Detail>("/applications/" + id);
        if (id) {
          void offlineManager.recordDetailFetch(user.id, id, detail, epoch);
        }
        return detail;
      } catch (err) {
        if (isNetworkError(err) && id) {
          const cached = await offlineManager.getCachedDetail(user.id, id);
          if (cached?.detail) {
            return cached.detail as Detail;
          }
        }
        throw err;
      }
    },
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const a = d.application;

  const saveDetailApplication = async (
    updated: Application,
    patchIntent?: {
      type: "stage" | "state" | "favorite" | "tags";
      stage?: string;
      state?: string;
      outcome?: string;
      favorite?: boolean;
      tags?: string[];
    },
  ) => {
    if (detailSavingRef.current) return;
    detailSavingRef.current = true;
    setDetailSaving(true);
    setDetailError(undefined);
    try {
      await api<Application>("/applications/" + updated.id, "PUT", updated);
      setDetailConflict(null);
      await refresh();
      await q.refetch();
    } catch (err) {
      if (err instanceof APIError && err.status === 409) {
        await refresh();
        const res = await q.refetch();
        if (res.data?.application) {
          setDetailConflict({
            local: updated,
            server: res.data.application,
            patch: patchIntent,
          });
        }
        setDetailError(new Error("Конфликт изменений: вакансия была обновлена на сервере."));
      } else {
        setDetailError(err);
      }
      throw err;
    } finally {
      detailSavingRef.current = false;
      setDetailSaving(false);
    }
  };

  const handleDetailStageChange = async (newStage: string) => {
    if (a.stage === newStage || detailSavingRef.current) return;
    let appliedDate = a.appliedDate;
    if (a.stage === "saved" && newStage !== "saved" && !appliedDate) {
      appliedDate = dateToday(user.timezone);
    }
    try {
      await saveDetailApplication(
        { ...a, stage: newStage, appliedDate },
        { type: "stage", stage: newStage },
      );
    } catch {
      /* error captured in detailError */
    }
  };

  const handleDetailStateChange = async (newState: string) => {
    if (a.state === newState || detailSavingRef.current) return;
    if (newState === "closed") {
      setOutcomeDetailOpen(true);
      return;
    }
    try {
      await saveDetailApplication(
        { ...a, state: newState, outcome: "" },
        { type: "state", state: newState, outcome: "" },
      );
    } catch {
      /* error captured in detailError */
    }
  };

  const handleDetailToggleFavorite = async () => {
    if (detailSavingRef.current) return;
    const nextFavorite = !a.favorite;
    try {
      await saveDetailApplication(
        { ...a, favorite: nextFavorite },
        { type: "favorite", favorite: nextFavorite },
      );
    } catch {
      /* error captured in detailError */
    }
  };

  const saveTags = async (tags: string[]) => {
    setTagBusy(true);
    setTagError(undefined);
    try {
      await saveDetailApplication(
        { ...a, tags },
        { type: "tags", tags },
      );
      setNewTag("");
      setTagDropdownOpen(false);
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
            huntflow: "Huntflow",
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
      <PageHeader
        title={a.company}
        subtitle={a.position}
        logo={
          <CompanyAvatar
            name={a.company}
            logoUrl={a.companyLogo}
            className="page-header-avatar"
          />
        }
      >
        <div className="detail-header-actions">
          {isApplicationStale(a) && (
            <button
              type="button"
              className="stale-warning-btn-header"
              aria-label="Внимание: не было активности более 10 дней"
              title="Внимание: не было активности более 10 дней"
              onClick={() => setStaleDetailModalOpen(true)}
            >
              <ClockAlert size={16} />
              <span>Требует внимания (&gt;10 дней)</span>
            </button>
          )}
          <button
            type="button"
            className={`favorite-toggle-btn ${a.favorite ? "is-favorite active" : ""}`}
            aria-label={a.favorite ? "Удалить из избранного" : "Добавить в избранное"}
            title={a.favorite ? "Удалить из избранного" : "Добавить в избранное"}
            onClick={handleDetailToggleFavorite}
          >
            <Star size={15} fill={a.favorite ? "currentColor" : "none"} />
            <span>{a.favorite ? "В избранном" : "В избранное"}</span>
          </button>
        </div>
      </PageHeader>
      {Boolean(detailError) && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBox error={detailError} />
        </div>
      )}
      {detailConflict && (
        <div
          className="conflict conflict-row"
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong>Конфликт изменений:</strong> Вакансия была изменена на сервере.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {detailConflict.patch && (
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  const { server: serverApp, patch } = detailConflict;
                  if (!patch) return;
                  let patchFields: Partial<Application> = {};

                  if (patch.type === "stage" && patch.stage !== undefined) {
                    const appliedDate =
                      (serverApp.stage === "saved" || !serverApp.appliedDate) && patch.stage !== "saved"
                        ? (serverApp.appliedDate || dateToday(user.timezone))
                        : serverApp.appliedDate;
                    patchFields = {
                      stage: patch.stage,
                      appliedDate,
                    };
                  } else if (patch.type === "state" && patch.state !== undefined) {
                    patchFields = {
                      state: patch.state,
                      outcome: patch.outcome ?? (patch.state === "closed" ? detailConflict.local.outcome : ""),
                    };
                  } else if (patch.type === "favorite" && patch.favorite !== undefined) {
                    patchFields = {
                      favorite: patch.favorite,
                    };
                  } else if (patch.type === "tags" && patch.tags !== undefined) {
                    patchFields = {
                      tags: patch.tags,
                    };
                  } else {
                    return;
                  }

                  const toSave: Application = {
                    ...serverApp,
                    ...patchFields,
                    version: serverApp.version,
                  };
                  try {
                    await saveDetailApplication(toSave, patch);
                  } catch {
                    /* handled in saveDetailApplication */
                  }
                }}
              >
                Повторить изменение
              </button>
            )}
            <button
              type="button"
              onClick={() => setDetailConflict(null)}
            >
              {detailConflict.patch ? "Отмена" : "Закрыть"}
            </button>
          </div>
        </div>
      )}
      <div className="detail-meta-row">
        <div className="detail-badges">
          {(a.groups ?? []).map((group) => (
            <span
              className={`count-chip badge-group tag-color-${groupColorIndex(group)}`}
              key={group}
            >
              {group}
            </span>
          ))}
          <BadgeDropdown
            value={a.stage}
            kind="stage"
            disabled={detailSaving}
            onChange={handleDetailStageChange}
          />
          <BadgeDropdown
            value={a.state}
            kind="state"
            disabled={detailSaving}
            onChange={handleDetailStateChange}
          />
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
            <TagEditorScroll>
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
                        ?.querySelector<HTMLButtonElement>(
                          ".group-dropdown-item",
                        )
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
            </TagEditorScroll>
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
                    · {e.source === "mcp" ? "MCP" : e.source === "telegram" ? "Telegram" : e.source === "extension" ? "Расширение" : "Вручную"}
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
      <OutcomeModal
        isOpen={outcomeDetailOpen}
        application={a}
        onClose={() => setOutcomeDetailOpen(false)}
        onConfirm={async (outcome) => {
          const latestApp = (await q.refetch()).data?.application ?? a;
          await saveDetailApplication(
            { ...latestApp, state: "closed", outcome },
            { type: "state", state: "closed", outcome },
          );
          setOutcomeDetailOpen(false);
        }}
      />
      <StaleActionModal
        isOpen={staleDetailModalOpen}
        application={a}
        timezone={user.timezone}
        onClose={() => setStaleDetailModalOpen(false)}
        onPause={async () => {
          const latestApp = (await q.refetch()).data?.application ?? a;
          await saveDetailApplication(
            { ...latestApp, state: "paused", outcome: "" },
            { type: "state", state: "paused", outcome: "" },
          );
          setStaleDetailModalOpen(false);
        }}
        onCloseOutcome={async (outcome) => {
          const latestApp = (await q.refetch()).data?.application ?? a;
          await saveDetailApplication(
            { ...latestApp, state: "closed", outcome },
            { type: "state", state: "closed", outcome },
          );
          setStaleDetailModalOpen(false);
        }}
        onCreateTask={async (task) => {
          await api("/tasks", "POST", {
            applicationId: a.id,
            title: task.title,
            date: task.date,
            time: task.time,
            state: "open",
          });
          await refresh();
          await q.refetch();
          setStaleDetailModalOpen(false);
        }}
      />
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
  const [busy, setBusy] = useState(false);
  const applying = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<unknown>();
  const applyAll = async () => {
    if (applying.current || !proposals.length) return;
    applying.current = true;
    setBusy(true);
    setNotice("");
    setError(undefined);
    let applied = 0;
    let failed = 0;
    let firstError: unknown;
    try {
      for (const proposal of proposals) {
        try {
          await api("/proposals/" + proposal.id, "POST", {
            action: "apply",
            version: proposal.current.version,
          });
          applied++;
        } catch (e) {
          failed++;
          firstError ??= e;
        }
      }
      setNotice(`Применено: ${applied}.`);
      if (failed) {
        setError(
          new Error(
            `Не удалось применить: ${failed}. Проверьте оставшиеся предложения. ${firstError instanceof Error ? firstError.message : ""}`,
          ),
        );
      }
    } finally {
      refresh();
      applying.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Предложения"
        subtitle="Вы решаете, какие изменения попадут в журнал"
      >
        {proposals.length > 0 && (
          <button className="text-button" disabled={busy} onClick={applyAll}>
            {busy ? "Применяем…" : "Применить всё"}
          </button>
        )}
      </PageHeader>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <ErrorBox error={error} />
      {proposals.length ? (
        <fieldset
          className="proposals-grid"
          disabled={busy}
          aria-label="Предложения изменений"
          aria-busy={busy}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
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
        </fieldset>
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
      {["localhost", "127.0.0.1"].includes(location.hostname) && (
        <p className="notice">
          Внешние календарные сервисы не могут прочитать localhost. Для подписки
          нужен доступный извне HTTPS-адрес Avari.Jobs.
        </p>
      )}
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

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNotice("Ссылка скопирована");
      setError(undefined);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        new Error(
          "Не удалось скопировать. Выделите ссылку и скопируйте её вручную.",
        ),
      );
    }
  };

  return (
    <div className="extension-download-card">
      <ErrorBox error={error} />
      {notice && (
        <div className="success notice" role="status">
          {notice}
        </div>
      )}
      {download.isPending ? (
        <Loading />
      ) : url ? (
        <div className="extension-download-content">
          <div className="extension-download-input-row">
            <FieldInput
              label="Индивидуальная ссылка на ZIP-архив"
              hint="Ссылка привязана к вашей учётной записи. Не публикуйте её в открытом доступе."
            >
              <input
                readOnly
                value={url}
                className="extension-download-input"
                onFocus={(e) => e.currentTarget.select()}
              />
            </FieldInput>
              <button
                type="button"
                className="button extension-copy-btn"
                disabled={busy}
                onClick={handleCopy}
                title="Скопировать ссылку"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Скопировано" : "Скопировать ссылку"}</span>
              </button>
          </div>
          <div className="actions extension-download-actions">
            <a className="button primary" href={url} download>
              <Download size={15} /> Скачать ZIP расширения
            </a>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={generate}
            >
              <RefreshCw size={14} className={busy ? "spin" : ""} />
              <span>Сменить ссылку</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={generate}
          >
            <Download size={15} />
            <span>Создать персональную ссылку скачивания</span>
          </button>
        </div>
      )}
    </div>
  );
}
function SettingsPage() {
  const settingsLocation = useLocation();
  const local = useQuery({
    queryKey: ["local-status"],
    queryFn: () => api<LocalStatus>("/local/status"),
  });
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
    "general" | "calendar" | "fields" | "extension" | "transfer" | "mcp"
  >("general");
  useEffect(() => {
    if (settingsLocation.hash === "#updates") setActiveTab("general");
  }, [settingsLocation.hash]);
  const connectedExtensionsCount =
    sessions.data?.filter((s) => s.kind === "extension").length ?? 0;

  return (
    <>
      <PageHeader
        title="Настройки"
        subtitle="Настройте журнал под свой поиск"
      />
      <p><Link to="/whats-new">Что нового в Avari.Jobs</Link></p>
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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "transfer"}
          className={activeTab === "transfer" ? "active" : ""}
          onClick={() => setActiveTab("transfer")}
        >
          <Download size={15} />
          Импорт и экспорт
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "mcp"} className={activeTab === "mcp" ? "active" : ""} onClick={() => setActiveTab("mcp")}>
          <Monitor size={15} /> MCP / Codex
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
          {activeTab === "mcp" && <MCPSettings api={api} />}
          {activeTab === "transfer" && (
            <TransferPanel
              user={user}
              onImported={() => {
                void client.invalidateQueries({ queryKey: ["me"] });
                refresh();
                void api<Field[]>("/fields").then(setFields);
              }}
            />
          )}

          {activeTab === "general" && (
            <>
              {local.data?.personal && (
                <LocalAutostart launcher={local.data.launcher} />
              )}

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

              <TelegramSettings api={api} />
              {!local.data?.personal && <PushSettings userId={user.id} api={api} />}
              {!local.data?.personal && (
                <OfflineSettingsPanel userKey={user.id} user={user} data={data} />
              )}
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
