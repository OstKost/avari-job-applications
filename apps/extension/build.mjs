import { build } from "vite";
import react from "@vitejs/plugin-react";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
let defaultServer =
  process.env.VITE_AVARI_DEFAULT_SERVER || "https://jobs.avari.dev";
if (defaultServer) {
  const url = new URL(defaultServer);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("VITE_AVARI_DEFAULT_SERVER must be an HTTPS origin");
  }
  defaultServer = url.origin;
  process.env.VITE_AVARI_DEFAULT_SERVER = defaultServer;
}
const { version: packageVersion } = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
const version = process.env.AVARI_VERSION || packageVersion;
if (
  !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version) ||
  version
    .split(".")
    .some(
      (part) =>
        Number(part) > 65535 || (part.length > 1 && part.startsWith("0")),
    )
) {
  throw new Error(
    "AVARI_VERSION must be a Chrome-compatible major.minor.patch version",
  );
}
await build({
  configFile: false,
  root,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: root + "index.html",
        action: root + "action.html",
        auth: root + "auth.html",
      },
    },
  },
});
for (const name of ["content", "background"])
  await build({
    configFile: false,
    root,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      lib: {
        entry: root + "src/" + name + ".ts",
        name: "Avari" + name,
        formats: ["iife"],
        fileName: () => name + ".js",
      },
    },
  });
const manifest = {
  manifest_version: 3,
  name: "Avari.Jobs — журнал откликов",
  version,
  description:
    "Сохраняйте вакансии с популярных карьерных сайтов в личном журнале откликов.",
  permissions: ["storage", "activeTab", "scripting"],
  optional_permissions: ["notifications"],
  ...(defaultServer ? { host_permissions: [defaultServer + "/*"] } : {}),
  optional_host_permissions: [
    "https://*/*",
    "http://localhost/*",
    "http://127.0.0.1/*",
  ],
  action: {
    default_title: "Avari.Jobs",
    default_popup: "action.html",
    default_icon: {
      16: "brand/icon-16.png",
      32: "brand/icon-32.png",
      48: "brand/icon-48.png",
      128: "brand/icon-128.png",
    },
  },
  background: { service_worker: "background.js" },
  content_scripts: [
    {
      matches: [
        "https://*.hh.ru/vacancy/*",
        "https://*.hh.ru/applicant/negotiations*",
        "https://*.hh.ru/applicant/vacancies*",
        "https://*.hh.ru/applicant/favorite*",
        "https://*.hh.ru/search/vacancy*",
        "https://*.linkedin.com/jobs/*",
        "https://*.linkedin.com/my-items/saved-jobs*",
        "https://*.getmatch.ru/vacancies/*",
        "https://*.getmatch.ru/applications*",
        "https://*.hirify.me/jobs/*",
        "https://*.hirify.me/applications*",
        "https://*.hirify.me/account/favorites*",
        "https://*.geekjob.ru/vacancy/*",
        "https://*.career.habr.com/vacancies*",
        "https://*.huntflow.io/vacancy/*",
      ],
      js: ["content.js"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["index.html", "assets/*", "brand/*"],
      matches: ["http://*/*", "https://*/*"],
    },
  ],
  icons: {
    16: "brand/icon-16.png",
    32: "brand/icon-32.png",
    48: "brand/icon-48.png",
    128: "brand/icon-128.png",
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self';",
  },
};
await writeFile(root + "dist/manifest.json", JSON.stringify(manifest, null, 2));
await copyFile(root + "public/brand/icon-128.png", root + "dist/icon.png");
