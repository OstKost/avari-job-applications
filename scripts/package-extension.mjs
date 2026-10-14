import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
// Package identically on Windows and Unix; no external zip executable needed.
const files = {};
const root = path.resolve("apps/extension/dist");
async function collect(directory, prefix = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      await collect(path.join(directory, entry.name), name + "/");
    else if (entry.isFile())
      files[name] = [
        new Uint8Array(await readFile(path.join(directory, entry.name))),
        { mtime: new Date(1980, 0, 1, 0, 0, 0) },
      ];
  }
}
await collect(root);
await mkdir("dist", { recursive: true });
await writeFile("dist/avari-extension.zip", zipSync(files, { level: 6 }));
