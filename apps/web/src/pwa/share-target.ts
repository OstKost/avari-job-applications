import { jobIdentity } from "@avari/shared";

export interface ParsedShareData {
  rawUrl: string | null;
  canonicalUrl: string | null;
  site?: string;
  externalId?: string;
  title: string | null;
  text: string | null;
}

export interface StoredShareSession {
  timestamp: number;
  data: ParsedShareData;
}

const MAX_STRING_LEN = 1000;
const SESSION_STORAGE_KEY = "avari_pending_share_target";
export const SHARE_TARGET_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

function sanitizeString(val: unknown, maxLen = MAX_STRING_LEN): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

/**
 * Extracts a candidate URL from an explicit url parameter or scans the text parameter for http(s) URL.
 * Strictly rejects non-http/https schemes (e.g. javascript:, data:, file:) and malformed URLs.
 */
export function extractValidHttpUrl(urlCandidate?: string | null, textCandidate?: string | null): string | null {
  // 1. Try explicit url param first
  if (urlCandidate) {
    const sanitized = sanitizeString(urlCandidate);
    if (sanitized) {
      try {
        const parsed = new URL(sanitized);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          return parsed.href;
        }
      } catch {
        // Not a valid standalone URL
      }
    }
  }

  // 2. Fallback: Search in text parameter for an http:// or https:// URL
  if (textCandidate) {
    const match = textCandidate.match(/https?:\/\/[^\s"'<>]+/i);
    if (match) {
      try {
        const parsed = new URL(match[0]);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          return parsed.href;
        }
      } catch {
        // Invalid URL match
      }
    }
  }

  return null;
}

/**
 * Parses query params from /share?title=...&text=...&url=...
 * Reuses @avari/shared jobIdentity for canonicalization.
 */
export function parseShareTargetParams(searchParams: URLSearchParams | string): ParsedShareData | null {
  const params = typeof searchParams === "string" ? new URLSearchParams(searchParams) : searchParams;

  const rawTitle = sanitizeString(params.get("title"));
  const rawText = sanitizeString(params.get("text"));
  const rawUrlParam = sanitizeString(params.get("url"));

  if (!rawTitle && !rawText && !rawUrlParam) {
    return null;
  }

  const validUrl = extractValidHttpUrl(rawUrlParam, rawText);
  if (rawUrlParam && !validUrl) return null;
  let canonicalUrl = validUrl;
  let site: string | undefined;
  let externalId: string | undefined;

  if (validUrl) {
    try {
      const identity = jobIdentity(validUrl);
      if (identity) {
        canonicalUrl = identity.url;
        site = identity.site;
        externalId = identity.id;
      }
    } catch {
      // fallback to validUrl
    }
  }

  return {
    rawUrl: validUrl,
    canonicalUrl,
    site,
    externalId,
    title: rawTitle,
    text: rawText,
  };
}

/**
 * Persists an incoming share target across login in sessionStorage with a bounded TTL.
 */
export function savePendingShare(data: ParsedShareData, storage: Storage = window.sessionStorage): void {
  try {
    const item: StoredShareSession = {
      timestamp: Date.now(),
      data,
    };
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(item));
  } catch {
    // sessionStorage quota or security restriction
  }
}

/**
 * Retrieves the pending share target from sessionStorage, validating TTL.
 * Clears expired or consumed records.
 */
export function getPendingShare(storage: Storage = window.sessionStorage, ttlMs = SHARE_TARGET_TTL_MS): ParsedShareData | null {
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed: StoredShareSession = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.timestamp || !parsed.data) {
      storage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    if (Date.now() - parsed.timestamp > ttlMs) {
      storage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return parsed.data;
  } catch {
    storage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

/**
 * Clears pending share target from sessionStorage.
 */
export function clearPendingShare(storage: Storage = window.sessionStorage): void {
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
