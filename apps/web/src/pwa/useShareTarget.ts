import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  parseShareTargetParams,
  savePendingShare,
  getPendingShare,
  clearPendingShare,
  type ParsedShareData,
} from "./share-target";

export interface UseShareTargetOptions {
  /**
   * If true, automatically checks window.location for /share route or #add-vacancy shortcut on mount
   */
  autoIntake?: boolean;
  /**
   * Current authentication status. When true, pending shared vacancy from sessionStorage is consumed.
   */
  isAuthenticated?: boolean;
  /**
   * Callback invoked when a shared vacancy draft is ready to be opened in the vacancy form.
   * NOTE: Must only prefill form / draft, NEVER auto-save or submit records!
   */
  onOpenVacancyForm?: (shared: ParsedShareData) => void;
}

export interface UseShareTargetReturn {
  pendingShare: ParsedShareData | null;
  consumeShare: () => ParsedShareData | null;
  discardShare: () => void;
  intakeFromUrl: (
    urlOrParams: string | URLSearchParams,
  ) => ParsedShareData | null;
}

export function useShareTarget(
  options: UseShareTargetOptions = {},
): UseShareTargetReturn {
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingShare, setPendingShare] = useState<ParsedShareData | null>(
    () => {
      if (typeof window === "undefined") return null;
      return getPendingShare();
    },
  );

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Intake from current location URL if /share?title=...&text=...&url=... or #add-vacancy
  const intakeFromUrl = useCallback(
    (urlOrParams: string | URLSearchParams): ParsedShareData | null => {
      let params: URLSearchParams;
      if (typeof urlOrParams === "string") {
        try {
          const u = new URL(urlOrParams, window.location.origin);
          params = u.searchParams;
        } catch {
          params = new URLSearchParams(urlOrParams);
        }
      } else {
        params = urlOrParams;
      }

      const parsed = parseShareTargetParams(params);
      if (parsed) {
        savePendingShare(parsed);
        setPendingShare(parsed);
        return parsed;
      }
      return null;
    },
    [],
  );

  // Check URL on mount or location change
  useEffect(() => {
    if (options.autoIntake === false || typeof window === "undefined") return;

    if (location.hash === "#add-vacancy") {
      const shortcut: ParsedShareData = {
        rawUrl: null,
        canonicalUrl: null,
        title: null,
        text: null,
      };
      savePendingShare(shortcut);
      setPendingShare(shortcut);
      navigate(location.pathname + location.search, { replace: true });
    } else if (location.pathname === "/share") {
      intakeFromUrl(location.search);
      navigate("/", { replace: true });
    }
  }, [
    intakeFromUrl,
    options.autoIntake,
    location.pathname,
    location.search,
    location.hash,
    navigate,
  ]);

  // When user is authenticated (or was already authenticated), provide the pending share to onOpenVacancyForm
  useEffect(() => {
    if (options.isAuthenticated && pendingShare) {
      const data = pendingShare;
      // Invoke callback to route to vacancy form
      optionsRef.current.onOpenVacancyForm?.(data);
      // Clean up session storage so it is not repeatedly opened
      clearPendingShare();
      setPendingShare(null);
    }
  }, [options.isAuthenticated, pendingShare]);

  const consumeShare = useCallback((): ParsedShareData | null => {
    const data = getPendingShare();
    clearPendingShare();
    setPendingShare(null);
    return data;
  }, []);

  const discardShare = useCallback(() => {
    clearPendingShare();
    setPendingShare(null);
  }, []);

  return {
    pendingShare,
    consumeShare,
    discardShare,
    intakeFromUrl,
  };
}
