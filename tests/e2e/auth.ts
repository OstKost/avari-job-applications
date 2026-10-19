import { test, expect, type Page } from "@playwright/test";

// The real fixture shares the production 15-attempt/IP/minute limit across specs.
// Retrying that explicit response keeps the full suite isolated from test speed
// without weakening the server's throttle or bypassing the actual login form.
export async function submitLogin(page: Page): Promise<void> {
  const submit = () => Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Войти", exact: true }).click(),
  ]);
  let [response] = await submit();
  if (response.status() === 429) {
    test.setTimeout(test.info().timeout + 65_000);
    await page.waitForTimeout(60_100);
    [response] = await submit();
  }
  expect(response.status()).toBe(200);
}
