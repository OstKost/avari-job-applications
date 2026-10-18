import { test, expect } from "@playwright/test";

test.use({ hasTouch: true });

test("statistics: real actions, ranges, charts, themes and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/statistics");
  await page
    .getByLabel("Email", { exact: true })
    .fill("statistics@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("link", { name: "Статистика", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Статистика", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Пока нет активности за этот период.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Добавьте первую вакансию", { exact: false }),
  ).toHaveCount(2);
  await page.getByLabel("Период активности").selectOption("90");
  const activity = page.getByRole("region", {
    name: "Активность",
    exact: true,
  });
  await expect(activity.locator(".statistics-tiles button")).toHaveCount(90);
  await page.getByLabel("Период активности").selectOption("30");
  await expect(activity.locator(".statistics-tiles button")).toHaveCount(30);

  // Write through the real authenticated API; a subsequent page load verifies aggregation.
  const fixture = await page.evaluate(async () => {
    const csrf = decodeURIComponent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("avari_csrf="))
        ?.split("=")[1] ?? "",
    );
    const me = await (await fetch("/api/v1/me")).json();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: me.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const write = async (path: string, body: unknown) => {
      const response = await fetch(`/api/v1/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const app = await write("applications", {
      company: "Statistics Corp",
      position: "Engineer",
      stage: "hr",
      state: "active",
      savedDate: today,
      appliedDate: today,
    });
    await write("notes", { applicationId: app.id, text: "Statistics note" });
    await write("tasks", {
      applicationId: app.id,
      title: "Statistics task",
      date: today,
      kind: "task",
      state: "open",
    });
    return { today, app };
  });
  await page.reload();
  await expect(activity.getByText("3", { exact: true })).toBeVisible();
  await activity.locator(".statistics-tiles button").last().focus();
  await expect(page.getByRole("tooltip")).toContainText("3 действия");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  const daily = page.getByRole("region", {
    name: "Отклики по дням",
    exact: true,
  });
  await expect(daily.locator(".statistics-column")).toHaveCount(30);
  await page.getByLabel("Период откликов").selectOption("7");
  await expect(daily.locator(".statistics-column")).toHaveCount(7);
  await page.getByLabel("Период откликов").selectOption("90");
  await expect(daily.locator(".statistics-column")).toHaveCount(90);
  await page.getByLabel("Период откликов").selectOption("custom");
  await page.getByLabel("С даты", { exact: true }).fill(fixture.today);
  await page.getByLabel("По дату", { exact: true }).fill(fixture.today);
  await expect(daily.locator(".statistics-column")).toHaveCount(1);
  await daily.locator(".statistics-column button").focus();
  await expect(page.getByRole("tooltip")).toContainText("HR: 1");

  const state = page.getByRole("region", {
    name: "По состояниям",
    exact: true,
  });
  const stage = page.getByRole("region", { name: "По этапам", exact: true });
  await expect(state.locator(".statistics-sector")).toHaveCount(1);
  await expect(stage.locator(".statistics-sector")).toHaveCount(1);
  await stage.locator(".statistics-sector").focus();
  await expect(page.getByRole("tooltip")).toContainText("HR: 1 (100%)");

  // Saving through the UI refreshes the activity query without reloading the page.
  await page.getByRole("link", { name: "Отклики", exact: true }).click();
  await page
    .getByRole("link", { name: "Statistics Corp", exact: true })
    .click();
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("One more action");
  await dialog
    .getByRole("button", { name: "Добавить заметку", exact: true })
    .click();
  await page.getByRole("link", { name: "Статистика", exact: true }).click();
  await expect(activity.getByText("4", { exact: true })).toBeVisible();

  // Add another stage on the same day and a closed vacancy on an earlier day.
  await page.evaluate(async ({ today }) => {
    const csrf = decodeURIComponent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("avari_csrf="))
        ?.split("=")[1] ?? "",
    );
    const earlier = new Date(`${today}T00:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - 2);
    for (const fields of [
      {
        company: "Applied Corp",
        stage: "applied",
        state: "active",
        appliedDate: today,
      },
      {
        company: "Closed Corp",
        stage: "offer",
        state: "closed",
        outcome: "self_rejected",
        appliedDate: earlier.toISOString().slice(0, 10),
      },
    ]) {
      const response = await fetch("/api/v1/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          position: "Engineer",
          savedDate: today,
          ...fields,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, fixture);
  await page.reload();
  await expect(activity.getByText("6", { exact: true })).toBeVisible();
  await expect(stage.locator(".statistics-sector")).toHaveCount(3);
  await expect(state.locator(".statistics-sector")).toHaveCount(2);
  await daily.locator(".statistics-column button").last().focus();
  await expect(page.getByRole("tooltip")).toContainText("Отклик: 1; HR: 1");
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Включить светлую тему", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "test-results/statistics-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Включить тёмную тему", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/statistics-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Статистика", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await activity.locator(".statistics-tiles button").last().tap();
  await expect(page.getByRole("tooltip")).toContainText("6 действий");
  await page.screenshot({
    path: "test-results/statistics-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
