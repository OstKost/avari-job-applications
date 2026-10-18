import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { releaseNotes, markdown } from "./release-notes.mjs";
const version =
  process.env.AVARI_VERSION || process.env.GITHUB_REF_NAME?.replace(/^v/, "");
const releases = await releaseNotes(version);
const directory = path.resolve(process.argv[2] || "dist");
const platforms = {};
for (const platform of ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"]) {
  const entry = JSON.parse(
    await readFile(path.join(directory, `update-${platform}.json`), "utf8"),
  );
  if (
    entry.platform !== platform ||
    entry.version !== version ||
    !entry.signature ||
    !/^[a-zA-Z0-9._-]+$/.test(entry.file)
  )
    throw new Error(`Invalid update metadata for ${platform}`);
  await access(path.join(directory, entry.file));
  const signature = (
    await readFile(path.join(directory, entry.file + ".sig"), "utf8")
  ).trim();
  if (signature !== entry.signature)
    throw new Error(`Signature mismatch for ${platform}`);
  platforms[platform] = {
    url: `https://github.com/OstKost/avari-job-applications/releases/download/v${version}/${entry.file}`,
    signature,
  };
}
await writeFile(
  path.join(directory, "desktop-update.json"),
  JSON.stringify(
    {
      version,
      pub_date: `${releases[0].date}T00:00:00Z`,
      notes: markdown(releases.filter((n) => n.version === version)),
      releases,
      platforms,
    },
    null,
    2,
  ),
);
