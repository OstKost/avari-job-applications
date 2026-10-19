// Chromium can restrict storage.local to trusted extension contexts. Firefox
// event pages instead persist credentials in extension-origin localStorage,
// which content scripts cannot access (their localStorage belongs to the site).
const prefix = "avari.private.";
function restrictedLocal() {
  return typeof chrome.storage.local.setAccessLevel === "function";
}
export function restrictStorage() {
  if (restrictedLocal())
    return chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  return Promise.resolve();
}
export const privateStorage = {
  async get(keys: string | string[]): Promise<Record<string, any>> {
    const names = Array.isArray(keys) ? keys : [keys];
    if (restrictedLocal()) return chrome.storage.local.get(names);
    const previous = await chrome.storage.local.get(names);
    const result: Record<string, any> = {};
    for (const key of names) {
      let value = localStorage.getItem(prefix + key);
      if (value === null && previous[key] !== undefined) {
        value = JSON.stringify(previous[key]);
        localStorage.setItem(prefix + key, value);
      }
      if (value !== null) result[key] = JSON.parse(value);
    }
    await chrome.storage.local.remove(names);
    return result;
  },
  async set(values: Record<string, unknown>) {
    if (restrictedLocal()) await chrome.storage.local.set(values);
    else {
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(prefix + key, JSON.stringify(value));
      await chrome.storage.local.remove(Object.keys(values));
    }
    if ("token" in values)
      await chrome.storage.local.set({ authRevision: crypto.randomUUID() });
  },
  async remove(keys: string | string[]) {
    const names = Array.isArray(keys) ? keys : [keys];
    if (!restrictedLocal())
      for (const key of names) localStorage.removeItem(prefix + key);
    await chrome.storage.local.remove(names);
    if (names.includes("token"))
      await chrome.storage.local.set({ authRevision: crypto.randomUUID() });
  },
};
