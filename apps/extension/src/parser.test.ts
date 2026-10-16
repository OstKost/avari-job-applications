import { describe, it, expect } from "vitest";
import {
  parsePage,
  parseSalary,
  statusFromText,
  responseDate,
  recentResponse,
} from "./parser";
const doc = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");
describe("hh.ru DOM parser", () => {
  it("offers recent responses using the actual hh date and company fields, not employer activity", () => {
    const row = (id: number, date: string) =>
      `<div data-qa="negotiations-item"><span data-qa="negotiations-tag">Отказ</span><a href="/vacancy/${id}"><span data-qa="negotiations-item-vacancy">Developer</span></a><div data-qa="negotiations-item-company">Example</div><div data-qa="negotiations-item-date">${date}</div><span>Был онлайн сегодня</span><p>private conversation</p></div>`;
    const parsed = parsePage(
      doc(
        row(123, "сегодня") +
          row(456, "1 января 2000") +
          row(789, "неизвестно"),
      ),
      "https://rostov.hh.ru/applicant/negotiations",
    );
    expect(parsed.observations).toHaveLength(3);
    expect(parsed.observations[0].candidate).toMatchObject({
      company: "Example",
      position: "Developer",
      url: "https://hh.ru/vacancy/123",
      stage: "applied",
    });
    expect(parsed.observations[1].candidate).toBeUndefined();
    expect(parsed.observations[2].candidate).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("private");
  });
  it("handles relative dates, year rollover, invalid dates and calendar-month boundaries", () => {
    const today = new Date(2026, 0, 11, 12);
    expect(responseDate("вчера", today)).toBe("2026-01-10");
    expect(responseDate("позавчера", today)).toBe("2026-01-09");
    expect(responseDate("31 декабря", today)).toBe("2025-12-31");
    expect(responseDate("1 января", today)).toBe("2026-01-01");
    expect(responseDate("31 февраля 2026", today)).toBe("");
    expect(responseDate("11.01.2026", today)).toBe("2026-01-11");
    expect(recentResponse("2025-12-11", today)).toBe(true);
    expect(recentResponse("2025-12-10", today)).toBe(false);
    expect(recentResponse("2026-01-12", today)).toBe(false);
    expect(recentResponse("2026-02-28", new Date(2026, 2, 31, 12))).toBe(true);
    expect(recentResponse("2026-02-27", new Date(2026, 2, 31, 12))).toBe(false);
  });
  it("reads current negotiation tags without including recommended vacancies", () => {
    // Structure observed after login on 2026-10-11; all vacancy data anonymized.
    const states = [
      ["not-viewed", "Не&nbsp;просмотрен", "waiting"],
      ["viewed", "Просмотрен", "viewed"],
      ["interview", "Собеседование", "interview"],
      ["discard", "Отказ", "rejected"],
    ];
    const p = parsePage(
      doc(
        states
          .map(
            ([tag, label], i) =>
              `<div data-qa="negotiations-item" role="button"><span data-qa="negotiations-tag negotiations-item-${tag}">${label}</span><section><div><a href="/vacancy/${100 + i}"><span data-qa="negotiations-item-vacancy">Вакансия</span></a></div></section><button>Перейти в чат</button></div>`,
          )
          .join("") +
          '<article><a href="/vacancy/999">Рекомендация</a><button>Откликнуться</button></article>',
      ),
      "https://rostov.hh.ru/applicant/negotiations",
    );
    expect(p.observations.map((o) => [o.hhId, o.status])).toEqual(
      states.map((s, i) => [String(100 + i), s[2]]),
    );
  });
  it("reads the public vacancy markup observed on hh.ru on 2026-10-11", () => {
    // Minimal metadata excerpt from https://rostov.hh.ru/vacancy/138066204.
    // Description, scripts, contacts and applicant information are excluded.
    const p = parsePage(
      doc(
        '<h1 data-qa="vacancy-title">Claude / Codex / Golang разработчик</h1><a data-qa="vacancy-company-name">Claude Coders</a><span data-qa="vacancy-salary">50&nbsp;000&nbsp;₽ за&nbsp;месяц, на руки</span><p data-qa="work-formats-text">Формат работы: <!-- -->на&nbsp;месте работодателя или удалённо</p><span data-qa="vacancy-view-raw-address">Ростов-на-Дону, микрорайон Северный, улица Пацаева, 16/1</span><button data-qa="vacancy-response-link-top">Откликнуться</button>',
      ),
      "https://rostov.hh.ru/vacancy/138066204",
    );
    expect(p.vacancy).toMatchObject({
      hhId: "138066204",
      company: "Claude Coders",
      position: "Claude / Codex / Golang разработчик",
      workFormat: "на месте работодателя или удалённо",
      salary: { min: 50000, currency: "RUB", period: "month", tax: "net" },
    });
    expect(p.observations).toEqual([]);
  });
  it("extracts company logo from vacancy page DOM or structured data", () => {
    const fromDom = parsePage(
      doc(
        '<h1>Backend</h1><a data-qa="vacancy-company-name">Acme</a><div data-qa="vacancy-company-logo"><img src="https://hh.ru/employer-logo/123.png" /></div>',
      ),
      "https://hh.ru/vacancy/999",
    );
    expect(fromDom.vacancy?.companyLogo).toBe(
      "https://hh.ru/employer-logo/123.png",
    );

    const fromJsonLd = parsePage(
      doc(
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Dev","hiringOrganization":{"name":"Acme","logo":"https://hh.ru/employer-logo/456.png"}}</script>',
      ),
      "https://hh.ru/vacancy/999",
    );
    expect(fromJsonLd.vacancy?.companyLogo).toBe(
      "https://hh.ru/employer-logo/456.png",
    );
  });
  it("extracts a vacancy and never infers an application from opening", () => {
    const p = parsePage(
      doc(
        '<h1 data-qa="vacancy-title">Go developer</h1><a data-qa="vacancy-company-name">Компания</a><span data-qa="vacancy-salary">от 150 000 до 220 000 ₽ за месяц, на руки</span><span data-qa="vacancy-view-raw-address">Москва</span><button data-qa="vacancy-response-link-top">Откликнуться</button>',
      ),
      "https://spb.hh.ru/vacancy/123?from=search",
    );
    expect(p.vacancy).toMatchObject({
      company: "Компания",
      position: "Go developer",
      hhId: "123",
      url: "https://hh.ru/vacancy/123",
      salary: { min: 150000, max: 220000, currency: "RUB", tax: "net" },
    });
    expect(p.observations).toEqual([]);
  });
  it("supports explicit application statuses", () => {
    const p = parsePage(
      doc(
        '<h1>Backend</h1><button data-qa="vacancy-response-link-top">Вы откликнулись</button>',
      ),
      "https://hh.ru/vacancy/123",
    );
    expect(p.observations[0].status).toBe("applied");
  });
  it("falls back to structured job data without leaking descriptions", () => {
    const p = parsePage(
      doc(
        '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Developer","hiringOrganization":{"name":"Example"},"description":"secret","jobLocation":{"address":{"addressLocality":"Казань"}},"baseSalary":{"currency":"USD","value":{"minValue":2000,"maxValue":3000,"unitText":"MONTH"}}}]}</script>',
      ),
      "https://hh.ru/vacancy/123",
    );
    expect(p.vacancy).toMatchObject({
      company: "Example",
      position: "Developer",
      location: "Казань",
      salary: { min: 2000, max: 3000, currency: "USD" },
    });
    expect(JSON.stringify(p)).not.toContain("secret");
  });
  it("reads only visible row statuses and excludes chat messages", () => {
    const p = parsePage(
      doc(
        '<article data-qa="negotiations-item"><a href="/vacancy/123">Go</a><span data-qa="negotiations-item-status">Приглашение</span><p>Переписка: вам отказали</p></article><article data-qa="negotiations-item"><a href="/vacancy/456">React</a><span data-qa="negotiations-item-status">Отказ</span></article>',
      ),
      "https://hh.ru/applicant/negotiations",
    );
    expect(p.observations).toEqual([
      {
        hhId: "123",
        status: "invited",
        url: "https://hh.ru/applicant/negotiations",
      },
      {
        hhId: "456",
        status: "rejected",
        url: "https://hh.ru/applicant/negotiations",
      },
    ]);
    expect(JSON.stringify(p)).not.toContain("Переписка");
  });
  it("does not infer absence or archive as a rejection", () => {
    expect(
      parsePage(
        doc("<main>Ничего не найдено</main>"),
        "https://hh.ru/applicant/negotiations",
      ).observations,
    ).toEqual([]);
    expect(statusFromText("Архив")).toBe("archived");
  });
  it("ignores contradictory multiple responses for the same vacancy", () => {
    const p = parsePage(
      doc(
        '<li><a href="/vacancy/123">A</a><span data-qa="status">Отказ</span></li><li><a href="/vacancy/123">A</a><span data-qa="status">Приглашение</span></li>',
      ),
      "https://hh.ru/applicant/negotiations",
    );
    expect(p.observations).toEqual([]);
    expect(p.warning).toContain("противоречивые");
  });
  it("keeps unknown status text and rejects unsupported hosts", () => {
    expect(statusFromText("Новый статус")).toBe("unknown:новый статус");
    expect(
      parsePage(doc("<h1>Go</h1>"), "https://hh.ru.evil.example/vacancy/123")
        .supported,
    ).toBe(false);
  });
  it("parses salary bounds, taxes, currency and periods", () => {
    expect(
      parseSalary("до 100 000 ₽ в месяц, до вычета налогов"),
    ).toMatchObject({ min: null, max: 100000, tax: "gross" });
    expect(parseSalary("от 2 500 $ в месяц")).toMatchObject({
      min: 2500,
      max: null,
      currency: "USD",
    });
    expect(parseSalary("€ 25 за час")).toMatchObject({
      min: 25,
      max: 25,
      currency: "EUR",
      period: "hour",
    });
  });
});

describe("additional job sites", () => {
  it("reads Getmatch public header and archive status", () => {
    // Public DOM inspected on 2026-10-11; no description or personal data.
    const p = parsePage(
      doc(
        `<section class="b-vacancy-header"><h1>Golang-разработчик</h1><h2>в <a href="/companies/example">Example</a></h2><h3>250 000 —‍ 350 000 ₽/‍мес на руки</h3></section><div class="b-vacancy-locations__group"><span class="tag__title">📍 Россия</span><span class="tag__title">Удалённо</span></div><div class="b-notification_danger"><b>Вакансия в архиве</b></div>`,
      ),
      "https://getmatch.ru/vacancies/19879-golang-razrabotchik?s=offers",
    );
    expect(p.vacancy).toMatchObject({
      company: "Example",
      position: "Golang-разработчик",
      hhId: "",
      url: "https://getmatch.ru/vacancies/19879",
      location: "Россия",
      workFormat: "Удалённо",
      salary: { min: 250000, max: 350000, currency: "RUB", tax: "net" },
    });
    expect(p.observations).toEqual([
      {
        vacancyUrl: "https://getmatch.ru/vacancies/19879",
        status: "vacancy_closed",
        url: "https://getmatch.ru/vacancies/19879",
      },
    ]);
  });
  it("reads Hirify metadata without using recommendations or apply as a status", () => {
    const p = parsePage(
      doc(
        `<div class="vacancy-header"><div class="company-name">Example</div><h1>Analyst</h1><div class="apply"><button>Откликнуться</button></div><div class="common-detail-item"><div class="label">Work format</div><div class="value">remote (Global)</div></div><div class="common-detail-item"><div class="label">Country</div><div class="value">Russia/Kazakhstan</div></div></div><article><h1>Recommended job</h1><div class="company-name">Other</div></article><script type="application/ld+json">{"@type":"JobPosting","title":"Analyst","hiringOrganization":{"name":"Example"},"description":"private text","baseSalary":{"currency":"USD","value":{"minValue":2000,"maxValue":3000,"unitText":"MONTH"}}}</script>`,
      ),
      "https://hirify.me/jobs/1090398-analyst",
    );
    expect(p.vacancy).toMatchObject({
      company: "Example",
      position: "Analyst",
      url: "https://hirify.me/jobs/1090398",
      location: "Russia/Kazakhstan",
      workFormat: "remote (Global)",
      salary: { min: 2000, max: 3000, currency: "USD" },
    });
    expect(p.observations).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("private text");
  });
  it("reads LinkedIn job data and only explicit application statuses", () => {
    const p = parsePage(
      doc(
        `<h1 class="top-card-layout__title">Developer</h1><a class="topcard__org-name-link">Example</a><span class="topcard__flavor--bullet">London</span><div class="compensation__salary">$110,000.00/yr - $120,000.00/yr</div><div hidden><div class="jobs-s-apply__application-status">Application rejected</div></div><div class="jobs-s-apply__application-status">You applied</div><p>Interview advice</p>`,
      ),
      "https://www.linkedin.com/jobs/view/developer-at-example-123/?trackingId=secret",
    );
    expect(p.vacancy).toMatchObject({
      company: "Example",
      position: "Developer",
      hhId: "",
      url: "https://www.linkedin.com/jobs/view/123",
      salary: { min: 110000, max: 120000, currency: "USD", period: "year" },
    });
    expect(p.observations).toEqual([
      {
        vacancyUrl: "https://www.linkedin.com/jobs/view/123",
        status: "applied",
        url: "https://www.linkedin.com/jobs/view/123",
      },
    ]);
    expect(JSON.stringify(p)).not.toContain("secret");
  });
  it("reads Geekjob public vacancy details and salary", () => {
    const p = parsePage(
      doc(
        `<article class="row vacancy"><section class="col s12 m12 main"><header><h1>Игровой партнёр</h1><h5 class="company-name">Прямой работодатель <a href="/company/123">Soulmate.gg</a></h5><div class="location">Новороссийск, Россия</div><div class="jobinfo"><span class="jobformat">Релокация • Удаленная работа<br>Опыт работы любой</span><span class="salary">от 40 000 до 60 000 ₽</span></div></header><div class="description"><div id="vacancy-description">private text</div></div></section></article>`,
      ),
      "https://geekjob.ru/vacancy/6accdf12a0f2fb0465068852?from=search",
    );
    expect(p.vacancy).toMatchObject({
      company: "Soulmate.gg",
      position: "Игровой партнёр",
      hhId: "",
      url: "https://geekjob.ru/vacancy/6accdf12a0f2fb0465068852",
      location: "Новороссийск, Россия",
      workFormat: "Релокация, Удаленная работа",
      salary: { min: 40000, max: 60000, currency: "RUB" },
    });
    expect(p.observations).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("private text");
  });
  it("reads Habr Career public vacancy details and salary", () => {
    const p = parsePage(
      doc(
        `<div class="basic-section vacancy-header"><div class="vacancy-header__title"><div class="page-title"><h1 class="page-title__title">Data Engineer</h1></div></div><div class="vacancy-header__salary"><div class="basic-salary">от 270 000 до 285 000 ₽</div></div><div class="content-section"><div class="vacancy-meta"><div class="basic-chip"><div class="chip-with-icon__text">Можно удалённо</div></div></div></div></div><div class="company_name"><a href="/companies/top-selection">Top Selection</a></div><script type="application/ld+json">{"@type":"JobPosting","title":"Data Engineer","hiringOrganization":{"name":"Top Selection"},"jobLocation":{"address":{"addressLocality":"Москва"}},"description":"private text"}</script>`,
      ),
      "https://career.habr.com/vacancies/1000168817?s=search",
    );
    expect(p.vacancy).toMatchObject({
      company: "Top Selection",
      position: "Data Engineer",
      hhId: "",
      url: "https://career.habr.com/vacancies/1000168817",
      location: "Москва",
      workFormat: "Можно удалённо",
      salary: { min: 270000, max: 285000, currency: "RUB" },
    });
    expect(p.observations).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("private text");
  });
  it("rejects stale LinkedIn selections during SPA navigation", () => {
    const html = `<ul><li data-job-id="123">Search result</li></ul><div data-job-id="456"><div class="job-details-jobs-unified-top-card__job-title"><h1>Developer</h1><a href="/jobs/view/456">Developer</a></div></div>`;
    expect(
      parsePage(
        doc(html),
        "https://www.linkedin.com/jobs/search/?currentJobId=123",
      ).supported,
    ).toBe(false);
    expect(
      parsePage(
        doc(html),
        "https://www.linkedin.com/jobs/search/?currentJobId=456",
      ).vacancy?.url,
    ).toBe("https://www.linkedin.com/jobs/view/456");
  });
  it("leaves fields blank on login pages and rejects unsupported routes", () => {
    const p = parsePage(
      doc("<h1>Sign in</h1>"),
      "https://www.linkedin.com/jobs/view/123",
    );
    expect(p.vacancy?.position).toBe("");
    expect(p.warning).toBeTruthy();
    expect(
      parsePage(doc("<h1>Find jobs</h1>"), "https://getmatch.ru/vacancies")
        .supported,
    ).toBe(false);
  });
});

describe("authenticated site markup observed on 2026-10-11", () => {
  // Minimal DOM structures; account details, actual responses and comments anonymized.
  const linkedInHeader = `<div><a href="https://www.linkedin.com/company/example/life/"><svg></svg><p><a href="https://www.linkedin.com/company/example/life/">Example</a></p></a><p><a href="https://www.linkedin.com/jobs/view/123/?trackingId=private">Developer</a></p><p><span>Россия</span> · <span>1 неделю назад</span> · 32 человека нажали «Подать заявку»</p><p>Ответы управляются за пределами LinkedIn</p><a href="/jobs/search-results/?currentJobId=123"><svg></svg>Удаленная работа</a><a href="/jobs/search-results/?currentJobId=123"><svg></svg>Полный рабочий день</a><a aria-label="Подать заявку на сайте компании" href="https://example.com/apply">Подать заявку</a><button aria-label="Сохранить вакансию">Сохранить</button></div>`;
  it("reads the SDUI search-results header without inferring viewed or applied", () => {
    const html = `<main><button>Выбрано Developer Просмотрена</button><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"><div data-component-type="LazyColumn">${linkedInHeader}<div><h2>Об этой вакансии</h2><p>Interview advice and private description</p></div></div></div></main>`;
    const p = parsePage(
      doc(html),
      "https://www.linkedin.com/jobs/search-results/?currentJobId=123&trackingId=private",
    );
    expect(p.vacancy).toMatchObject({
      company: "Example",
      position: "Developer",
      location: "Россия",
      workFormat: "Удаленная работа",
      url: "https://www.linkedin.com/jobs/view/123",
    });
    expect(p.observations).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("private");
    expect(
      parsePage(
        doc(html),
        "https://www.linkedin.com/jobs/search-results/?currentJobId=456",
      ).supported,
    ).toBe(false);
  });
  it("reads direct SDUI cards with a paragraph title and guards against stale cards", () => {
    const html = `<title>Developer | Example | LinkedIn</title><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails"><div data-component-type="LazyColumn"><div id="JobDetails_ManageJobBanner_123"></div><div>${linkedInHeader.replace('<a href="https://www.linkedin.com/jobs/view/123/?trackingId=private">Developer</a>', "Developer")}</div><div id="JobDetails_AboutTheJob_123"><h2>Об этой вакансии</h2><p>private description</p><a href="/company/recommended">Other</a></div></div></div>`;
    const p = parsePage(doc(html), "https://www.linkedin.com/jobs/view/123");
    expect(p.vacancy).toMatchObject({
      company: "Example",
      position: "Developer",
      location: "Россия",
    });
    expect(p.observations).toEqual([]);
    expect(
      parsePage(doc(html), "https://www.linkedin.com/jobs/view/456").vacancy
        ?.position,
    ).toBe("");
  });
  it("reads Getmatch application status separately from removed vacancies and comments", () => {
    const html = `<article class="applicationCard-module__hash__card applicationCard-module__hash__cardArchived"><div class="applicationCard-module__hash__header"><div class="applicationCard-module__hash__statusGroup"><span class="applicationCard-module__hash__status">Отказ</span><span class="applicationCard-module__hash__metaStatus">Вакансия снята</span></div></div><h3><a href="/vacancies/123-developer?s=my-applications-v">Developer</a></h3><p>private personal comment</p></article><h2>Топ подходящих вакансий</h2><article><h3><a href="/vacancies/456-recommended">Recommended</a></h3><p>Отказ</p></article>`;
    const p = parsePage(doc(html), "https://getmatch.ru/applications?s=menu");
    expect(p.kind).toBe("responses");
    expect(p.observations).toEqual([
      {
        vacancyUrl: "https://getmatch.ru/vacancies/123",
        status: "rejected",
        url: "https://getmatch.ru/applications",
      },
    ]);
    expect(JSON.stringify(p)).not.toContain("private");
  });
  it("reads Hirify selected stages without collecting contacts or other platforms", () => {
    const html = `<table class="applications-table__table"><tbody><tr class="applications-table__row"><td><a class="applications-table__job-link" href="https://hirify.me/jobs/123-developer">Developer</a></td><td><button role="combobox" class="applications-table__stage-select"><span>Отклик</span><svg></svg></button></td><td>private contact</td><td>Отказ in comment</td></tr><tr class="applications-table__row"><td><a class="applications-table__job-link" href="https://hh.ru/vacancy/456">External tracker record</a></td><td><button class="applications-table__stage-select">Отказ</button></td></tr></tbody></table>`;
    const p = parsePage(doc(html), "https://hirify.me/applications");
    expect(p.observations).toEqual([
      {
        vacancyUrl: "https://hirify.me/jobs/123",
        status: "applied",
        url: "https://hirify.me/applications",
      },
    ]);
    expect(JSON.stringify(p)).not.toContain("private");
    const conflict = parsePage(
      doc(html + html.replace("<span>Отклик</span>", "<span>Отказ</span>")),
      "https://hirify.me/applications",
    );
    expect(conflict.observations).toEqual([]);
    expect(conflict.warning).toContain("противоречивые");
  });
  it.each([
    ["HR интервью", "hr"],
    ["Техническое интервью", "interview"],
    ["Финальное интервью", "final"],
    ["Оффер", "offer"],
    ["Тестовое задание", "test_assignment"],
    ["No Response", "no_response"],
  ])("recognizes Hirify stage %s", (raw, status) =>
    expect(statusFromText(raw)).toBe(status),
  );
});

it("detects existing favorites and a button becoming selected", () => {
  const page = doc(
    `<h1 data-qa="vacancy-title">Developer</h1><div data-qa="vacancy-company-name">Example</div><button data-qa="vacancy-shortlist-button" aria-pressed="false">В избранное</button>`,
  );
  expect(
    parsePage(page, "https://hh.ru/vacancy/123").observations,
  ).toHaveLength(0);
  page.querySelector("button")!.setAttribute("aria-pressed", "true");
  expect(
    parsePage(page, "https://hh.ru/vacancy/123").observations[0],
  ).toMatchObject({
    status: "favorite",
    candidate: { favorite: true, stage: "saved" },
  });
});
it("offers favorites visible in lists, with no application date", () => {
  const page = doc(
    `<div class="serp-item"><a data-qa="serp-item__title" href="/vacancy/123">Developer</a><span data-qa="vacancy-serp__vacancy-employer">Example</span></div>`,
  );
  const parsed = parsePage(page, "https://hh.ru/applicant/vacancies");
  expect(parsed.supported).toBe(true);
  expect(parsed.observations[0]).toMatchObject({
    hhId: "123",
    status: "favorite",
    candidate: { favorite: true, appliedDate: "" },
  });
  expect(
    parsePage(page, "https://hh.ru/search/vacancy").observations,
  ).toHaveLength(0);
});
