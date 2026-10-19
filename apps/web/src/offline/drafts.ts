/**
 * Draft management registry and coordinator.
 * Supports:
 * - Standalone draft persistence across page reload and close.
 * - Auto-save with debounce.
 * - Synchronous/awaitable flush before application updates or tab close.
 * - Dirty state checking across all active forms.
 * - Multi-tab notifications without destructive forced reloads.
 */

import {
  saveDraft,
  getDraft,
  deleteDraft,
  getAllUserDrafts,
  getUserGeneration,
  type StoredDraft,
} from "./db";
import { offlineBroadcast } from "./broadcast";

export type DraftKind = "application" | "task" | "note";

export interface ActiveDraftHandler {
  flush: () => Promise<void>;
  isDirty: () => boolean;
  clear: () => Promise<void>;
  cancelTimer?: () => void;
}

// Global active draft registrations (in-memory for current tab)
const activeHandlers = new Map<string, ActiveDraftHandler>();

export function registerDraftHandler(
  userKey: string,
  kind: DraftKind,
  entityId: string | null | undefined,
  handler: ActiveDraftHandler,
): () => void {
  const key = `${userKey}:${kind}:${entityId || "new"}`;
  activeHandlers.set(key, handler);
  return () => {
    activeHandlers.delete(key);
  };
}

/**
 * Cancels all pending debounced draft autosave timers across registered forms.
 * Used when session is revoked or on logout.
 */
export function cancelAllDraftTimers(): void {
  for (const handler of activeHandlers.values()) {
    try {
      handler.cancelTimer?.();
    } catch {}
  }
}

/**
 * Checks if any registered form in the current tab has unsaved/dirty changes.
 */
export function hasDirtyDrafts(): boolean {
  for (const handler of activeHandlers.values()) {
    try {
      if (handler.isDirty()) return true;
    } catch {}
  }
  return false;
}

/**
 * Awaitable flush of all registered active forms in current tab.
 * Called before PWA updates or navigation.
 * Propagates errors (e.g. quota/abort) so callers like PWA update can fail-closed and abort SKIP_WAITING.
 */
export async function flushAllDrafts(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const handler of activeHandlers.values()) {
    promises.push(handler.flush());
  }
  await Promise.all(promises);
}

/**
 * Saves a draft directly and notifies tabs.
 */
export async function persistDraft(
  userKey: string,
  kind: DraftKind,
  entityId: string | null | undefined,
  data: any,
): Promise<void> {
  const safeId = entityId || "new";
  const gen = getUserGeneration(userKey);
  await saveDraft(userKey, kind, safeId, data, gen, { throwOnError: true });
  offlineBroadcast.post({
    type: "DRAFT_UPDATED",
    userKey,
    kind,
    entityId: safeId,
    timestamp: Date.now(),
  });
}

/**
 * Removes a draft after successful submit or discard.
 */
export async function discardDraft(
  userKey: string,
  kind: DraftKind,
  entityId: string | null | undefined,
): Promise<void> {
  const safeId = entityId || "new";
  await deleteDraft(userKey, kind, safeId);
  offlineBroadcast.post({
    type: "DRAFT_CLEARED",
    userKey,
    kind,
    entityId: safeId,
  });
}

/**
 * Retrieves a stored draft if any.
 */
export async function loadDraft<T = any>(
  userKey: string,
  kind: DraftKind,
  entityId?: string | null,
): Promise<T | null> {
  const stored = await getDraft(userKey, kind, entityId || "new");
  return stored ? (stored.data as T) : null;
}

export async function listDrafts(userKey: string): Promise<StoredDraft[]> {
  return await getAllUserDrafts(userKey);
}
