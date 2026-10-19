import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";

const [archive = "dist/avari-extension.zip", output = "dist/firefox-unpacked"] =
  process.argv.slice(2);
const files = unzipSync(await readFile(archive));
const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
const expected =
  process.env.AVARI_VERSION ||
  JSON.parse(await readFile("package.json", "utf8")).version;
if (manifest.version !== expected)
  throw new Error("Firefox archive version does not match release");
manifest.browser_specific_settings = {
  gecko_android: { strict_min_version: "142.0" },
  gecko: {
    id: process.env.FIREFOX_EXTENSION_ID || "jobs@avari.dev",
    strict_min_version: "140.0",
    data_collection_permissions: {
      required: ["authenticationInfo", "browsingActivity"],
    },
  },
};
manifest.background = { scripts: ["background.js"] };
delete manifest.minimum_chrome_version;
files["manifest.json"] = new TextEncoder().encode(
  JSON.stringify(manifest, null, 2),
);
for (const [name, data] of Object.entries(files)) {
  const target = path.resolve(output, name);
  if (!target.startsWith(path.resolve(output) + path.sep))
    throw new Error("Unsafe archive path");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}
await mkdir("dist", { recursive: true });
await writeFile(
  "dist/avari-extension-firefox.zip",
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        name,
        [data, { mtime: new Date(1980, 0, 1) }],
      ]),
    ),
    { level: 6 },
  ),
);
console.log(`Packaged Firefox ${manifest.version} (Firefox 140+)`);
