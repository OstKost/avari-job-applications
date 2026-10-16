import { test, expect, chromium, type Worker } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("real MV3 extension: login, DOM capture, save, dedup, proposal confirmation, restart", async () => {
  test.setTimeout(90000);
  const temp = await mkdtemp(path.join(tmpdir(), "avari-extension-"));
  const extension = path.join(temp, "extension");
  await cp(path.resolve("apps/extension/dist"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(extension, "manifest.json"), "utf8"),
  );
  const originalHosts: string[] = manifest.host_permissions ?? [];
  manifest.host_permissions = [
    ...originalHosts,
    new URL(process.env.AVARI_TEST_URL!).origin + "/*",
  ];
  await writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify(manifest),
  );
  let context = await chromium.launchPersistentContext(
    path.join(temp, "profile"),
    {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  try {
    let worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = worker.url().split("/")[2];
    {
      const defaultServer = new URL(
        process.env.VITE_AVARI_DEFAULT_SERVER || "https://jobs.avari.dev",
      ).origin;
      expect(originalHosts).toContain(defaultServer + "/*");
      const fresh = await context.newPage();
      await fresh.goto(`chrome-extension://${id}/index.html`);
      await expect(fresh.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(
        fresh.getByRole("radio", { name: "Онлайн сохранение", exact: true }),
      ).toBeChecked();
      expect(
        await worker.evaluate(
          async () => (await chrome.storage.local.get("server")).server,
        ),
      ).toBe(defaultServer);
      await fresh.getByText("Настройки адресов", { exact: true }).click();
      await expect(
        fresh.getByRole("textbox", { name: "Онлайн сервис", exact: true }),
      ).toHaveValue(defaultServer);
      await fresh
        .getByRole("textbox", { name: "Онлайн сервис", exact: true })
        .fill("https://custom.example.com");
      await fresh
        .getByRole("radio", { name: "Локальное сохранение", exact: true })
        .check();
      await expect(
        fresh.getByRole("textbox", { name: "Локальный сервис", exact: true }),
      ).toHaveValue("http://127.0.0.1:47831");
      await fresh
        .getByRole("radio", { name: "Онлайн сохранение", exact: true })
        .check();
      await expect(
        fresh.getByRole("textbox", { name: "Онлайн сервис", exact: true }),
      ).toHaveValue("https://custom.example.com");
      expect(
        await worker.evaluate(
          async () => (await chrome.storage.local.get("server")).server,
        ),
      ).toBe(defaultServer);
      await fresh.close();
    }
    let popup = await context.newPage();
    const errors: string[] = [];
    popup.on("pageerror", (e) => errors.push(e.message));
    await popup.goto(`chrome-extension://${id}/index.html`);
    {
      await popup
        .getByRole("radio", { name: "Локальное сохранение", exact: true })
        .check();
      await popup.getByText("Настройки адресов", { exact: true }).click();
      await popup
        .getByRole("textbox", { name: "Локальный сервис", exact: true })
        .fill(process.env.AVARI_TEST_URL!);
    }
    await popup
      .getByLabel("Email", { exact: true })
      .fill("extension@example.com");
    await popup
      .getByLabel("Пароль", { exact: true })
      .fill("browser-test-password");
    await popup.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(
      popup.getByRole("heading", { name: "Эта страница не поддерживается" }),
    ).toBeVisible();
    expect(
      await worker.evaluate(
        async () => (await chrome.storage.local.get("server")).server,
      ),
    ).toBe(process.env.AVARI_TEST_URL!);
    await expect(popup.locator("html")).toHaveAttribute("data-theme", "dark");
    const hh = await context.newPage();
    await hh.route("https://hh.ru/vacancy/111222333", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><html><body><h1 data-qa="vacancy-title">Frontend developer</h1><span data-qa="vacancy-company-name">Бета Компания</span><div data-qa="vacancy-salary">от 120 000 ₽ в месяц, на руки</div><button data-qa="vacancy-response-link-top">Откликнуться</button></body></html>',
      }),
    );
    await hh.goto("https://hh.ru/vacancy/111222333");
    await expect(
      hh.getByRole("heading", { name: "Frontend developer" }),
    ).toBeVisible();
    const snapshot = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) throw new Error("hh tab missing");
      return await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE" });
    });
    expect(snapshot.vacancy.company).toBe("Бета Компания");
    expect(snapshot.observations).toEqual([]);
    await hh.bringToFront();
    await popup.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(
      popup.getByRole("button", {
        name: /Редактировать перед сохранением/,
      }),
    ).toBeVisible();
    await popup
      .getByRole("button", {
        name: /Редактировать перед сохранением/,
      })
      .click();
    await expect(popup.getByLabel("Компания *")).toHaveValue("Бета Компания");
    await popup.getByLabel("Контакт рекрутера").fill("Draft survives closure");
    await popup.close();
    popup = await context.newPage();
    popup.on("pageerror", (e) => errors.push(e.message));
    await hh.bringToFront();
    await popup.goto(`chrome-extension://${id}/index.html`);
    await expect(popup.getByLabel("Контакт рекрутера")).toHaveValue(
      "Draft survives closure",
    );
    await popup.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      popup.getByText("Сохранено в журнале", { exact: true }),
    ).toBeVisible();
    await expect(
      popup.getByRole("button", { name: "Изменить этап", exact: true }),
    ).toBeVisible();
    await hh.locator('[data-qa="vacancy-response-link-top"]').evaluate((el) => {
      el.textContent = "Вы откликнулись";
    });
    await expect
      .poll(
        async () => await worker.evaluate(() => chrome.action.getBadgeText({})),
      )
      .toBe("1");
    await popup.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(
      popup.getByRole("button", { name: "Применить", exact: true }),
    ).toBeVisible();
    await popup.screenshot({
      path: "test-results/extension-proposal-dark.png",
      fullPage: true,
    });
    await popup.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(
      popup.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () => await worker.evaluate(() => chrome.action.getBadgeText({})),
      )
      .toBe("");
    await hh.reload();
    await hh.locator('[data-qa="vacancy-response-link-top"]').evaluate((el) => {
      el.textContent = "Вы откликнулись";
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await worker.evaluate(() => chrome.action.getBadgeText({}))).toBe(
      "",
    );
    await popup.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(
      popup.getByText("Отклик", { exact: true }).first(),
    ).toBeVisible();
    const value = await worker.evaluate(async () => {
      const c = await chrome.storage.local.get(["server", "token"]);
      const response = await fetch(c.server + "/api/v1/applications", {
        headers: { Authorization: "Bearer " + c.token },
      });
      return response.json();
    });
    expect(value).toHaveLength(1);
    expect(value[0].stage).toBe("applied");
    await hh.locator('[data-qa="vacancy-response-link-top"]').evaluate((el) => {
      el.textContent = "Вас пригласили";
    });
    await expect
      .poll(
        async () => await worker.evaluate(() => chrome.action.getBadgeText({})),
      )
      .toBe("1");
    await popup.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(
      popup.getByRole("button", { name: "Применить", exact: true }),
    ).toBeVisible();
    await popup
      .getByRole("button", { name: "Изменить этап", exact: true })
      .click();
    await popup.getByLabel("Контакт рекрутера").fill("HR after observation");
    await popup.getByRole("button", { name: "Сохранить", exact: true }).click();
    await popup.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(
      popup.getByText("Запись изменилась. Проверьте новое сравнение", {
        exact: true,
      }),
    ).toBeVisible();
    await popup.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(
      popup.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    const afterConflict = await worker.evaluate(async () => {
      const c = await chrome.storage.local.get(["server", "token"]);
      return await (
        await fetch(c.server + "/api/v1/applications", {
          headers: { Authorization: "Bearer " + c.token },
        })
      ).json();
    });
    expect(afterConflict[0].stage).toBe("hr");
    expect(afterConflict[0].recruiter).toBe("HR after observation");

    for (const fixture of [
      {
        url: "https://www.linkedin.com/jobs/view/111222333?trackingId=x",
        html: '<h1 class="top-card-layout__title">LinkedIn developer</h1><a class="topcard__org-name-link">LinkedIn Company</a><div class="jobs-s-apply__application-status">You applied</div>',
        company: "LinkedIn Company",
        canonical: "https://www.linkedin.com/jobs/view/111222333",
      },
      {
        url: "https://getmatch.ru/vacancies/111222333-developer?s=offers",
        html: '<section class="b-vacancy-header"><h1>Getmatch developer</h1><h2><a href="/companies/example">Getmatch Company</a></h2></section><div class="b-notification_danger"><b>Вакансия в архиве</b></div>',
        company: "Getmatch Company",
        canonical: "https://getmatch.ru/vacancies/111222333",
      },
      {
        url: "https://hirify.me/jobs/111222333-developer?utm_source=test",
        html: '<div class="vacancy-header"><h1>Hirify developer</h1><div class="company-name">Hirify Company</div><div class="apply"><button>Откликнуться</button></div></div>',
        company: "Hirify Company",
        canonical: "https://hirify.me/jobs/111222333",
      },
    ]) {
      const page = await context.newPage();
      await page.route(fixture.url, (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><html><body>" + fixture.html + "</body></html>",
        }),
      );
      await page.goto(fixture.url);
      await page.bringToFront();
      await popup
        .getByRole("button", { name: "Обновить", exact: true })
        .click();
      await expect(
        popup.getByRole("button", {
          name: /Редактировать перед сохранением/,
        }),
      ).toBeVisible();
      await popup
        .getByRole("button", {
          name: /Редактировать перед сохранением/,
        })
        .click();
      await expect(popup.getByLabel("Компания *")).toHaveValue(fixture.company);
      await popup
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect(
        popup.getByText("Сохранено в журнале", { exact: true }),
      ).toBeVisible();
      // Reading the saved card submits its explicit status via the real worker/API.
      await popup
        .getByRole("button", { name: "Обновить", exact: true })
        .click();
      if (!fixture.url.includes("hirify")) {
        await expect(
          popup.getByRole("button", { name: "Применить", exact: true }),
        ).toBeVisible();
        await popup
          .getByRole("button", { name: "Применить", exact: true })
          .click();
        await expect(
          popup.getByRole("button", { name: "Применить", exact: true }),
        ).toHaveCount(0);
      }
      await popup
        .getByRole("button", { name: "Обновить", exact: true })
        .click();
      await expect(
        popup.getByRole("button", { name: "Изменить этап", exact: true }),
      ).toBeVisible();
      await page.close();
    }
    const multiSite = await worker.evaluate(async () => {
      const c = await chrome.storage.local.get(["server", "token"]);
      return await (
        await fetch(c.server + "/api/v1/applications", {
          headers: { Authorization: "Bearer " + c.token },
        })
      ).json();
    });
    expect(multiSite).toHaveLength(4);
    expect(
      multiSite.find(
        (a: { company: string }) => a.company === "LinkedIn Company",
      ).stage,
    ).toBe("applied");
    expect(
      multiSite.find(
        (a: { company: string }) => a.company === "Getmatch Company",
      ).outcome,
    ).toBe("vacancy_closed");
    expect(
      multiSite.find((a: { company: string }) => a.company === "Hirify Company")
        .stage,
    ).toBe("saved");

    for (const fixture of [
      {
        url: "https://getmatch.ru/applications?s=menu",
        html: '<article class="applicationCard-module__test__card"><div class="applicationCard-module__test__statusGroup"><span>Отказ</span><span>Вакансия снята</span></div><h3><a href="/vacancies/111222333-developer">Developer</a></h3><p>Private comment</p></article>',
        status: "rejected",
      },
      {
        url: "https://hirify.me/applications",
        html: '<table><tbody><tr class="applications-table__row"><td><a class="applications-table__job-link" href="https://hirify.me/jobs/111222333-developer">Developer</a></td><td><button class="applications-table__stage-select" role="combobox"><span>Отклик</span></button></td><td>Private contact</td></tr></tbody></table>',
        status: "applied",
      },
    ]) {
      const page = await context.newPage();
      await page.route(fixture.url, (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><html><body>" + fixture.html + "</body></html>",
        }),
      );
      await page.goto(fixture.url);
      await expect
        .poll(
          async () =>
            await worker.evaluate(() => chrome.action.getBadgeText({})),
        )
        .toBe("1");
      await page.bringToFront();
      await popup
        .getByRole("button", { name: "Обновить", exact: true })
        .click();
      await expect(
        popup.getByRole("heading", { name: "Отклики на открытой странице" }),
      ).toBeVisible();
      await popup
        .getByRole("button", { name: "Применить", exact: true })
        .click();
      await expect(
        popup.getByRole("button", { name: "Применить", exact: true }),
      ).toHaveCount(0);
      const result = await worker.evaluate(async () => {
        const c = await chrome.storage.local.get(["server", "token"]);
        return await (
          await fetch(c.server + "/api/v1/applications", {
            headers: { Authorization: "Bearer " + c.token },
          })
        ).json();
      });
      expect(result).toHaveLength(4);
      const company = fixture.url.includes("getmatch")
        ? "Getmatch Company"
        : "Hirify Company";
      expect(
        result.find((a: { company: string }) => a.company === company)
          .externalStatus,
      ).toBe(fixture.status);
      expect(JSON.stringify(result)).not.toContain("Private");
      await page.close();
    }
    // Detected vacancies show a collapsed panel; explicit opening uses its owning tab.
    const quick = await context.newPage();
    await quick.route("https://hh.ru/vacancy/999888777", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<h1 data-qa="vacancy-title">Quick developer</h1><span data-qa="vacancy-company-name">Quick Company</span>',
      }),
    );
    await quick.goto("https://hh.ru/vacancy/999888777");
    await expect(quick.locator("#avari-quick-popup")).toHaveAttribute(
      "data-collapsed",
      "",
    );
    const openMini = async () => {
      await quick.bringToFront();
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        await chrome.tabs.sendMessage(tab.id!, { type: "OPEN_PANEL" });
      });
    };
    await openMini();
    const inline = quick.frameLocator("#avari-quick-popup iframe");
    await expect(
      inline.getByRole("button", { name: "Сохранить вакансию", exact: true }),
    ).toBeVisible();
    await quick.getByRole("button", { name: "Закрыть мини-окно" }).click();
    await expect(quick.locator("#avari-quick-popup")).toHaveCount(0);
    await openMini();
    const handle = quick.locator("#avari-quick-popup .handle");
    const before = await handle.boundingBox();
    await quick.mouse.move(before!.x + 40, before!.y + 12);
    await quick.mouse.down();
    await quick.mouse.move(before!.x - 80, before!.y + 100);
    await quick.mouse.up();
    const after = await handle.boundingBox();
    expect(after!.x).toBeLessThan(before!.x);
    await inline.getByLabel("Группа (необязательно)").fill("Удалённая работа");
    await popup.bringToFront();
    await inline
      .getByRole("button", { name: "Сохранить вакансию", exact: true })
      .click();
    await expect(
      inline.getByText("Уже сохранена", { exact: true }),
    ).toBeVisible();
    await inline.getByRole("button", { name: "Этап", exact: true }).click();
    await inline
      .locator('[role="menuitemradio"][data-value="applied"]')
      .click();
    await expect(
      inline.getByRole("button", { name: "Этап", exact: true }),
    ).toContainText("Отклик");
    await quick.reload();
    await expect(quick.locator("#avari-quick-popup")).toHaveAttribute(
      "data-collapsed",
      "",
    );
    await openMini();
    await expect(
      inline.getByRole("button", { name: "Этап", exact: true }),
    ).toContainText("Отклик");
    await quick.screenshot({ path: "test-results/extension-quick-popup.png" });
    await quick.close();

    const sdui = await context.newPage();
    await sdui.route(
      "https://www.linkedin.com/jobs/search-results/?currentJobId=111222333",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: '<!doctype html><html><body><main><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"><div data-component-type="LazyColumn"><div><a href="https://www.linkedin.com/company/example/">LinkedIn Company</a><p><a href="https://www.linkedin.com/jobs/view/111222333/">LinkedIn developer</a></p><p>Россия · 1 неделю назад</p><a href="/jobs/search-results/?currentJobId=111222333"><svg></svg>Удаленная работа</a><button aria-label="Сохранить вакансию">Сохранить</button></div></div></div></main></body></html>',
        }),
    );
    await sdui.goto(
      "https://www.linkedin.com/jobs/search-results/?currentJobId=111222333",
    );
    await sdui.bringToFront();
    await popup.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(
      popup.getByRole("button", { name: "Изменить этап", exact: true }),
    ).toBeVisible();
    await sdui.close();

    expect(errors).toEqual([]);
    await popup.getByRole("button", { name: "Включить светлую тему" }).click();
    await context.close();
    context = await chromium.launchPersistentContext(
      path.join(temp, "profile"),
      {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${id}/index.html`);
    await expect(
      reopened.getByRole("heading", { name: "Эта страница не поддерживается" }),
    ).toBeVisible();
    await expect(reopened.locator("html")).toHaveAttribute(
      "data-theme",
      "light",
    );
  } finally {
    await context.close();
    await rm(temp, { recursive: true, force: true });
  }
});
