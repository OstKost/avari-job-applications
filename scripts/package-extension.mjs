import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
await mkdir("dist", { recursive: true });
const archive = path.resolve("dist/avari-extension.zip");
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "."], { cwd: "apps/extension/dist" });
