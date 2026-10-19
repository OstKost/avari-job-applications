import { expect, test } from "@playwright/test";
import { submitLogin } from "./auth";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "X-Real-IP": "192.0.2.84" });
});

test("landing: real previews, navigation, mobile and independent palette", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("avari-theme", "light"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Вакансии, откликии собеседования —в одном журнале.",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".landing")).toHaveCSS(
    "background-color",
    "rgb(11, 16, 22)",
  );
  await page
    .getByRole("link", { name: "Посмотреть, как работает", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#features$/);
  await expect(page.locator(".landing")).toBeVisible();
  const journal = page.getByRole("tab", { name: "Отклики", exact: true });
  await journal.click();
  await journal.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Календарь", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAttribute(
    "id",
    "preview-panel-calendar",
  );
  await expect
    .poll(() =>
      page
        .getByRole("tabpanel")
        .locator("img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await page.getByRole("tab", { name: "План дня", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Следующие шаги перед глазами" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Отклики", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole("tabpanel")
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.currentSrc),
    )
    .toContain("journal-mobile.webp");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page
    .getByText("Чем отличается локальная версия?", { exact: true })
    .click();
  await expect(page.locator(".landing-questions details[open]")).toContainText(
    "Автоматической синхронизации между версиями нет",
  );
  await page.screenshot({
    path: "test-results/landing-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Начать онлайн", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/login\?mode=register$/);
  await expect(
    page.getByRole("heading", { name: "Создать аккаунт", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Подтвердите пароль", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await page
    .getByRole("button", { name: "Забыли пароль?", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Восстановление доступа", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "На главную", exact: true }).click();
  await expect(page.locator(".landing")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("avari-theme"))).toBe(
    "light",
  );
  expect(errors).toEqual([]);
});

test("landing: login returns to protected URL and authenticated root stays dashboard", async ({
  page,
}) => {
  await page.goto("/calendar?view=week#agenda");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
    "/calendar?view=week#agenda",
  );
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await submitLogin(page);
  await expect(page).toHaveURL(/\/calendar\?view=week#agenda$/);
  await expect(
    page.getByRole("heading", { name: "Календарь", exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".landing")).toHaveCount(0);
  await page.goto("/login?returnTo=https%3A%2F%2Fexample.com");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
});

test("landing: direct login reload, reduced motion and registration mode", async ({
  page,
}) => {
  await page.goto("/login?mode=register");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Создать аккаунт", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Вход в Avari.Jobs", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/login-desktop-new.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/login-mobile-new.png",
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.goto("/");
  await expect(page.locator(".landing-product")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("tabpanel")).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await page.locator(".landing-product").scrollIntoViewIfNeeded();
  await expect(page.locator(".landing-product")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("tabpanel")).toHaveCSS(
    "animation-name",
    "landing-screen-in",
  );
  await page.goto("/extension");
  await page
    .getByRole("link", { name: "Войти в Avari.Jobs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Вход в Avari.Jobs", exact: true }),
  ).toBeVisible();
});
