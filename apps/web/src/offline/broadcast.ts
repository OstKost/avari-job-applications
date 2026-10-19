/**
 * BroadcastChannel synchronization for offline status, cache invalidation, and multi-tab drafts.
 * Degrades gracefully if BroadcastChannel is not supported.
 */

export const BROADCAST_CHANNEL_NAME = "avari_offline_channel";

export type BroadcastMsg =
  | { type: "SETTINGS_CHANGED"; optIn: boolean; userKey: string | null }
  | { type: "CACHE_CLEARED"; userKey?: string }
  | { type: "SESSION_EXPIRED" }
  | { type: "DRAFT_UPDATED"; userKey: string; kind: string; entityId: string; timestamp: number }
  | { type: "DRAFT_CLEARED"; userKey: string; kind: string; entityId: string };

type Listener = (msg: BroadcastMsg) => void;

class OfflineChannel {
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          const data = event.data as BroadcastMsg;
          this.listeners.forEach((fn) => {
            try {
              fn(data);
            } catch (err) {
              console.error("[offline-channel] Listener error:", err);
            }
          });
        };
      } catch (err) {
        console.warn("[offline-channel] Failed to initialize BroadcastChannel:", err);
      }
    }
  }

  public post(msg: BroadcastMsg): void {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch (err) {
        console.warn("[offline-channel] Failed to post message:", err);
      }
    }
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  public close(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {}
      this.channel = null;
    }
    this.listeners.clear();
  }
}

export const offlineBroadcast = new OfflineChannel();
