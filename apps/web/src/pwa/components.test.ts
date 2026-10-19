import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { PwaUpdatePrompt } from "./components";
import type { UsePwaReturn } from "./usePwa";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
beforeEach(() => {
  // jsdom has no native top layer; simulate modal membership for these lifecycle tests.
  const query = document.querySelectorAll.bind(document);
  vi.spyOn(document, "querySelectorAll").mockImplementation((selector: string) =>
    query(selector === "dialog:modal" ? "dialog[open]" : selector),
  );
});
afterEach(() => {
  act(() => root.unmount());
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
  root = createRoot(container);
  vi.restoreAllMocks();
});

it("moves one live prompt through modal open, nested open, close and removal without touching the draft", async () => {
  const updateServiceWorker = vi.fn();
  const dismissUpdate = vi.fn();
  const pwa = { needRefresh: true, isUpdating: false, otherTabsDirty: true,
    updateServiceWorker, dismissUpdate } as unknown as UsePwaReturn;
  await act(async () => root.render(createElement(PwaUpdatePrompt, { pwa })));
  const banner = document.querySelector(".pwa-banner")!;
  const host = banner.parentElement!;
  expect(host.parentElement).toBe(document.body);
  expect(updateServiceWorker).not.toHaveBeenCalled();

  const first = document.createElement("dialog");
  const second = document.createElement("dialog");
  const draft = document.createElement("input");
  draft.value = "unsaved application";
  first.append(draft);
  // DOM order deliberately differs from the order in which dialogs open.
  document.body.append(second, first);
  await act(async () => { first.open = true; });
  expect(host.parentElement).toBe(first);
  await act(async () => { second.open = true; });
  expect(host.parentElement).toBe(second);
  expect(document.querySelectorAll(".pwa-banner")).toHaveLength(1);
  expect(document.querySelector(".pwa-banner")).toBe(banner);
  await act(async () => { second.open = false; });
  expect(host.parentElement).toBe(first);
  expect(draft.value).toBe("unsaved application");
  await act(async () => {
    banner.querySelector<HTMLButtonElement>(".pwa-button-primary")!.click();
  });
  expect(updateServiceWorker).toHaveBeenCalledTimes(1);
  expect(first.open).toBe(true);
  await act(async () => { first.remove(); });
  expect(host.parentElement).toBe(document.body);
  await act(async () => root.render(createElement(PwaUpdatePrompt, { pwa: { ...pwa, needRefresh: false } })));
  expect(host.isConnected).toBe(false);
  expect(document.querySelector(".pwa-banner")).toBeNull();
});

it("attaches to an already open focused dialog and cleans up on unmount", async () => {
  const dialog = document.createElement("dialog");
  dialog.open = true;
  const input = document.createElement("input");
  dialog.append(input);
  document.body.append(dialog);
  input.focus();
  const pwa = { needRefresh: true, isUpdating: true, otherTabsDirty: false } as UsePwaReturn;
  await act(async () => root.render(createElement(PwaUpdatePrompt, { pwa })));
  expect(dialog.querySelector(".pwa-banner")).toBeTruthy();
  expect(document.activeElement).toBe(input);
  expect(dialog.querySelector<HTMLButtonElement>(".pwa-button-primary")!.disabled).toBe(true);
  await act(async () => root.render(null));
  expect(document.querySelector(".pwa-update-host")).toBeNull();
  expect(dialog.open).toBe(true);
});
