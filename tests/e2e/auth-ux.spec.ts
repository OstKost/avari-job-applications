import { test, expect } from "@playwright/test";

test("auth forms preserve destination and email, clear passwords and support recovery", async ({
  page,
}) => {
  await page.goto("/login?returnTo=%2Fapplications");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  const password = page.getByLabel("Пароль", { exact: true });
  await password.fill("browser-test-password");
  await page
    .getByRole("button", { name: "Показать пароль", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Нет аккаунта? Создать" }).click();
  await expect(
    page.getByRole("heading", { name: "Создать аккаунт", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "browser@example.com",
  );
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Telegram/ })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
    "/applications",
  );
  await page.getByRole("button", { name: "Уже есть аккаунт? Войти" }).click();
  await page.getByRole("button", { name: "Забыли пароль?" }).click();
  await expect(
    page.getByText(
      "Укажите email и новый пароль. Администратор одобрит смену вручную.",
    ),
  ).toBeVisible();
  await page
    .getByLabel("Новый пароль", { exact: true })
    .fill("new-browser-password");
  await page.getByLabel("Подтвердите новый пароль").fill("different-password");
  await page.getByRole("button", { name: "Запросить сброс пароля" }).click();
  await expect(page.getByText("Пароли не совпадают")).toBeVisible();
  await page.getByRole("button", { name: "← Вернуться ко входу" }).click();
  await expect(password).toHaveValue("");
  await expect(page.getByText("Пароли не совпадают")).toHaveCount(0);
});

test("registration survives automatic login failure without registering twice", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unavailable" }),
    }),
  );
  await page.goto("/login?mode=register");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`fallback-${Date.now()}@example.com`);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Аккаунт создан. Войдите, чтобы подтвердить его.",
  );
  await expect(
    page.getByRole("heading", { name: "Вход в Avari.Jobs" }),
  ).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
});

for (const theme of ["light", "dark"]) {
  test(`auth layout and password controls: ${theme}`, async ({
    page,
  }, info) => {
    await page.goto("/login");
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ["login", "register", "recovery"]) {
        await page.goto(`/login${mode === "login" ? "" : "?mode=" + mode}`);
        await page.evaluate(
          (value) => (document.documentElement.dataset.theme = value),
          theme,
        );
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page
          .getByRole("button", { name: "Показать пароль", exact: true })
          .click();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        expect(overflow).toBe(false);
        await page.screenshot({
          path: info.outputPath(`${theme}-${width}-${mode}.png`),
          fullPage: true,
        });
      }
    }
  });
}

test("auth errors preserve input and keep switching disabled while submitting", async ({
  page,
}) => {
  let finish: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/v1/auth/login", async (route) => {
    await waiting;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Неверный email или пароль" }),
    });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Нет аккаунта? Создать" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Войти через Telegram" }),
  ).toBeDisabled();
  finish();
  await expect(page.getByRole("alert")).toContainText(
    "Неверный email или пароль",
  );
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue(
    "incorrect-password",
  );
  await page.getByRole("button", { name: "Нет аккаунта? Создать" }).click();
  await page.route("**/api/v1/auth/register", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Этот email уже зарегистрирован" }),
    }),
  );
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Этот email уже зарегистрирован",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "browser@example.com",
  );
  await page.getByRole("button", { name: "Уже есть аккаунт? Войти" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("pending account retains confirmation and destination after a failed status check", async ({
  page,
}) => {
  let failStatus = false;
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: failStatus ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        failStatus
          ? { error: "Не удалось проверить статус" }
          : {
              id: "pending-ux",
              email: "pending@example.com",
              status: "pending",
              timezone: "UTC",
              createdAt: new Date().toISOString(),
            },
      ),
    }),
  );
  await page.route("**/api/v1/telegram", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ enabled: false, link: null }),
    }),
  );
  await page.goto("/login?returnTo=%2Fapplications");
  await expect(page).toHaveURL(/\/applications$/);
  await expect(
    page.getByRole("heading", { name: "Подтвердите аккаунт" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Подтвердить через Telegram" }),
  ).toHaveCount(0);
  failStatus = true;
  await page.getByRole("button", { name: "Проверить статус" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось проверить статус",
  );
  await expect(
    page.getByRole("heading", { name: "Подтвердите аккаунт" }),
  ).toBeVisible();
  failStatus = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/applications$/);
});
