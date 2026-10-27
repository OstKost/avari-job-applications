import { test, expect } from "@playwright/test";
import { submitLogin } from "./auth";

test("MCP token lifecycle and vacancy creation", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("mcp-browser@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await submitLogin(page);
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("tab", { name: "MCP / Codex" }).click();
  await expect(page.getByText("Нет MCP-подключений.")).toBeVisible();
  await page.getByLabel("Название подключения").fill("E2E Codex");
  await page.getByRole("button", { name: "Создать токен на 90 дней" }).click();
  const input = page.getByLabel("Новый MCP-токен");
  await expect(input).toBeVisible();
  const secret = await input.inputValue();
  expect(secret.startsWith("avari_mcp_")).toBeTruthy();
  const headers = {
    Authorization: `Bearer ${secret}`,
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  };
  const call = async (name: string, args: unknown) => {
    const response = await page.request.post("/mcp", {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      },
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()).result;
    expect(result.isError).not.toBe(true);
    return result.structuredContent;
  };
  const prepared = await call("prepare_vacancy", {
    url: "https://example.com/jobs/e2e?utm_source=codex",
    fields: { company: "MCP Browser Corp", position: "Go engineer" },
  });
  const before = await (await page.request.get("/api/v1/applications")).json();
  expect(before).toHaveLength(0);
  const args = {
    url: prepared.url,
    fields: prepared.fields,
    idempotencyKey: prepared.idempotencyKey,
  };
  const saved = await call("save_vacancy", args);
  expect(saved.status).toBe("created");
  expect((await call("save_vacancy", args)).status).toBe("already_exists");
  await page.getByRole("button", { name: "Скрыть токен" }).click();
  await expect(input).not.toBeVisible();
  await page.screenshot({
    path: "test-results/mcp-settings.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mcp-settings-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "Общие", exact: true }).click();
  await page.getByRole("tab", { name: "MCP / Codex" }).click();
  await expect(input).not.toBeVisible();
  await expect(page.getByText("E2E Codex", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отозвать", exact: true }).click();
  await expect(page.getByText("Нет MCP-подключений.")).toBeVisible();
  const denied = await page.request.post("/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(denied.status()).toBe(401);
  await page.goto(saved.application.link);
  await expect(page.getByText("MCP Browser Corp").first()).toBeVisible();
  await expect(page.getByText(/· MCP/)).toBeVisible();
});
