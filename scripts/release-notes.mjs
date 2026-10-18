import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const compareVersions = (a, b) => {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};
export async function releaseNotes(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Invalid release version");
  const notes = [];
  for (const name of await readdir(path.join(root, "releases"))) {
    if (!name.endsWith(".json")) continue;
    const n = JSON.parse(
      await readFile(path.join(root, "releases", name), "utf8"),
    );
    if (
      name !== `${n.version}.json` ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(n.version) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(n.date) ||
      !Number.isFinite(Date.parse(n.date)) ||
      new Date(n.date).toISOString().slice(0, 10) !== n.date ||
      typeof n.summary !== "string" ||
      !n.summary.trim()
    )
      throw new Error(`Invalid release notes: ${name}`);
    for (const key of ["features", "improvements", "fixes"])
      if (
        !Array.isArray(n[key]) ||
        n[key].some((v) => typeof v !== "string" || !v.trim())
      )
        throw new Error(`Invalid ${key}: ${name}`);
    if (compareVersions(n.version, version) <= 0) notes.push(n);
  }
  if (!notes.some((n) => n.version === version))
    throw new Error(`Missing editorial release notes for ${version}`);
  return notes.sort((a, b) => compareVersions(b.version, a.version));
}
export const markdown = (notes) =>
  notes
    .map(
      (n) =>
        `## ${n.version} · ${n.date}\n\n${n.summary}\n` +
        [
          ["features", "Новое"],
          ["improvements", "Улучшения"],
          ["fixes", "Исправления"],
        ]
          .map(([key, title]) =>
            n[key].length
              ? `\n### ${title}\n\n${n[key].map((v) => `- ${v}`).join("\n")}\n`
              : "",
          )
          .join(""),
    )
    .join("\n");
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const version =
    process.env.AVARI_VERSION ||
    (/^v\d+\.\d+\.\d+$/.test(process.env.GITHUB_REF_NAME || "")
      ? process.env.GITHUB_REF_NAME.slice(1)
      : undefined) ||
    pkg.version;
  const notes = await releaseNotes(version);
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(
    path.join(root, "dist/release-notes.md"),
    markdown(notes.filter((n) => n.version === version)),
  );
  console.log(`Validated release notes for ${version}`);
}
