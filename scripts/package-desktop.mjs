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
