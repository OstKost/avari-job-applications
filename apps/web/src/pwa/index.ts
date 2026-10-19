export * from "./capabilities";
export * from "./tab-coordinator";
export * from "./usePwa";
export * from "./components";
export * from "./share-target";
export * from "./useShareTarget";
export * from "./ShareFallbackModal";

/**
 * Legacy interface maintained for compatibility.
 */
export interface PwaShareTargetPayload {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

/**
 * Hook or helper seam for consuming incoming share target data.
 */
export function parseIncomingShareTarget(searchParams: URLSearchParams): PwaShareTargetPayload | null {
  const title = searchParams.get("title") || undefined;
  const text = searchParams.get("text") || undefined;
  const url = searchParams.get("url") || undefined;

  if (!title && !text && !url) {
    return null;
  }

  return { title, text, url };
}
