import { test, expect, type Page } from "@playwright/test";
import { submitLogin } from "./auth";

// Production is behind a trusted reverse proxy. Give each independent flow its
// own client IP so it exercises the real limiter without sharing other specs' quota.
test.beforeEach(async ({ page }, info) => {
  const suffix = info.title.includes("registration")
    ? 71
    : info.title.includes("link requires")
      ? 72
      : 73;
  await page.setExtraHTTPHeaders({ "X-Real-IP": `192.0.2.${suffix}` });
});

async function tokenFromLink(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href"))!).searchParams.get("start")!;
}
async function bot(
  page: Page,
  token: string,
  telegramId: number,
  approve = true,
) {
  const response = await page.request.post("/__test/telegram", {
    data: { token, telegramId, approve },
  });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

test("telegram registration activates the pending account", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`telegram-registration-${Date.now()}@example.com`);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page
    .getByLabel("Подтвердите пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: /Создать аккаунт/ }).click();
  await expect(
    page.getByRole("heading", { name: "Заявка отправлена" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить через Telegram" })
    .click();
  const token = await tokenFromLink(page, "Открыть бота и подтвердить");
  await bot(page, token, 7002);
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible({ timeout: 15000 });
});

test("telegram link requires website confirmation and supports disconnect", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("telegram@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await submitLogin(page);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page
    .getByRole("button", { name: "Подключить Telegram", exact: true })
    .click();
  const token = await tokenFromLink(page, "Открыть бота и подтвердить");
  await bot(page, token, 7003);
  await expect(
    page.getByRole("button", { name: "Подтвердить этот аккаунт на сайте" }),
  ).toBeVisible({ timeout: 15000 });
  const before = await (await page.request.get("/api/v1/telegram")).json();
  expect(before.link).toBeNull();
  await page
    .getByRole("button", { name: "Подтвердить этот аккаунт на сайте" })
    .click();
  const morning = page.getByLabel("Утренняя сводка", { exact: true });
  await expect(morning).not.toBeChecked();
  await morning.check();
  await expect(morning).toBeChecked();
  await page
    .getByRole("button", { name: "Отключить Telegram", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить отключение", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Подключить Telegram", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/me")).ok()).toBeTruthy();
});

test("telegram login requires an explicit bot approval before issuing session", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Войти через Telegram", exact: true })
    .click();
  await expect(page.getByText(/Код:/)).toBeVisible();
  const token = await tokenFromLink(page, "Открыть Telegram");
  const challenge = await bot(page, token, 7001, false);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  const response = await page.request.post("/__test/telegram", {
    data: { id: challenge.id, telegramId: 7001, approve: true },
  });
  expect(response.ok()).toBeTruthy();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const user = await (await page.request.get("/api/v1/me")).json();
  expect(user.email).toBe("telegram-login@example.com");
});
