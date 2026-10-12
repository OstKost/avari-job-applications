import { describe, it, expect, vi, afterEach } from "vitest";
import { createAPI, APIError } from "./index";
afterEach(() => vi.unstubAllGlobals());
describe("API response handling", () => {
  it("does not report success for a non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>Proxy</html>", { status: 200 })),
    );
    await expect(
      createAPI()("/applications", "POST", {}),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("некорректный ответ"),
    });
  });
  it("keeps the server comparison on conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: "Запись изменилась",
              current: { version: 2 },
            }),
            { status: 409 },
          ),
        ),
    );
    await expect(
      createAPI()("/applications/id", "PUT", {}),
    ).rejects.toMatchObject({ status: 409, current: { version: 2 } });
  });
  it("localizes a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(createAPI()("/tasks")).rejects.toBeInstanceOf(APIError);
    await expect(createAPI()("/tasks")).rejects.toThrow(
      "Нет соединения с сервером",
    );
  });

  it("handles plural declensions correctly", async () => {
    const { pluralize, pluralTasks, pluralApplications } = await import("./index");
    expect(pluralize(1, "задача", "задачи", "задач")).toBe("задача");
    expect(pluralize(2, "задача", "задачи", "задач")).toBe("задачи");
    expect(pluralize(5, "задача", "задачи", "задач")).toBe("задач");
    expect(pluralize(11, "задача", "задачи", "задач")).toBe("задач");
    expect(pluralize(21, "задача", "задачи", "задач")).toBe("задача");
    expect(pluralize(24, "задача", "задачи", "задач")).toBe("задачи");

    expect(pluralTasks(1, "открытая")).toBe("1 открытая задача");
    expect(pluralTasks(2, "открытая")).toBe("2 открытые задачи");
    expect(pluralTasks(5, "открытая")).toBe("5 открытых задач");
    expect(pluralTasks(11, "открытая")).toBe("11 открытых задач");
    expect(pluralTasks(21, "открытая")).toBe("21 открытая задача");

    expect(pluralTasks(1, "просроченная")).toBe("1 просроченная задача");
    expect(pluralTasks(3, "просроченная")).toBe("3 просроченные задачи");
    expect(pluralTasks(10, "просроченная")).toBe("10 просроченных задач");

    expect(pluralApplications(1, "активный")).toBe("1 активный отклик");
    expect(pluralApplications(2, "активный")).toBe("2 активных отклика");
    expect(pluralApplications(5, "активный")).toBe("5 активных откликов");
  });
});

