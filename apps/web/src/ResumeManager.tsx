import { createWebAPI, assertServerMutationAllowed, requireLiveVerification } from "./offline/policy";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Pencil,
  Plus,
  LoaderCircle,
  FileCheck,
  X,
} from "lucide-react";
import {
  dateLabel,
  type Resume,
  type ResumeVersion,
} from "@avari/shared";
import { Modal, ErrorBox, Empty, FieldInput } from "@avari/shared/ui";

const api = createWebAPI();

const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".md",
  ".txt",
  ".docx",
  ".doc",
  ".odt",
  ".rtf",
];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MiB

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResumeManager() {
  const client = useQueryClient();
  const resumesQuery = useQuery({
    queryKey: ["resumes"],
    queryFn: () => api<Resume[]>("/resumes"),
  });

  const resumes = resumesQuery.data ?? [];
  const [uploadModal, setUploadModal] = useState<{
    isOpen: boolean;
    resumeId?: string; // If set, upload new version for this resume
    resumeTitle?: string;
  }>({ isOpen: false });

  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    resume?: Resume;
  }>({ isOpen: false });

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    resume?: Resume;
    version?: ResumeVersion;
  }>({ isOpen: false });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const [uploadError, setUploadError] = useState<unknown>();
  const [renameError, setRenameError] = useState<unknown>();
  const [deleteError, setDeleteError] = useState<unknown>();

  const isSubmittingRef = useRef(false);

  const refresh = () => client.invalidateQueries({ queryKey: ["resumes"] });

  const handleDownload = async (resumeId: string, versionId: string, filename: string) => {
    try {
      const response = await fetch(`/api/v1/resumes/${resumeId}/versions/${versionId}/download`, {
        headers: {
          ...(typeof document !== "undefined"
            ? {
                "X-CSRF-Token":
                  document.cookie
                    .split("; ")
                    .find((v) => v.startsWith("avari_csrf="))
                    ?.slice(11) ?? "",
              }
            : {}),
        },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Не удалось скачать файл");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e);
    }
  };

  const handleUploadSubmit = async (file: File, title: string, resumeId?: string) => {
    if (isSubmittingRef.current || busy) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setUploadError(undefined);
    try {
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new Error(
          `Неподдерживаемый формат файла: ${ext}. Разрешены: ${ALLOWED_EXTENSIONS.join(", ")}`,
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("Файл превышает лимит 20 МБ.");
      }

      const formData = new FormData();
      formData.append("file", file);
      if (title.trim()) {
        formData.append("title", title.trim());
      }

      const csrf = document.cookie
        .split("; ")
        .find((v) => v.startsWith("avari_csrf="))
        ?.slice(11);

      const path = resumeId ? `/api/v1/resumes/${resumeId}/versions` : "/api/v1/resumes";
      assertServerMutationAllowed();
      const res = await fetch(path, {
        method: "POST",
        headers: {
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        credentials: "include",
        body: formData,
      }).catch((error) => {
        requireLiveVerification();
        throw error;
      });

      if (!res.ok) {
        if ([401, 403].includes(res.status)) window.dispatchEvent(new Event("avari-session-expired"));
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Ошибка загрузки резюме");
      }

      setUploadModal({ isOpen: false });
      setUploadError(undefined);
      await refresh();
    } catch (e) {
      setUploadError(e);
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  };

  const handleRenameSubmit = async (id: string, newTitle: string) => {
    if (isSubmittingRef.current || busy) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setRenameError(undefined);
    try {
      await api(`/resumes/${id}`, "PUT", { title: newTitle.trim() });
      setRenameModal({ isOpen: false });
      setRenameError(undefined);
      await refresh();
    } catch (e) {
      setRenameError(e);
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.resume || isSubmittingRef.current || busy) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setDeleteError(undefined);
    try {
      if (deleteModal.version) {
        // Delete specific version
        await api(
          `/resumes/${deleteModal.resume.id}/versions/${deleteModal.version.id}`,
          "DELETE",
        );
      } else {
        // Delete entire resume
        await api(`/resumes/${deleteModal.resume.id}`, "DELETE");
      }
      setDeleteModal({ isOpen: false });
      setDeleteError(undefined);
      await refresh();
    } catch (e) {
      setDeleteError(e);
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="resume-manager">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Оригиналы резюме с версионностью. Поддерживаемые форматы: PDF, MD, TXT, DOCX, DOC, ODT, RTF до 20 МБ.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => setUploadModal({ isOpen: true })}
        >
          <Upload size={16} />
          Загрузить новое резюме
        </button>
      </div>

      <ErrorBox error={error || resumesQuery.error} />

      {resumes.length === 0 ? (
        <Empty title="Нет загруженных резюме">
          Здесь будут храниться ваши резюме и их версии для откликов на вакансии.
        </Empty>
      ) : (
        <div className="resume-manager-grid">
          {resumes.map((resume) => {
            const sortedVersions = [...(resume.versions ?? [])].sort(
              (a, b) => b.versionNumber - a.versionNumber,
            );
            return (
              <article key={resume.id} className="resume-card">
                <header className="resume-card-header">
                  <div className="resume-card-title-row">
                    <FileText size={20} className="primary-text" />
                    <span>{resume.title}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      className="text-button"
                      aria-label="Переименовать резюме"
                      onClick={() => setRenameModal({ isOpen: true, resume })}
                    >
                      <Pencil size={15} />
                      Переименовать
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setUploadModal({
                          isOpen: true,
                          resumeId: resume.id,
                          resumeTitle: resume.title,
                        })
                      }
                    >
                      <Plus size={15} />
                      Добавить версию
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      style={{ color: "#f87171" }}
                      aria-label="Удалить резюме"
                      onClick={() =>
                        setDeleteModal({ isOpen: true, resume })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </header>

                <div className="resume-versions-list">
                  {sortedVersions.map((v, idx) => (
                    <div key={v.id} className="resume-version-row">
                      <div className="resume-version-meta">
                        <span className="badge badge-saved">
                          v{v.versionNumber} {idx === 0 && "· текущая"}
                        </span>
                        <strong title={v.filename}>{v.filename}</strong>
                        <span className="muted">
                          {v.format.toUpperCase()} · {formatBytes(v.size)} · {dateLabel(v.createdAt)}
                        </span>
                      </div>
                      <div className="resume-version-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Скачать ${v.filename}`}
                          onClick={() => handleDownload(resume.id, v.id, v.filename)}
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-button text-button"
                          style={{ color: "#f87171" }}
                          aria-label={`Удалить версию v${v.versionNumber}`}
                          onClick={() =>
                            setDeleteModal({
                              isOpen: true,
                              resume,
                              version: v,
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Upload modal */}
      {uploadModal.isOpen && (
        <UploadResumeModal
          isOpen={uploadModal.isOpen}
          resumeId={uploadModal.resumeId}
          resumeTitle={uploadModal.resumeTitle}
          busy={busy}
          error={uploadError}
          onClose={() => {
            setUploadModal({ isOpen: false });
            setUploadError(undefined);
          }}
          onSubmit={handleUploadSubmit}
        />
      )}

      {/* Rename modal */}
      {renameModal.isOpen && renameModal.resume && (
        <RenameResumeModal
          isOpen={renameModal.isOpen}
          resume={renameModal.resume}
          busy={busy}
          error={renameError}
          onClose={() => {
            setRenameModal({ isOpen: false });
            setRenameError(undefined);
          }}
          onSubmit={(newTitle) => handleRenameSubmit(renameModal.resume!.id, newTitle)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteModal.isOpen && deleteModal.resume && (
        <Modal
          title={
            deleteModal.version
              ? `Удалить версию v${deleteModal.version.versionNumber}?`
              : `Удалить резюме «${deleteModal.resume.title}»?`
          }
          onClose={() => {
            setDeleteModal({ isOpen: false });
            setDeleteError(undefined);
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p className="muted" style={{ margin: 0 }}>
              {deleteModal.version
                ? `Вы уверены, что хотите удалить файл ${deleteModal.version.filename}? Это действие необратимо.`
                : "Будут удалены все загруженные версии этого резюме. Это действие нельзя отменить."}
            </p>
            <ErrorBox error={deleteError} />
            <div className="actions">
              <button
                type="button"
                className="primary"
                style={{ background: "#f87171", borderColor: "#f87171" }}
                disabled={busy}
                onClick={handleDeleteConfirm}
              >
                {busy ? "Удаление…" : "Удалить"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleteModal({ isOpen: false });
                  setDeleteError(undefined);
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UploadResumeModal({
  isOpen,
  resumeId,
  resumeTitle,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  resumeId?: string;
  resumeTitle?: string;
  busy: boolean;
  error?: unknown;
  onClose: () => void;
  onSubmit: (file: File, title: string, resumeId?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(resumeTitle ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState<unknown>();

  const selectFiles = (files: FileList | null) => {
    if (busy || !files?.length) return;
    setSelectionError(undefined);
    const selected = files[0];
    const ext = "." + (selected.name.split(".").pop() || "").toLowerCase();
    if (files.length !== 1) {
      setSelectionError(new Error("Выберите один файл резюме."));
      return;
    }
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setSelectionError(new Error("Неподдерживаемый формат. Выберите PDF, MD, TXT, DOCX, DOC, ODT или RTF."));
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setSelectionError(new Error("Файл превышает лимит 20 МБ."));
      return;
    }
    setFile(selected);
    if (!resumeId && (!title || title === file?.name.replace(/\.[^/.]+$/, ""))) {
      setTitle(selected.name.replace(/\.[^/.]+$/, ""));
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      title={resumeId ? `Добавить версию для «${resumeTitle}»` : "Загрузка нового резюме"}
      onClose={onClose}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return;
          onSubmit(file, title, resumeId);
        }}
      >
        <ErrorBox error={selectionError || error} />

        {!resumeId && (
          <FieldInput label="Название резюме (необязательно, по умолчанию имя файла)">
            <input
              type="text"
              value={title}
              disabled={busy}
              placeholder="Например: Go Backend Developer"
              onChange={(e) => setTitle(e.target.value)}
            />
          </FieldInput>
        )}

        <div className="resume-upload">
          <input
            className="resume-upload-input"
            type="file"
            ref={fileInputRef}
            aria-label="Выбрать файл резюме"
            accept={ALLOWED_EXTENSIONS.join(",")}
            disabled={busy}
            tabIndex={-1}
            onChange={(e) => {
              selectFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`resume-dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              if (busy || !e.dataTransfer.types.includes("Files")) return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = busy ? "none" : "copy";
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              selectFiles(e.dataTransfer.files);
            }}
          >
            <span className="resume-dropzone-icon" aria-hidden="true">
              {busy ? <LoaderCircle size={28} className="resume-upload-spinner" /> : file ? <FileCheck size={28} /> : <Upload size={28} />}
            </span>
            <strong>{busy ? "Загружаем резюме…" : dragging ? "Отпустите файл здесь" : file ? "Файл готов к загрузке" : "Перетащите резюме сюда"}</strong>
            <span className="muted">{file ? "Перетащите другой файл или нажмите, чтобы заменить" : "или нажмите, чтобы выбрать файл на устройстве"}</span>
            <span className="resume-dropzone-formats">PDF, MD, TXT, DOCX, DOC, ODT, RTF до 20 МБ</span>
          </button>
          {file && (
            <div className="resume-upload-file" role="status">
              <FileText size={22} aria-hidden="true" />
              <div>
                <strong title={file.name}>{file.name}</strong>
                <span className="muted">{formatBytes(file.size)} · {file.name.split(".").pop()?.toUpperCase()}</span>
              </div>
              <button
                type="button"
                className="icon-button text-button"
                aria-label="Убрать выбранный файл"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setSelectionError(undefined);
                  if (!resumeId && title === file.name.replace(/\.[^/.]+$/, "")) setTitle("");
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
        </div>

        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !file}>
            {busy ? "Загрузка…" : "Загрузить"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameResumeModal({
  isOpen,
  resume,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  resume: Resume;
  busy: boolean;
  error?: unknown;
  onClose: () => void;
  onSubmit: (newTitle: string) => void;
}) {
  const [title, setTitle] = useState(resume.title);
  if (!isOpen) return null;

  return (
    <Modal title="Переименовать резюме" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onSubmit(title);
        }}
      >
        <ErrorBox error={error} />
        <FieldInput label="Новое название резюме">
          <input
            type="text"
            required
            disabled={busy}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FieldInput>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}

