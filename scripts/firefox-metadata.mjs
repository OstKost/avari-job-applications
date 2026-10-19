import { readFile, writeFile } from "node:fs/promises";
const version =
  process.env.AVARI_VERSION ||
  JSON.parse(await readFile("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Invalid release version");
const notes = JSON.parse(await readFile(`releases/${version}.json`, "utf8"));
const releaseNotes = [
  notes.summary,
  ...notes.features,
  ...notes.improvements,
  ...notes.fixes,
].join("\n\n");
await writeFile(
  process.argv[2] || "dist/firefox-metadata.json",
  JSON.stringify(
    {
      version: {
        release_notes: { ru: releaseNotes },
        approval_notes:
          "Source code is attached from the exact release tag. Build with Node.js 26: npm ci; npm run build:extension; node scripts/package-extension.mjs; node scripts/package-firefox.mjs. Firefox output is dist/firefox-unpacked. Authentication remains in the background event page; content scripts only extract user-visible vacancy data. Telegram login is optional; existing email/password reviewer credentials remain supported. The validator reports only React library __html renderer warnings; application code never uses dangerouslySetInnerHTML. Huntflow adds vacancy parsing, with explicit user confirmation before saving.",
      },
    },
    null,
    2,
  ),
);
