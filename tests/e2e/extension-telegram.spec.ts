import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("real MV3 extension: Telegram login survives popup close and browser restart", async () => {
  test.setTimeout(90000);
  const temp = await mkdtemp(path.join(tmpdir(), "avari-telegram-"));
  const extension = path.join(temp, "extension");
  await cp(path.resolve("apps/extension/dist"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(extension, "manifest.json"), "utf8"),
  );
  expect(manifest.version).toBe(process.env.AVARI_VERSION || "1.10.0");
  expect(
    manifest.web_accessible_resources.flatMap((r: any) => r.resources),
  ).not.toContain("auth.html");
  const server = process.env.AVARI_TEST_URL!;
  manifest.host_permissions.push(new URL(server).origin + "/*");
  await writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify(manifest),
  );
  const launch = () =>
    chromium.launchPersistentContext(path.join(temp, "profile"), {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      extraHTTPHeaders: { "X-Real-IP": "192.0.2.79" },
    });
  let context = await launch();
  try {
    let worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = worker.url().split("/")[2];
    // Configure a server with Telegram enabled; the personal server must hide the button.
    await worker.evaluate(
      async ({ server }) => {
        await chrome.storage.local.set({
          server,
          storageMode: "local",
          serverAddresses: { online: "https://jobs.avari.dev", local: server },
        });
      },
      { server },
    );
    let popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/index.html`);
    await expect(
      popup.getByRole("button", { name: "Войти через Telegram", exact: true }),
    ).toBeVisible();
    const opened = context.waitForEvent("page");
    await popup
      .getByRole("button", { name: "Войти через Telegram", exact: true })
      .click();
    let auth = await opened;
    await expect(
      auth.getByRole("heading", { name: "Вход через Telegram" }),
    ).toBeVisible();
    await expect(auth.getByText(/Код:/)).toBeVisible();
    await expect(auth.getByText(`Сервис: ${server}`)).toBeVisible();
    const link = auth.getByRole("link", {
      name: "Открыть Telegram",
      exact: true,
    });
    const botToken = new URL(
      (await link.getAttribute("href"))!,
    ).searchParams.get("start")!;
    const secret = await worker.evaluate(
      async () =>
        (
          (await chrome.storage.local.get("telegramLogin")).telegramLogin as {
            secret: string;
          }
        ).secret,
    );
    expect(await auth.locator("body").innerText()).not.toContain(secret);
    expect(auth.url()).not.toContain(secret);
    await auth.screenshot({
      path: "test-results/extension-telegram-pending.png",
    });
    await popup.close();
    // Opening the bot alone must not complete login.
    const start = await context.request.post(server + "/__test/telegram", {
      data: { token: botToken, telegramId: 7001, approve: false },
    });
    expect(start.ok()).toBeTruthy();
    const challenge = await start.json();
    expect(
      await worker.evaluate(
        async () => (await chrome.storage.local.get("token")).token,
      ),
    ).toBeUndefined();
    await context.close();
    context = await launch();
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    auth = await context.newPage();
    await auth.goto(`chrome-extension://${id}/auth.html`);
    await expect(
      auth.getByRole("link", { name: "Открыть Telegram" }),
    ).toHaveAttribute(
      "href",
      `https://t.me/browser_test_bot?start=${botToken}`,
    );
    const approval = await context.request.post(server + "/__test/telegram", {
      data: { id: challenge.id, telegramId: 7001, approve: true },
    });
    expect(approval.ok()).toBeTruthy();
    await expect(
      auth.getByRole("heading", { name: "Вы вошли", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const config = await auth.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "TELEGRAM_STATUS",
        server: location.origin,
      }),
    );
    expect(config.ok).toBe(false); // A stale or wrong server cannot complete an auth attempt.
    const result = await worker.evaluate(async () => {
      const saved = await chrome.storage.local.get([
        "server",
        "token",
        "telegramLogin",
      ]);
      const response = await fetch(saved.server + "/api/v1/me", {
        headers: { Authorization: "Bearer " + saved.token },
        credentials: "omit",
      });
      return {
        user: await response.json(),
        pending: saved.telegramLogin,
        token: saved.token,
      };
    });
    expect(result.user.email).toBe("telegram-login@example.com");
    expect(result.pending).toBeUndefined();
    expect(await auth.locator("body").innerText()).not.toContain(result.token);
    expect(
      (await context.cookies(server)).find((c) => c.name === "avari_session"),
    ).toBeUndefined();
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/index.html`);
    await expect(popup.getByLabel("Email", { exact: true })).not.toBeVisible();
    const settings = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "CONFIG" }),
    );
    expect(settings.data.hasToken).toBe(true);
    expect(settings.data.token).toBeUndefined();
    await auth.screenshot({
      path: "test-results/extension-telegram-success.png",
    });
  } finally {
    await context.close();
    await rm(temp, { recursive: true, force: true });
  }
});
