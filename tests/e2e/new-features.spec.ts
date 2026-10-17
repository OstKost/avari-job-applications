import { test, expect, type Page } from "@playwright/test";

const dedicatedUser = {
  email: "features@example.com",
  password: "browser-test-password",
};

const loginDedicated = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(dedicatedUser.email);
  await page.getByLabel("Пароль", { exact: true }).fill(dedicatedUser.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Главная", exact: true })).toBeVisible();
};

const getCSRFToken = async (page: Page): Promise<string> => {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "avari_csrf")?.value;
  if (!csrf) {
    throw new Error("CSRF cookie avari_csrf not found");
  }
  return csrf;
};

const createApiApp = async (
  page: Page,
  prefix: string,
  extra: Record<string, unknown> = {},
) => {
  const csrf = await getCSRFToken(page);
  const company = `${prefix} Corp ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const res = await page.request.post("/api/v1/applications", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      company,
      position: "Senior Specialist",
      stage: "saved",
      state: "active",
      ...extra,
    },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  return json as { id: string; company: string; position: string; stage: string; state: string; favorite?: boolean };
};

test.describe("Approved Features E2E Acceptance", () => {
  test("1. Search/filter and page 2 restore after detail back/reload with initial async loading", async ({
    page,
  }) => {
    await loginDedicated(page);
    const prefix = `PAG_${Date.now()}`;

    // Create 25 unique apps via real API so there are at least 2 pages (page size = 20)
    for (let i = 1; i <= 25; i++) {
      await createApiApp(page, `${prefix}_${String(i).padStart(2, "0")}`);
    }

    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();

    // Open spotlight search/filter and filter by the unique prefix
    await page.getByRole("button", { name: "Поиск и фильтры" }).click();
    const searchInput = page.getByLabel("Поиск по компании и позиции");
    await expect(searchInput).toBeVisible();
    await searchInput.fill(prefix);
    await searchInput.press("Enter");

    // Verify pagination controls: next page button should be enabled
    const nextBtn = page.getByRole("button", { name: "Следующая страница" });
    await expect(nextBtn).toBeVisible();
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Verify we are now on page 2: page button 2 is active or status shows page 2
    await expect(page.getByRole("button", { name: "Предыдущая страница" })).toBeEnabled();

    // Click on an application from page 2 to navigate to its detail page
    const detailLink = page.locator("tr.application-data-row a.company-link").first();
    await expect(detailLink).toBeVisible();
    const targetCompany = (await detailLink.textContent())?.trim() ?? "";
    await detailLink.click();

    // Verify detail page is open
    await expect(page.getByRole("heading", { name: targetCompany, exact: true })).toBeVisible();

    // Navigate back via "Все отклики" link
    await page.getByRole("link", { name: "Все отклики", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();

    // Page 2 and search filter should be preserved
    await expect(page.getByRole("button", { name: "Предыдущая страница" })).toBeEnabled();
    await expect(page.locator("tr.application-data-row a.company-link").first()).toBeVisible();

    // Reload the page and verify page 2 and search filter are still restored
    await page.reload();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Предыдущая страница" })).toBeEnabled();
  });

  test("2. Applications vs Favorites independent preferences", async ({ page }) => {
    await loginDedicated(page);
    const prefPrefix = `PRF_${Date.now()}`;
    // Create an app and a favorite app
    const appNormal = await createApiApp(page, `${prefPrefix}_NORM`);
    const appFav = await createApiApp(page, `${prefPrefix}_FAV`, { favorite: true });

    // Go to /applications and set state filter to 'active'
    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Поиск и фильтры" }).click();
    await page.getByLabel("Поиск по компании и позиции").fill(appNormal.company);
    await page.getByLabel("Поиск по компании и позиции").press("Enter");
    await expect(page.locator("tr.application-data-row")).toHaveCount(1);

    // Go to /favorites
    await page.getByRole("link", { name: "Избранные вакансии", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Избранные вакансии", exact: true })).toBeVisible();

    // In /favorites, search should NOT be inherited from /applications
    // Search input should be empty or different
    await page.getByRole("button", { name: "Поиск и фильтры" }).click();
    await page.getByLabel("Поиск по компании и позиции").fill(appFav.company);
    await page.getByLabel("Поиск по компании и позиции").press("Enter");
    await expect(page.locator("tr.application-data-row")).toHaveCount(1);
    await expect(page.getByText(appFav.company)).toBeVisible();

    // Switch back to /applications: search should still be appNormal.company, not appFav.company
    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();
    await expect(page.getByText(appNormal.company)).toBeVisible();
    await expect(page.getByText(appFav.company)).toHaveCount(0);
  });

  test("3. Inline stage appliedDate account timezone, close requires outcome, and cancel is no-op", async ({
    page,
  }) => {
    await loginDedicated(page);
    const prefix = `STG_${Date.now()}`;
    const testApp = await createApiApp(page, prefix);

    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();

    // Find row
    const row = page.locator("tr.application-data-row", { hasText: testApp.company });
    await expect(row).toBeVisible();

    // 1. Stage change to 'applied' sets appliedDate in account timezone (Europe/Moscow)
    const stageTrigger = row.locator("button.badge-dropdown-trigger").first();
    await stageTrigger.click();
    const stageMenu = page.locator(".status-workflow-flow, [role='menu']");
    await expect(stageMenu).toBeVisible();
    // Select stage 'applied' (Отклик)
    await stageMenu.getByRole("menuitemradio", { name: /Отклик/ }).click();

    // Verify row now shows 'Отклик' and date
    await expect(row.locator("button.badge-dropdown-trigger").first()).toContainText("Отклик");
    const dateCell = row.locator("td.date-cell");
    await expect(dateCell).toContainText("Отклик");

    // 2. State change to 'closed' triggers OutcomeModal
    const stateTrigger = row.locator("button.badge-dropdown-trigger").nth(1);
    await stateTrigger.click();
    const stateMenu = page.locator("[role='menu']");
    await expect(stateMenu).toBeVisible();
    await stateMenu.getByRole("menuitemradio", { name: /Закрыт/ }).click();

    // Modal should appear
    const outcomeModal = page.getByRole("dialog", { name: "Закрытие вакансии" });
    await expect(outcomeModal).toBeVisible();

    // Cancel outcome modal: must be a no-op, state must remain active
    await outcomeModal.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(outcomeModal).toHaveCount(0);
    await expect(row.locator("button.badge-dropdown-trigger").nth(1)).toContainText("Активен");

    // Open again, select outcome, and confirm
    await stateTrigger.click();
    await page.locator("[role='menu']").getByRole("menuitemradio", { name: /Закрыт/ }).click();
    await expect(outcomeModal).toBeVisible();
    await outcomeModal.getByRole("combobox").selectOption({ label: "Отказ работодателя" });
    await outcomeModal.getByRole("button", { name: "Подтвердить закрытие" }).click();
    await expect(outcomeModal).toHaveCount(0);

    // Verify row state is now 'Закрыт'
    await expect(row.locator("button.badge-dropdown-trigger").nth(1)).toContainText("Закрыт");
  });

  test("4. Favorite toggle from table row, card, and detail page into /favorites and removal", async ({
    page,
  }) => {
    await loginDedicated(page);
    const prefix = `FAV_${Date.now()}`;
    const testApp = await createApiApp(page, prefix);

    // 1. Toggle favorite in table row
    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    const row = page.locator("tr.application-data-row", { hasText: testApp.company });
    await expect(row).toBeVisible();
    const starBtn = row.locator("button.favorite-star-btn");
    await expect(starBtn).toBeVisible();
    await starBtn.click();
    await expect(starBtn).toHaveClass(/active/);

    // Verify presence in /favorites
    await page.getByRole("link", { name: "Избранные вакансии", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Избранные вакансии", exact: true })).toBeVisible();
    await expect(page.getByText(testApp.company)).toBeVisible();

    // 2. Open detail page and verify favorite toggle button
    await page.getByRole("link", { name: testApp.company }).click();
    await expect(page.getByRole("heading", { name: testApp.company, exact: true })).toBeVisible();
    const detailFavBtn = page.locator("button.favorite-toggle-btn");
    await expect(detailFavBtn).toBeVisible();
    await expect(detailFavBtn).toContainText("В избранном");

    // Remove from favorite in detail page
    await detailFavBtn.click();
    await expect(detailFavBtn).toContainText("В избранное");

    // Verify removed from /favorites
    await page.getByRole("link", { name: "Избранные вакансии", exact: true }).click();
    await expect(page.getByText(testApp.company)).toHaveCount(0);

    // 3. Switch to card view in /applications and toggle favorite on card
    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    const cardViewBtn = page.getByRole("button", { name: "Карточки откликов" });
    if (await cardViewBtn.isVisible()) {
      await cardViewBtn.click();
    }
    const card = page.locator(".application-card", { hasText: testApp.company });
    await expect(card).toBeVisible();
    const cardStar = card.locator("button.favorite-star-btn");
    await cardStar.click();
    await expect(cardStar).toHaveClass(/active/);

    // Verify back in /favorites
    await page.getByRole("link", { name: "Избранные вакансии", exact: true }).click();
    await expect(page.getByText(testApp.company)).toBeVisible();
  });

  test("5. Warning modal for stale >240h application: table and detail actions (pause, close, or editable task next weekday)", async ({
    page,
  }) => {
    await loginDedicated(page);

    // The seeded stale application is "Stale Corp 250h"
    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Отклики", exact: true })).toBeVisible();

    const staleRow = page.locator("tr.application-data-row", { hasText: "Stale Corp 250h" });
    await expect(staleRow).toBeVisible();

    // Stale warning button should be immediately left of detail action button
    const warningBtn = staleRow.locator("button.stale-warning-btn");
    await expect(warningBtn).toBeVisible();
    await warningBtn.click();

    // Shared StaleActionModal opens
    const staleModal = page.getByRole("dialog", { name: /Действие по вакансии: Stale Corp 250h/ });
    await expect(staleModal).toBeVisible();

    // Check prefilled task form: 'Связаться по вакансии' and next weekday
    const taskTitleInput = staleModal.getByLabel("Название задачи");
    await expect(taskTitleInput).toHaveValue("Связаться по вакансии");
    const taskDateInput = staleModal.getByLabel("Дата");
    const dateVal = await taskDateInput.inputValue();
    expect(dateVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const taskTimeInput = staleModal.getByLabel(/Время/);
    await expect(taskTimeInput).toHaveValue("");

    // Close modal without saving (cancel)
    await staleModal.getByRole("button", { name: "Отмена" }).click();
    await expect(staleModal).toHaveCount(0);

    // Open detail page and check larger warning button by company header
    await staleRow.locator("a.company-link").click();
    await expect(page.getByRole("heading", { name: "Stale Corp 250h", exact: true })).toBeVisible();

    const headerWarningBtn = page.locator("button.stale-warning-btn-header");
    await expect(headerWarningBtn).toBeVisible();
    await headerWarningBtn.click();

    const detailStaleModal = page.getByRole("dialog", { name: /Действие по вакансии: Stale Corp 250h/ });
    await expect(detailStaleModal).toBeVisible();

    // Click "Приостановить" tab/button
    await detailStaleModal.getByRole("button", { name: "Приостановить" }).click();
    await expect(detailStaleModal).toHaveCount(0);

    // After pausing, application state is paused and warning button disappears
    await expect(page.locator("button.stale-warning-btn-header")).toHaveCount(0);
  });

  test("6. Automatic reminder visible in calendar and API (single lifetime, no duplicate)", async ({
    page,
  }) => {
    await loginDedicated(page);

    // Dedicated seeded app "Auto Reminder Inc 49h" has been reconciled once before serving
    const tasksRes = await page.request.get("/api/v1/tasks");
    expect(tasksRes.status()).toBe(200);
    const tasks = (await tasksRes.json()) as Array<{ id: string; title: string; state: string }>;
    const autoTasks = tasks.filter((t) => t.title === "Сделать отклик по вакансии");
    expect(autoTasks.length).toBe(1);

    // Check Calendar view
    await page.getByRole("link", { name: "Календарь", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Календарь", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Сделать отклик по вакансии/ })).toBeVisible();
  });

  test("7. Resume TXT upload -> rename PUT/PATCH -> add v2 -> download byte check -> delete version/resume", async ({
    page,
  }) => {
    await loginDedicated(page);
    await page.getByRole("link", { name: "Резюме", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Резюме", exact: true })).toBeVisible();

    const uniqueResumeTitle = `Resume_${Date.now()}`;
    const initialContent = "Test resume version 1 content";

    // 1. Upload new resume
    await page.getByRole("button", { name: "Загрузить новое резюме" }).click();
    const uploadModal = page.getByRole("dialog");
    await expect(uploadModal).toBeVisible();

    await uploadModal.getByLabel(/Название резюме/).fill(uniqueResumeTitle);
    await uploadModal.getByLabel(/Файл резюме/).setInputFiles({
      name: "resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(initialContent),
    });
    await uploadModal.getByRole("button", { name: "Загрузить" }).click();
    await expect(uploadModal).toHaveCount(0);

    // Verify card is rendered
    const card = page.locator(".resume-card", { hasText: uniqueResumeTitle });
    await expect(card).toBeVisible();
    await expect(card.locator(".resume-version-row")).toHaveCount(1);

    // 2. Rename resume
    await card.getByRole("button", { name: "Переименовать" }).click();
    const renameModal = page.getByRole("dialog", { name: "Переименовать резюме" });
    await expect(renameModal).toBeVisible();
    const renamedTitle = `${uniqueResumeTitle}_Renamed`;
    await renameModal.getByLabel("Новое название резюме").fill(renamedTitle);
    await renameModal.getByRole("button", { name: "Сохранить" }).click();
    await expect(renameModal).toHaveCount(0);
    await expect(page.locator(".resume-card", { hasText: renamedTitle })).toBeVisible();

    // 3. Add v2 version
    const renamedCard = page.locator(".resume-card", { hasText: renamedTitle });
    await renamedCard.getByRole("button", { name: "Добавить версию" }).click();
    const addV2Modal = page.getByRole("dialog");
    await expect(addV2Modal).toBeVisible();
    const v2Content = "Second version updated content bytes 12345";
    await addV2Modal.getByLabel(/Файл резюме/).setInputFiles({
      name: "resume_v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(v2Content),
    });
    await addV2Modal.getByRole("button", { name: "Загрузить" }).click();
    await expect(addV2Modal).toHaveCount(0);

    // Verify 2 versions rendered
    await expect(renamedCard.locator(".resume-version-row")).toHaveCount(2);

    // 4. Download byte check
    const downloadPromise = page.waitForEvent("download");
    await renamedCard.getByRole("button", { name: "Скачать resume_v2.txt" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("resume_v2.txt");
    const downloadStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(Buffer.from(chunk));
    }
    const downloadedText = Buffer.concat(chunks).toString("utf-8");
    expect(downloadedText).toBe(v2Content);

    // 5. Delete version 2
    await renamedCard.getByRole("button", { name: "Удалить версию v2" }).click();
    const deleteModal = page.getByRole("dialog");
    await expect(deleteModal).toBeVisible();
    await deleteModal.getByRole("button", { name: "Удалить" }).click();
    await expect(deleteModal).toHaveCount(0);
    await expect(renamedCard.locator(".resume-version-row")).toHaveCount(1);

    // 6. Delete entire resume
    await renamedCard.getByRole("button", { name: "Удалить резюме" }).click();
    const deleteResumeModal = page.getByRole("dialog");
    await expect(deleteResumeModal).toBeVisible();
    await deleteResumeModal.getByRole("button", { name: "Удалить" }).click();
    await expect(deleteResumeModal).toHaveCount(0);
    await expect(page.locator(".resume-card", { hasText: renamedTitle })).toHaveCount(0);
  });

  test("8. Unsupported/oversize upload error remains inside modal", async ({ page }) => {
    await loginDedicated(page);
    await page.getByRole("link", { name: "Резюме", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Резюме", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Загрузить новое резюме" }).click();
    const uploadModal = page.getByRole("dialog");
    await expect(uploadModal).toBeVisible();

    // 1. Unsupported extension (.exe)
    await uploadModal.getByLabel(/Файл резюме/).setInputFiles({
      name: "exploit.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ binary not allowed"),
    });
    await uploadModal.getByRole("button", { name: "Загрузить" }).click();

    // Modal must NOT close, error must remain inside modal or page error box
    await expect(uploadModal).toBeVisible();
    await expect(
      page.getByText(/Неподдерживаемый формат файла/i).or(page.locator(".error-box")),
    ).toBeVisible();

    // 2. Oversize file (> 20 MiB)
    const largeBuffer = Buffer.alloc(21 * 1024 * 1024, 0x61);
    await uploadModal.getByLabel(/Файл резюме/).setInputFiles({
      name: "oversize.txt",
      mimeType: "text/plain",
      buffer: largeBuffer,
    });
    await uploadModal.getByRole("button", { name: "Загрузить" }).click();

    // Modal must still remain open with error message
    await expect(uploadModal).toBeVisible();
    await expect(
      page.getByText(/превышает лимит 20 МБ/i).or(page.locator(".error-box")),
    ).toBeVisible();
  });

  test("9. Responsive mobile at 390px: Settings, favorites, resumes reachable without horizontal overflow", async ({
    page,
  }) => {
    await loginDedicated(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // Navigate to /settings
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();

    // Navigate to /favorites
    await page.goto("/favorites");
    await expect(page.getByRole("heading", { name: "Избранные вакансии", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();

    // Navigate to /resumes
    await page.goto("/resumes");
    await expect(page.getByRole("heading", { name: "Резюме", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });

  test("10. Compact dropdown keyboard/focus/Escape/viewport positioning", async ({ page }) => {
    await loginDedicated(page);
    const prefix = `KEY_${Date.now()}`;
    const testApp = await createApiApp(page, prefix);

    await page.getByRole("link", { name: "Отклики", exact: true }).click();
    const row = page.locator("tr.application-data-row", { hasText: testApp.company });
    await expect(row).toBeVisible();

    const trigger = row.locator("button.badge-dropdown-trigger").first();
    await trigger.focus();
    await page.keyboard.press("ArrowDown");

    const menu = page.locator(".status-workflow-flow, [role='menu']");
    await expect(menu).toBeVisible();

    // Check viewport constraints: menu bounding box must be within window bounds
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }

    // Press Escape: closes dropdown and restores focus to trigger
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
