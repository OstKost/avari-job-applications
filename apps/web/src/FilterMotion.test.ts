import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TableRowsMotion } from "./FilterMotion";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render(key: string, text: string) {
  act(() =>
    root.render(
      createElement(
        "table",
        null,
        createElement(
          "thead",
          null,
          createElement("tr", null, createElement("th", null, "Компания")),
        ),
        createElement(TableRowsMotion, {
          transitionKey: key,
          children: createElement("tr", null, createElement("td", null, text)),
        }),
      ),
    ),
  );
}
it("retains the latest outgoing rows and keeps the heading mounted", () => {
  render("all", "Первая версия");
  const heading = container.querySelector("thead");
  render("all", "Обновлённая версия");
  render("group", "Новая группа");
  expect(container.querySelector("tbody")?.textContent).toBe(
    "Обновлённая версия",
  );
  expect(container.querySelector("tbody")?.hasAttribute("inert")).toBe(true);
  act(() => vi.advanceTimersByTime(260));
  expect(container.querySelector("tbody")?.textContent).toBe("Новая группа");
  expect(container.querySelector("thead")).toBe(heading);
});
it("discards an intermediate filter during rapid switching", () => {
  render("all", "Все");
  render("one", "Один");
  act(() => vi.advanceTimersByTime(100));
  render("two", "Два");
  act(() => vi.advanceTimersByTime(160));
  expect(container.querySelector("tbody")?.textContent).toBe("Все");
  act(() => vi.advanceTimersByTime(100));
  expect(container.querySelector("tbody")?.textContent).toBe("Два");
});
it("switches immediately with reduced motion", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  render("all", "Все");
  render("empty", "Ничего не найдено");
  expect(container.querySelector("tbody")?.textContent).toBe(
    "Ничего не найдено",
  );
  expect(container.querySelector("tbody")?.hasAttribute("inert")).toBe(false);
});
it("retains outgoing cards before showing the next filter", () => {
  const renderCards = (key: string, text: string) =>
    act(() =>
      root.render(
        createElement(TableRowsMotion, {
          cards: true,
          transitionKey: key,
          children: createElement("a", { className: "application-card" }, text),
        }),
      ),
    );
  renderCards("all", "Все карточки");
  renderCards("group", "Карточки группы");
  expect(
    container.querySelector(".application-cards.exiting")?.textContent,
  ).toBe("Все карточки");
  act(() => vi.advanceTimersByTime(260));
  expect(container.querySelector(".application-cards")?.textContent).toBe(
    "Карточки группы",
  );
  expect(container.querySelector(".exiting")).toBeNull();
});
