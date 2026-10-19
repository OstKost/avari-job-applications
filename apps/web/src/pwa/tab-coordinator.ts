export type TabMessage =
  | { type: "AVARI_DRAFT_CHECK"; senderId: string }
  | { type: "AVARI_DRAFT_RESPONSE"; senderId: string; hasDirtyDrafts: boolean }
  | { type: "AVARI_UPDATE_PREPARE"; senderId: string }
  | { type: "AVARI_UPDATE_CONFIRMED"; senderId: string };

export class TabCoordinator {
  private channel: BroadcastChannel | null = null;
  private tabId: string;
  private dirtyDraftCheckFn: (() => boolean | Promise<boolean>) | null = null;
  private messageHandler: ((event: MessageEvent<TabMessage>) => void) | null = null;
  private isDestroyed = false;

  constructor() {
    this.tabId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    this.initChannel();
  }

  private initChannel() {
    if (typeof BroadcastChannel !== "undefined" && !this.channel && !this.isDestroyed) {
      try {
        this.channel = new BroadcastChannel("avari_pwa_tabs");
        this.messageHandler = this.handleMessage.bind(this);
        this.channel.addEventListener("message", this.messageHandler);
      } catch {
        this.channel = null;
      }
    }
  }

  public registerDirtyDraftCheck(fn: () => boolean | Promise<boolean>) {
    this.dirtyDraftCheckFn = fn;
    if (!this.channel && !this.isDestroyed) {
      this.initChannel();
    }
  }

  public unregisterDirtyDraftCheck() {
    this.dirtyDraftCheckFn = null;
  }

  private async handleMessage(event: MessageEvent<TabMessage>) {
    const data = event.data;
    if (!data || data.senderId === this.tabId) return;

    if (data.type === "AVARI_DRAFT_CHECK") {
      let dirty = false;
      if (this.dirtyDraftCheckFn) {
        try {
          dirty = await Promise.resolve(this.dirtyDraftCheckFn());
        } catch {
          // Fail-closed: if check throws, assume dirty to protect data
          dirty = true;
        }
      }
      try {
        this.channel?.postMessage({
          type: "AVARI_DRAFT_RESPONSE",
          senderId: this.tabId,
          hasDirtyDrafts: dirty,
        });
      } catch {
        // channel error
      }
    }
  }

  /**
   * Checks other open tabs for unsaved / dirty drafts.
   * Resolves to true if any other tab reports active dirty drafts or if checking fails closed.
   */
  public async checkOtherTabsDirtyDrafts(timeoutMs = 300): Promise<boolean> {
    if (this.isDestroyed) return false;
    if (!this.channel) {
      this.initChannel();
      if (!this.channel) return false;
    }

    return new Promise<boolean>((resolve) => {
      let anyDirty = false;
      const onMsg = (event: MessageEvent<TabMessage>) => {
        if (event.data?.type === "AVARI_DRAFT_RESPONSE" && event.data.senderId !== this.tabId) {
          if (event.data.hasDirtyDrafts) {
            anyDirty = true;
          }
        }
      };

      try {
        this.channel!.addEventListener("message", onMsg);
        this.channel!.postMessage({
          type: "AVARI_DRAFT_CHECK",
          senderId: this.tabId,
        });
      } catch {
        // Fail-closed on communication error
        return resolve(true);
      }

      setTimeout(() => {
        try {
          this.channel?.removeEventListener("message", onMsg);
        } catch {
          // ignore
        }
        resolve(anyDirty);
      }, timeoutMs);
    });
  }

  public notifyUpdateConfirmed() {
    if (this.isDestroyed) return;
    try {
      this.channel?.postMessage({
        type: "AVARI_UPDATE_CONFIRMED",
        senderId: this.tabId,
      });
    } catch {
      // ignore
    }
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.channel) {
      if (this.messageHandler) {
        this.channel.removeEventListener("message", this.messageHandler);
        this.messageHandler = null;
      }
      this.channel.close();
      this.channel = null;
    }
    this.dirtyDraftCheckFn = null;
  }
}
