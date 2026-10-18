import { describe, expect, it } from "vitest";
import { emptyApplication } from "@avari/shared";
import {
  activityLevel,
  dailyApplications,
  dateRange,
  distribution,
  shiftDay,
  validDay,
} from "./statisticsData";

describe("statistics calculations", () => {
  it("uses inclusive ranges across leap days and year boundaries", () => {
    expect(dateRange("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    for (const length of [30, 90])
      expect(
        dateRange(shiftDay("2026-10-18", 1 - length), "2026-10-18"),
      ).toHaveLength(length);
    expect(validDay("2026-02-30")).toBe(false);
    expect(dateRange("2026-10-18", "2026-10-01")).toEqual([]);
  });
  it("counts by applied date and current stage, including closed vacancies", () => {
    const a = {
      ...emptyApplication(),
      appliedDate: "2026-10-02",
      stage: "hr",
      state: "closed",
    };
    const b = {
      ...emptyApplication(),
      appliedDate: "2026-10-02",
      stage: "applied",
    };
    const days = dailyApplications(
      [a, b, emptyApplication()],
      "2026-10-01",
      "2026-10-03",
    );
    expect(days.map((day) => day.total)).toEqual([0, 2, 0]);
    expect(days[1].counts.hr).toBe(1);
    expect(
      dailyApplications(
        [{ ...a, stage: "offer" }, b],
        "2026-10-02",
        "2026-10-02",
      )[0].counts,
    ).toMatchObject({ hr: 0, offer: 1, applied: 1 });
  });
  it("includes saved and closed vacancies in pie totals and keeps zero categories", () => {
    const apps = [
      emptyApplication(),
      { ...emptyApplication(), stage: "offer", state: "closed" },
    ];
    expect(distribution(apps, "stage")).toHaveLength(6);
    expect(
      distribution(apps, "stage").find((s) => s.key === "saved"),
    ).toMatchObject({ count: 1, percent: 50 });
    expect(
      distribution(apps, "state").find((s) => s.key === "closed"),
    ).toMatchObject({ count: 1, percent: 50 });
    expect(
      distribution([], "state").every((s) => s.count === 0 && s.percent === 0),
    ).toBe(true);
    expect(distribution([emptyApplication()], "stage")[0].percent).toBe(100);
  });
  it("keeps stable activity intensity thresholds", () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 100].map(activityLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});
