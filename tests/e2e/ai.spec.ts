import { test, expect } from "@playwright/test";
import { submitLogin } from "./auth";

test("AI workflow: connection, vacancy extraction, skills and approved profile", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("ai-browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await submitLogin(page);
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page.goto("/settings#ai");
  await page.getByLabel("Идентификатор модели").fill("fixture-model");
  await page.getByLabel("API-ключ", { exact: true }).fill("fixture-key");
  await page
    .getByRole("button", { name: "Сохранить подключение", exact: true })
    .click();
  await expect(
    page.getByText("Подключение сохранено", { exact: true }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "avari_csrf",
  )!.value;
  const response = await page.request.post("/api/v1/applications", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
    data: {
      company: "AI Fixture",
      position: "React Engineer",
      ai: {
        text: "Develop React interfaces, query SQL databases",
        summary: "",
        skills: [],
        source: "manual",
        processedAt: "",
        provider: "",
        model: "",
        textHash: "",
        stale: false,
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  const app = await response.json();
  await page.goto(`/applications/${app.id}`);
  await page
    .getByRole("button", { name: "Выделить описание и навыки через ИИ" })
    .click();
  await expect(
    page
      .getByText("Разработка интерфейсов на React и SQL", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("#React", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: "Перегенерировать описание и навыки" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Предлагаемый результат" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Применить с заменой текущего результата" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Предлагаемый результат" }),
  ).toHaveCount(0);
  await page.goto("/skills");
  await expect(
    page.getByText("Обработано 1 из 1 вакансий выбранной выборки."),
  ).toBeVisible();
  const skill = page
    .locator(".ai-skill-list article")
    .filter({ hasText: "#React" });
  await skill.getByRole("button", { name: "Изменить" }).click();
  await page
    .getByRole("dialog", { name: "Навык и самооценка" })
    .getByLabel("Уровень владения")
    .selectOption("4");
  await page
    .getByRole("button", { name: "Сохранить навык", exact: true })
    .click();
  await expect(skill.getByText("4/10", { exact: true })).toBeVisible();
  await page.goto("/resumes");
  await page
    .getByRole("button", { name: "Предложить три варианта через ИИ" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Frontend Engineer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Выбрать и отредактировать название" })
    .first()
    .click();
  await page.getByRole("button", { name: "Утвердить направление" }).click();
  const profile = page.locator("article.ai-panel").filter({
    has: page.getByRole("heading", {
      name: "Frontend Engineer",
      exact: true,
    }),
  });
  await profile.getByRole("checkbox").check();
  await profile
    .getByRole("button", { name: "Сохранить направление и правки" })
    .click();
  await expect(
    profile.getByRole("button", { name: "Сгенерировать профиль через ИИ" }),
  ).toBeEnabled();
  await profile
    .getByRole("button", { name: "Сгенерировать профиль через ИИ" })
    .click();
  await expect(
    profile.getByRole("heading", { name: "Предлагаемый результат" }),
  ).toBeVisible();
  await expect(profile.getByLabel("Профиль (можно редактировать)")).toHaveValue(
    "",
  );
  await profile
    .getByRole("button", { name: "Применить с заменой текущего результата" })
    .click();
  await expect(profile.getByLabel("Профиль (можно редактировать)")).toHaveValue(
    /Описание направления/,
  );
  await page.screenshot({
    path: testInfo.outputPath("ai-profiles-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    profile.getByLabel("Профиль (можно редактировать)"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("ai-profiles-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
