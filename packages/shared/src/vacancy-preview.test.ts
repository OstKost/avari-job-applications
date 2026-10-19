import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emptyApplication, type Application, type Transport } from "./index";
import {
  mergeVacancyPreview,
  readVacancyClipboard,
  type VacancyPreview,
} from "./vacancy-preview";
import { VacancyAutofill } from "./VacancyAutofill";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const preview: VacancyPreview = {
  url: "https://hh.ru/vacancy/123",
  fields: { company: "Loaded", position: "Role", salary: { min: 0 } },
};

it("overwrites existing values, preserves absent values and merges salary components", () => {
  const current = {
    ...emptyApplication(),
    company: "Manual",
    location: "City",
    workFormat: "Hybrid",
    recruiter: "Person",
    groups: ["Main"],
    salary: { min: 100, max: 200, currency: "EUR", tax: "net", period: "year" },
  };
  const next = mergeVacancyPreview(current, preview);
  expect(next).toMatchObject({
    company: "Loaded",
    position: "Role",
    location: "City",
    workFormat: "Hybrid",
    recruiter: "Person",
    groups: ["Main"],
    salary: { min: 0, max: 200, currency: "EUR", tax: "net", period: "year" },
  });
  expect(current.company).toBe("Manual");
  expect(
    mergeVacancyPreview(current, {
      ...preview,
      fields: { company: "", location: "  ", salary: { min: null } },
    }).company,
  ).toBe("Manual");
});
it("preserves edits made during a pending request, by individual field", () => {
  const baseline = emptyApplication();
  const current = {
    ...baseline,
    company: "Typed during request",
    salary: { ...baseline.salary, max: 500 },
  };
  const next = mergeVacancyPreview(
    current,
    {
      ...preview,
      fields: { ...preview.fields, salary: { min: 100, max: 200 } },
    },
    baseline,
  );
  expect(next).toMatchObject({
    company: current.company,
    position: "Role",
    salary: { min: 100, max: 500 },
  });
});
it("reads only a supported vacancy URL and quietly handles denied or missing clipboard", async () => {
  for (const raw of [
    "hello",
    "https://hh.ru/",
    "https://hh.ru.evil.com/vacancy/123",
  ]) {
    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn().mockResolvedValue(raw) },
    });
    expect(await readVacancyClipboard()).toBe("");
  }
  vi.stubGlobal("navigator", {
    clipboard: {
      readText: vi.fn().mockResolvedValue(" https://hh.ru/vacancy/123 "),
    },
  });
  expect(await readVacancyClipboard()).toBe(preview.url);
  vi.stubGlobal("navigator", {
    clipboard: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  expect(await readVacancyClipboard()).toBe("");
  vi.stubGlobal("navigator", {});
  expect(await readVacancyClipboard()).toBe("");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function render(
  api: ReturnType<typeof vi.fn>,
  options: { clipboardText?: Promise<string>; enabled?: boolean } = {},
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let current = emptyApplication();
  let update!: (value: Application) => void;
  function Harness() {
    const [value, setValue] = useState(current);
    current = value;
    update = setValue;
    return createElement(VacancyAutofill, {
      value,
      update: setValue,
      api: api as Transport,
      enabled: true,
      disabled: false,
      ...options,
    });
  }
  act(() => root!.render(createElement(Harness)));
  return {
    get value() {
      return current;
    },
    set: (change: Partial<Application>) =>
      act(() => update({ ...current, ...change })),
  };
}
function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  )!;
  expect(button).toBeTruthy();
  act(() => button.click());
}

describe("vacancy autofill requests", () => {
  it("loads a pasted URL after debounce, and makes no save request", async () => {
    vi.useFakeTimers();
    const api = vi.fn().mockResolvedValue(preview);
    const state = render(api);
    state.set({ url: preview.url, company: "Manual" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(api).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(state.value.company).toBe("Loaded");
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toBe("/vacancies/preview");
  });
  it("prefetches clipboard metadata but waits for the fill button", async () => {
    const api = vi.fn().mockResolvedValue(preview);
    const state = render(api, { clipboardText: Promise.resolve(preview.url) });
    await act(async () => {});
    expect(state.value.company).toBe("");
    expect(container.textContent).toContain("Заполнить из буфера обмена?");
    click("Заполнить");
    expect(state.value.company).toBe("Loaded");
    expect(state.value.url).toBe(preview.url);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("dismisses the clipboard offer without applying data", async () => {
    const state = render(vi.fn().mockResolvedValue(preview), {
      clipboardText: Promise.resolve(preview.url),
    });
    await act(async () => {});
    click("Пропустить");
    expect(state.value.company).toBe("");
    expect(container.textContent).not.toContain("Заполнить из буфера обмена?");
  });
  it("aborts a request on URL change and ignores late responses", async () => {
    vi.useFakeTimers();
    const pending = deferred<VacancyPreview>();
    const api = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({
        ...preview,
        url: "https://hh.ru/vacancy/456",
        fields: { company: "New job" },
      });
    const state = render(api);
    state.set({ url: preview.url });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const signal = api.mock.calls[0][4].signal as AbortSignal;
    state.set({ url: "https://hh.ru/vacancy/456" });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(preview);
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(state.value.company).toBe("New job");
  });
  it("preserves edits during loading, supports retry and aborts on unmount", async () => {
    vi.useFakeTimers();
    const pending = deferred<VacancyPreview>();
    const api = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error("Network failed"))
      .mockReturnValueOnce(new Promise(() => {}));
    const state = render(api);
    state.set({ url: preview.url });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    state.set({ company: "Typed" });
    await act(async () => {
      pending.resolve(preview);
    });
    expect(state.value).toMatchObject({ company: "Typed", position: "Role" });
    click("Повторить загрузку");
    await act(async () => {});
    expect(container.textContent).toContain("Network failed");
    expect(state.value.company).toBe("Typed");
    click("Повторить загрузку");
    const signal = api.mock.calls[2][4].signal as AbortSignal;
    act(() => root!.unmount());
    root = undefined;
    expect(signal.aborted).toBe(true);
  });
  it("ignores unsupported URLs and unavailable clipboard", async () => {
    vi.useFakeTimers();
    const api = vi.fn();
    const state = render(api, { clipboardText: Promise.resolve("") });
    state.set({ url: "https://example.com/role" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api).not.toHaveBeenCalled();
  });
  it("ignores a late clipboard read once the URL has been entered", async () => {
    vi.useFakeTimers();
    const clip = deferred<string>();
    const api = vi.fn().mockResolvedValue(preview);
    const state = render(api, { clipboardText: clip.promise });
    state.set({ url: preview.url });
    await act(async () => {
      clip.resolve("https://hh.ru/vacancy/456");
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][2]).toEqual({ url: preview.url });
    expect(container.textContent).not.toContain("Заполнить из буфера обмена?");
  });
  it("makes no automatic requests when autofill is disabled", async () => {
    vi.useFakeTimers();
    const api = vi.fn();
    const state = render(api, {
      enabled: false,
      clipboardText: Promise.resolve(preview.url),
    });
    state.set({ url: preview.url });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api).not.toHaveBeenCalled();
  });
});
