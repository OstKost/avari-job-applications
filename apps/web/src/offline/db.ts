/**
 * Native IndexedDB wrapper for Avari.Jobs offline support.
 * Namespaces storage by origin, user ID, and schema version.
 * Zero external runtime dependencies.
 */

import type { User } from "@avari/shared";

export const OFFLINE_DB_NAME = "avari_offline_v1";
export const OFFLINE_DB_VERSION = 1;

export const STORE_SETTINGS = "settings";
export const STORE_USER = "user";
export const STORE_JOURNAL = "journal";
export const STORE_DETAILS = "details";
export const STORE_DRAFTS = "drafts";

export interface StoredJournalSnapshot {
  userKey: string;
  generation: number;
  applications: any[];
  tasks: any[];
  fields: any[];
  proposals: any[];
  savedAt: number;
}

export interface StoredDetailSnapshot {
  /** Composite key: `${userKey}:${applicationId}` */
  id: string;
  userKey: string;
  applicationId: string;
  generation: number;
  detail: any;
  savedAt: number;
}

export interface StoredDraft {
  /** Composite key: `${userKey}:${kind}:${entityId || 'new'}` */
  id: string;
  userKey: string;
  kind: "application" | "task" | "note";
  entityId: string; // "new" or specific ID
  generation: number;
  data: any;
  updatedAt: number;
}

export interface StoredUserMetadata {
  userKey: string;
  id: string;
  email: string;
  status: "pending" | "active" | "blocked";
  timezone: string;
  createdAt: string;
  savedAt: number;
}

export interface OfflineSettings {
  optIn: boolean;
  lastOptedInUserKey: string | null;
  lastActiveTabId?: string;
  updatedAt: number;
}

export interface StoredSessionState {
  key: string; // `session_state:${userKey}`
  userKey: string;
  epoch: number;
  revoked: boolean;
  active: boolean;
  updatedAt: number;
}

const DEFAULT_SETTINGS: OfflineSettings = {
  optIn: false,
  lastOptedInUserKey: null,
  updatedAt: 0,
};

let dbPromise: Promise<IDBDatabase> | null = null;

// Track active generation per user in-memory to discard stale in-flight writes
const userGenerations = new Map<string, number>();

export function getUserGeneration(userKey: string): number {
  return userGenerations.get(userKey) ?? 0;
}

export function bumpUserGeneration(userKey: string): number {
  const next = (userGenerations.get(userKey) ?? 0) + 1;
  userGenerations.set(userKey, next);
  return next;
}

export function resetAllGenerations(): void {
  for (const k of userGenerations.keys()) {
    userGenerations.set(k, (userGenerations.get(k) ?? 0) + 1);
  }
}

export function makeSessionStateKey(userKey: string): string {
  return `session_state:${userKey}`;
}

export async function getSessionState(userKey: string): Promise<StoredSessionState | null> {
  if (!isIndexedDBAvailable() || !userKey) return null;
  try {
    const db = await openOfflineDB();
    return await new Promise<StoredSessionState | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_SETTINGS, "readonly");
        const req = tx.objectStore(STORE_SETTINGS).get(makeSessionStateKey(userKey));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// Read an existing authenticated epoch without activating a cached/offline session.
// Called before mounting offline forms; mounted forms never adopt a newer epoch.
export async function restoreSessionGeneration(userKey: string): Promise<boolean> {
  const state = await getSessionState(userKey);
  if (state?.revoked) return false;
  if (state) userGenerations.set(userKey, state.epoch);
  return true;
}

export async function initOrActivateSession(userKey: string, stillCurrent: () => boolean = () => true): Promise<number> {
  if (!isIndexedDBAvailable() || !userKey) return 1;
  try {
    const db = await openOfflineDB();
    return await new Promise<number>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_SETTINGS, "readwrite");
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.get(makeSessionStateKey(userKey));
        let computedEpoch = 1;
        req.onsuccess = () => {
          if (!stillCurrent()) { tx.abort(); return; }
          const existing = req.result as StoredSessionState | undefined;
          const currentEpoch = existing?.epoch ?? 1;
          computedEpoch = existing?.revoked ? currentEpoch + 1 : currentEpoch;
          const record: StoredSessionState = {
            key: makeSessionStateKey(userKey),
            userKey,
            epoch: computedEpoch,
            revoked: false,
            active: true,
            updatedAt: Date.now(),
          };
          store.put(record);
        };
        tx.oncomplete = () => {
          userGenerations.set(userKey, computedEpoch);
          resolve(computedEpoch);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Session transaction aborted"));
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    throw e;
  }
}

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

export function openOfflineDB(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains(STORE_USER)) {
          db.createObjectStore(STORE_USER, { keyPath: "userKey" });
        }

        if (!db.objectStoreNames.contains(STORE_JOURNAL)) {
          db.createObjectStore(STORE_JOURNAL, { keyPath: "userKey" });
        }

        if (!db.objectStoreNames.contains(STORE_DETAILS)) {
          const detailStore = db.createObjectStore(STORE_DETAILS, { keyPath: "id" });
          detailStore.createIndex("by_user", "userKey", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          const draftStore = db.createObjectStore(STORE_DRAFTS, { keyPath: "id" });
          draftStore.createIndex("by_user", "userKey", { unique: false });
          draftStore.createIndex("by_user_kind", ["userKey", "kind"], { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open IndexedDB"));
      };

      request.onblocked = () => {
        console.warn("[offline-db] Database open blocked by another open connection");
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });

  return dbPromise;
}

export function closeOfflineDB(): void {
  if (dbPromise) {
    dbPromise.then(
      (db) => {
        try {
          db.close();
        } catch {}
      },
      () => {},
    );
    dbPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getOfflineSettings(): Promise<OfflineSettings> {
  if (!isIndexedDBAvailable()) return { ...DEFAULT_SETTINGS };
  try {
    const db = await openOfflineDB();
    return await new Promise<OfflineSettings>((resolve) => {
      try {
        const tx = db.transaction(STORE_SETTINGS, "readonly");
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.get("offline_settings");
        req.onsuccess = () => {
          if (req.result && req.result.value) {
            resolve({ ...DEFAULT_SETTINGS, ...req.result.value });
          } else {
            resolve({ ...DEFAULT_SETTINGS });
          }
        };
        req.onerror = () => resolve({ ...DEFAULT_SETTINGS });
      } catch {
        resolve({ ...DEFAULT_SETTINGS });
      }
    });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveOfflineSettings(settings: Partial<OfflineSettings>): Promise<OfflineSettings> {
  if (!isIndexedDBAvailable()) return { ...DEFAULT_SETTINGS, ...settings };
  try {
    const current = await getOfflineSettings();
    const merged: OfflineSettings = {
      ...current,
      ...settings,
      updatedAt: Date.now(),
    };
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_SETTINGS, "readwrite");
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.put({ key: "offline_settings", value: merged });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
    return merged;
  } catch (e) {
    console.warn("[offline-db] Failed to save offline settings:", e);
    return { ...DEFAULT_SETTINGS, ...settings };
  }
}

// ---------------------------------------------------------------------------
// User Metadata Cache (Opt-in only, no passwords/tokens)
// ---------------------------------------------------------------------------

export async function saveCachedUser(userKey: string, user: User, writeGen?: number): Promise<void> {
  if (!isIndexedDBAvailable() || !userKey) return;
  const currentGen = getUserGeneration(userKey);
  writeGen ??= currentGen;
  if (writeGen !== currentGen) {
    return; // Write discarded because generation was bumped (e.g. logout)
  }
  try {
    const db = await openOfflineDB();
    const record: StoredUserMetadata = {
      userKey,
      id: user.id,
      email: user.email,
      status: user.status,
      timezone: user.timezone,
      createdAt: user.createdAt,
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction([STORE_USER, STORE_SETTINGS], "readwrite");
        const settingsStore = tx.objectStore(STORE_SETTINGS);
        const checkReq = settingsStore.get(makeSessionStateKey(userKey));
        checkReq.onsuccess = () => {
          const session = checkReq.result as StoredSessionState | undefined;
          if (session && (session.revoked || writeGen !== session.epoch)) {
            try { tx.abort(); } catch {}
            resolve();
            return;
          }
          const req = tx.objectStore(STORE_USER).put(record);
          req.onerror = () => reject(req.error);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => resolve();
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    console.warn("[offline-db] Failed to cache user metadata:", e);
  }
}

export async function getCachedUser(userKey: string): Promise<StoredUserMetadata | null> {
  if (!isIndexedDBAvailable() || !userKey) return null;
  try {
    const db = await openOfflineDB();
    return await new Promise<StoredUserMetadata | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_USER, "readonly");
        const req = tx.objectStore(STORE_USER).get(userKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Journal Snapshot Cache
// ---------------------------------------------------------------------------

export async function saveJournalSnapshot(
  userKey: string,
  data: {
    applications?: any[];
    tasks?: any[];
    fields?: any[];
    proposals?: any[];
  },
  writeGen?: number,
): Promise<void> {
  if (!isIndexedDBAvailable() || !userKey) return;
  const currentGen = getUserGeneration(userKey);
  writeGen ??= currentGen;
  if (writeGen !== currentGen) {
    return; // Write discarded
  }
  try {
    const db = await openOfflineDB();
    const sanitizedApplications = (data.applications || []).map((app) => {
      if (!app) return app;
      const copy = { ...app };
      if ("resumeFile" in copy) delete copy.resumeFile;
      if ("resumeContent" in copy) delete copy.resumeContent;
      return copy;
    });

    const record: StoredJournalSnapshot = {
      userKey,
      generation: writeGen ?? currentGen,
      applications: sanitizedApplications,
      tasks: data.tasks || [],
      fields: data.fields || [],
      proposals: data.proposals || [],
      savedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction([STORE_JOURNAL, STORE_SETTINGS], "readwrite");
        const settingsStore = tx.objectStore(STORE_SETTINGS);
        const checkReq = settingsStore.get(makeSessionStateKey(userKey));
        checkReq.onsuccess = () => {
          const session = checkReq.result as StoredSessionState | undefined;
          if (session && (session.revoked || writeGen !== session.epoch)) {
            // Stale session from another tab's logout
            try { tx.abort(); } catch {}
            resolve();
            return;
          }
          const req = tx.objectStore(STORE_JOURNAL).put(record);
          req.onerror = () => reject(req.error);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => resolve();
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    console.warn("[offline-db] Failed to save journal snapshot:", e);
  }
}

export async function getJournalSnapshot(userKey: string): Promise<StoredJournalSnapshot | null> {
  if (!isIndexedDBAvailable() || !userKey) return null;
  try {
    const db = await openOfflineDB();
    return await new Promise<StoredJournalSnapshot | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_JOURNAL, "readonly");
        const req = tx.objectStore(STORE_JOURNAL).get(userKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Application Details Snapshot Cache
// ---------------------------------------------------------------------------

export async function saveDetailSnapshot(
  userKey: string,
  applicationId: string,
  detail: any,
  writeGen?: number,
): Promise<void> {
  if (!isIndexedDBAvailable() || !userKey || !applicationId || !detail) return;
  const currentGen = getUserGeneration(userKey);
  writeGen ??= currentGen;
  if (writeGen !== currentGen) {
    return; // Discard write
  }
  try {
    const db = await openOfflineDB();
    const id = `${userKey}:${applicationId}`;
    const record: StoredDetailSnapshot = {
      id,
      userKey,
      applicationId,
      generation: writeGen ?? currentGen,
      detail,
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction([STORE_DETAILS, STORE_SETTINGS], "readwrite");
        const settingsStore = tx.objectStore(STORE_SETTINGS);
        const checkReq = settingsStore.get(makeSessionStateKey(userKey));
        checkReq.onsuccess = () => {
          const session = checkReq.result as StoredSessionState | undefined;
          if (session && (session.revoked || writeGen !== session.epoch)) {
            try { tx.abort(); } catch {}
            resolve();
            return;
          }
          const req = tx.objectStore(STORE_DETAILS).put(record);
          req.onerror = () => reject(req.error);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => resolve();
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    console.warn("[offline-db] Failed to save detail snapshot:", e);
  }
}

export async function getDetailSnapshot(userKey: string, applicationId: string): Promise<StoredDetailSnapshot | null> {
  if (!isIndexedDBAvailable() || !userKey || !applicationId) return null;
  try {
    const db = await openOfflineDB();
    const id = `${userKey}:${applicationId}`;
    return await new Promise<StoredDetailSnapshot | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_DETAILS, "readonly");
        const req = tx.objectStore(STORE_DETAILS).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drafts Storage (Independent of opt-in, per-user scoped)
// ---------------------------------------------------------------------------

export function makeDraftId(userKey: string, kind: string, entityId?: string | null): string {
  return `${userKey}:${kind}:${entityId || "new"}`;
}

export interface SaveDraftOptions {
  throwOnError?: boolean;
}

export async function saveDraft(
  userKey: string,
  kind: "application" | "task" | "note",
  entityId: string | null | undefined,
  data: any,
  writeGen?: number,
  options?: SaveDraftOptions,
): Promise<void> {
  if (!userKey) return;
  if (!isIndexedDBAvailable()) {
    if (options?.throwOnError) {
      throw new Error("IndexedDB is not available for saving draft");
    }
    return;
  }
  const currentGen = getUserGeneration(userKey);
  writeGen ??= currentGen;
  if (writeGen !== currentGen) {
    if (options?.throwOnError) {
      throw new Error("Draft write generation is stale");
    }
    return; // Discard write
  }
  try {
    const db = await openOfflineDB();
    const safeEntityId = entityId || "new";
    const id = makeDraftId(userKey, kind, safeEntityId);
    const record: StoredDraft = {
      id,
      userKey,
      kind,
      entityId: safeEntityId,
      generation: writeGen ?? currentGen,
      data,
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      let abortedDueToStaleSession = false;
      try {
        const tx = db.transaction([STORE_DRAFTS, STORE_SETTINGS], "readwrite");
        const settingsStore = tx.objectStore(STORE_SETTINGS);
        const checkReq = settingsStore.get(makeSessionStateKey(userKey));
        checkReq.onsuccess = () => {
          const session = checkReq.result as StoredSessionState | undefined;
          if (session && (session.revoked || writeGen !== session.epoch)) {
            // Session was revoked in another tab or epoch bumped, abort save
            abortedDueToStaleSession = true;
            try { tx.abort(); } catch {}
            return;
          }
          const req = tx.objectStore(STORE_DRAFTS).put(record);
          req.onerror = () => reject(req.error);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => {
          if (abortedDueToStaleSession && !options?.throwOnError) {
            resolve();
          } else {
            reject(new Error("Draft transaction aborted" + (abortedDueToStaleSession ? " (stale session)" : "")));
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    if (options?.throwOnError) {
      throw e;
    }
    throw e;
  }
}

export async function getDraft(
  userKey: string,
  kind: "application" | "task" | "note",
  entityId?: string | null,
): Promise<StoredDraft | null> {
  if (!isIndexedDBAvailable() || !userKey) return null;
  try {
    const db = await openOfflineDB();
    const id = makeDraftId(userKey, kind, entityId || "new");
    return await new Promise<StoredDraft | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_DRAFTS, "readonly");
        const req = tx.objectStore(STORE_DRAFTS).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export async function deleteDraft(
  userKey: string,
  kind: "application" | "task" | "note",
  entityId?: string | null,
): Promise<void> {
  if (!isIndexedDBAvailable() || !userKey) return;
  try {
    const db = await openOfflineDB();
    const id = makeDraftId(userKey, kind, entityId || "new");
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_DRAFTS, "readwrite");
        const req = tx.objectStore(STORE_DRAFTS).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    console.warn("[offline-db] Failed to delete draft:", e);
  }
}

export async function getAllUserDrafts(userKey: string): Promise<StoredDraft[]> {
  if (!isIndexedDBAvailable() || !userKey) return [];
  try {
    const db = await openOfflineDB();
    return await new Promise<StoredDraft[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_DRAFTS, "readonly");
        const index = tx.objectStore(STORE_DRAFTS).index("by_user");
        const req = index.getAll(userKey);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Clearing Data (Logout / 401 / 403 / Account Switch / Disable Opt-in)
// ---------------------------------------------------------------------------

/**
 * Clears cached data.
 * When clearDrafts=true (e.g. on logout/401/403), drafts are completely purged.
 * Atomically updates persistent session epoch and revokes active state so
 * concurrent or delayed writes from other tabs cannot resurrect data.
 */
export async function clearOfflineCache(userKey?: string, clearDrafts = true): Promise<void> {
  if (clearDrafts) {
    if (userKey) {
      bumpUserGeneration(userKey);
    } else {
      resetAllGenerations();
    }
  }

  if (!isIndexedDBAvailable()) return;
  try {
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      try {
        const stores = [STORE_USER, STORE_JOURNAL, STORE_DETAILS, STORE_SETTINGS];
        if (clearDrafts) stores.push(STORE_DRAFTS);
        const tx = db.transaction(stores, "readwrite");
        const settingsStore = tx.objectStore(STORE_SETTINGS);

        if (!userKey) {
          // Clear all entries across data stores
          for (const s of [STORE_USER, STORE_JOURNAL, STORE_DETAILS]) {
            tx.objectStore(s).clear();
          }
          if (clearDrafts) {
            tx.objectStore(STORE_DRAFTS).clear();
            // Scan session states in settings and mark revoked
            const cursorReq = settingsStore.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor) {
                const val = cursor.value;
                if (val && typeof val.key === "string" && val.key.startsWith("session_state:")) {
                  cursor.update({
                    ...val,
                    epoch: (val.epoch || 1) + 1,
                    revoked: true,
                    active: false,
                    updatedAt: Date.now(),
                  });
                }
                cursor.continue();
              }
            };
          }
        } else {
          // If clearDrafts is true (logout / session expiry), invalidate/revoke session state
          // for this userKey in the same transaction so late writes from old session are rejected.
          // If clearDrafts is false (user simply toggled off read cache opt-in), preserve active session!
          if (clearDrafts) {
            const sessionKey = makeSessionStateKey(userKey);
            const stateReq = settingsStore.get(sessionKey);
            stateReq.onsuccess = () => {
              const current = stateReq.result as StoredSessionState | undefined;
              const nextEpoch = (current?.epoch ?? (userGenerations.get(userKey) ?? 1)) + 1;
              userGenerations.set(userKey, nextEpoch);
              settingsStore.put({
                key: sessionKey,
                userKey,
                epoch: nextEpoch,
                revoked: true,
                active: false,
                updatedAt: Date.now(),
              });
            };
          }

          // Delete specific user's entries
          tx.objectStore(STORE_USER).delete(userKey);
          tx.objectStore(STORE_JOURNAL).delete(userKey);

          // Details index scan
          const detailStore = tx.objectStore(STORE_DETAILS);
          const detailIndex = detailStore.index("by_user");
          const detailReq = detailIndex.openCursor(IDBKeyRange.only(userKey));
          detailReq.onsuccess = () => {
            const cursor = detailReq.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };

          if (clearDrafts) {
            const draftStore = tx.objectStore(STORE_DRAFTS);
            const draftIndex = draftStore.index("by_user");
            const draftReq = draftIndex.openCursor(IDBKeyRange.only(userKey));
            draftReq.onsuccess = () => {
              const cursor = draftReq.result;
              if (cursor) {
                cursor.delete();
                cursor.continue();
              }
            };
          }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    console.warn("[offline-db] Failed to clear offline cache:", e);
  }
}
