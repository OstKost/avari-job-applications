import { test, expect, type Page } from "@playwright/test";
test("public extension page and privacy are available before login", async ({
  page,
}) => {
  await page.goto("/extension");
  await expect(
    page.getByRole("heading", { name: "Расширение Avari.Jobs" }),
  ).toBeVisible();
  // Direct public downloads are blocked to comply with Chrome Web Store and Safe Browsing requirements
  const directDownload = await page.request.get("/downloads/avari-extension.zip");
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
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
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
  await dialog.getByLabel("Название новой группы").fill("Разработка");
  await dialog
    .getByRole("button", { name: "Добавить группу", exact: true })
    .click();
  await dialog.getByLabel("Название новой группы").fill("Удалённая работа");
  await dialog
    .getByRole("button", { name: "Добавить группу", exact: true })
    .click();
  await dialog.getByLabel("Этап", { exact: true }).selectOption("applied");
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
      .locator(".detail-badges")
      .getByText("Удалённая работа", { exact: true }),
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
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Контакт рекрутера")
    .fill("hr@example.com");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(
    page.getByText("hr@example.com", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("registration stays pending and unauthorized data is blocked", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("pending-browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByLabel("Подтвердите пароль").fill("browser-test-password");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByText("Аккаунт создан.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявка отправлена" }),
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


test("workspace design: dashboard, grouped table, density, pagination and monthly agenda", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
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
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await page.getByLabel("Группировка", { exact: true }).selectOption("stage");
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
  await page.getByLabel("Группировка", { exact: true }).selectOption("");
  await page
    .getByRole("button", { name: "Высокие строки", exact: true })
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
    .getByRole("button", { name: "Высокие строки", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Высокие строки", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
  await page.getByLabel("Группировка", { exact: true }).selectOption("company");
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
