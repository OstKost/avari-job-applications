import { test, expect } from "@playwright/test";
const repository =
  "https://github.com/OstKost/avari-job-applications/releases/download/v1.1.0/";
const files = [
  "avari-jobs-windows-x64-setup.exe",
  "avari-jobs-macos-apple-silicon.dmg",
  "avari-jobs-macos-intel.dmg",
];
test.beforeEach(async ({ page }) => {
  await page.route(
    "https://api.github.com/repos/OstKost/avari-job-applications/releases/latest",
    (route) =>
      route.fulfill({
        json: {
          tag_name: "v1.1.0",
          assets: files.map((name) => ({
            name,
            browser_download_url: repository + name,
          })),
        },
      }),
  );
});
test("installer selection and complete installation guide", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Ваш компьютер.",
  );
  await expect(page.locator("#download")).toHaveAttribute(
    "href",
    repository + files[0],
  );
  await page.screenshot({
    path: info.outputPath("guide-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Apple Silicon/ }).click();
  await expect(page.locator("#download")).toHaveAttribute(
    "href",
    repository + files[1],
  );
  await page.getByRole("button", { name: /Intel/ }).click();
  await expect(page.locator("#download")).toHaveAttribute(
    "href",
    repository + files[2],
  );
  await page.getByRole("button", { name: "Далее →" }).click();
  await expect(
    page.getByRole("heading", { name: "Ваш личный журнал — с чистого листа" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Далее →" }).click();
  await expect(
    page.getByRole("heading", { name: "Вакансия из браузера — в журнал" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Страница расширения ↗" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Вручную", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Скачать архив расширения ↓" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Далее →" }).click();
  await expect(
    page.getByRole("heading", { name: "Теперь можно искать работу" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Всё готово ✓" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "← Назад" }).click();
  await expect(page.locator("#progress")).toHaveText("Шаг 3 из 4");
  expect(errors).toEqual([]);
});
test("mobile guide stays within screen and works without release API", async ({
  page,
}, info) => {
  await page.route(
    "https://api.github.com/repos/OstKost/avari-job-applications/releases/latest",
    (route) => route.fulfill({ status: 403, json: {} }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#download")).toHaveAttribute(
    "href",
    /releases\/latest\/download\/avari-jobs-windows/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("guide-mobile.png"),
    fullPage: true,
  });
  await page.locator('[data-step="2"]').click();
  await page.getByRole("tab", { name: "Вручную", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Скачать архив расширения ↓" }),
  ).toBeVisible();
});
