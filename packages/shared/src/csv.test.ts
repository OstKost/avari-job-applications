import { describe, it, expect } from "vitest";
import { exportApplicationsToCSV } from "./csv";
import type { Application, Field, Task } from "./index";

describe("exportApplicationsToCSV", () => {
  it("includes UTF-8 BOM, headers and formatted data", () => {
    const apps: Application[] = [
      {
        id: "app-1",
        company: 'ООО "Яндекс"',
        position: "Frontend Developer, Senior",
        url: "https://example.com/job/1",
        hhId: "123456",
        savedDate: "2026-10-10",
        appliedDate: "2026-10-11",
        stage: "interview",
        state: "active",
        outcome: "",
        salary: {
          min: 300000,
          max: 400000,
          currency: "RUB",
          period: "month",
          tax: "net",
        },
        location: "Москва",
        workFormat: "Гибрид",
        recruiter: "Анна (@anna_recruiter)",
        externalStatus: "invited",
        groups: ["Golang"],
        tags: ["React", "Remote"],
        custom: {
          "field-rating": 5,
          "field-notes": "Было приятное общение\nЖдем фидбек",
        },
        version: 1,
        createdAt: "2026-10-10T12:00:00Z",
        updatedAt: "2026-10-11T12:00:00Z",
      },
    ];

    const fields: Field[] = [
      {
        id: "field-rating",
        name: "Оценка",
        type: "number",
        options: [],
        role: "",
      },
      {
        id: "field-notes",
        name: "Заметки о процессе",
        type: "text",
        options: [],
        role: "",
      },
    ];

    const tasks: Task[] = [
      {
        id: "t-1",
        applicationId: "app-1",
        title: "Техническое интервью",
        kind: "interview",
        date: "2026-10-15",
        time: "15:00",
        state: "open",
        version: 1,
        createdAt: "2026-10-11T13:00:00Z",
      },
    ];

    const csv = exportApplicationsToCSV(apps, fields, tasks);

    // Starts with UTF-8 BOM
    expect(csv.startsWith("\uFEFF")).toBe(true);

    const contentWithoutBOM = csv.slice(1);
    const lines = contentWithoutBOM.split("\r\n");

    // Header line
    expect(lines[0]).toContain("Компания,Позиция,Этап,Состояние");
    expect(lines[0]).toContain("Заметки о процессе,Оценка");

    // Escaped company with quotes: "ООО ""Яндекс"""
    expect(lines[1]).toContain('"ООО ""Яндекс"""');
    // Escaped position with comma: "Frontend Developer, Senior"
    expect(lines[1]).toContain('"Frontend Developer, Senior"');
    // Stage human readable
    expect(lines[1]).toContain("Интервью");
    // State human readable
    expect(lines[1]).toContain("Активен");
    // External status readable
    expect(lines[1]).toContain("Приглашение");
    // Groups formatted
    expect(lines[1]).toContain("Golang");
    // Tags formatted
    expect(lines[1]).toContain("React; Remote");
    // Next task
    expect(lines[1]).toContain("Техническое интервью");
    expect(lines[1]).toContain("2026-10-15 15:00");
    // Multi-line custom field escaped
    expect(lines[1]).toContain('"Было приятное общение\nЖдем фидбек"');
  });

  it("handles empty lists gracefully", () => {
    const csv = exportApplicationsToCSV([], []);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Компания,Позиция,Этап");
  });
});
