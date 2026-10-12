import { execFileSync } from "node:child_process";
import { mkdir, cp } from "node:fs/promises";
import path from "node:path";
for (const arch of ["amd64", "arm64"]) {
  const dir = path.resolve("dist/avari-linux-" + arch);
  await mkdir(dir, { recursive: true });
  for (const [binary, cmd] of [
    ["avari", "api"],
    ["avari-admin", "admin"],
  ])
    execFileSync(
      "go",
      [
        "build",
        "-trimpath",
        "-o",
        path.join(dir, binary),
        "./apps/server/cmd/" + cmd,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, GOOS: "linux", GOARCH: arch, CGO_ENABLED: "0" },
      },
    );
  await cp("deploy", path.join(dir, "deploy"), { recursive: true });
  await cp("README.md", path.join(dir, "README.md"));
  execFileSync("tar", [
    "-czf",
    path.resolve("dist/avari-linux-" + arch + ".tar.gz"),
    "-C",
    path.dirname(dir),
    path.basename(dir),
  ]);
}
