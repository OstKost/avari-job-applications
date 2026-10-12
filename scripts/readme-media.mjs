// Compose README illustrations from real E2E captures, without changing UI pixels.
// Refresh the source captures with make e2e, then run node scripts/readme-media.mjs.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const output = new URL("../docs/readme-assets/", import.meta.url);
await mkdir(output, { recursive: true });
const source = async (name) =>
  "data:image/png;base64," +
  (
    await readFile(new URL(`../test-results/${name}.png`, import.meta.url))
  ).toString("base64");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const cards = [
    {
      name: "dashboard",
      title: "Ваш следующий карьерный шаг",
      subtitle: "План на день, активные отклики и прогресс поиска",
      images: ["design-dashboard-dark"],
      width: 1440,
      height: 1540,
    },
    {
      name: "journal",
      title: "Каждая возможность — на своём месте",
      subtitle: "Группы, этапы, фильтры и статистика текущей выборки",
      images: ["design-table-grouped"],
      width: 1440,
      height: 1120,
      screenHeight: 930,
    },
    {
      name: "calendar",
      title: "Встречи и задачи в одном календаре",
      subtitle: "Месяц, повестка дня и подписка для внешнего календаря",
      images: ["design-calendar-dark"],
      width: 1440,
      height: 1240,
    },
    {
      name: "themes",
      title: "Две темы. Одна система интерфейса.",
      subtitle: "Arctic Depths · тёмная и светлая палитры",
      images: ["design-table-dark", "design-table-light"],
      width: 1440,
      height: 760,
      screenHeight: 566,
    },
    {
      name: "mobile",
      title: "Поиск работы продолжается на телефоне",
      subtitle: "Адаптивная главная, карточки откликов и календарь",
      images: [
        "design-dashboard-mobile",
        "design-table-mobile",
        "design-calendar-mobile",
      ],
      width: 1280,
      height: 1040,
      screenHeight: 844,
      mobile: true,
    },
  ];
  for (const card of cards) {
    const images = await Promise.all(card.images.map(source));
    await page.setViewportSize({ width: card.width, height: card.height });
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% 0%,#164567,#0d1520 65%);color:#e8edf4;font-family:Arial,sans-serif}
      main{padding:36px 40px}header{margin-bottom:28px}h1{font-size:32px;letter-spacing:-.8px;margin:0 0 12px}p{font-size:18px;color:#a8c0d0;margin:0}.screens{display:flex;gap:24px;justify-content:center;align-items:flex-start}
      .frame{flex:1;min-width:0;border:1px solid #34516a;border-radius:14px;overflow:hidden;background:#142d3b;box-shadow:0 18px 50px #0005;height:${card.screenHeight ? card.screenHeight + 30 + "px" : "auto"}}
      .bar{height:30px;background:#162535;border-bottom:1px solid #2a3c50;display:flex;gap:6px;align-items:center;padding-left:14px}.bar i{width:6px;height:6px;border-radius:50%;background:#63809a}img{display:block;width:100%;height:auto}
      ${card.mobile ? ".frame{flex:0 0 360px;border-radius:22px}.bar{height:24px}" : ""}
      </style><main><header><h1>${card.title}</h1><p>${card.subtitle}</p></header><div class="screens">${images.map((image) => `<div class="frame"><div class="bar"><i></i><i></i><i></i></div><img src="${image}" alt=""></div>`).join("")}</div></main></html>`);
    await page.evaluate(() =>
      Promise.all([...document.images].map((image) => image.decode())),
    );
    await page.screenshot({
      path: new URL(`${card.name}.jpg`, output).pathname,
      type: "jpeg",
      quality: 90,
    });
  }
} finally {
  await browser.close();
}
