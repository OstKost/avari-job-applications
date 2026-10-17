import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const rust =
  process.env.AVARI_DESKTOP_TARGET ||
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
    /^host: (.+)$/m,
  )[1];
const targets = {
  "x86_64-pc-windows-msvc": ["windows", "amd64"],
  "aarch64-apple-darwin": ["darwin", "arm64"],
  "x86_64-apple-darwin": ["darwin", "amd64"],
};
if (!targets[rust])
  throw new Error(
    "Desktop v1 supports Windows x64 and macOS Intel/Apple Silicon",
  );
const version = process.env.AVARI_VERSION || "1.3.0";
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  throw new Error("Invalid AVARI_VERSION");
const [GOOS, GOARCH] = targets[rust];
const directory = path.join(root, "apps/desktop/src-tauri/binaries");
await mkdir(directory, { recursive: true });
execFileSync(
  "go",
  [
    "build",
    "-trimpath",
    "-o",
    path.join(
      directory,
      "avari-server-" + rust + (GOOS === "windows" ? ".exe" : ""),
    ),
    "./apps/server/cmd/api",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GOOS, GOARCH, CGO_ENABLED: "0" },
  },
);
const config = { version };
if (process.env.AVARI_WINDOWS_CERT_THUMBPRINT) {
  if (!/^[0-9a-f]{40}$/i.test(process.env.AVARI_WINDOWS_CERT_THUMBPRINT))
    throw new Error("Invalid signing thumbprint");
  config.bundle = {
    windows: {
      certificateThumbprint: process.env.AVARI_WINDOWS_CERT_THUMBPRINT,
      digestAlgorithm: "sha256",
      timestampUrl: "http://timestamp.digicert.com",
    },
  };
}
await writeFile(
  path.join(directory, "release-config.json"),
  JSON.stringify(config),
);
