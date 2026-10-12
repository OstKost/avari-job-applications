import type { Application, Field, Task } from "./index";
import { stages, states, outcomes, externalStatuses, sortTasks } from "./index";

function escapeCSV(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportApplicationsToCSV(
  applications: Application[],
  fields: Field[] = [],
  tasks: Task[] = [],
): string {
  const customFields = [...fields].sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const headers = [
    "Компания",
    "Позиция",
    "Этап",
    "Состояние",
    "Результат",
    "Дата отклика",
    "Дата сохранения",
    "Зарплата от",
    "Зарплата до",
    "Валюта",
    "Период зарплаты",
    "Налог",
    "Формат работы",
    "Локация",
    "Группы",
    "Ссылка",
    "ID на hh.ru",
    "Контакт рекрутера",
    "Статус на сайте",
    "Ближайшая задача",
    "Дата задачи",
    ...customFields.map((f) => f.name),
  ];

  const lines: string[] = [];
  lines.push(headers.map(escapeCSV).join(","));

  for (const app of applications) {
    const nextTask = sortTasks(
      tasks.filter((t) => t.applicationId === app.id && t.state === "open"),
    )[0];

    const row: string[] = [
      escapeCSV(app.company),
      escapeCSV(app.position),
      escapeCSV(stages[app.stage] ?? app.stage),
      escapeCSV(states[app.state] ?? app.state),
      escapeCSV(outcomes[app.outcome] ?? app.outcome),
      escapeCSV(app.appliedDate || ""),
      escapeCSV(app.savedDate || ""),
      escapeCSV(app.salary?.min != null ? app.salary.min : ""),
      escapeCSV(app.salary?.max != null ? app.salary.max : ""),
      escapeCSV(app.salary?.currency || ""),
      escapeCSV(app.salary?.period || ""),
      escapeCSV(app.salary?.tax || ""),
      escapeCSV(app.workFormat || ""),
      escapeCSV(app.location || ""),
      escapeCSV((app.groups || []).join("; ")),
      escapeCSV(app.url || ""),
      escapeCSV(app.hhId || ""),
      escapeCSV(app.recruiter || ""),
      escapeCSV(externalStatuses[app.externalStatus] ?? app.externalStatus ?? ""),
      escapeCSV(nextTask ? nextTask.title : ""),
      escapeCSV(nextTask ? `${nextTask.date}${nextTask.time ? " " + nextTask.time : ""}` : ""),
      ...customFields.map((f) => {
        const val = app.custom?.[f.id];
        return escapeCSV(val == null ? "" : Array.isArray(val) ? val.join("; ") : String(val));
      }),
    ];

    lines.push(row.join(","));
  }

  // UTF-8 BOM (\uFEFF) ensures Excel opens Cyrillic without garbled characters
  return "\uFEFF" + lines.join("\r\n");
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
