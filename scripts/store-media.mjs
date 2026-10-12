// Render store media in the browser from actual, anonymized E2E screenshots.
// Run make e2e first. This keeps the product UI pixels unchanged.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const output = new URL("../docs/chrome-store-assets/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
for (const card of [
  {
    name: "extension",
    image: "extension-proposal-dark.png",
    title: "Вакансии\nпод рукой",
    subtitle:
      "Сохраняйте вакансии, меняйте этапы и добавляйте задачи из расширения.",
    mode: "popup",
  },
  {
    name: "journal",
    image: "design-dashboard-dark.png",
    title: "Следующий\nкарьерный шаг",
    subtitle: "Отклики, задачи и интервью — в одном журнале Avari.Jobs.",
    mode: "web",
  },
]) {
  const image =
    "data:image/png;base64," +
    (
      await readFile(new URL("../test-results/" + card.image, import.meta.url))
    ).toString("base64");
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1280px;height:800px;background:radial-gradient(circle at 90% 15%,#12314b,#0d111b 65%);color:#e8edf4;font-family:Arial,sans-serif;overflow:hidden}
    main{height:100%;padding:66px 64px;display:flex;align-items:center;gap:46px}.copy{width:360px;flex-shrink:0}.brand{color:#62c7ff;font-size:25px;font-weight:700;margin-bottom:34px}h1{font-size:48px;line-height:1.08;letter-spacing:-1.6px;margin:0 0 26px;white-space:pre-line}p{font-size:21px;line-height:1.5;color:#9facbd;margin:0}.sites{margin-top:32px;font-size:15px;color:#b6d5e8}.frame{border:1px solid #2a3c50;border-radius:18px;overflow:hidden;box-shadow:0 26px 75px #0007;background:#0d1520;flex-shrink:0}.caption{padding:16px 20px;color:#8ba0b8;font-size:14px;border-bottom:1px solid #2a3c50}.screen{overflow:hidden}.popup{margin-left:90px;width:392px}.popup .screen{width:390px;height:520px}.popup img{width:1440px;height:auto;max-width:none;display:block}.web{width:790px}.web .screen{height:540px}.web img{width:788px;height:auto;display:block}
    .web-layout{padding-left:50px;padding-right:36px;gap:24px}.web-layout .copy{width:340px}.web-layout h1{font-size:42px}
    </style><main class="${card.mode === "web" ? "web-layout" : ""}"><section class="copy"><div class="brand">Avari.Jobs</div><h1>${card.title}</h1><p>${card.subtitle}</p><div class="sites">hh.ru · LinkedIn · Getmatch · Hirify</div></section><section class="frame ${card.mode}"><div class="caption">${card.mode === "popup" ? "Расширение для Chromium" : "Журнал поиска работы"}</div><div class="screen"><img src="${image}" alt="Интерфейс Avari.Jobs"></div></section></main></html>`);
  await page.evaluate(() =>
    Promise.all(Array.from(document.images).map((image) => image.decode())),
  );
  await page.screenshot({
    path: new URL(card.name + "-1280x800.png", output).pathname,
  });
}
await browser.close();
