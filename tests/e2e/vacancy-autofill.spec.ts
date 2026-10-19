import { submitLogin } from "./auth";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
const url = "https://hh.ru/vacancy/123456";
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto("/");
  } else {
    await page.goto("/");
    await page
      .getByLabel("Email", { exact: true })
      .fill("autofill@example.com");
    await page
      .getByLabel("Пароль", { exact: true })
      .fill("browser-test-password");
    await submitLogin(page);
    await expect(
      page.getByRole("heading", { name: "Главная", exact: true }),
    ).toBeVisible();
    cookies = await page.context().cookies();
  }
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
}
async function clipboard(page: Page, text: string | null) {
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: () =>
          value === null
            ? Promise.reject(new DOMException("Denied", "NotAllowedError"))
            : Promise.resolve(value),
      },
    });
  }, text);
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "Добавить вакансию", exact: true })
    .click();
  return page.getByRole("dialog");
}

test("pasting a supported URL overwrites found fields, preserves missing values and saves separately", async ({
  page,
}, testInfo) => {
  await clipboard(page, null);
  await login(page);
  const savedBefore = await (
    await page.request.get("/api/v1/applications")
  ).json();
  let requests = 0;
  await page.route("**/api/v1/vacancies/preview", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ url });
    await route.fulfill({
      json: {
        url,
        fields: {
          company: "Autofill Corp",
          position: "Golang Engineer",
          salary: { min: 120000 },
        },
      },
    });
  });
  const dialog = await open(page);
  await dialog.getByLabel("Компания *", { exact: true }).fill("Manual company");
  await dialog.getByLabel("Зарплата до", { exact: true }).fill("250000");
  await dialog.getByLabel("Ссылка на вакансию", { exact: true }).fill(url);
  await expect(dialog.getByLabel("Компания *", { exact: true })).toHaveValue(
    "Autofill Corp",
  );
  await expect(dialog.getByLabel("Позиция *", { exact: true })).toHaveValue(
    "Golang Engineer",
  );
  await expect(dialog.getByLabel("Зарплата от", { exact: true })).toHaveValue(
    "120000",
  );
  await expect(dialog.getByLabel("Зарплата до", { exact: true })).toHaveValue(
    "250000",
  );
  expect(requests).toBe(1);
  expect(await (await page.request.get("/api/v1/applications")).json()).toEqual(
    savedBefore,
  );
  await page.screenshot({
    path: testInfo.outputPath("vacancy-autofill.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Autofill Corp", exact: true }),
  ).toBeVisible();
});

test("clipboard data is offered before filling and can be dismissed", async ({
  page,
}, testInfo) => {
  await clipboard(page, url);
  await login(page);
  let requests = 0;
  await page.route("**/api/v1/vacancies/preview", async (route) => {
    requests++;
    await route.fulfill({
      json: {
        url,
        fields: { company: "Clipboard Corp", position: "Backend Developer" },
      },
    });
  });
  let dialog = await open(page);
  await expect(
    dialog.getByText("Заполнить из буфера обмена?", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Компания *", { exact: true })).toHaveValue(
    "",
  );
  await page.screenshot({
    path: testInfo.outputPath("vacancy-clipboard.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByText("Заполнить из буфера обмена?", { exact: true }),
  ).toBeVisible();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("vacancy-clipboard-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Пропустить", exact: true }).click();
  await expect(
    dialog.getByLabel("Ссылка на вакансию", { exact: true }),
  ).toHaveValue("");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  dialog = await open(page);
  await dialog.getByRole("button", { name: "Заполнить", exact: true }).click();
  await expect(dialog.getByLabel("Компания *", { exact: true })).toHaveValue(
    "Clipboard Corp",
  );
  await expect(
    dialog.getByLabel("Ссылка на вакансию", { exact: true }),
  ).toHaveValue(url);
  expect(requests).toBe(2);
});

test("loading failure preserves manual values and allows retry", async ({
  page,
}) => {
  await clipboard(page, "https://example.com/unrelated");
  await login(page);
  let requests = 0;
  await page.route("**/api/v1/vacancies/preview", async (route) => {
    requests++;
    if (requests === 1)
      await route.fulfill({
        status: 422,
        json: { error: "Страница недоступна. Заполните поля вручную." },
      });
    else
      await route.fulfill({
        json: { url, fields: { position: "Loaded role" } },
      });
  });
  const dialog = await open(page);
  await dialog
    .getByLabel("Компания *", { exact: true })
    .fill("Keep manual company");
  await dialog.getByLabel("Ссылка на вакансию", { exact: true }).fill(url);
  await expect(dialog.getByRole("status")).toContainText("Страница недоступна");
  await expect(dialog.getByLabel("Компания *", { exact: true })).toHaveValue(
    "Keep manual company",
  );
  await dialog
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await expect(dialog.getByLabel("Позиция *", { exact: true })).toHaveValue(
    "Loaded role",
  );
  await expect(dialog.getByLabel("Компания *", { exact: true })).toHaveValue(
    "Keep manual company",
  );
});
