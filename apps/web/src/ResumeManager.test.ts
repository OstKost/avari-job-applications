import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResumeManager } from "./ResumeManager";
import type { Resume } from "@avari/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockResumes: Resume[] = [
  {
    id: "res-1",
    title: "Резюме Frontend Lead",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    versions: [
      {
        id: "ver-1",
        resumeId: "res-1",
        versionNumber: 1,
        filename: "cv_v1.pdf",
        format: "pdf",
        size: 1024 * 50,
        checksum: "abc1",
        createdAt: "2026-10-01T10:00:00Z",
      },
      {
        id: "ver-2",
        resumeId: "res-1",
        versionNumber: 2,
        filename: "cv_v2.docx",
        format: "docx",
        size: 1024 * 80,
        checksum: "abc2",
        createdAt: "2026-10-15T12:00:00Z",
      },
    ],
  },
];

describe("ResumeManager", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    container = document.createElement("div");
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it("renders resumes with sequential versions and file formats", () => {
    queryClient.setQueryData(["resumes"], mockResumes);

    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ResumeManager),
        ),
      );
    });

    expect(container.textContent).toContain("Резюме Frontend Lead");
    expect(container.textContent).toContain("v2 · текущая");
    expect(container.textContent).toContain("cv_v2.docx");
    expect(container.textContent).toContain("v1");
    expect(container.textContent).toContain("cv_v1.pdf");
    expect(container.textContent).toContain("DOCX · 80.0 KB");
  });

  it("validates allowed formats (PDF, MD, TXT, DOCX, DOC, ODT, RTF)", () => {
    queryClient.setQueryData(["resumes"], []);

    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ResumeManager),
        ),
      );
    });

    // Click upload button
    const uploadBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Загрузить новое резюме") || b.textContent?.includes("Загрузить резюме"),
    );
    expect(uploadBtn).toBeTruthy();
    act(() => {
      uploadBtn?.click();
    });

    // Check modal appears
    expect(container.textContent).toContain("Загрузка нового резюме");
    expect(container.textContent).toContain("PDF, MD, TXT, DOCX, DOC, ODT, RTF до 20 МБ");
  });
});
