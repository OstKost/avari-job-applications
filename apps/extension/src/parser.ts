import {
  emptyApplication,
  jobIdentity,
  jobSite,
  jobResponsesSite,
  type Application,
} from "@avari/shared";
export type ParsedObservation = {
  hhId?: string;
  vacancyUrl?: string;
  status: string;
  url: string;
  candidate?: Application;
};
export type Snapshot = {
  supported: boolean;
  kind: "vacancy" | "responses" | "unsupported";
  vacancy?: Application;
  observations: ParsedObservation[];
  warning?: string;
};
const clean = (text: string) =>
  text
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
// hh uses relative dates and omits the year for recent responses.
export function responseDate(raw: string, today = new Date()): string {
  const value = clean(raw).toLowerCase();
  const date = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12,
  );
  if (value === "вчера") date.setDate(date.getDate() - 1);
  else if (value === "позавчера") date.setDate(date.getDate() - 2);
  else if (value !== "сегодня") {
    const months = [
      "января",
      "февраля",
      "марта",
      "апреля",
      "мая",
      "июня",
      "июля",
      "августа",
      "сентября",
      "октября",
      "ноября",
      "декабря",
    ];
    const named = value.match(/^(\d{1,2}) ([а-я]+)(?: (\d{4}))?$/);
    const numeric = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const day = Number(named?.[1] ?? numeric?.[1] ?? iso?.[3]);
    const month = named
      ? months.indexOf(named[2])
      : Number(numeric?.[2] ?? iso?.[2]) - 1;
    let year = Number(
      named?.[3] ?? numeric?.[3] ?? iso?.[1] ?? today.getFullYear(),
    );
    if (!day || month < 0 || month > 11) return "";
    if (
      named &&
      !named[3] &&
      (month > today.getMonth() ||
        (month === today.getMonth() && day > today.getDate()))
    )
      year--;
    date.setFullYear(year, month, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day
    )
      return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function recentResponse(date: string, today = new Date()): boolean {
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12,
  );
  const start = new Date(end);
  start.setDate(1);
  start.setMonth(start.getMonth() - 1);
  start.setDate(
    Math.min(
      end.getDate(),
      new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
    ),
  );
  const parsed = new Date(date + "T12:00:00");
  return !!date && parsed >= start && parsed <= end;
}
function text(root: ParentNode, selectors: string[]) {
  for (const selector of selectors) {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;
      if (el.ownerDocument.defaultView?.getComputedStyle(el).display === "none")
        continue;
      const value = clean(el.innerText ?? el.textContent ?? "");
      if (value) return value;
    }
  }
  return "";
}
function imageSrc(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;
      if (el.ownerDocument.defaultView?.getComputedStyle(el).display === "none")
        continue;
      const src =
        el.getAttribute("src") ||
        el.getAttribute("data-src") ||
        (el instanceof HTMLImageElement ? el.src : "");
      if (src && /^https?:\/\//i.test(src)) return src.trim();
    }
  }
  return "";
}
export function statusFromText(raw: string): string {
  const s = clean(raw).toLowerCase();
  if (!s) return "";
  const english: Record<string, string> = {
    applied: "applied",
    "application submitted": "applied",
    "you applied": "applied",
    "application viewed": "viewed",
    "awaiting response": "waiting",
    "invited to interview": "interview",
    "application rejected": "rejected",
    "no longer accepting applications": "vacancy_closed",
    "job closed": "vacancy_closed",
  };
  if (english[s]) return english[s];
  const stages: Record<string, string> = {
    отклик: "applied",
    отправлен: "applied",
    "hr интервью": "hr",
    "техническое интервью": "interview",
    "финальное интервью": "final",
    "тестовое задание": "test_assignment",
    оффер: "offer",
    "no response": "no_response",
  };
  if (stages[s]) return stages[s];
  if (/ваканси[яию].*(?:закрыта|закрыт|в архиве)/.test(s))
    return "vacancy_closed";
  if (/^(?:отказ|вам отказали|отклик отклонён|отклик отклонен)$/.test(s))
    return "rejected";
  if (/собеседование|приглашение на интервью/.test(s)) return "interview";
  if (/^(?:приглашение|вас пригласили|приглашены)$/.test(s)) return "invited";
  if (/^(?:выход на работу|трудоустроен|трудоустроены)$/.test(s))
    return "hired";
  if (/^(?:просмотрен|просмотрено|отклик просмотрен)$/.test(s)) return "viewed";
  if (
    /^(?:не просмотрен|не просмотрено|ожидание|ожидает просмотра|ожидает ответа)$/.test(
      s,
    )
  )
    return "waiting";
  if (/^(?:вы откликнулись|отклик отправлен|вы уже откликнулись)$/.test(s))
    return "applied";
  if (/^архив$/.test(s)) return "archived";
  return "unknown:" + s.slice(0, 150);
}
export function parseSalary(raw: string) {
  const out = emptyApplication().salary;
  const s = clean(raw).toLowerCase();
  out.tax = /на руки|after tax|net/.test(s)
    ? "net"
    : /до вычета|до налог|before tax|gross/.test(s)
      ? "gross"
      : "";
  out.period = /в год|за год|\/yr|\/year|per year|annually/.test(s)
    ? "year"
    : /в час|за час|\/hr|\/hour|per hour|hourly/.test(s)
      ? "hour"
      : /за проект/.test(s)
        ? "project"
        : "month";
  out.currency = /usd|\$|доллар/.test(s)
    ? "USD"
    : /eur|€|евро/.test(s)
      ? "EUR"
      : /₸|kzt|тенге/.test(s)
        ? "KZT"
        : /byn|бел.*руб/.test(s)
          ? "BYN"
          : "RUB";
  const salaryPart = s
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1")
    .split(
      /на руки|до вычета|за месяц|в месяц|в год|за год|в час|за час|за проект/,
    )[0];
  const numbers = (salaryPart.match(/\d[\d ]*(?:[.,]\d+)?/g) ?? []).map((n) =>
    Number(n.replace(/ /g, "").replace(",", ".")),
  );
  if (numbers.length >= 2) {
    out.min = numbers[0];
    out.max = numbers[1];
  } else if (numbers.length === 1) {
    if (/(?:^|\s)(?:до|up to)(?:\s|$)/.test(salaryPart)) {
      out.max = numbers[0];
    } else {
      out.min = numbers[0];
      if (!/(?:^|\s)(?:от|from)(?:\s|$)/.test(salaryPart)) out.max = numbers[0];
    }
  }
  return out;
}
function structuredJob(doc: Document): Record<string, any> | undefined {
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(el.textContent ?? "null");
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        if (
          node["@type"] === "JobPosting" ||
          (Array.isArray(node["@type"]) && node["@type"].includes("JobPosting"))
        )
          return node;
        if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
      }
    } catch {
      continue;
    }
  }
}

function salaryFromJob(job: Record<string, any> | undefined) {
  const salary = emptyApplication().salary;
  const base = job?.baseSalary;
  if (!base || typeof base !== "object") return salary;
  const value = base.value;
  salary.min =
    typeof value === "number"
      ? value
      : typeof value?.minValue === "number"
        ? value.minValue
        : typeof value?.value === "number"
          ? value.value
          : null;
  salary.max = typeof value?.maxValue === "number" ? value.maxValue : null;
  const curr = typeof base.currency === "string" ? base.currency : "";
  salary.currency = curr.toUpperCase() === "RUR" ? "RUB" : curr;
  salary.period =
    ({ HOUR: "hour", YEAR: "year", MONTH: "month" } as Record<string, string>)[
      value?.unitText
    ] ?? "month";
  return salary;
}

function parseResponseList(doc: Document, rawURL: string): Snapshot {
  const site = jobResponsesSite(rawURL);
  const url = new URL(rawURL);
  const observations: ParsedObservation[] = [];
  const rows =
    site === "getmatch"
      ? doc.querySelectorAll('article[class*="applicationCard-module__"]')
      : doc.querySelectorAll(".applications-table__row");
  for (const row of rows) {
    const link = row.querySelector<HTMLAnchorElement>(
      site === "getmatch"
        ? 'h3 a[href*="/vacancies/"]'
        : ".applications-table__job-link",
    );
    if (!link || row.closest('[hidden], [aria-hidden="true"]')) continue;
    const identity = jobIdentity(
      new URL(link.getAttribute("href") ?? "", url).href,
    );
    if (!identity || identity.site !== site) continue;
    const rawStatus = text(
      row,
      site === "getmatch"
        ? ['[class*="__statusGroup"] > span:first-child']
        : [".applications-table__stage-select"],
    );
    if (!rawStatus) continue;
    observations.push({
      vacancyUrl: identity.url,
      status: statusFromText(rawStatus),
      url: url.origin + url.pathname,
    });
  }
  const byJob = new Map<string, Set<string>>();
  const unique = new Map<string, ParsedObservation>();
  for (const o of observations) {
    const statuses = byJob.get(o.vacancyUrl!) ?? new Set();
    statuses.add(o.status);
    byJob.set(o.vacancyUrl!, statuses);
    unique.set(o.vacancyUrl + ":" + o.status, o);
  }
  const conflicting = [...byJob.values()].some((values) => values.size > 1);
  return {
    supported: true,
    kind: "responses",
    observations: [...unique.values()].filter(
      (o) => byJob.get(o.vacancyUrl!)?.size === 1,
    ),
    warning: conflicting
      ? "Для части вакансий найдены противоречивые состояния. Проверьте их вручную."
      : !observations.length
        ? "На видимой странице не найдены состояния откликов. Это не означает отказ."
        : undefined,
  };
}

function linkedinHeader(doc: Document, rawURL: string) {
  const identity = jobIdentity(rawURL);
  if (!identity) return;
  const screen = doc.querySelector(
    '[data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails"], [data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"]',
  );
  const column = screen?.querySelector('[data-component-type="LazyColumn"]');
  const header = [...(column?.children ?? [])].find(
    (el) => el.querySelector('a[href*="/company/"]') && !el.querySelector("h2"),
  );
  if (!header || header.closest('[hidden], [aria-hidden="true"]')) return;
  if (
    new URL(rawURL).pathname.startsWith("/jobs/view/") &&
    !screen?.querySelector(
      '[id="JobDetails_ManageJobBanner_' +
        identity.id +
        '"], [id="JobDetails_AboutTheJob_' +
        identity.id +
        '"]',
    )
  )
    return;
  const titleLink = [
    ...header.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]'),
  ].find(
    (el) =>
      jobIdentity(new URL(el.getAttribute("href") ?? "", rawURL).href)?.url ===
        identity.url && !el.querySelector("svg"),
  );
  let position = titleLink ? clean(titleLink.textContent ?? "") : "";
  if (!new URL(rawURL).pathname.startsWith("/jobs/view/") && !position) return;
  // Direct SDUI cards use a paragraph for the title, without an h1 or job link.
  if (!position) {
    const pageTitle = doc.title.split(" | ")[0];
    position = [...header.querySelectorAll("p")].some(
      (el) => clean(el.textContent ?? "") === pageTitle,
    )
      ? pageTitle
      : "";
  }
  const companyLink = [...header.querySelectorAll('a[href*="/company/"]')].find(
    (el) => !el.querySelector("img, svg") && clean(el.textContent ?? ""),
  );
  const company = companyLink ? clean(companyLink.textContent ?? "") : "";
  const metadata = [...header.querySelectorAll("p")]
    .map((el) => clean(el.textContent ?? ""))
    .find((value) => value.includes("·"));
  const location = metadata?.split("·")[0].trim() ?? "";
  const workFormat =
    [...header.querySelectorAll("a")]
      .map((el) => clean(el.textContent ?? ""))
      .find((value) =>
        /^(?:Удал[её]нная работа|Удал[её]нно|Гибрид|Работа в офисе|В офисе|Remote|Hybrid|On-site)$/i.test(
          value,
        ),
      ) ?? "";
  return { header, position, company, location, workFormat };
}

function parseOtherSite(doc: Document, rawURL: string): Snapshot {
  if (jobResponsesSite(rawURL)) return parseResponseList(doc, rawURL);
  const identity = jobIdentity(rawURL);
  if (!identity)
    return { supported: false, kind: "unsupported", observations: [] };
  const { site } = identity;
  const job = structuredJob(doc);
  const vacancy = emptyApplication();
  const linkedin =
    site === "linkedin" ? linkedinHeader(doc, rawURL) : undefined;
  vacancy.url = identity.url;
  // Search pages may still show the previous selection while the new job loads.
  if (
    site === "linkedin" &&
    !new URL(rawURL).pathname.startsWith("/jobs/view/")
  ) {
    const selected = doc.querySelector(
      '.job-details-jobs-unified-top-card[data-job-id="' +
        identity.id +
        '"], .jobs-search__job-details--container[data-job-id="' +
        identity.id +
        '"]',
    );
    const titleLink = doc.querySelector<HTMLAnchorElement>(
      ".job-details-jobs-unified-top-card__job-title a",
    );
    const linkedJob = titleLink?.getAttribute("href");
    const linkedIdentity = linkedJob
      ? jobIdentity(new URL(linkedJob, rawURL).href)
      : undefined;
    if (!linkedin && !selected && linkedIdentity?.id !== identity.id)
      return { supported: false, kind: "unsupported", observations: [] };
  }
  const selectors = {
    linkedin: {
      position: [
        ".job-details-jobs-unified-top-card__job-title h1",
        ".job-details-jobs-unified-top-card__job-title",
        ".top-card-layout__title",
      ],
      company: [
        ".job-details-jobs-unified-top-card__company-name",
        ".topcard__org-name-link",
      ],
      location: [
        ".job-details-jobs-unified-top-card__primary-description-container .tvm__text:first-child",
        ".topcard__flavor--bullet",
      ],
      salary: [".salary.compensation__salary", ".compensation__salary"],
      status: [
        ".jobs-s-apply__application-status",
        ".job-details-jobs-unified-top-card__application-status",
        ".jobs-details-top-card__apply-error",
      ],
    },
    getmatch: {
      position: [".b-vacancy-header h1"],
      company: ['.b-vacancy-header h2 a[href^="/companies/"]'],
      location: [".b-vacancy-locations"],
      salary: [".b-vacancy-header h3"],
      status: [
        ".b-notification_danger b",
        '[data-qa="vacancy-response-status"]',
      ],
    },
    hirify: {
      position: [".vacancy-header h1"],
      company: [".vacancy-header .company-name"],
      location: [] as string[],
      salary: [],
      status: ['.vacancy-header [data-qa="vacancy-response-status"]'],
    },
    geekjob: {
      position: [".vacancy h1", "h1"],
      company: [
        ".vacancy .company-name a[href*='/company/']",
        ".company-name a",
        ".vacancy .company-name",
      ],
      location: [".vacancy .location"],
      salary: [".vacancy .salary", ".serp-list .salary"],
      status: [] as string[],
    },
    habr: {
      position: [".page-title__title", ".vacancy-header__title h1", "h1"],
      company: [
        ".company_name a[href*='/companies/']",
        ".company_name",
        ".company-name",
      ],
      location: [".vacancy-header .location", ".basic-section .location"],
      salary: [
        ".vacancy-header__salary .basic-salary",
        ".basic-salary",
        ".vacancy-header__salary",
      ],
      status: [] as string[],
    },
    hh: { position: [], company: [], location: [], salary: [], status: [] },
  }[site];
  vacancy.position =
    linkedin?.position ||
    text(doc, selectors.position) ||
    (typeof job?.title === "string" ? job.title : "");
  vacancy.company =
    linkedin?.company ||
    text(doc, selectors.company) ||
    (typeof job?.hiringOrganization?.name === "string"
      ? job.hiringOrganization.name
      : "");
  const otherStructuredLogo =
    typeof job?.hiringOrganization?.logo === "string"
      ? job.hiringOrganization.logo
      : typeof job?.hiringOrganization?.logo?.url === "string"
        ? job.hiringOrganization.logo.url
        : "";
  vacancy.companyLogo =
    (otherStructuredLogo && /^https?:\/\//i.test(otherStructuredLogo)
      ? otherStructuredLogo.trim()
      : "") ||
    imageSrc(doc, [
      ".job-details-jobs-unified-top-card__company-logo img",
      ".topcard__org-name-link img",
      ".b-vacancy-header img",
      ".company-logo img",
      ".company_logo img",
      ".vacancy-header img",
    ]);
  const locations = Array.isArray(job?.jobLocation)
    ? job.jobLocation
    : [job?.jobLocation];
  vacancy.location = locations
    .map((location) => location?.address?.addressLocality)
    .filter((value) => typeof value === "string")
    .join(", ");
  vacancy.workFormat = job?.jobLocationType === "TELECOMMUTE" ? "Удалённо" : "";
  if (site === "getmatch") {
    const tags = [
      ...doc.querySelectorAll(".b-vacancy-locations__group [class*='__title']"),
    ]
      .filter((el) => !el.closest('[hidden], [aria-hidden="true"]'))
      .map((el) => clean(el.textContent ?? ""));
    vacancy.location = [
      ...new Set(
        tags
          .filter((tag) => tag.startsWith("📍"))
          .map((tag) => tag.replace(/^📍\s*/, "")),
      ),
    ].join(", ");
    vacancy.workFormat = [
      ...new Set(
        tags.filter((tag) =>
          /удалённо|удаленно|гибрид|офис|remote|hybrid|onsite/i.test(tag),
        ),
      ),
    ].join(", ");
  } else if (site === "hirify") {
    for (const row of doc.querySelectorAll(
      ".vacancy-header .common-detail-item",
    )) {
      const label = text(row, [".label"]).toLowerCase();
      if (["формат работы", "work format"].includes(label))
        vacancy.workFormat = text(row, [".value"]);
      if (["страна", "country", "локация", "location"].includes(label))
        vacancy.location = text(row, [".value"]);
    }
  } else if (site === "geekjob") {
    const loc = text(doc, selectors.location);
    if (loc) vacancy.location = loc;
    const formatEl = doc.querySelector<HTMLElement>(
      ".vacancy .jobinfo .jobformat, .jobformat",
    );
    if (formatEl) {
      const cloned = formatEl.cloneNode(true) as HTMLElement;
      for (const br of cloned.querySelectorAll("br")) {
        br.replaceWith(doc.createTextNode("\n"));
      }
      const rawText = cloned.textContent ?? "";
      const formats = [
        ...new Set(
          rawText
            .split(/[•\n\r,]+/)
            .map((s) => clean(s))
            .filter((s) =>
              /удаленн|удалённ|гибрид|офис|релокац|remote|hybrid|relocation/i.test(
                s,
              ),
            ),
        ),
      ];
      if (formats.length) vacancy.workFormat = formats.join(", ");
    }
  } else if (site === "habr") {
    const chips = [
      ...doc.querySelectorAll(".vacancy-meta .basic-chip, .basic-chip"),
    ]
      .filter((el) => !el.closest('[hidden], [aria-hidden="true"]'))
      .map((el) => clean(el.textContent ?? ""));
    const workFormats = chips.filter((c) =>
      /удален|удалён|гибрид|офис|remote|hybrid/i.test(c),
    );
    if (workFormats.length) vacancy.workFormat = workFormats.join(", ");
  } else {
    vacancy.location =
      linkedin?.location || text(doc, selectors.location) || vacancy.location;
    vacancy.workFormat = linkedin?.workFormat || vacancy.workFormat;
  }
  const rawSalary = text(doc, selectors.salary);
  vacancy.salary = rawSalary ? parseSalary(rawSalary) : salaryFromJob(job);
  const explicit = text(doc, selectors.status);
  const status = explicit ? statusFromText(explicit) : "";
  return {
    supported: true,
    kind: "vacancy",
    vacancy,
    observations: status
      ? [{ vacancyUrl: identity.url, status, url: identity.url }]
      : [],
    warning:
      !vacancy.company || !vacancy.position
        ? "Не все поля доступны. Проверьте компанию и позицию перед сохранением."
        : undefined,
  };
}
function parseBasePage(doc: Document, rawURL: string): Snapshot {
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    return { supported: false, kind: "unsupported", observations: [] };
  }
  if (!jobSite(rawURL))
    return { supported: false, kind: "unsupported", observations: [] };
  if (jobSite(rawURL) !== "hh") return parseOtherSite(doc, rawURL);
  const id = url.pathname.match(/^\/vacancy\/(\d+)(?:\/|$)/)?.[1];
  if (id) {
    const job = structuredJob(doc);
    const vacancy = emptyApplication();
    vacancy.hhId = id;
    vacancy.url = "https://hh.ru/vacancy/" + id;
    vacancy.position =
      text(doc, ['[data-qa="vacancy-title"]', "h1"]) || job?.title || "";
    vacancy.company =
      text(doc, [
        '[data-qa="vacancy-company-name"]',
        '[data-qa="vacancy-company-name-wrapper"]',
      ]) ||
      job?.hiringOrganization?.name ||
      "";
    const structuredLogo =
      typeof job?.hiringOrganization?.logo === "string"
        ? job.hiringOrganization.logo
        : typeof job?.hiringOrganization?.logo?.url === "string"
          ? job.hiringOrganization.logo.url
          : "";
    vacancy.companyLogo =
      (structuredLogo && /^https?:\/\//i.test(structuredLogo)
        ? structuredLogo.trim()
        : "") ||
      imageSrc(doc, [
        '[data-qa="vacancy-company-logo"] img',
        ".vacancy-company-logo img",
        'a[data-qa="vacancy-company-name"] img',
        ".bloko-avatar img",
      ]);
    vacancy.location =
      text(doc, [
        '[data-qa="vacancy-view-raw-address"]',
        '[data-qa="vacancy-view-location"]',
        '[data-qa="vacancy-view-location-name"]',
      ]) ||
      job?.jobLocation?.address?.addressLocality ||
      "";
    vacancy.workFormat =
      text(doc, [
        '[data-qa="work-formats-text"]',
        '[data-qa="vacancy-work-format"]',
        '[data-qa="vacancy-work-schedule"]',
      ]).replace(/^Формат работы:\s*/i, "") ||
      (job?.jobLocationType === "TELECOMMUTE" ? "Удалённо" : "");
    const salary = text(doc, [
      '[data-qa="vacancy-salary"]',
      '[data-qa="vacancy-salary-compensation-type-net"]',
      '[data-qa="vacancy-salary-compensation-type-gross"]',
    ]);
    if (salary) vacancy.salary = parseSalary(salary);
    else if (job?.baseSalary) {
      const b = job.baseSalary;
      vacancy.salary = {
        min:
          typeof b.value?.minValue === "number"
            ? b.value.minValue
            : typeof b.value?.value === "number"
              ? b.value.value
              : null,
        max: typeof b.value?.maxValue === "number" ? b.value.maxValue : null,
        currency: b.currency ?? "RUB",
        period:
          (
            { HOUR: "hour", YEAR: "year", MONTH: "month" } as Record<
              string,
              string
            >
          )[b.value?.unitText] ?? "month",
        tax: "",
      };
    }
    const explicit = text(doc, [
      '[data-qa="vacancy-response-status"]',
      '[data-qa="vacancy-archived-message"]',
    ]);
    const buttonStatus = text(doc, [
      '[data-qa="vacancy-response-link-top"]',
      '[data-qa="vacancy-response-link-bottom"]',
    ]);
    const candidate = explicit
      ? statusFromText(explicit)
      : statusFromText(buttonStatus);
    const parsedStatus = explicit
      ? candidate
      : [
            "applied",
            "waiting",
            "viewed",
            "invited",
            "interview",
            "rejected",
            "vacancy_closed",
            "hired",
          ].includes(candidate)
        ? candidate
        : "";
    return {
      supported: true,
      kind: "vacancy",
      vacancy,
      observations: parsedStatus
        ? [{ hhId: id, status: parsedStatus, url: vacancy.url }]
        : [],
      warning:
        !vacancy.company || !vacancy.position
          ? "Не все поля доступны. Проверьте компанию и позицию перед сохранением."
          : undefined,
    };
  }
  if (/^\/applicant\/negotiations(?:\/|$)/.test(url.pathname)) {
    const observations: (ParsedObservation & { hhId: string })[] = [];
    for (const link of doc.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/vacancy/"]',
    )) {
      let id: string | undefined;
      try {
        const target = new URL(link.getAttribute("href") ?? "", url);
        if (target.hostname === "hh.ru" || target.hostname.endsWith(".hh.ru"))
          id = target.pathname.match(/^\/vacancy\/(\d+)(?:\/|$)/)?.[1];
      } catch {
        continue;
      }
      if (!id) continue;
      const row = link.closest(
        '[data-qa="negotiations-item"], [data-qa="negotiations-list-item"], [data-qa="negotiation-item"], tr, [role="row"], article, li',
      );
      if (!row || row.closest('[hidden], [aria-hidden="true"]')) continue;
      const statusText = text(row, [
        '[data-qa~="negotiations-tag"]',
        '[data-qa="negotiations-item-status"]',
        '[data-qa="negotiation-status"]',
        '[data-qa="negotiations-item-response-status"]',
        '[data-qa*="status"]',
      ]);
      if (!statusText) continue;
      const status = statusFromText(statusText);
      if (!observations.some((o) => o.hhId === id && o.status === status)) {
        const appliedDate = responseDate(
          text(row, ['[data-qa="negotiations-item-date"]']),
        );
        const company = text(row, ['[data-qa="negotiations-item-company"]']);
        const position =
          text(link, ['[data-qa="negotiations-item-vacancy"]']) ||
          clean(link.textContent ?? "");
        const candidate =
          company && position && recentResponse(appliedDate)
            ? {
                ...emptyApplication(),
                company,
                position,
                appliedDate,
                hhId: id,
                url: "https://hh.ru/vacancy/" + id,
                stage: "applied" as const,
              }
            : undefined;
        observations.push({
          hhId: id,
          status,
          url: url.origin + url.pathname,
          ...(candidate ? { candidate } : {}),
        });
      }
    }
    const byId = new Map<string, Set<string>>();
    for (const o of observations) {
      const values = byId.get(o.hhId) ?? new Set();
      values.add(o.status);
      byId.set(o.hhId, values);
    }
    return {
      supported: true,
      kind: "responses",
      observations: observations.filter((o) => byId.get(o.hhId)?.size === 1),
      warning: observations.some((o) => (byId.get(o.hhId)?.size ?? 0) > 1)
        ? "Для части вакансий найдены противоречивые состояния. Проверьте их вручную."
        : !observations.length
          ? "На видимой странице не найдены состояния откликов. Это не означает отказ."
          : undefined,
    };
  }
  return { supported: false, kind: "unsupported", observations: [] };
}

// Read the confirmed state after hh updates its DOM, including existing favorites.
function isFavorite(root: ParentNode): boolean {
  return [
    ...root.querySelectorAll<HTMLElement>(
      '[data-qa="vacancy-shortlist-active"], [data-qa="vacancy-shortlist-remove"], [data-qa="vacancy-shortlist-button"], [data-qa="vacancy-shortlist"]',
    ),
  ].some((el) => {
    if (
      el.closest('[hidden], [aria-hidden="true"]') ||
      el.ownerDocument.defaultView?.getComputedStyle(el).display === "none"
    )
      return false;
    const qa = el.getAttribute("data-qa");
    return (
      qa === "vacancy-shortlist-active" ||
      qa === "vacancy-shortlist-remove" ||
      el.getAttribute("aria-pressed") === "true" ||
      /убрать из избранного|удалить из избранного|в избранном/i.test(
        [
          el.textContent,
          el.getAttribute("aria-label"),
          el.getAttribute("title"),
        ].join(" "),
      )
    );
  });
}
export function parsePage(doc: Document, rawURL: string): Snapshot {
  const snapshot = parseBasePage(doc, rawURL);
  if (jobSite(rawURL) !== "hh") return snapshot;
  const url = new URL(rawURL);
  if (snapshot.vacancy && isFavorite(doc)) {
    snapshot.vacancy.favorite = true;
    snapshot.observations.push({
      hhId: snapshot.vacancy.hhId,
      status: "favorite",
      url: snapshot.vacancy.url,
      candidate: snapshot.vacancy,
    });
  } else if (
    /^\/(?:applicant\/(?:vacancies|favorite)|search\/vacancy)(?:\/|$)/.test(
      url.pathname,
    )
  ) {
    const favoritesPage = /^\/applicant\/(?:vacancies|favorite)(?:\/|$)/.test(
      url.pathname,
    );
    for (const row of doc.querySelectorAll(
      '[data-qa="vacancy-serp__vacancy"], [data-qa="vacancy-serp__vacancy_standard"], .vacancy-serp-item, .serp-item',
    )) {
      if (
        row.closest('[hidden], [aria-hidden="true"]') ||
        (!favoritesPage && !isFavorite(row))
      )
        continue;
      const link = row.querySelector<HTMLAnchorElement>(
        'a[data-qa="serp-item__title"], a[data-qa="vacancy-serp__vacancy-title"]',
      );
      if (!link) continue;
      const identity = jobIdentity(
        new URL(link.getAttribute("href") ?? "", rawURL).href,
      );
      if (identity?.site !== "hh") continue;
      const candidate = {
        ...emptyApplication(),
        url: identity.url,
        hhId: identity.id,
        favorite: true,
        position: clean(link.textContent ?? ""),
        company: text(row, [
          '[data-qa="vacancy-serp__vacancy-employer"]',
          '[data-qa="vacancy-serp-item__meta-info-company"]',
        ]),
      };
      if (!candidate.company || !candidate.position) continue;
      if (
        !snapshot.observations.some(
          (o) => o.hhId === identity.id && o.status === "favorite",
        )
      )
        snapshot.observations.push({
          hhId: identity.id,
          status: "favorite",
          url: url.origin + url.pathname,
          candidate,
        });
    }
    if (snapshot.observations.length) {
      snapshot.supported = true;
      snapshot.kind = "responses";
    }
  }
  return snapshot;
}
