/**
 * Adapters for connecting ApplicationForm, TaskForm, and NoteForm to offline drafts.
 */

import React from "react";
import { assertServerMutationAllowed } from "./policy";
import type { Application, Task, Note, Transport, Field } from "@avari/shared";
import { ApplicationForm, TaskForm, NoteForm } from "@avari/shared/ui";
import { useFormDraft } from "./hooks";

export interface OfflineApplicationFormProps {
  userKey: string;
  initial: Application;
  fields: Field[];
  api: Transport;
  onSaved: (a: Application) => void;
  onCancel: () => void;
  groupOptions?: string[];
  tagOptions?: string[];
  actionsAtTop?: boolean;
  onBack?: () => void;
  title?: React.ReactNode;
  autofill?: boolean;
  clipboardText?: Promise<string>;
}

export function OfflineApplicationForm({
  userKey,
  initial,
  fields,
  api,
  onSaved,
  onCancel,
  groupOptions,
  tagOptions,
  actionsAtTop,
  onBack,
  title,
  autofill,
  clipboardText,
}: OfflineApplicationFormProps) {
  const entityId = initial.id || "new";
  const {
    draft,
    setDraft,
    hasStoredDraft,
    restoreDraft,
    discardStoredDraft,
    restoreRevision,
    clear,
  } = useFormDraft<Application>({
    userKey,
    kind: "application",
    entityId,
    initialValue: initial,
  });

  const wrappedApi: Transport = React.useMemo(() => {
    return async <T,>(path: string, method?: string, body?: unknown, requestKey?: string): Promise<T> => {
      const upperMethod = (method || "GET").toUpperCase();
      if (upperMethod !== "GET") assertServerMutationAllowed();
      return api<T>(path, method, body, requestKey);
    };
  }, [api]);

  const handleSaved = async (savedApp: Application) => {
    await clear();
    onSaved(savedApp);
  };

  const handleCancel = async () => {
    // Keep draft so user doesn't lose data on accidental close
    onCancel();
  };

  return (
    <ApplicationForm
      key={`${entityId}:${restoreRevision}`}
      initial={draft}
      fields={fields}
      api={wrappedApi}
      onSaved={handleSaved}
      onCancel={handleCancel}
      onDraftChange={(updated) => {
        // Only trigger draft changes after user interacts; does not overwrite un-restored draft
        setDraft(updated);
      }}
      draftAdapter={{
        hasStoredDraft,
        onRestore: restoreDraft,
        onDiscard: discardStoredDraft,
      }}
      groupOptions={groupOptions}
      tagOptions={tagOptions}
      actionsAtTop={actionsAtTop}
      onBack={onBack}
      title={title}
      autofill={autofill}
      clipboardText={clipboardText}
    />
  );
}

export interface OfflineTaskFormProps {
  userKey: string;
  initial: Partial<Task>;
  applications: Application[];
  api: Transport;
  onSaved: () => void;
  onCancel: () => void;
}

export function OfflineTaskForm({
  userKey,
  initial,
  applications,
  api,
  onSaved,
  onCancel,
}: OfflineTaskFormProps) {
  const entityId = initial.id || "new";
  const {
    draft,
    setDraft,
    hasStoredDraft,
    restoreDraft,
    discardStoredDraft,
    restoreRevision,
    clear,
  } = useFormDraft<Partial<Task>>({
    userKey,
    kind: "task",
    entityId,
    initialValue: initial,
  });

  const wrappedApi: Transport = React.useMemo(() => {
    return async <T,>(path: string, method?: string, body?: unknown, requestKey?: string): Promise<T> => {
      const upperMethod = (method || "GET").toUpperCase();
      if (upperMethod !== "GET") assertServerMutationAllowed();
      return api<T>(path, method, body, requestKey);
    };
  }, [api]);

  const handleSaved = async () => {
    await clear();
    onSaved();
  };

  return (
    <TaskForm
      key={`${entityId}:${restoreRevision}`}
      initial={draft}
      applications={applications}
      api={wrappedApi}
      onSaved={handleSaved}
      onCancel={onCancel}
      onDraftChange={(updated) => {
        setDraft(updated);
      }}
      draftAdapter={{
        hasStoredDraft,
        onRestore: restoreDraft,
        onDiscard: discardStoredDraft,
      }}
    />
  );
}

export interface OfflineNoteFormProps {
  userKey: string;
  applicationId: string;
  initial?: Note;
  api: Transport;
  onSaved: (n: Note) => void;
  onCancel: () => void;
}

export function OfflineNoteForm({
  userKey,
  applicationId,
  initial,
  api,
  onSaved,
  onCancel,
}: OfflineNoteFormProps) {
  const entityId = initial?.id ? `${applicationId}:${initial.id}` : `${applicationId}:new`;
  const {
    draft,
    setDraft,
    hasStoredDraft,
    restoreDraft,
    discardStoredDraft,
    restoreRevision,
    clear,
  } = useFormDraft<{ text: string }>({
    userKey,
    kind: "note",
    entityId,
    initialValue: { text: initial?.text || "" },
  });

  const wrappedApi: Transport = React.useMemo(() => {
    return async <T,>(path: string, method?: string, body?: unknown, requestKey?: string): Promise<T> => {
      const upperMethod = (method || "GET").toUpperCase();
      if (upperMethod !== "GET") assertServerMutationAllowed();
      return api<T>(path, method, body, requestKey);
    };
  }, [api]);

  const handleSaved = async (savedNote: Note) => {
    await clear();
    onSaved(savedNote);
  };

  return (
    <NoteForm
      key={`${entityId}:${restoreRevision}`}
      applicationId={applicationId}
      initial={initial}
      draftText={draft.text}
      api={wrappedApi}
      onSaved={handleSaved}
      onCancel={onCancel}
      onDraftChange={(text) => {
        setDraft({ text });
      }}
      draftAdapter={{
        hasStoredDraft,
        onRestore: restoreDraft,
        onDiscard: discardStoredDraft,
      }}
    />
  );
}
