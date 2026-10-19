import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DailyGoal,
  getDailySummaryQueryKey,
  type DailySummaryData,
} from "./DailyGoal";
import type { Transport } from "@avari/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_SUMMARY: DailySummaryData = {
  today: "2026-10-18",
  timezone: "Europe/Moscow",
  goal: 10,
  added: 3,
  applied: 4,
  completedTasks: 1,
  completedInterviews: 1,
  total: 8,
  plannedTasks: 2,
  plannedInterviews: 1,
  completedTodayTasks: 1,
  completedTodayInterviews: 1,
};

describe("DailyGoal", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let mockApi: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    mockApi = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("exports correct queryKey helper for invalidation", () => {
    expect(getDailySummaryQueryKey("user-123")).toEqual(["daily-summary", "user-123"]);
  });

  it("renders daily summary card with progress capped at 100%, stats breakdown, and encouragement", async () => {
    queryClient.setQueryData(getDailySummaryQueryKey("user-1"), SAMPLE_SUMMARY);

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(DailyGoal, { userId: "user-1", api: mockApi as unknown as Transport })
        )
      );
    });

    // Title and scores
    expect(container.textContent).toContain("Ежедневная цель");
    expect(container.textContent).toContain("В процессе");
    const scoreEl = container.querySelector('[data-testid="daily-goal-score"]');
    expect(scoreEl?.textContent).toContain("8/10");

    // Progress bar width is 80%
    const progressBar = container.querySelector<HTMLElement>('[data-testid="daily-goal-progress-bar"]');
    expect(progressBar?.style.width).toBe("80%");

    // Breakdown counts
    expect(container.textContent).toContain("Отклики");
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("Добавлено");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("Интервью");
    expect(container.textContent).toContain("1 (1)");
    expect(container.textContent).toContain("Задачи");
    expect(container.textContent).toContain("1 (2)");

    // Remaining encouragement
    const encouragement = container.querySelector('[data-testid="daily-goal-encouragement"]');
    expect(encouragement?.textContent).toBe("Осталось выполнить 2 действия до цели.");
  });

  it("caps progress bar at 100% when goal is exceeded and shows completed badge", async () => {
    const exceededSummary: DailySummaryData = {
      ...SAMPLE_SUMMARY,
      goal: 5,
      total: 12,
    };
    queryClient.setQueryData(getDailySummaryQueryKey("user-2"), exceededSummary);

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(DailyGoal, { userId: "user-2", api: mockApi as unknown as Transport })
        )
      );
    });

    expect(container.textContent).toContain("Выполнена");
    const scoreEl = container.querySelector('[data-testid="daily-goal-score"]');
    expect(scoreEl?.textContent).toContain("12/5");

    const progressBar = container.querySelector<HTMLElement>('[data-testid="daily-goal-progress-bar"]');
    expect(progressBar?.style.width).toBe("100%");

    const encouragement = container.querySelector('[data-testid="daily-goal-encouragement"]');
    expect(encouragement?.textContent).toContain("Дневная цель выполнена!");
  });

  it("handles offline or API failure gracefully without throwing or blocking", async () => {
    mockApi.mockRejectedValue(new Error("Network Error"));

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(DailyGoal, { userId: "user-offline", api: mockApi as unknown as Transport })
        )
      );
    });

    // Wait for the query to fail and update state
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container.textContent).toContain("Ежедневная цель");
    expect(container.textContent).toContain("Недоступно");
    expect(container.textContent).toContain("Данные о цели временно недоступны");
    expect(container.querySelector('[data-testid="daily-goal-retry"]')).toBeTruthy();
  });
});
