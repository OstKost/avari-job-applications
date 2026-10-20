import { test, expect } from "@playwright/test";

for (const width of [320, 390, 768, 800]) {
  test(`mobile layout at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    await page
      .getByLabel("Email", { exact: true })
      .fill("features@example.com");
    await page
      .getByLabel("Пароль", { exact: true })
      .fill("browser-test-password");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Главная", exact: true }),
    ).toBeVisible();
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "avari_csrf",
    )!.value;
    const created = await page.request.post("/api/v1/applications", {
      headers: { "X-CSRF-Token": csrf },
      data: {
        company: "Очень длинное название компании для мобильного экрана",
        position: "Senior Frontend Engineer",
        stage: "saved",
        state: "active",
        tags: ["TypeScript", "React"],
      },
    });
    expect(created.ok()).toBeTruthy();
    const application = await created.json();
    for (const route of [
      `/applications/${application.id}`,
      "/",
      "/applications",
      "/favorites",
      "/calendar",
      "/statistics",
      "/resumes",
      "/proposals",
      "/settings",
    ]) {
      await page.goto(route);
      await expect(
        page.locator("main").getByRole("heading").first(),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(
          `${route.replaceAll("/", "") || "dashboard"}.png`,
        ),
        fullPage: true,
      });
      const layout = await page.evaluate(() => {
        const nav = document.querySelector(".sidebar")!.getBoundingClientRect();
        return {
          width: document.documentElement.scrollWidth,
          navBottom: nav.bottom,
          navPosition: getComputedStyle(document.querySelector(".sidebar")!)
            .position,
        };
      });
      expect.soft(layout.width, route).toBeLessThanOrEqual(width);
      expect.soft(layout.navPosition, route).toBe("fixed");
      expect.soft(layout.navBottom, route).toBeCloseTo(844, 0);
      if (route.startsWith("/applications/")) {
        expect(
          await page
            .locator(".detail-meta-row")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBeTruthy();
      }
      if (route === "/applications") {
        const tabs = page.locator(".register-tabs button");
        for (const tab of await tabs.all()) {
          expect(
            await tab.evaluate((el) => {
              const text = document.createRange();
              text.selectNodeContents(el);
              const content = text.getBoundingClientRect();
              const button = el.getBoundingClientRect();
              return (
                content.left >= button.left && content.right <= button.right
              );
            }),
          ).toBeTruthy();
        }
      }
    }
    await page.goto("/");
    await page
      .getByRole("button", { name: "Добавить вакансию", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath("application-form.png") });
  });
}
