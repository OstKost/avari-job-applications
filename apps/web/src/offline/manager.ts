/**
 * High-level Offline Manager coordinating IndexedDB, BroadcastChannel, and React Query cache.
 */

import type { User } from "@avari/shared";
import {
  getOfflineSettings,
  saveOfflineSettings,
  saveCachedUser,
  getCachedUser,
  saveJournalSnapshot,
  getJournalSnapshot,
  saveDetailSnapshot,
  getDetailSnapshot,
  clearOfflineCache,
  getUserGeneration,
  restoreSessionGeneration,
  type OfflineSettings,
  type StoredJournalSnapshot,
  type StoredDetailSnapshot,
  type StoredUserMetadata,
} from "./db";
import { offlineBroadcast } from "./broadcast";

export class OfflineManager {
  private static instance: OfflineManager | null = null;
  private currentSettings: OfflineSettings = {
    optIn: false,
    lastOptedInUserKey: null,
    updatedAt: 0,
  };
  private isOnlineState = typeof navigator !== "undefined" ? navigator.onLine : true;
  private onlineListeners = new Set<(online: boolean) => void>();
  private settingsListeners = new Set<(settings: OfflineSettings) => void>();
  private unsubBroadcast: (() => void) | null = null;
  private readyPromise: Promise<void>;

  private constructor() {
    this.readyPromise = this.init();
  }

  public static getInstance(): OfflineManager {
    if (!OfflineManager.instance) {
      OfflineManager.instance = new OfflineManager();
    }
    return OfflineManager.instance;
  }

  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  private async init(): Promise<void> {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }

    try {
      this.currentSettings = await getOfflineSettings();
      this.notifySettings();
    } catch (err) {
      console.warn("[offline-manager] Failed to load offline settings during init:", err);
    }

    this.unsubBroadcast = offlineBroadcast.subscribe((msg) => {
      if (msg.type === "SETTINGS_CHANGED") {
        this.currentSettings = {
          optIn: msg.optIn,
          lastOptedInUserKey: msg.userKey,
          updatedAt: Date.now(),
        };
        this.notifySettings();
      }
    });
  }

  private handleOnline = () => {
    this.isOnlineState = true;
    this.onlineListeners.forEach((fn) => fn(true));
  };

  private handleOffline = () => {
    this.isOnlineState = false;
    this.onlineListeners.forEach((fn) => fn(false));
  };

  public isOnline(): boolean {
    if (typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return this.isOnlineState;
  }

  public subscribeOnline(fn: (online: boolean) => void): () => void {
    this.onlineListeners.add(fn);
    return () => this.onlineListeners.delete(fn);
  }

  public subscribeSettings(fn: (settings: OfflineSettings) => void): () => void {
    this.settingsListeners.add(fn);
    return () => this.settingsListeners.delete(fn);
  }

  private notifySettings(): void {
    this.settingsListeners.forEach((fn) => fn(this.currentSettings));
  }

  public getSettings(): OfflineSettings {
    return this.currentSettings;
  }

  public async setOptIn(enabled: boolean, currentUserKey?: string): Promise<OfflineSettings> {
    await this.whenReady();
    const userKeyToSave = enabled
      ? (currentUserKey || this.currentSettings.lastOptedInUserKey)
      : null;

    const updated = await saveOfflineSettings({
      optIn: enabled,
      lastOptedInUserKey: userKeyToSave,
    });
    this.currentSettings = updated;
    this.notifySettings();

    // If disabled, immediately clear cached data for all users
    if (!enabled) {
      await clearOfflineCache(undefined, false);
      offlineBroadcast.post({
        type: "CACHE_CLEARED",
      });
    }

    offlineBroadcast.post({
      type: "SETTINGS_CHANGED",
      optIn: enabled,
      userKey: userKeyToSave,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Snapshot sync helpers (Opt-in strictly checked per userKey)
  // -------------------------------------------------------------------------

  public async recordSuccessfulFetch(userKey: string, user: User, journalData: {
    applications?: any[];
    tasks?: any[];
    fields?: any[];
    proposals?: any[];
  }, writeGen = getUserGeneration(userKey)): Promise<void> {
    await this.whenReady();
    if (!userKey) return;
    // Account isolation: opt-in consent MUST match userKey
    if (!this.currentSettings.optIn || this.currentSettings.lastOptedInUserKey !== userKey) {
      return;
    }
    try {
      await saveCachedUser(userKey, user, writeGen);
      await saveJournalSnapshot(userKey, journalData, writeGen);
    } catch (err) {
      console.warn("[offline-manager] Error caching journal snapshot:", err);
    }
  }

  public async recordDetailFetch(userKey: string, applicationId: string, detail: any, writeGen = getUserGeneration(userKey)): Promise<void> {
    await this.whenReady();
    if (!userKey || !applicationId) return;
    // Account isolation: opt-in consent MUST match userKey
    if (!this.currentSettings.optIn || this.currentSettings.lastOptedInUserKey !== userKey) {
      return;
    }
    try {
      await saveDetailSnapshot(userKey, applicationId, detail, writeGen);
    } catch (err) {
      console.warn("[offline-manager] Error caching detail snapshot:", err);
    }
  }

  public async restoreLastOptedInAccount(): Promise<{
    user: StoredUserMetadata | null;
    journal: StoredJournalSnapshot | null;
  } | null> {
    await this.whenReady();
    if (!this.currentSettings.optIn || !this.currentSettings.lastOptedInUserKey) {
      return null;
    }
    const userKey = this.currentSettings.lastOptedInUserKey;
    try {
      const [user, journal] = await Promise.all([
        getCachedUser(userKey),
        getJournalSnapshot(userKey),
      ]);
      if (!user || !await restoreSessionGeneration(userKey)) return null;
      return { user, journal };
    } catch (err) {
      console.warn("[offline-manager] Error restoring last opted-in account:", err);
      return null;
    }
  }

  public async getCachedDetail(userKey: string, applicationId: string): Promise<StoredDetailSnapshot | null> {
    await this.whenReady();
    if (!this.currentSettings.optIn || this.currentSettings.lastOptedInUserKey !== userKey) {
      return null;
    }
    try {
      return await getDetailSnapshot(userKey, applicationId);
    } catch (err) {
      console.warn("[offline-manager] Error getting cached detail:", err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Invalidation & Session Termination (Logout / 401 / 403)
  // -------------------------------------------------------------------------

  /**
   * Called on 401, 403, or manual logout.
   * Completely purges user drafts, read cache, disables consent and clears last user pointer.
   */
  public async handleLogout(userKey?: string): Promise<void> {
    await this.whenReady();

    // Disable consent and clear last user pointer
    this.currentSettings = await saveOfflineSettings({
      optIn: false,
      lastOptedInUserKey: null,
    });
    this.notifySettings();

    // Clear drafts and read cache (clearDrafts = true)
    await clearOfflineCache(userKey, true);

    offlineBroadcast.post({
      type: "CACHE_CLEARED",
      userKey,
    });
    offlineBroadcast.post({
      type: "SETTINGS_CHANGED",
      optIn: false,
      userKey: null,
    });
    offlineBroadcast.post({
      type: "SESSION_EXPIRED",
    });
  }

  public destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    if (this.unsubBroadcast) {
      this.unsubBroadcast();
      this.unsubBroadcast = null;
    }
    this.onlineListeners.clear();
    this.settingsListeners.clear();
  }
}

export const offlineManager = OfflineManager.getInstance();
