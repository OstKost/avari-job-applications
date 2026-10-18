import { stages, states, type Application } from "@avari/shared";

export const stageColors: Record<string, string> = {
  saved: "var(--chart-saved)",
  applied: "var(--chart-applied)",
  hr: "var(--chart-hr)",
  interview: "var(--chart-interview)",
  final: "var(--chart-final)",
  offer: "var(--chart-offer)",
};
export const stateColors: Record<string, string> = {
  active: "var(--chart-active)",
  paused: "var(--chart-paused)",
  closed: "var(--chart-closed)",
};

// Date-only arithmetic intentionally uses UTC: account dates are already resolved.
export function shiftDay(date: string, offset: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
export function validDay(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
}
export function dateRange(from: string, to: string): string[] {
  if (!validDay(from) || !validDay(to) || from > to) return [];
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    days.push(day);
    if (day === to) break;
  }
  return days;
}
export function activityLevel(count: number): number {
  return count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
}
export function dailyApplications(
  applications: Application[],
  from: string,
  to: string,
) {
  const days = dateRange(from, to).map((date) => ({
    date,
    total: 0,
    counts: Object.fromEntries(Object.keys(stages).map((key) => [key, 0])),
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const app of applications) {
    const day = byDate.get(app.appliedDate);
    if (day && app.stage in day.counts) {
      day.total++;
      day.counts[app.stage]++;
    }
  }
  return days;
}
export function distribution(
  applications: Application[],
  kind: "stage" | "state",
) {
  const labels = kind === "stage" ? stages : states;
  const colors = kind === "stage" ? stageColors : stateColors;
  return Object.entries(labels).map(([key, label]) => {
    const count = applications.filter((app) => app[kind] === key).length;
    return {
      key,
      label,
      count,
      color: colors[key],
      percent: applications.length ? (count / applications.length) * 100 : 0,
    };
  });
}
