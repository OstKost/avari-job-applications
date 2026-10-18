import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  releaseNotes,
  compareVersions,
  markdown,
  root,
} from "./release-notes.mjs";

test("release notes require an editorial entry for the exact release and omit future releases", async () => {
  const notes = await releaseNotes("1.3.0");
  assert.equal(notes[0].version, "1.3.0");
  assert.ok(notes.every((n) => compareVersions(n.version, "1.3.0") <= 0));
  assert.match(markdown(notes), /Улучшения/);
  await assert.rejects(releaseNotes("999.0.0"), /Missing editorial/);
  await assert.rejects(releaseNotes("1.4.0-beta.1"), /Invalid release/);
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
});

test("update manifest is produced only for a complete matching platform set", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "avari-updates-"));
  const platforms = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"];
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/desktop-update.mjs"), directory],
      { env: { ...process.env, AVARI_VERSION: "1.3.0" }, encoding: "utf8" },
    );
  try {
    assert.notEqual(run().status, 0);
    for (const platform of platforms) {
      const file = `${platform}.exe`;
      await writeFile(path.join(directory, file), "test payload");
      await writeFile(path.join(directory, file + ".sig"), "test-signature");
      await writeFile(
        path.join(directory, `update-${platform}.json`),
        JSON.stringify({
          version: "1.3.0",
          platform,
          file,
          signature: "test-signature",
        }),
      );
    }
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(
      await readFile(path.join(directory, "desktop-update.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(manifest.platforms), platforms);
    assert.equal(manifest.version, "1.3.0");
    assert.ok(
      Object.values(manifest.platforms).every((p) =>
        p.url.startsWith(
          "https://github.com/OstKost/avari-job-applications/releases/download/v1.3.0/",
        ),
      ),
    );
    await writeFile(
      path.join(directory, "windows-x86_64.exe.sig"),
      "different-signature",
    );
    assert.notEqual(run().status, 0);
    await rm(path.join(directory, "desktop-update.json"));
    await rm(path.join(directory, "darwin-x86_64.exe"));
    assert.notEqual(run().status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical notes cover every published application tag", async () => {
  const notes = await releaseNotes("1.5.0");
  assert.equal(notes.length, 11);
  assert.equal(notes.at(-1).version, "1.0.0");
  assert.equal(notes[0].version, "1.5.0");
  const old = notes.find((n) => n.version === "1.3.0");
  assert.match(old.summary, /Расширение/);
  assert.ok(!JSON.stringify(old).includes("проверка подписи"));
  assert.ok(
    !(await releaseNotes("1.3.0")).some((n) =>
      ["1.4.0", "1.5.0"].includes(n.version),
    ),
  );
});

test("Vite development serves release metadata as JSON instead of SPA HTML", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: path.join(root, "apps/web"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, open: false },
  });
  try {
    await server.listen();
    const base = server.resolvedUrls.local[0];
    const metadata = await fetch(new URL("release.json", base));
    assert.match(metadata.headers.get("content-type"), /application\/json/);
    const { version } = await metadata.json();
    const response = await fetch(
      new URL("release-notes.json?cache-test=1", base),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), await releaseNotes(version));
    const head = await fetch(new URL("release-notes.json", base), {
      method: "HEAD",
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const post = await fetch(new URL("release-notes.json", base), {
      method: "POST",
    });
    assert.equal(post.status, 405);
  } finally {
    await server.close();
  }
});
