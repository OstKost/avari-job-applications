import type { components } from "./generated-api";
export {
  jobIdentity,
  jobSite,
  jobSitesLabel,
  jobResponsesSite,
  jobFavoritesSite,
  observationBelongsToPage,
} from "./job-sites";
export { exportApplicationsToCSV, downloadCSV } from "./csv";
export type Journal = components["schemas"]["Journal"];
export type ImportRequest = components["schemas"]["ImportRequest"];
export type ImportReport = components["schemas"]["ImportReport"];
export type LocalStatus = components["schemas"]["LocalStatus"];
export type UpdateStatus = components["schemas"]["UpdateStatus"];
export type ReleaseNote = components["schemas"]["ReleaseNote"];
export type LocalSettings = components["schemas"]["LocalSettings"];
export type TelegramChallenge = components["schemas"]["TelegramChallenge"];
export type User = components["schemas"]["User"];
export type Session = components["schemas"]["Session"];
export type Salary = components["schemas"]["Salary"];
export type Application = Omit<
  components["schemas"]["Application"],
  "groups" | "tags"
> & {
  groups?: string[];
  tags?: string[];
  lastActivityAt?: string;
  stale?: boolean;
};
export type Task = components["schemas"]["Task"];
export type CalendarSubscription =
  components["schemas"]["CalendarSubscription"];
export type ExtensionDownload = components["schemas"]["ExtensionDownload"];
export type Note = components["schemas"]["Note"];
export type Field = components["schemas"]["Field"];
export type ActivityStatistics = components["schemas"]["ActivityStatistics"];
export type HistoryEvent = components["schemas"]["HistoryEvent"];
export type Proposal = components["schemas"]["Proposal"];
export type Detail = components["schemas"]["Detail"];

export type ResumeVersion = components["schemas"]["ResumeVersion"];
export type Resume = components["schemas"]["Resume"];

export const stages: Record<string, string> = {
  saved: "Сохранена",
  applied: "Отклик",
  hr: "HR",
  interview: "Интервью",
  final: "Финал",
  offer: "Оффер",
};
export const states: Record<string, string> = {
  active: "Активен",
  paused: "Приостановлен",
  closed: "Закрыт",
};
export const outcomes: Record<string, string> = {
  employer_rejected: "Отказ работодателя",
  self_rejected: "Мой отказ",
  vacancy_closed: "Вакансия закрыта",
  offer_accepted: "Оффер принят",
  other: "Другое",
};
export const externalStatuses: Record<string, string> = {
  favorite: "В избранном",
  applied: "Отклик отправлен",
  waiting: "Ожидание",
  viewed: "Просмотрен",
  invited: "Приглашение",
  interview: "Собеседование",
  rejected: "Отказ",
  vacancy_closed: "Вакансия закрыта",
  hired: "Выход на работу",
  archived: "Архив",
  hr: "HR интервью",
  final: "Финальное интервью",
  offer: "Оффер",
  test_assignment: "Тестовое задание",
  no_response: "Не отвечают",
  unknown: "Неизвестно",
};
export const fieldLabels: Record<string, string> = {
  favorite: "Избранное",
  groups: "Группа",
  tags: "Теги",
  company: "Компания",
  position: "Позиция",
  url: "Ссылка",
  hhId: "ID hh.ru",
  savedDate: "Дата сохранения",
  appliedDate: "Дата отклика",
  stage: "Этап",
  state: "Состояние",
  outcome: "Результат",
  salary: "Зарплата",
  location: "Локация",
  workFormat: "Формат работы",
  recruiter: "Контакт рекрутера",
  companyLogo: "Логотип компании",
  externalStatus: "Состояние на сайте",
  custom: "Дополнительные поля",
  title: "Задача",
  date: "Дата",
  time: "Время",
  kind: "Тип",
  applicationId: "Вакансия",
  text: "Текст заметки",
};
export function displayValue(
  key: string,
  value: unknown,
  fields: Field[] = [],
  applications: Application[] = [],
): string {
  if (value == null || value === "") return "—";
  if (key === "favorite") return value ? "Да" : "Нет";
  if (key === "stage") return stages[String(value)] ?? String(value);
  if (key === "state")
    return (
      states[String(value)] ??
      { open: "Открыта", done: "Выполнена" }[String(value)] ??
      String(value)
    );
  if (key === "outcome") return outcomes[String(value)] ?? String(value);
  if (key === "externalStatus")
    return (
      externalStatuses[String(value)] ??
      String(value).replace(/^unknown:/, "Неизвестно: ")
    );
  if (key === "kind")
    return (
      ({ task: "Задача", interview: "Интервью" } as Record<string, string>)[
        String(value)
      ] ?? String(value)
    );
  if (key === "applicationId") {
    const a = applications.find((a) => a.id === value);
    return a ? a.company + " · " + a.position : "Связана с вакансией";
  }
  if (key === "custom" && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length
      ? entries
          .map(
            ([id, v]) =>
              (fields.find((f) => f.id === id)?.name ?? "Удалённое поле") +
              ": " +
              displayValue("", v),
          )
          .join("; ")
      : "—";
  }
  if (key === "salary" && typeof value === "object") {
    const s = value as Salary;
    const n = (v: number) => new Intl.NumberFormat("ru-RU").format(v);
    return s.min == null && s.max == null
      ? "—"
      : (s.min != null && s.max != null
          ? s.min === s.max
            ? n(s.min)
            : n(s.min) + "–" + n(s.max)
          : s.min != null
            ? "от " + n(s.min)
            : "до " + n(s.max!)) +
          " " +
          s.currency +
          " " +
          ((
            {
              month: "в месяц",
              year: "в год",
              hour: "в час",
              project: "за проект",
            } as Record<string, string>
          )[s.period] ?? "") +
          " " +
          (({ gross: "до налогов", net: "на руки" } as Record<string, string>)[
            s.tax
          ] ?? "");
  }
  if (
    ["savedDate", "appliedDate", "date"].includes(key) &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    return dateLabel(value);
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function dateToday(timezone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Returns the next weekday date (YYYY-MM-DD) in user's timezone.
 * "next weekday (account timezone, weekends only)"
 * If today is Friday, Saturday, or Sunday, advances to next Monday.
 * If today is Monday-Thursday, advances to tomorrow.
 */
export function nextWeekday(timezone?: string, fromDate = new Date()): string {
  // Format current date in target timezone to get Y, M, D
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  // Calculate day-by-day
  // Let's create a date and advance it day by day until it's Mon-Fri
  // To avoid DST jumping bugs, advance UTC milliseconds from an aligned noon
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(fromDate);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  // Start from next calendar day
  const current = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  current.setUTCDate(current.getUTCDate() + 1);
  while (current.getUTCDay() === 0 || current.getUTCDay() === 6) {
    current.setUTCDate(current.getUTCDate() + 1);
  }
  const outY = current.getUTCFullYear();
  const outM = String(current.getUTCMonth() + 1).padStart(2, "0");
  const outD = String(current.getUTCDate()).padStart(2, "0");
  return `${outY}-${outM}-${outD}`;
}

export function dateLabel(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", options).format(
    new Date(value.length === 10 ? value + "T12:00:00" : value),
  );
}
export function emptyApplication(): Application {
  return {
    id: "",
    company: "",
    position: "",
    url: "",
    hhId: "",
    savedDate: dateToday(),
    appliedDate: "",
    stage: "saved",
    state: "active",
    outcome: "",
    salary: { min: null, max: null, currency: "RUB", period: "month", tax: "" },
    location: "",
    workFormat: "",
    recruiter: "",
    companyLogo: "",
    favorite: false,
    externalStatus: "",
    custom: {},
    version: 0,
    createdAt: "",
    updatedAt: "",
  };
}
export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public current?: unknown,
  ) {
    super(message);
  }
}
export type Transport = <T>(
  path: string,
  method?: string,
  body?: unknown,
  key?: string,
  options?: { signal?: AbortSignal },
) => Promise<T>;
export function createAPI(base = "", token?: string): Transport {
  return async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    options?: { signal?: AbortSignal },
  ) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    else if (method !== "GET") {
      const csrf = document.cookie
        .split("; ")
        .find((v) => v.startsWith("avari_csrf="))
        ?.slice(11);
      if (csrf) headers["X-CSRF-Token"] = csrf;
    }
    if (key) headers["Idempotency-Key"] = key;
    const response = await fetch(base + "/api/v1" + path, {
      method,
      headers,
      credentials: token ? "omit" : "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    }).catch((error) => {
      if (options?.signal?.aborted) throw error;
      throw new APIError(
        0,
        "Нет соединения с сервером. Проверьте подключение и повторите.",
      );
    });
    const payload = await response.json().catch(() => {
      throw new APIError(
        response.ok ? 502 : response.status,
        "Сервер вернул некорректный ответ. Проверьте адрес сервиса.",
      );
    });
    if (
      !response.ok &&
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/me" &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("avari-session-expired"));
    if (!response.ok)
      throw new APIError(
        response.status,
        payload.error ?? "Ошибка запроса",
        payload.current,
      );
    return payload as T;
  };
}
export function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) =>
    (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")),
  );
}

export function companyColorIndex(name: string, total = 16): number {
  const normalized = (name || "").trim().toLowerCase();
  if (!normalized) return 0;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return hash % total;
}

/** Stable palette index independent of a tag's case or display prefix. */
export function tagColorIndex(tag: string): number {
  return companyColorIndex(tag.trim().replace(/^#+/, "").normalize("NFC"), 16);
}

export function tagLabel(tag: string): string {
  return "#" + tag.trim().replace(/^#+/, "");
}

export function companyInitials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "??";
  const words = trimmed.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) {
    const first = Array.from(words[0])[0] || "";
    const second = Array.from(words[1])[0] || "";
    return (first + second).toUpperCase();
  }
  return Array.from(trimmed).slice(0, 2).join("").toUpperCase();
}

export function pluralize(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(count) % 100;
  const rem = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (rem > 1 && rem < 5) return few;
  if (rem === 1) return one;
  return many;
}

export function pluralTasks(count: number, adjective?: string): string {
  if (adjective === "открытая") {
    const adj = pluralize(count, "открытая", "открытые", "открытых");
    const noun = pluralize(count, "задача", "задачи", "задач");
    return `${count} ${adj} ${noun}`;
  }
  if (adjective === "просроченная") {
    const adj = pluralize(
      count,
      "просроченная",
      "просроченные",
      "просроченных",
    );
    const noun = pluralize(count, "задача", "задачи", "задач");
    return `${count} ${adj} ${noun}`;
  }
  return `${count} ${pluralize(count, "задача", "задачи", "задач")}`;
}

export function pluralApplications(count: number, adjective?: string): string {
  if (adjective === "активный") {
    const adj = pluralize(count, "активный", "активных", "активных");
    const noun = pluralize(count, "отклик", "отклика", "откликов");
    return `${count} ${adj} ${noun}`;
  }
  return `${count} ${pluralize(count, "отклик", "отклика", "откликов")}`;
}

export async function gravatarUrl(
  email: string,
  size = 80,
  defaultParam = "404",
): Promise<string> {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return "";
  try {
    const data = new TextEncoder().encode(normalized);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${encodeURIComponent(defaultParam)}`;
  } catch {
    return "";
  }
}

export function isApplicationStale(a: Application): boolean {
  if (a.state !== "active") return false;
  if (typeof a.stale === "boolean") return a.stale;
  const activity = a.lastActivityAt || a.appliedDate || a.savedDate || a.createdAt;
  if (!activity) return false;
  const timestamp = new Date(activity).getTime();
  if (isNaN(timestamp)) return false;
  const diffHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  return diffHours >= 240;
}

export { readVacancyClipboard } from "./vacancy-preview";
