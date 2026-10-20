import { submitLogin } from "./auth";
import { test, expect, type Page } from "@playwright/test";
test("public extension page and privacy are available before login", async ({
  page,
}) => {
  const privacyResponse = await page.goto("/privacy.html");
  expect(privacyResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Политика конфиденциальности / Privacy Policy",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("#ru")).toContainText("web@ostkost.ru");
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page.locator("#en")).toContainText("web@ostkost.ru");
  await page.goto("/extension");
  await expect(
    page.getByRole("heading", { name: "Расширение Avari.Jobs" }),
  ).toBeVisible();
  // Direct public downloads are blocked to comply with Chrome Web Store and Safe Browsing requirements
  const directDownload = await page.request.get(
    "/downloads/avari-extension.zip",
  );
  expect(directDownload.status()).toBe(404);
  const release = await (await page.request.get("/release.json")).json();
  await expect(
    page.getByText(`Версия: ${release.version}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Конфиденциальность", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Конфиденциальность" }),
  ).toBeVisible();
});
const login = async (page: Page) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await submitLogin(page);
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Календарь", exact: true }),
  ).toBeVisible();
};
test("site: real API, vacancy, note, interview, themes, custom fields and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Включить светлую тему" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Включить тёмную тему" })
    .click();
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Компания *", { exact: true })
    .fill("Альфа Технологии");
  await dialog
    .getByLabel("Позиция *", { exact: true })
    .fill("Senior Go developer");
  await dialog
    .getByLabel("Ссылка на вакансию")
    .fill("https://hh.ru/vacancy/987654321");
  await dialog
    .getByLabel("Группа вакансии", { exact: true })
    .fill("Разработка");
  await dialog.getByLabel("Название нового тега").fill("Удалённая работа");
  await dialog
    .getByRole("button", { name: "Добавить тег", exact: true })
    .click();
  await dialog.getByLabel("Этап", { exact: true }).click();
  await dialog.getByRole("menuitemradio", { name: /Отклик/ }).click();
  await dialog.getByLabel("Приоритет", { exact: true }).selectOption("Высокий");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Альфа Технологии", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".detail-badges").getByText("Разработка", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".detail-tags")
      .getByText("#Удалённая работа", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Заметка", { exact: true })
    .fill("Обсудить команду и формат работы.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Добавить заметку", exact: true })
    .click();
  await expect(
    page.getByText("Обсудить команду и формат работы.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Редактировать заметку" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Заметка", { exact: true })
    .fill("Обсудили команду. Следующий шаг — интервью.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить заметку" })
    .click();
  await expect(
    page.getByText("Обсудили команду. Следующий шаг — интервью.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Заметка отредактирована", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Добавить задачу", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Название *")
    .fill("Знакомство с командой");
  await page
    .getByRole("dialog")
    .getByLabel("Тип", { exact: true })
    .selectOption("interview");
  await page
    .getByRole("dialog")
    .getByLabel("Время", { exact: true })
    .fill("14:30");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить задачу" })
    .click();
  await expect(
    page.getByRole("button", { name: "Знакомство с командой", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Календарь", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Знакомство с командой", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Знакомство с командой", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Название *")
    .fill("Черновик задачи");
  const tasks = await (await page.request.get("/api/v1/tasks")).json();
  const task = tasks.find(
    (t: { title: string }) => t.title === "Знакомство с командой",
  );
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "avari_csrf",
  )!.value;
  const concurrent = await page.request.put("/api/v1/tasks/" + task.id, {
    data: { ...task, title: "Обновлено в другом окне" },
    headers: { "X-CSRF-Token": csrf },
  });
  expect(concurrent.status()).toBe(200);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить задачу" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Задача изменилась",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByText("Обновлено в другом окне", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Загрузить актуальную задачу" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Название *")
    .fill("Знакомство с командой");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить задачу" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/calendar-dark-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Включить светлую тему" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "test-results/calendar-light-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Включить тёмную тему" })
    .click();
  await page
    .getByRole("button", { name: "Отметить выполнение: Знакомство с командой" })
    .click();
  await expect(
    page.getByRole("button", { name: "Вернуть задачу: Знакомство с командой" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByRole("tab", { name: /Критерии и поля/ }).click();
  await expect(
    page.getByRole("heading", { name: "Мои критерии" }),
  ).toBeVisible();
  await page.getByLabel("Название", { exact: true }).first().fill("Важность");
  await page.getByRole("button", { name: "Сохранить поля" }).click();
  await expect(
    page.getByText("Дополнительные поля сохранены", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await expect(
    page.locator(".application-cards").getByText("Альфа Технологии"),
  ).toBeVisible();
  await page
    .locator(".application-cards")
    .getByText("Альфа Технологии")
    .click();
  await expect(
    page.getByRole("heading", { name: "Альфа Технологии", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/vacancy-dark-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await page.getByLabel("Контакт рекрутера").fill("hr@example.com");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("hr@example.com", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Редактировать", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Выйти из аккаунта?" })
    .getByRole("button", { name: "Выйти", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("registration stays pending and unauthorized data is blocked", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Нет аккаунта? Создать", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("pending-browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "Подтвердите аккаунт" }),
  ).toBeVisible();
  const response = await page.request.get("/api/v1/applications");
  expect(response.status()).toBe(403);
});

test("calendar subscription: connect, update, rotate and disable on desktop and mobile", async ({
  page,
}) => {
  await login(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "avari_csrf",
  )!.value;
  const response = await page.request.post("/api/v1/tasks", {
    data: {
      title: "Подписная встреча",
      date: "2027-01-20",
      time: "10:30",
      kind: "interview",
    },
    headers: { "X-CSRF-Token": csrf },
  });
  expect(response.ok()).toBeTruthy();
  const task = await response.json();
  await page.getByRole("button", { name: "Подписаться", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Создать ссылку подписки" }).click();
  const input = dialog.getByLabel("Личная ссылка календаря");
  await expect(input).toHaveValue(/\.ics$/);
  const url = await input.inputValue();
  await expect(
    dialog.getByRole("link", { name: "Apple Календарь" }),
  ).toHaveAttribute("href", url.replace(/^https?:/, "webcal:"));
  await expect(
    dialog.getByRole("link", { name: "Google Календарь" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Яндекс Календарь" }),
  ).toBeVisible();
  await dialog.getByText("Как подключить календарь", { exact: true }).click();
  await expect(
    dialog.getByText("Добавить по URL", { exact: false }),
  ).toBeVisible();
  let feed = await page.request.get(url);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect(await feed.text()).toContain("DTSTART:20270120T073000Z");
  await page.screenshot({
    path: "test-results/calendar-subscription-desktop.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  const update = await page.request.put("/api/v1/tasks/" + task.id, {
    data: { ...task, date: "2027-01-22", time: "11:00" },
    headers: { "X-CSRF-Token": csrf },
  });
  expect(update.ok()).toBeTruthy();
  feed = await page.request.get(url);
  const content = await feed.text();
  expect(content).toContain("DTSTART:20270122T080000Z");
  expect(
    content.match(new RegExp("UID:avari-task-" + task.id + "@avari", "g")),
  ).toHaveLength(1);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByRole("tab", { name: "Календарь", exact: true }).click();
  await expect(page.getByLabel("Личная ссылка календаря")).toHaveValue(url);
  await page.reload();
  await page.getByRole("tab", { name: "Календарь", exact: true }).click();
  await expect(page.getByLabel("Личная ссылка календаря")).toHaveValue(url);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Личная ссылка календаря").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/calendar-subscription-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Сменить ссылку" }).click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByLabel("Личная ссылка календаря")).toHaveValue(url);
  await page.getByRole("button", { name: "Сменить ссылку" }).click();
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByLabel("Личная ссылка календаря")).not.toHaveValue(url);
  const rotated = await page.getByLabel("Личная ссылка календаря").inputValue();
  expect((await page.request.get(url)).status()).toBe(404);
  expect((await page.request.get(rotated)).status()).toBe(200);
  await page.getByRole("button", { name: "Отключить подписку" }).click();
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Создать ссылку подписки" }),
  ).toBeVisible();
  expect((await page.request.get(rotated)).status()).toBe(404);

  // Test personal extension download link in settings
  await page.getByRole("tab", { name: "Расширение", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Расширение для Chromium" }),
  ).toBeVisible();
  const tokenInput = page.getByLabel("Индивидуальная ссылка на ZIP-архив");
  await expect(tokenInput).toBeVisible();
  const downloadUrl = await tokenInput.inputValue();
  expect(downloadUrl).toContain("/api/v1/extension/download/");
  const dlRes = await page.request.get(downloadUrl);
  expect(dlRes.status()).toBe(200);
  expect((await dlRes.body()).subarray(0, 2).toString()).toBe("PK");
  expect(dlRes.headers()["cache-control"]).toBe("private, no-cache");
  expect(dlRes.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");

  // Rotate token
  await page.getByRole("button", { name: "Сменить ссылку" }).click();
  await expect(page.getByText("Новая ссылка создана")).toBeVisible();
  const newUrl = await tokenInput.inputValue();
  expect(newUrl).not.toBe(downloadUrl);
  expect((await page.request.get(downloadUrl)).status()).toBe(404);
  const newRes = await page.request.get(newUrl);
  expect(newRes.status()).toBe(200);
  expect((await newRes.body()).subarray(0, 2).toString()).toBe("PK");
});

test("workspace design: dashboard, grouped table, cards, pagination and monthly agenda", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.screenshot({
    path: "test-results/design-login-desktop.png",
    fullPage: true,
  });
  await login(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "avari_csrf",
  )!.value;
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const companies = [
    "Яндекс",
    "Т-Банк",
    "Авито",
    "VK",
    "Сбер",
    "Ozon",
    "МТС",
    "Контур",
  ];
  const stages = ["applied", "hr", "interview", "final", "offer", "saved"];
  const fixtures = [];
  for (let i = 0; i < 24; i++) {
    const response = await page.request.post("/api/v1/applications", {
      headers: { "X-CSRF-Token": csrf },
      data: {
        company: companies[i % companies.length],
        position:
          i % 2 ? "Senior Frontend Developer" : "Backend Developer · Go",
        savedDate: today,
        appliedDate: stages[i % stages.length] === "saved" ? "" : today,
        stage: stages[i % stages.length],
        state: "active",
        location: "Москва",
        workFormat: "Удалённо",
        salary: {
          min: 250000,
          max: 350000,
          currency: "RUB",
          period: "month",
          tax: "net",
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    fixtures.push(await response.json());
  }
  for (let i = 0; i < 3; i++) {
    const response = await page.request.post("/api/v1/tasks", {
      headers: { "X-CSRF-Token": csrf },
      data: {
        title: [
          "Знакомство с продуктовой командой",
          "Подготовиться к техническому интервью",
          "Обсудить условия оффера",
        ][i],
        date: today,
        time: ["10:00", "14:30", "17:00"][i],
        kind: i === 1 ? "task" : "interview",
        applicationId: fixtures[i].id,
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Подготовиться к техническому интервью",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/design-dashboard-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Включить светлую тему", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/design-dashboard-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Включить тёмную тему", exact: true })
    .click();
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await page.getByRole("button", { name: "Группировка", exact: true }).click();
  await page.getByRole("option", { name: "По этапу", exact: true }).click();
  await expect(page.locator(".group-row")).toHaveCount(6);
  const folder = page
    .locator(".group-chips")
    .getByRole("button", { name: /^Оффер/ });
  await folder.click();
  await expect(folder).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".table-wrap .company-cell")).toHaveCount(4);
  await expect(
    page.locator(".application-statistics .summary-total strong"),
  ).toHaveText("4");
  await page
    .locator(".group-chips")
    .getByRole("button", { name: /^Все вакансии/ })
    .click();
  await expect(page.locator(".group-row")).toHaveCount(6);

  const group = page.locator(".group-row button").first();
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({
    path: "test-results/design-table-grouped.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Группировка", exact: true }).click();
  await page
    .getByRole("option", { name: "Без группировки", exact: true })
    .click();

  await expect(page.locator(".application-register")).toHaveClass(
    /compact-rows/,
  );
  await page
    .getByRole("button", { name: "Следующая страница", exact: true })
    .click();
  await expect(page.locator(".table-pagination")).toContainText("2 / 2");
  await page
    .getByRole("button", { name: "Поиск и фильтры", exact: true })
    .click();
  await page.getByLabel("Поиск по компании и позиции").fill("Яндекс");
  await page.getByLabel("Поиск по компании и позиции").press("Enter");
  await expect(page.locator(".table-pagination")).toContainText("1 / 1");
  await expect(page.locator(".table-wrap tbody tr")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Поиск и фильтры", exact: true })
    .click();
  await page.getByRole("button", { name: "Сбросить всё", exact: true }).click();
  await page.getByLabel("Поиск по компании и позиции").press("Enter");
  await page
    .getByRole("button", { name: "Карточки откликов", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Карточки откликов", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".application-register")).toHaveClass(/card-view/);
  await page
    .getByRole("button", { name: "Карточки откликов", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/design-table-dark.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Включить светлую тему" })
    .click();
  await page.screenshot({
    path: "test-results/design-table-light.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  await expect(page.locator(".month-day[aria-pressed=true]")).toHaveCount(1);
  expect([28, 35, 42]).toContain(await page.locator(".month-day").count());
  await expect(
    page.getByRole("button", {
      name: "Подготовиться к техническому интервью",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Следующий месяц" }).click();
  await expect(
    page.getByRole("button", {
      name: "Подготовиться к техническому интервью",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Подготовиться к техническому интервью",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Включить тёмную тему" })
    .click();
  await page.screenshot({
    path: "test-results/design-calendar-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/design-calendar-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await page.getByRole("button", { name: "Группировка", exact: true }).click();
  await page.getByRole("option", { name: "По этапу", exact: true }).click();
  await expect(
    page.locator(".application-cards .mobile-group").first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/design-table-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".application-register")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/design-dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("page motion: rapid navigation settles on the latest route and respects reduced motion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await login(page);
  await expect(page.locator(".page-transition")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect
    .poll(() =>
      page
        .locator(".page-header")
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe("block-arrive");
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await page.getByRole("link", { name: "Предложения", exact: true }).click();
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".page-transition")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Добавить вакансию", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Настройки", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".page-transition")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page
      .locator(".page-header")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(
    await page
      .locator(".page-transition")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Календарь", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

// Close every inspection connection: leaving one open masks multi-instance lifecycle bugs.
async function offlineRecords(page: Page, store: string): Promise<any[]> {
  return page.evaluate((storeName) => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open("avari_offline_v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, "readonly");
      const get = tx.objectStore(storeName).getAll();
      tx.oncomplete = () => { db.close(); resolve(get.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), store);
}

test("pwa & offline: real list/detail/calendar cold start, read-only, optout drafts and relogin", async ({ page: initialPage, context }) => {
  let page = initialPage;
  const company = `Offline Company ${Date.now()}`;
  const note = `Offline detail note ${company}`;
  const taskTitle = `Offline interview ${company}`;
  await login(page);
  const csrf = (await context.cookies()).find(c => c.name === "avari_csrf")!.value;
  const headers = { "X-CSRF-Token": csrf };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  const created = await page.request.post("/api/v1/applications", { headers, data: {
    company, position: "Offline Engineer", stage: "saved", state: "active", savedDate: today,
  } });
  expect(created.ok()).toBeTruthy();
  const application = await created.json();
  expect((await page.request.post("/api/v1/notes", { headers, data: { applicationId: application.id, text: note } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/v1/tasks", { headers, data: {
    applicationId: application.id, title: taskTitle, date: today, time: "12:00", kind: "interview",
  } })).ok()).toBeTruthy();

  await page.goto("/settings");
  await page.getByText("Разрешить чтение журнала офлайн (Opt-in)").click();
  await expect(page.getByLabel("Разрешить чтение журнала офлайн (Opt-in)")).toBeChecked();
  await page.goto("/applications");
  await expect(page.locator(".table-wrap .company-link").filter({ hasText: company }).first()).toBeVisible();
  await page.goto(`/applications/${application.id}`);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect.poll(async () => (await offlineRecords(page, "details")).some(r => r.applicationId === application.id)).toBe(true);
  await page.goto("/calendar");
  await expect(page.locator(".calendar-agenda").getByText(taskTitle, { exact: true })).toBeVisible();
  await expect.poll(async () => (await offlineRecords(page, "journal")).some(r => r.tasks.some((t: any) => t.title === taskTitle))).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  const offlineMutations: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/v1/") && !["GET", "HEAD"].includes(request.method())) offlineMutations.push(request.url());
  });
  await page.goto("/applications");
  await expect(page.locator(".offline-notice")).toBeVisible();
  await expect(page.locator(".table-wrap .company-link").filter({ hasText: company }).first()).toBeVisible();
  await page.goto(`/applications/${application.id}`);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  await expect(page.locator(".calendar-agenda").getByText(taskTitle, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  await page.getByRole("dialog").getByLabel("Компания *").fill("Offline local draft");
  await page.getByRole("dialog").getByLabel("Позиция *", { exact: true }).fill("Offline Engineer");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("отправка пока недоступна");
  expect(offlineMutations).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();

  await context.setOffline(false);
  await expect.poll(() => page.locator(".offline-notice").count()).toBe(0);
  // Opting out clears READ copies, while independent drafts continue to save.
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByText("Разрешить чтение журнала офлайн (Opt-in)").click();
  await expect(page.getByLabel("Разрешить чтение журнала офлайн (Opt-in)")).not.toBeChecked();
  await expect.poll(async () => (await offlineRecords(page, "journal")).length).toBe(0);
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  await page.getByRole("dialog").getByLabel("Компания *").fill("Optout still saves drafts");
  await expect.poll(async () => (await offlineRecords(page, "drafts")).some(r => r.data.company === "Optout still saves drafts")).toBe(true);
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();

  const pageB = await context.newPage();
  await pageB.goto("/");
  await pageB.getByRole("button", { name: "Добавить вакансию" }).click();
  await pageB.getByRole("dialog").getByLabel("Компания *").fill("Pending old-tab draft");
  await page.locator(".sidebar-footer").getByRole("button", { name: "Выйти из аккаунта" }).click();
  await page.getByRole("dialog", { name: "Выйти из аккаунта?" }).getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(pageB.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  await expect(pageB.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await offlineRecords(page, "drafts")).length).toBe(0);
  await login(page);
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  await page.getByRole("dialog").getByLabel("Компания *").fill("Post-relogin fresh draft");
  await expect.poll(async () => (await offlineRecords(page, "drafts")).some(r => r.data.company === "Post-relogin fresh draft")).toBe(true);
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  await page.locator(".draft-restore-banner").getByRole("button", { name: "Восстановить", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Компания *")).toHaveValue("Post-relogin fresh draft");
  await pageB.close();
  await page.close();
});

for (const status of [401, 403]) {
  test(`pwa auth ${status}: navigator false cannot restore persisted account`, async ({ page, context }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByText("Разрешить чтение журнала офлайн (Opt-in)").click();
  await expect(page.getByLabel("Разрешить чтение журнала офлайн (Opt-in)")).toBeChecked();
    await expect.poll(async () => (await offlineRecords(page, "user")).length).toBeGreaterThan(0);
    await context.addInitScript(() => Object.defineProperty(navigator, "onLine", { get: () => false }));
    await page.route("**/api/v1/me", route => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: "denied" }) }));
    await page.reload();
    await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
    await expect.poll(async () => (await offlineRecords(page, "user")).length).toBe(0);
    await expect(page.locator(".company-link")).toHaveCount(0);
  });
}

test("pwa cached fallback stays read-only with navigator true until live me verifies", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByText("Разрешить чтение журнала офлайн (Opt-in)").click();
  await expect(page.getByLabel("Разрешить чтение журнала офлайн (Opt-in)")).toBeChecked();
  await expect.poll(async () => (await offlineRecords(page, "journal")).length).toBe(1);
  await page.route("**/api/v1/me", route => route.abort("failed"));
  await page.route("**/api/v1/applications", route => route.abort("failed"));
  await page.goto("/");
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.locator(".offline-notice")).toBeVisible();
  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  await page.getByRole("dialog").getByLabel("Компания *").fill("Cached fallback draft");
  let mutationCount = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/applications")) mutationCount++; });
  await page.getByRole("dialog").getByLabel("Позиция *", { exact: true }).fill("Offline Engineer");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(mutationCount).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();

  await page.unroute("**/api/v1/me");
  await page.unroute("**/api/v1/applications");
  let releaseVerification!: () => void;
  const verificationGate = new Promise<void>(resolve => { releaseVerification = resolve; });
  await page.route("**/api/v1/me", async route => { await verificationGate; await route.continue(); });
  const meRequest = page.waitForRequest("**/api/v1/me");
  await page.locator(".offline-notice").getByRole("button", { name: "Повторить" }).click();
  await meRequest;
  await expect(page.locator(".offline-notice")).toBeVisible();
  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  await page.getByRole("dialog").getByLabel("Компания *").fill("Awaiting verification draft");
  await page.getByRole("dialog").getByLabel("Позиция *", { exact: true }).fill("Offline Engineer");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(mutationCount).toBe(0);
  releaseVerification();
  await expect(page.locator(".offline-notice")).toHaveCount(0);
});

test("pwa share: confirmed intake across login, canonical duplicate, shortcut and manual paste", async ({ page, context }) => {
  const unique = Date.now();
  const incomingUrl = `https://jobs.example.org/vacancy/${unique}`;
  const mutations: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/applications")) mutations.push(request.url());
  });
  await page.goto(`/share?url=${encodeURIComponent(incomingUrl)}&title=Shared%20Engineer`);
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("browser-test-password");
  await submitLogin(page);
  const form = page.getByRole("dialog", { name: "Добавить вакансию", exact: true });
  await expect(form.getByLabel("Ссылка на вакансию", { exact: true })).toHaveValue(incomingUrl);
  await expect(form.getByLabel("Позиция *", { exact: true })).toHaveValue("Shared Engineer");
  expect(mutations).toEqual([]);
  await expect(page.getByRole("heading", { name: "Страница не найдена", exact: true })).toHaveCount(0);
  const before = await (await page.request.get("/api/v1/daily-summary")).json();
  await form.getByLabel("Компания *", { exact: true }).fill(`Shared Confirmed ${unique}`);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Shared Confirmed ${unique}`, exact: true })).toBeVisible();
  expect(mutations).toHaveLength(1);
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await page.getByRole("button", { name: "Цели", exact: true }).click();
  await expect(page.getByTestId("daily-goal-score")).toHaveText(`${before.total + 1}/10`);
  await page.getByRole("button", { name: "Закрыть цели", exact: true }).click();

  const csrf = (await context.cookies()).find(cookie => cookie.name === "avari_csrf")!.value;
  const company = `Canonical Duplicate ${unique}`;
  const response = await page.request.post("/api/v1/applications", {
    headers: { "X-CSRF-Token": csrf }, data: {
      company, position: "Existing Engineer", url: "https://hh.ru/vacancy/987123456",
      stage: "saved", state: "active", savedDate: new Date().toISOString().slice(0, 10),
    },
  });
  expect(response.ok()).toBeTruthy();
  const existing = await response.json();
  await page.goto(`/share?url=${encodeURIComponent("https://hh.ru/vacancy/987123456?utm_source=share")}`);
  await expect(page).toHaveURL(new RegExp(`/applications/${existing.id}$`));
  await expect(page.getByRole("heading", { name: company, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toHaveLength(1);

  await page.goto("/#add-vacancy");
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Компания *", { exact: true })).toHaveValue("");
  await form.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Вставить ссылку", exact: true }).click();
  const paste = page.getByRole("dialog", { name: "Добавить вакансию по ссылке", exact: true });
  await paste.getByLabel("Ссылка или текст вакансии").fill("javascript:alert(1)");
  await paste.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(paste.getByRole("alert")).toBeVisible();
  await paste.getByLabel("Ссылка или текст вакансии").fill(`Новая вакансия ${incomingUrl}`);
  await paste.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Shared Confirmed ${unique}`, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toHaveLength(1);
  await page.goto("/share?url=javascript%3Aalert(1)");
  await expect(page.getByRole("heading", { name: "Главная", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
