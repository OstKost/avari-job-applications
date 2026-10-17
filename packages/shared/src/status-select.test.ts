import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Select } from "./ui";
import { stages, states } from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});
function render(items = stages, disabled = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(Select, {
        items,
        value: Object.keys(items)[0],
        onChange,
        "aria-label": "Этап",
        disabled,
      }),
    ),
  );
  return {
    trigger: container.querySelector<HTMLButtonElement>("button")!,
    onChange,
  };
}
function key(target: Element, key: string) {
  act(() =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
  );
}
describe("colored status select", () => {
  it("opens at the selected option and supports keyboard selection", () => {
    const { trigger, onChange } = render();
    key(trigger, "ArrowDown");
    const options = container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    );
    expect(document.activeElement).toBe(options[0]);
    key(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    act(() => options[1].click());
    expect(onChange).toHaveBeenCalledWith("applied");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("closes with Escape without changing the state", () => {
    const { trigger, onChange } = render(states);
    act(() => trigger.click());
    expect(container.querySelector(".badge-active")).not.toBeNull();
    key(document.activeElement!, "Escape");
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
  it("prevents changes while disabled", () => {
    const { trigger, onChange } = render(stages, true);
    act(() => trigger.click());
    expect(trigger.disabled).toBe(true);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("renders workflow diagram for stages without separate inner scroll", () => {
    const { trigger } = render(stages);
    act(() => trigger.click());
    const menu = container.querySelector(".status-workflow-menu");
    expect(menu).not.toBeNull();
    const workflow = container.querySelector(".status-workflow-flow");
    expect(workflow).not.toBeNull();
    const connectors = container.querySelectorAll(".status-workflow-connector");
    expect(connectors.length).toBe(Object.keys(stages).length - 1);
  });
  it("numbers empty option as 0 and subsequent stages from 1", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(Select, {
          items: stages,
          value: "",
          onChange: vi.fn(),
          empty: "Все этапы",
          "aria-label": "Этап",
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    act(() => trigger.click());
    const nums = Array.from(
      container.querySelectorAll(".status-workflow-num"),
    ).map((el) => el.textContent);
    expect(nums[0]).toBe("0");
    expect(nums[1]).toBe("1");
    expect(nums[2]).toBe("2");
  });
  it("closes on an outside click", () => {
    const { trigger } = render();
    act(() => trigger.click());
    act(() =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("BadgeDropdown", () => {
  it("renders resting badge without permanent arrow and opens on click", async () => {
    const { BadgeDropdown } = await import("./ui");
    const div = document.createElement("div");
    document.body.append(div);
    const testRoot = createRoot(div);
    const onChange = vi.fn();

    act(() => {
      testRoot.render(
        createElement(BadgeDropdown, {
          value: "applied",
          kind: "stage",
          onChange,
        }),
      );
    });

    const trigger = div.querySelector<HTMLButtonElement>("button.badge-dropdown-trigger")!;
    expect(trigger).not.toBeNull();
    // Rest visuals: contains badge with class badge-applied
    expect(trigger.querySelector(".badge-applied")).not.toBeNull();
    // No permanent arrow svg inside trigger
    expect(trigger.querySelector("svg")).toBeNull();

    act(() => trigger.click());
    // Portal menu opened in document.body
    const menu = document.querySelector(".badge-dropdown-menu-portal");
    expect(menu).not.toBeNull();

    // Select next stage
    const hrBtn = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(
      (b) => b.dataset.value === "hr",
    );
    expect(hrBtn).not.toBeNull();
    act(() => hrBtn!.click());
    expect(onChange).toHaveBeenCalledWith("hr");

    act(() => testRoot.unmount());
    div.remove();
  });
});

