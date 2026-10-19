/**
 * React hooks for offline detection, opt-in settings, cache restore, and drafts.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { offlineManager } from "./manager";
import {
  saveDraft,
  getDraft,
  deleteDraft,
  getJournalSnapshot,
  getUserGeneration,
  type StoredDraft,
  type OfflineSettings,
} from "./db";
import {
  registerDraftHandler,
  hasDirtyDrafts,
  flushAllDrafts,
  type DraftKind,
} from "./drafts";

/**
 * Tracks browser online/offline status reactively.
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => offlineManager.isOnline());

  useEffect(() => {
    return offlineManager.subscribeOnline(setOnline);
  }, []);

  return online;
}

/**
 * Provides access to offline reading opt-in settings and toggle method.
 */
export function useOfflineSettings(currentUserKey?: string) {
  const [settings, setSettings] = useState<OfflineSettings>(() => offlineManager.getSettings());

  useEffect(() => {
    return offlineManager.subscribeSettings(setSettings);
  }, []);

  const setOptIn = useCallback(
    async (enabled: boolean) => {
      const updated = await offlineManager.setOptIn(enabled, currentUserKey);
      setSettings(updated);
      return updated;
    },
    [currentUserKey],
  );

  return {
    settings,
    optIn: settings.optIn && (!currentUserKey || settings.lastOptedInUserKey === currentUserKey),
    setOptIn,
  };
}

/**
 * Hook to restore cached data on cold start or offline load.
 * Injects snapshot into React Query client cache.
 * Catches all IDB failures gracefully.
 */
export function useOfflineHydration(client: QueryClient, userKey?: string) {
  const [hydrated, setHydrated] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      if (!userKey) {
        if (active) setHydrated(true);
        return;
      }

      try {
        await offlineManager.whenReady();
        const settings = offlineManager.getSettings();
        if (!settings.optIn || settings.lastOptedInUserKey !== userKey) {
          if (active) setHydrated(true);
          return;
        }

        const snapshot = await getJournalSnapshot(userKey);
        if (!active) return;

        if (snapshot) {
          setLastUpdated(snapshot.savedAt);
          // Populate react-query cache if empty
          const existingData = client.getQueryData(["data"]);
          if (!existingData) {
            client.setQueryData(["data"], {
              applications: snapshot.applications,
              tasks: snapshot.tasks,
              fields: snapshot.fields,
              proposals: snapshot.proposals,
            });
          }
        }
      } catch (err) {
        console.warn("[offline-hydration] Hydration failed gracefully:", err);
      } finally {
        if (active) {
          setHydrated(true);
        }
      }
    }

    hydrate();

    return () => {
      active = false;
    };
  }, [client, userKey]);

  return { hydrated, lastUpdated };
}

/**
 * Draft persistence hook for ApplicationForm, TaskForm, NoteForm.
 */
export interface UseFormDraftOptions<T> {
  userKey: string;
  kind: DraftKind;
  entityId?: string | null;
  initialValue: T;
  onDraftLoaded?: (draft: T) => void;
  debounceMs?: number;
}

export function useFormDraft<T extends Record<string, any>>({
  userKey,
  kind,
  entityId,
  initialValue,
  onDraftLoaded,
  debounceMs = 500,
}: UseFormDraftOptions<T>) {
  const [draft, setDraftState] = useState<T>(initialValue);
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const [storedDraftData, setStoredDraftData] = useState<T | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const draftRef = useRef<T>(draft);
  draftRef.current = draft;

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const timerRef = useRef<any>(null);

  // Check IndexedDB for existing draft on mount
  useEffect(() => {
    let active = true;
    async function checkExisting() {
      if (!userKey) return;
      try {
        const existing = await getDraft(userKey, kind, entityId || "new");
        if (!active) return;
        if (existing && existing.data) {
          setHasStoredDraft(true);
          setStoredDraftData(existing.data as T);
        }
      } catch (err) {
        console.warn("[offline-draft] Failed checking existing draft:", err);
      }
    }
    checkExisting();
    return () => {
      active = false;
    };
  }, [userKey, kind, entityId]);

  const [restoreRevision, setRestoreRevision] = useState(0);

  // Capture session epoch on form mount; does not silently acquire future generations
  const initialEpochRef = useRef<number>(getUserGeneration(userKey));

  // Flush implementation (strict: throws on quota or abort so PWA update / caller knows)
  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (userKey && isDirtyRef.current) {
      const epoch = initialEpochRef.current;
      await saveDraft(userKey, kind, entityId || "new", draftRef.current, epoch, {
        throwOnError: true,
      });
    }
  }, [userKey, kind, entityId]);

  // Clear draft implementation
  const clear = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsDirty(false);
    setHasStoredDraft(false);
    setStoredDraftData(null);
    if (userKey) {
      await deleteDraft(userKey, kind, entityId || "new");
    }
  }, [userKey, kind, entityId]);

  // Register in global registry for flushAllDrafts / hasDirtyDrafts
  useEffect(() => {
    if (!userKey) return;
    const unregister = registerDraftHandler(userKey, kind, entityId || "new", {
      flush,
      isDirty: () => isDirtyRef.current,
      clear,
      cancelTimer: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      },
    });
    return () => {
      unregister();
    };
  }, [userKey, kind, entityId, flush, clear]);

  // Update draft with auto-save debounce
  // Note: Only saves when actually modified (isDirty) so mounting does not overwrite stored draft
  // Nonfatal autosave errors are caught and logged without crashing the background timer
  const updateDraft = useCallback(
    (nextOrFn: T | ((prev: T) => T)) => {
      const next =
        typeof nextOrFn === "function"
          ? (nextOrFn as (prev: T) => T)(draftRef.current)
          : nextOrFn;
      draftRef.current = next;
      setDraftState(next);
      setIsDirty(true);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        if (userKey) {
          try {
            const epoch = initialEpochRef.current;
            await saveDraft(userKey, kind, entityId || "new", next, epoch);
          } catch (err) {
            console.warn("[offline-draft] Autosave nonfatal error:", err);
          }
        }
      }, debounceMs);
    },
    [userKey, kind, entityId, debounceMs],
  );

  // Restore stored draft
  const restoreDraft = useCallback(() => {
    if (storedDraftData) {
      setDraftState(storedDraftData);
      draftRef.current = storedDraftData;
      setIsDirty(true);
      setHasStoredDraft(false);
      setRestoreRevision((r) => r + 1);
      onDraftLoaded?.(storedDraftData);
    }
  }, [storedDraftData, onDraftLoaded]);

  // Discard stored draft prompt
  const discardStoredDraft = useCallback(async () => {
    setRestoreRevision((r) => r + 1);
    await clear();
  }, [clear]);

  return {
    draft,
    setDraft: updateDraft,
    isDirty,
    hasStoredDraft,
    storedDraftData,
    restoreDraft,
    discardStoredDraft,
    restoreRevision,
    flush,
    clear,
  };
}
