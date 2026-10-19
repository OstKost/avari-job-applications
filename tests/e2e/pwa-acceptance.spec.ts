import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function screenshot(page: Page, name: string) {
  const dir = process.env.AVARI_PWA_ARTIFACT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function offlineConsent(page: Page, enabled: boolean) {
  const checkbox = page.getByRole("checkbox", {
    name: /Разрешить чтение журнала офлайн/,
  });
  if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  // The controlled input commits only after its IndexedDB transaction finishes.
  await expect(checkbox).toBeChecked({ checked: enabled });
}

// This suite must never borrow the ordinary TestBrowser fixture URL.
const baseURL = process.env.AVARI_PWA_TEST_URL;
test.use({ baseURL, serviceWorkers: "allow" });
test.skip(!baseURL, "Requires the dedicated AVARI_PWA_TEST_URL fixture");

async function signIn(page: Page, email = "pwa@example.com") {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Основное меню", exact: true }),
  ).toBeVisible();
}
async function login(page: Page) {
  await page.goto("/login");
  await signIn(page);
}
async function records(page: Page) {
  const response = await page.request.get("/api/v1/applications");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(Array.isArray(body)).toBe(true);
  return body as { id: string; company: string; url: string }[];
}
async function seed(page: Page) {
  const response = await page.request.get("/__test/pwa-seed-info");
  expect(response.ok()).toBe(true);
  return (await response.json()) as { company: string; applicationId: string };
}
// Inspect actual durable records; an IDB error or missing store is a test failure.
async function stored(page: Page, name: string): Promise<any[]> {
  return page.evaluate(
    (name) =>
      new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open("avari_offline_v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(name)) {
            db.close();
            reject(new Error(`Missing offline store: ${name}`));
            return;
          }
          const tx = db.transaction(name, "readonly");
          const read = tx.objectStore(name).getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    name,
  );
}
async function controlled(page: Page) {
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  // The worker intentionally does not claim existing clients on first install.
  // Explicit test navigation gains control without masking an application reload.
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller)))
    await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}
async function openApplication(page: Page) {
  await page.goto("/#add-vacancy");
  await expect(
    page.getByRole("dialog").getByLabel("Компания *", { exact: true }),
  ).toBeVisible();
}
async function restoreCompany(page: Page, company: string) {
  await openApplication(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Компания *", { exact: true }),
  ).toHaveValue(company);
}
async function cacheEmpty(page: Page) {
  for (const name of ["journal", "details", "user"]) {
    await expect.poll(() => stored(page, name)).toEqual([]);
  }
}

test.describe("dedicated PWA acceptance", () => {
  test.setTimeout(90_000);
  test.beforeEach(async ({ request }) => {
    // Each test gets a fresh browser context; only the test-only server build pointer is shared.
    expect((await request.post("/__test/pwa-build-a")).ok()).toBe(true);
  });
  test.afterEach(async ({ request }) => {
    expect((await request.post("/__test/pwa-build-a")).ok()).toBe(true);
  });

  test("manifest, first installation without mount reload, and cache exclusions", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const key = "pwa-document-count";
      sessionStorage.setItem(
        key,
        String(Number(sessionStorage.getItem(key) || 0) + 1),
      );
    });
    await page.goto("/login");
    // Registration belongs to the authenticated workspace; login is an SPA transition.
    await signIn(page);
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    expect(
      await page.evaluate(() => sessionStorage.getItem("pwa-document-count")),
    ).toBe("1");
    await expect(page.locator(".pwa-banner")).toHaveCount(0);
    const manifests = await page
      .locator('link[rel="manifest"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(manifests).toEqual(["/manifest.webmanifest"]);
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(
      "application/manifest+json",
    );
    expect(response.headers()["cache-control"]).toContain("no-cache");
    const worker = await page.request.get("/sw.js");
    expect(worker.ok()).toBe(true);
    expect(worker.headers()["content-type"]).toContain(
      "application/javascript",
    );
    expect(worker.headers()["cache-control"]).toContain("no-cache");
    for (const path of [
      "/api/v1/me",
      "/downloads/absent.zip",
      "/resumes/absent.pdf",
    ]) {
      const resource = await page.request.get(path);
      if (path.startsWith("/api/")) {
        expect(resource.headers()["cache-control"]).toBe("no-store");
      } else expect(resource.status()).toBe(404);
    }
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(
      expect.arrayContaining(["/#today", "/calendar", "/#add-vacancy"]),
    );
    expect(manifest.share_target).toMatchObject({
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    });
    for (const size of [192, 512])
      for (const purpose of ["any", "maskable"]) {
        const icon = manifest.icons.find(
          (i: any) =>
            i.sizes === `${size}x${size}` && (i.purpose || "any") === purpose,
        );
        expect(icon).toBeTruthy();
        expect((await page.request.get(icon.src)).ok()).toBe(true);
      }
    const scope = await page.evaluate(
      async () => (await navigator.serviceWorker.ready).scope,
    );
    expect(scope).toBe(new URL("/", baseURL).href);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
          urls.push(new URL(req.url).pathname);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0);
    await screenshot(page, "dashboard");
    expect(
      cached.filter((path) => /^\/(api|downloads|resumes)(\/|$)/.test(path)),
    ).toEqual([]);
  });

  test("explicit A/B update flushes draft; other tab retains its document and input", async ({
    context,
  }) => {
    const a = await context.newPage();
    await login(a);
    await controlled(a);
    const b = await context.newPage();
    const info = await seed(a);
    await b.goto(`/applications/${info.applicationId}`);
    await b
      .getByRole("button", { name: "Добавить задачу", exact: true })
      .click();
    const task = b
      .getByRole("dialog")
      .getByLabel("Название *", { exact: true });
    await task.fill("Other tab task draft");
    await openApplication(a);
    const company = a
      .getByRole("dialog")
      .getByLabel("Компания *", { exact: true });
    await company.fill("Requester draft before update");
    for (const p of [a, b]) {
      await expect(p.locator("html")).toHaveAttribute("data-pwa-build", "A");
      await p.evaluate(() => {
        (window as any).__sameDocument = crypto.randomUUID();
      });
    }
    const otherDocument = await b.evaluate(
      () => (window as any).__sameDocument,
    );
    expect((await a.request.post("/__test/pwa-build-b")).ok()).toBe(true);
    await a.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error("No service worker registration");
      await reg.update();
    });
    const banner = a.locator(".pwa-banner");
    await expect(banner).toContainText("Доступно обновление Avari.Jobs", {
      timeout: 15000,
    });
    await expect(a.locator("html")).toHaveAttribute("data-pwa-build", "A");
    await expect(company).toHaveValue("Requester draft before update");
    await screenshot(a, "update-waiting");
    // Last edit immediately before click exercises flush rather than waiting for autosave debounce.
    await company.fill("Requester final flushed draft");
    await banner.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(a.locator("html")).toHaveAttribute("data-pwa-build", "B", {
      timeout: 15000,
    });
    expect(
      await a.evaluate(() => (window as any).__sameDocument),
    ).toBeUndefined();
    await expect
      .poll(async () =>
        (await stored(a, "drafts")).some(
          (d) =>
            d.kind === "application" &&
            d.data.company === "Requester final flushed draft",
        ),
      )
      .toBe(true);
    await restoreCompany(a, "Requester final flushed draft");
    expect(await b.evaluate(() => (window as any).__sameDocument)).toBe(
      otherDocument,
    );
    await expect(b.locator("html")).toHaveAttribute("data-pwa-build", "A");
    await expect(task).toHaveValue("Other tab task draft");
    await screenshot(b, "other-tab-preserved");
    await expect
      .poll(async () =>
        (await stored(b, "drafts")).some(
          (d) => d.kind === "task" && d.data.title === "Other tab task draft",
        ),
      )
      .toBe(true);
  });

  test("opt-in real records survive offline non-root restart; offline actions send no mutations", async () => {
    const profile = await mkdtemp(join(tmpdir(), "avari-pwa-cold-"));
    let context = await chromium.launchPersistentContext(profile, {
      baseURL,
      serviceWorkers: "allow",
    });
    try {
      const page = context.pages()[0];
      await login(page);
      const info = await seed(page);
      await page.goto("/settings");
      const optIn = page.getByRole("checkbox", {
        name: /Разрешить чтение журнала офлайн/,
      });
      await expect(optIn).not.toBeChecked();
      await offlineConsent(page, true);
      await page.goto(`/applications/${info.applicationId}`);
      await expect(
        page.getByText(
          "Unique acceptance criteria verified for offline replay.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.goto("/calendar");
      await expect(
        page.getByRole("button", {
          name: "Review PWA Acceptance Criteria",
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          (await stored(page, "journal")).some(
            (s) =>
              s.applications.some((a: any) => a.company === info.company) &&
              s.tasks.some(
                (t: any) => t.title === "Review PWA Acceptance Criteria",
              ),
          ),
        )
        .toBe(true);
      await expect
        .poll(async () => JSON.stringify(await stored(page, "details")))
        .toContain("Unique acceptance criteria verified for offline replay.");
      await controlled(page);
      const before = await records(page);
      // Close the entire Chromium process, then restart with the same durable profile offline.
      await context.close();
      context = await chromium.launchPersistentContext(profile, {
        baseURL,
        offline: true,
        serviceWorkers: "allow",
      });
      const mutations: string[] = [];
      context.on("request", (req) => {
        if (
          new URL(req.url()).pathname.startsWith("/api/") &&
          !["GET", "HEAD", "OPTIONS"].includes(req.method())
        )
          mutations.push(`${req.method()} ${req.url()}`);
      });
      await context.setOffline(true);
      const offline = await context.newPage();
      await offline.goto(`/applications/${info.applicationId}`);
      await expect(offline.locator(".offline-notice")).toContainText(
        "только для чтения",
      );
      await expect(
        offline.getByRole("heading", { name: info.company, exact: true }),
      ).toBeVisible();
      await expect(
        offline.getByText(
          "Unique acceptance criteria verified for offline replay.",
          { exact: true },
        ),
      ).toBeVisible();
      await screenshot(offline, "offline-detail");
      await offline
        .getByRole("button", { name: "Заметка", exact: true })
        .click();
      const dialog = offline.getByRole("dialog");
      await dialog
        .getByLabel("Заметка", { exact: true })
        .fill("Offline local draft only");
      await dialog
        .getByRole("button", { name: "Добавить заметку", exact: true })
        .click();
      await expect
        .poll(async () => JSON.stringify(await stored(offline, "drafts")))
        .toContain("Offline local draft only");
      await offline.goto("/calendar");
      await expect(
        offline.getByRole("button", {
          name: "Review PWA Acceptance Criteria",
          exact: true,
        }),
      ).toBeVisible();
      expect(mutations).toEqual([]);
      await context.setOffline(false);
      expect(await records(offline)).toEqual(before);
      const detail = await offline.request.get(
        `/api/v1/applications/${info.applicationId}`,
      );
      expect(detail.ok()).toBe(true);
      expect(JSON.stringify(await detail.json())).not.toContain(
        "Offline local draft only",
      );
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });

  test("opt-out and explicit cache purge preserve drafts; logout and 401 revoke fallback; relogin saves again", async ({
    page,
    context,
  }) => {
    await login(page);
    await openApplication(page);
    await page
      .getByRole("dialog")
      .getByLabel("Компания *", { exact: true })
      .fill("Independent opt-out draft");
    await expect
      .poll(async () => JSON.stringify(await stored(page, "drafts")))
      .toContain("Independent opt-out draft");
    await page.goto("/settings");
    const optIn = page.getByRole("checkbox", {
      name: /Разрешить чтение журнала офлайн/,
    });
    await offlineConsent(page, true);
    await expect
      .poll(async () => (await stored(page, "journal")).length)
      .toBe(1);
    await offlineConsent(page, false);
    await cacheEmpty(page);
    expect(JSON.stringify(await stored(page, "drafts"))).toContain(
      "Independent opt-out draft",
    );
    await offlineConsent(page, true);
    await expect
      .poll(async () => (await stored(page, "journal")).length)
      .toBe(1);
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Очистить локальный кэш", exact: true })
      .click();
    await cacheEmpty(page);
    expect(JSON.stringify(await stored(page, "drafts"))).toContain(
      "Independent opt-out draft",
    );
    const other = await context.newPage();
    await other.goto("/");
    await openApplication(other);
    await other
      .getByRole("dialog")
      .getByLabel("Компания *", { exact: true })
      .fill("Other tab pending logout draft");
    await screenshot(page, "settings");
    await page
      .getByRole("button", { name: "Выйти из аккаунта", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Выйти из аккаунта?" })
      .getByRole("button", { name: "Выйти", exact: true })
      .click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(other.getByLabel("Email", { exact: true })).toBeVisible();
    await cacheEmpty(page);
    await expect.poll(() => stored(page, "drafts")).toEqual([]);
    // A late autosave from the other document must not resurrect a revoked generation.
    await other.waitForTimeout(500);
    expect(await stored(other, "drafts")).toEqual([]);
    await other.close();
    await controlled(page);
    await context.setOffline(true);
    await page.goto("/applications");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.locator(".offline-notice")).toHaveCount(0);
    await context.setOffline(false);
    await signIn(page, "pwa-other@example.com");
    expect(await records(page)).toEqual([]);
    await page.goto("/settings");
    await expect(optIn).not.toBeChecked();
    expect(await stored(page, "drafts")).toEqual([]);
    await page
      .getByRole("button", { name: "Выйти из аккаунта", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Выйти из аккаунта?" })
      .getByRole("button", { name: "Выйти", exact: true })
      .click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await signIn(page);
    await openApplication(page);
    await page
      .getByRole("dialog")
      .getByLabel("Компания *", { exact: true })
      .fill("Fresh login draft");
    await expect
      .poll(async () => JSON.stringify(await stored(page, "drafts")))
      .toContain("Fresh login draft");
    await page.goto("/settings");
    await offlineConsent(page, true);
    await expect
      .poll(async () => (await stored(page, "journal")).length)
      .toBe(1);
    // Expire the real isolated server session; reconnect must not silently revalidate it.
    expect(
      (await page.request.post("/__test/pwa-expire-session")).status(),
    ).toBe(204);
    const unauthorized = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/me",
    );
    await page.goto("/applications");
    expect((await unauthorized).status()).toBe(401);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await cacheEmpty(page);
    await expect.poll(() => stored(page, "drafts")).toEqual([]);
    await context.setOffline(true);
    await page.goto("/applications");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.locator(".offline-notice")).toHaveCount(0);
    await context.setOffline(false);
    await signIn(page);
    await openApplication(page);
    await page
      .getByRole("dialog")
      .getByLabel("Компания *", { exact: true })
      .fill("After 401 relogin draft");
    await expect
      .poll(async () => JSON.stringify(await stored(page, "drafts")))
      .toContain("After 401 relogin draft");
  });

  test("share before auth prefills without creation; canonical duplicate, unsafe URL and shortcut", async ({
    page,
  }) => {
    const creates: string[] = [];
    page.on("request", (req) => {
      if (
        new URL(req.url()).pathname === "/api/v1/applications" &&
        req.method() === "POST"
      )
        creates.push(req.postData() || "");
    });
    await page.goto(
      "/share?title=Frontend+Lead&url=https%3A%2F%2Fhh.ru%2Fvacancy%2F12345678",
    );
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await signIn(page); // Preserve the intake document/session through authentication.
    const form = page.getByRole("dialog");
    await expect(form.getByLabel("Позиция *", { exact: true })).toHaveValue(
      "Frontend Lead",
    );
    await expect(form.getByLabel("Ссылка на вакансию")).toHaveValue(
      "https://hh.ru/vacancy/12345678",
    );
    const before = await records(page);
    expect(
      before.filter((a) => a.url === "https://hh.ru/vacancy/12345678"),
    ).toEqual([]);
    const info = await seed(page);
    await page.goto(
      "/share?title=Duplicate&url=https%3A%2F%2Fhh.ru%2Fvacancy%2F99887766%3Futm_source%3Dacceptance%23details",
    );
    // Must resolve the existing canonical record, not merely leave server count unchanged.
    await expect(page).toHaveURL(
      new RegExp(`/applications/${info.applicationId}$`),
    );
    await expect(
      page.getByRole("heading", { name: info.company, exact: true }),
    ).toBeVisible();
    expect(await records(page)).toEqual(before);
    await page.goto("/share?title=Exploit&url=javascript%3Aalert(1)");
    await expect(page).toHaveURL(new URL("/", baseURL).href);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await records(page)).toEqual(before);
    await openApplication(page);
    await expect(
      page.getByRole("dialog").getByLabel("Ссылка на вакансию"),
    ).toHaveValue("");
    expect(creates).toEqual([]);
  });

  test("mocked push requires gesture, queues test, and disables only this endpoint", async ({
    page,
  }) => {
    const endpoint = "https://push.invalid/acceptance-device";
    const publicKey = "AQID";
    const calls: { path: string; body: any }[] = [];
    let subscribed = false;
    await page.route("**/api/v1/push/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.split("/").pop()!;
      if (path === "config") {
        expect(req.method()).toBe("GET");
        await route.fulfill({ json: { enabled: true, publicKey, subscribed } });
        return;
      }
      expect(req.method()).toBe("POST");
      const body = req.postDataJSON();
      calls.push({ path, body });
      expect(body.endpoint).toBe(endpoint);
      expect(["subscribe", "test", "unsubscribe"]).toContain(path);
      if (path === "subscribe") subscribed = true;
      if (path === "unsubscribe") subscribed = false;
      await route.fulfill({
        json: path === "test" ? { queued: true } : { ok: true },
      });
    });
    await page.addInitScript(
      ({ endpoint }) => {
        const state = {
          requests: Number(
            sessionStorage.getItem("pwa-permission-requests") || 0,
          ),
          gestures: [] as boolean[],
          subscribes: 0,
          unsubscribes: 0,
        };
        (window as any).__pushMock = state;
        let permission: NotificationPermission = "default";
        Object.defineProperty(Notification, "permission", {
          configurable: true,
          get: () => permission,
        });
        Object.defineProperty(Notification, "requestPermission", {
          configurable: true,
          value: async () => {
            state.requests++;
            sessionStorage.setItem(
              "pwa-permission-requests",
              String(state.requests),
            );
            state.gestures.push(navigator.userActivation.isActive);
            permission = "granted";
            return permission;
          },
        });
        let sub: any = null;
        Object.defineProperty(PushManager.prototype, "getSubscription", {
          configurable: true,
          value: async () => sub,
        });
        Object.defineProperty(PushManager.prototype, "subscribe", {
          configurable: true,
          value: async (options: PushSubscriptionOptionsInit) => {
            state.subscribes++;
            sub = {
              endpoint,
              options,
              toJSON: () => ({
                endpoint,
                keys: { auth: "mock-auth", p256dh: "mock-p256dh" },
              }),
              unsubscribe: async () => {
                state.unsubscribes++;
                sub = null;
                return true;
              },
            };
            return sub;
          },
        });
      },
      { endpoint },
    );
    await login(page);
    await controlled(page);
    await page.goto("/settings");
    const card = page.getByTestId("push-settings-card");
    await expect(card.getByTestId("enable-push-btn")).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__pushMock.requests)).toBe(
      0,
    );
    expect(calls).toEqual([]);
    await card.getByTestId("enable-push-btn").click();
    await expect(card.getByTestId("disable-push-btn")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__pushMock)).toMatchObject(
      { requests: 1, gestures: [true], subscribes: 1 },
    );
    expect(calls).toEqual([
      {
        path: "subscribe",
        body: { endpoint, keys: { auth: "mock-auth", p256dh: "mock-p256dh" } },
      },
    ]);
    await card.getByTestId("test-push-btn").click();
    await expect(card.getByTestId("action-message")).toHaveText(
      "Тестовое уведомление поставлено в очередь на отправку.",
    );
    await card.getByTestId("disable-push-btn").click();
    await expect(card.getByTestId("enable-push-btn")).toBeVisible();
    expect(calls.slice(1)).toEqual([
      { path: "test", body: { endpoint } },
      { path: "unsubscribe", body: { endpoint } },
    ]);
    expect(
      await page.evaluate(() => (window as any).__pushMock.unsubscribes),
    ).toBe(1);
  });
});
