import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RefreshCw, X, AlertTriangle, Share2 } from "lucide-react";
import type { UsePwaReturn } from "./usePwa";
import "./pwa.css";

export interface PwaInstallPromptProps {
  pwa: UsePwaReturn;
  className?: string;
}

/**
 * PWA Install Button & iOS guidance modal.
 * Follows Russian UI requirements and strict capability detection without unsupported promises.
 */
export function PwaInstallPrompt({ pwa, className = "" }: PwaInstallPromptProps) {
  const [showIOSModal, setShowIOSModal] = useState(false);
  const { capabilities, isInstalled, promptInstall } = pwa;

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (capabilities.isIOS) {
      setShowIOSModal(true);
      return;
    }
    await promptInstall();
  };

  return (
    <>
      <button
        type="button"
        className={`pwa-button pwa-button-primary ${className}`}
        onClick={handleClick}
        title="Установить приложение на устройство"
      >
        <Download size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
        Установить приложение
      </button>

      {showIOSModal && (
        <div className="pwa-modal-overlay" onClick={() => setShowIOSModal(false)}>
          <div className="pwa-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pwa-modal-header">
              <h3>Установка на iOS (iPhone / iPad)</h3>
              <button
                type="button"
                className="pwa-modal-close"
                onClick={() => setShowIOSModal(false)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>

            {capabilities.isSafari ? (
              <ol className="pwa-ios-steps">
                <li>
                  Нажмите кнопку <strong>«Поделиться»</strong>{" "}
                  <Share2 size={15} style={{ verticalAlign: "middle" }} /> в нижней панели Safari.
                </li>
                <li>
                  В открывшемся меню выберите <strong>«На экран „Домой“»</strong>.
                </li>
                <li>
                  Подтвердите добавление, нажав <strong>«Добавить»</strong> в правом верхнем углу.
                </li>
              </ol>
            ) : (
              <div className="pwa-banner-warning">
                Откройте меню «Поделиться» и выберите «На экран «Домой»». Если этого пункта нет, откройте сайт в Safari и повторите.
              </div>
            )}

            <div className="pwa-banner-actions">
              <button
                type="button"
                className="pwa-button pwa-button-secondary"
                onClick={() => setShowIOSModal(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export interface PwaUpdatePromptProps {
  pwa: UsePwaReturn;
}

/** Keep one prompt inside the native modal's top layer without remounting it. */
function useUpdatePromptHost(visible: boolean) {
  const [host] = useState(() => document.createElement("div"));

  useLayoutEffect(() => {
    if (!visible) return;
    host.className = "pwa-update-host";
    let stack: HTMLDialogElement[] = [];

    const sync = (records: MutationRecord[] = []) => {
      // Mutation order also covers dialogs opened in a different order from DOM order.
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLDialogElement) {
          const dialog = record.target;
          stack = stack.filter((entry) => entry !== dialog);
          if (dialog.open) stack.push(dialog);
        }
      }
      let open: HTMLDialogElement[];
      try {
        open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal"));
      } catch {
        // Older engines without :modal still expose the open attribute.
        open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
      }
      stack = stack.filter((dialog) => open.includes(dialog));
      stack = [...open.filter((dialog) => !stack.includes(dialog)), ...stack];
      // On initial attachment, focus identifies an already open topmost dialog.
      const focused = document.activeElement?.closest("dialog");
      if (!records.length && focused instanceof HTMLDialogElement && open.includes(focused)) {
        stack = stack.filter((dialog) => dialog !== focused);
        stack.push(focused);
      }
      const target = stack.at(-1) ?? document.body;
      if (host.parentElement !== target) {
        const active = document.activeElement;
        const restoreFocus = active instanceof HTMLElement && host.contains(active);
        host.classList.toggle("pwa-update-host-in-dialog", target !== document.body);
        target.prepend(host);
        if (restoreFocus) active.focus({ preventScroll: true });
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    sync();
    // close does not bubble, and can arrive after the open mutation.
    document.addEventListener("close", syncOnClose, true);
    function syncOnClose() { sync(); }
    return () => {
      observer.disconnect();
      document.removeEventListener("close", syncOnClose, true);
      host.remove();
    };
  }, [host, visible]);

  return host;
}

/**
 * PWA Update Notification Banner.
 * Prompts the user before activating SW update and prevents loss of drafts in open tabs.
 */
export function PwaUpdatePrompt({ pwa }: PwaUpdatePromptProps) {
  const { needRefresh, isUpdating, otherTabsDirty, updateServiceWorker, dismissUpdate } = pwa;
  const host = useUpdatePromptHost(needRefresh);

  if (!needRefresh) {
    return null;
  }

  return createPortal(
    <div className="pwa-banner" role="alert">
      <div className="pwa-banner-title">
        <RefreshCw size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
        Доступно обновление Avari.Jobs
      </div>
      <p className="pwa-banner-desc">
        Новая версия приложения готова к работе. Обновите страницу, чтобы применить изменения.
      </p>

      {otherTabsDirty && (
        <div className="pwa-banner-warning">
          <AlertTriangle size={15} style={{ marginRight: 4, verticalAlign: "middle" }} />
          В других открытых вкладках есть несохранённые изменения. Сохраните их перед обновлением.
        </div>
      )}

      <div className="pwa-banner-actions">
        <button
          type="button"
          className="pwa-button pwa-button-secondary"
          onClick={dismissUpdate}
          disabled={isUpdating}
        >
          Позже
        </button>
        <button
          type="button"
          className="pwa-button pwa-button-primary"
          onClick={() => updateServiceWorker()}
          disabled={isUpdating}
        >
          {isUpdating ? "Обновление..." : "Обновить"}
        </button>
      </div>
    </div>,
    host,
  );
}
