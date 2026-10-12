import { cp, mkdir, rm, writeFile } from "node:fs/promises";
const destination = new URL("../apps/server/assets/dist/", import.meta.url);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL("../apps/web/dist/", import.meta.url), destination, {
  recursive: true,
});
await mkdir(new URL("downloads/", destination), { recursive: true });
await cp(
  new URL("../dist/avari-extension.zip", import.meta.url),
  new URL("downloads/avari-extension.zip", destination),
);
await writeFile(
  new URL("release.json", destination),
  JSON.stringify({ version: process.env.AVARI_VERSION || "1.0.0" }),
);
