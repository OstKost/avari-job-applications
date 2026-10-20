import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const local = process.env.AVARI_LOCAL_TEST_URL;
test("personal first run, extension options and journal merge from settings", async ({
  page,
}, testInfo) => {
  test.skip(!local, "Personal instance supplied by Go browser fixture");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(local!);
  await expect(
    page.getByText(
      "Для создания владельца откройте Avari.Jobs через иконку приложения.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать аккаунт", exact: true }),
  ).toBeDisabled();
  await page.goto(local! + "/#setup=browser-setup-secret");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Добро пожаловать в локальный Avari.Jobs",
    }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/setup=/);
  await page.screenshot({
    path: testInfo.outputPath("local-setup.png"),
    fullPage: true,
  });
  await page.getByLabel("Email", { exact: true }).fill("local@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("local-test-password");
  await page
    .getByLabel("Повторите пароль", { exact: true })
    .fill("local-test-password");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Подключите расширение" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подготовить архив для ручной установки" })
    .click();
  await expect(
    page.getByRole("link", { name: "Скачать архив расширения" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Открыть журнал", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  // Create real records through the same cookie and CSRF-protected API.
  await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((c) => c.startsWith("avari_csrf="))!
      .slice(11);
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    };
    const response = await fetch("/api/v1/applications", {
      method: "POST",
      headers,
      body: JSON.stringify({
        company: "Local Company",
        position: "Developer",
        url: "https://hh.ru/vacancy/87654321",
      }),
    });
    if (!response.ok) throw new Error("Create failed");
    const application = await response.json();
    await fetch("/api/v1/notes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        applicationId: application.id,
        text: "Моя заметка",
      }),
    });
  });
  await expect(
    page.getByRole("button", { name: "Установить приложение", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Push-уведомления", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Офлайн/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Подключить Telegram", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("tab", { name: "Импорт и экспорт", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать журнал JSON" }).click();
  const downloaded = await downloading;
  const data = await readFile((await downloaded.path())!, "utf8");
  const journal = JSON.parse(data);
  expect(journal.applications).toHaveLength(1);
  expect(journal.notes).toHaveLength(1);
  await page
    .locator('input[type="file"][aria-label="Импортировать журнал JSON"]')
    .setInputFiles({
      name: "journal.json",
      mimeType: "application/json",
      buffer: Buffer.from(data),
    });
  await expect(
    page.getByRole("button", { name: "Применить импорт" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Новые вакансии: 0", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("journal-import.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Применить импорт" }).click();
  await expect(
    page.getByText("Импорт завершён. Текущие версии записей сохранены."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Календарь", exact: true }).click();
  await expect(
    page.getByText(/Внешние календарные сервисы не могут прочитать localhost/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Общие", exact: true }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Нет аккаунта? Создать", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "На главную", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Войти через Telegram", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
