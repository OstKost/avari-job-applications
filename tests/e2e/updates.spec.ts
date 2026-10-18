import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
}

test("release history is quiet on first visit, marks upgrades and clears when read", async ({
  page,
}) => {
  await login(page);
  await expect(page.locator(".release-dot")).toHaveCount(0);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("avari-whats-new:"),
    );
    if (!key) throw new Error("Missing release view state");
    localStorage.setItem(key, "1.0.0");
    window.dispatchEvent(new Event("storage"));
  });
  await expect(page.locator(".release-dot")).toHaveCount(1);
  await page.getByRole("link", { name: "Что нового", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Что нового", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".release-entry")).not.toHaveCount(0);
  await expect(page.locator(".release-dot")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".release-entry")).not.toHaveCount(0);
  await expect(page.locator(".release-dot")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Что нового", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("desktop update downloads before explicit install; snooze and recovery preserve navigation", async ({
  page,
}) => {
  const state = {
    currentVersion: "1.3.0",
    availableVersion: "1.4.0",
    stage: "available",
    downloaded: 0,
    total: 1024,
    canInstall: false,
    checkedAt: Math.floor(Date.now() / 1000),
    snoozedUntil: 0,
    notes: [
      {
        version: "1.4.0",
        date: "2026-10-18",
        summary: "Тестовый выпуск",
        features: ["Удобное обновление"],
        improvements: [],
        fixes: [],
      },
    ],
    error: "",
    releaseUrl:
      "https://github.com/OstKost/avari-job-applications/releases/latest",
  };
  const commands: string[] = [];
  await page.route("**/api/v1/local/status", (route) =>
    route.fulfill({
      json: { personal: true, setupNeeded: false, launcher: true },
    }),
  );
  await page.route("**/api/v1/local/settings", (route) =>
    route.fulfill({ json: { autostart: false } }),
  );
  await page.route(/\/api\/v1\/local\/update(?:\/\w+)?$/, (route) => {
    const action = new URL(route.request().url()).pathname.split("/")[5];
    if (action) {
      commands.push(action);
      if (action === "snooze")
        state.snoozedUntil = Math.floor(Date.now() / 1000) + 604800;
      if (action === "download") {
        state.stage = "ready";
        state.downloaded = 1024;
        state.canInstall = true;
      }
      if (action === "install") state.stage = "installing";
    }
    return route.fulfill({ json: state });
  });
  await login(page);
  await page.getByRole("button", { name: "Напомнить через неделю" }).click();
  await expect(
    page.getByRole("complementary", { name: "Доступно обновление" }),
  ).toHaveCount(0);
  await page.goto("/settings#updates");
  await page.getByRole("button", { name: "Скачать версию 1.4.0" }).click();
  await expect(
    page.getByRole("button", {
      name: "Установить и перезапустить",
      exact: true,
    }),
  ).toBeVisible();
  expect(commands).toEqual(["snooze", "download"]);
  await page.screenshot({
    path: "test-results/updates-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Установить и перезапустить", exact: true })
    .click();
  await expect(
    page.getByText("Ожидаем запуска обновлённого приложения…"),
  ).toBeVisible();
  await page.route("**/release.json", (route) =>
    route.fulfill({ json: { version: "1.4.0" } }),
  );
  await expect(
    page.getByRole("button", { name: "Открыть обновлённое приложение" }),
  ).toBeVisible();
  expect(commands).toEqual(["snooze", "download", "install"]);
  await page
    .getByRole("button", { name: "Открыть обновлённое приложение" })
    .click();
  await expect(page).toHaveURL(/\/settings#updates$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("avari-update-restart")),
  ).toBeNull();
});

test("release history handles an HTML response and recovers on retry", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/release-notes.json", async (route) => {
    if (unavailable)
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html>SPA fallback</html>",
      });
    return route.continue();
  });
  await login(page);
  await page.getByRole("link", { name: "Что нового", exact: true }).click();
  await expect(
    page.getByText(
      "Не удалось загрузить историю изменений. Попробуйте ещё раз.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Unexpected token/)).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: /Повторить/ }).click();
  await expect(page.locator(".release-entry")).not.toHaveCount(0);
  await expect(
    page.getByText(
      "Не удалось загрузить историю изменений. Попробуйте ещё раз.",
      { exact: true },
    ),
  ).toHaveCount(0);
});
