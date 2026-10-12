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
// Promotional tiles use their own layouts so copy stays readable at store size.
const dataImage = async (path) =>
  "data:image/png;base64," + (await readFile(new URL(path, import.meta.url))).toString("base64");
const logo = await dataImage("../apps/extension/public/brand/avari-jobs-logo.png");
const dashboard = await dataImage("../test-results/design-dashboard-dark.png");
const extension = await dataImage("../test-results/extension-proposal-dark.png");
for (const tile of [
  { name: "promo-small-440x280", width: 440, height: 280 },
  { name: "promo-marquee-1400x560", width: 1400, height: 560 },
]) {
  const small = tile.width === 440;
  await page.setViewportSize({ width: tile.width, height: tile.height });
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 95% 0%,#164567 0%,#101d2d 45%,#0d111b 85%);color:#e8edf4;font-family:Arial,sans-serif;overflow:hidden}
    main{position:relative;width:${tile.width}px;height:${tile.height}px;padding:48px 56px;overflow:hidden}
    .copy{position:relative;z-index:3;width:510px}.brand{display:flex;align-items:center;gap:14px;font-size:28px;font-weight:700;color:#62c7ff}.brand img{width:42px;height:42px;object-fit:contain}
    h1{font-size:54px;line-height:1.08;letter-spacing:-1.8px;margin:30px 0 22px}p{font-size:22px;line-height:1.45;color:#b4c2d3;margin:0;max-width:460px}.sites{color:#b6d5e8;font-size:16px;margin-top:30px}
    .web{position:absolute;left:630px;top:76px;width:710px;border:1px solid #34516a;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px #0007;background:#0d1520}.bar{height:30px;background:#162535;border-bottom:1px solid #2a3c50;display:flex;gap:6px;align-items:center;padding-left:14px}.bar i{width:6px;height:6px;border-radius:50%;background:#63809a}.web img{display:block;width:710px}
    .popup{position:absolute;left:590px;top:194px;width:252px;height:338px;border:1px solid #34516a;border-radius:14px;overflow:hidden;box-shadow:0 20px 50px #0009;background:#0d1520}.popup img{display:block;width:920px;max-width:none}
    .small main{padding:26px 28px}.small .copy{width:384px}.small .brand{font-size:23px;gap:10px}.small .brand img{width:34px;height:34px}.small h1{font-size:36px;line-height:1.1;letter-spacing:-1px;margin:22px 0 14px}.small p{font-size:16px;line-height:1.4;max-width:350px}.small .sites{font-size:12px;margin-top:19px}
    </style><body class="${small ? "small" : "wide"}"><main><section class="copy"><div class="brand"><img src="${logo}" alt="">Avari.Jobs</div><h1>Вакансии под рукой</h1><p>${small ? "Сохраняйте вакансии.<br>Следите за откликами." : "Сохраняйте вакансии, отслеживайте отклики и планируйте интервью в одном журнале."}</p><div class="sites">hh.ru · LinkedIn · Getmatch · Hirify</div></section>${small ? "" : `<div class="web"><div class="bar"><i></i><i></i><i></i></div><img src="${dashboard}" alt="Журнал откликов"></div><div class="popup"><img src="${extension}" alt="Расширение"></div>`}</main></body></html>`);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((image) => image.decode())));
  // JPEG is always opaque and meets the store's no-alpha requirement.
  await page.screenshot({ path: new URL(tile.name + ".jpg", output).pathname, type: "jpeg", quality: 95 });
}
await browser.close();
