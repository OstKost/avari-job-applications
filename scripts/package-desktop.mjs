import { readdir, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.env.AVARI_DESKTOP_TARGET;
const names = {
  "x86_64-pc-windows-msvc": [
    "nsis",
    ".exe",
    "avari-jobs-windows-x64-setup.exe",
  ],
  "aarch64-apple-darwin": ["dmg", ".dmg", "avari-jobs-macos-apple-silicon.dmg"],
  "x86_64-apple-darwin": ["dmg", ".dmg", "avari-jobs-macos-intel.dmg"],
};
if (!names[target])
  throw new Error(
    "AVARI_DESKTOP_TARGET must identify the installer architecture",
  );
const [format, extension, name] = names[target];
const directory = path.join(
  root,
  "apps/desktop/src-tauri/target",
  target,
  "release/bundle",
  format,
);
const files = (await readdir(directory)).filter((f) => f.endsWith(extension));
if (files.length !== 1)
  throw new Error(
    `Expected exactly one ${format} installer, found ${files.length}`,
  );
const output = path.join(root, "dist/desktop", target);
await mkdir(output, { recursive: true });
await copyFile(path.join(directory, files[0]), path.join(output, name));
const bytes = await readFile(path.join(output, name));
const sha = createHash("sha256").update(bytes).digest("hex");
await writeFile(path.join(output, name + ".sha256"), `${sha}  ${name}\n`);

// Updater signing is mandatory for published updates; local verification builds remain unsigned.
if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const windows = target.includes("windows");
  let updaterPath = path.join(directory, files[0]);
  let updaterName = name;
  if (!windows) {
    const appDirectory = path.join(
      root,
      "apps/desktop/src-tauri/target",
      target,
      "release/bundle/macos",
    );
    const archives = (await readdir(appDirectory)).filter((f) =>
      f.endsWith(".app.tar.gz"),
    );
    if (archives.length !== 1)
      throw new Error("Expected one macOS updater archive");
    updaterPath = path.join(appDirectory, archives[0]);
    updaterName = target.startsWith("aarch64")
      ? "avari-jobs-macos-apple-silicon.app.tar.gz"
      : "avari-jobs-macos-intel.app.tar.gz";
    await copyFile(updaterPath, path.join(output, updaterName));
    const digest = createHash("sha256")
      .update(await readFile(updaterPath))
      .digest("hex");
    await writeFile(
      path.join(output, updaterName + ".sha256"),
      `${digest}  ${updaterName}\n`,
    );
  }
  const signature = (await readFile(updaterPath + ".sig", "utf8")).trim();
  if (!signature) throw new Error("Missing updater signature");
  await writeFile(path.join(output, updaterName + ".sig"), signature);
  const version = process.env.AVARI_VERSION;
  if (!version)
    throw new Error("AVARI_VERSION is required for signed update packages");
  const platform = windows
    ? "windows-x86_64"
    : target.startsWith("aarch64")
      ? "darwin-aarch64"
      : "darwin-x86_64";
  await writeFile(
    path.join(output, `update-${platform}.json`),
    JSON.stringify({ version, platform, file: updaterName, signature }),
  );
}
