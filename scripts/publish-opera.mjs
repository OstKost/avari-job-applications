import { readFile } from "node:fs/promises";

const {
  OPERA_SESSION_ID: sessionId,
  OPERA_CSRF_TOKEN: csrfToken,
  OPERA_PACKAGE_ID: packageId,
  TAG: tag,
} = process.env;

if (!sessionId || !csrfToken || !packageId || !/^v\d+\.\d+\.\d+$/.test(tag || "")) {
  throw new Error("Missing Opera publishing configuration (OPERA_SESSION_ID, OPERA_CSRF_TOKEN, OPERA_PACKAGE_ID, TAG)");
}

const wantedVersion = tag.slice(1);
const archivePath = process.argv[2];
if (!archivePath) {
  throw new Error("Usage: node publish-opera.mjs <path-to-avari-extension.zip>");
}

const cookieHeader = `sessionid=${sessionId}; csrftoken=${csrfToken}`;
const baseHeaders = {
  "Accept": "application/json; version=1.0",
  "X-CSRFToken": csrfToken,
  "Cookie": cookieHeader,
  "Referer": `https://addons.opera.com/developer/package/${packageId}/`,
};

async function api(path, options = {}) {
  const url = `https://addons.opera.com${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...baseHeaders,
      ...options.headers,
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(`Opera API ${response.status} (${path}): ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data)}`);
  }
  return data;
}

console.log(`Checking Opera package ${packageId}...`);
const pkg = await api(`/api/developer/packages/${packageId}/`);

const existingVersion = pkg.versions?.find((v) => v.version === wantedVersion);
if (existingVersion && existingVersion.submitted_for_moderation) {
  console.log(`Version ${wantedVersion} is already submitted or published on Opera Add-ons`);
  process.exit(0);
}

const archive = await readFile(archivePath);
const filename = "avari-extension.zip";
const size = archive.length;
const cleanName = filename.replace(/[^0-9a-zA-Z_-]/gim, "");
const identifier = `${size}-${cleanName}`;

console.log(`Uploading ${filename} (${size} bytes, id: ${identifier})...`);

const fd = new FormData();
fd.append("flowChunkNumber", "1");
fd.append("flowChunkSize", "1048576");
fd.append("flowCurrentChunkSize", size.toString());
fd.append("flowTotalSize", size.toString());
fd.append("flowIdentifier", identifier);
fd.append("flowFilename", filename);
fd.append("flowRelativePath", filename);
fd.append("flowTotalChunks", "1");
fd.append("file", new Blob([archive], { type: "application/zip" }), filename);

const uploadRes = await fetch("https://addons.opera.com/api/file-upload/", {
  method: "POST",
  headers: {
    "X-CSRFToken": csrfToken,
    "Cookie": cookieHeader,
  },
  body: fd,
});

if (!uploadRes.ok) {
  const text = await uploadRes.text().catch(() => "");
  throw new Error(`Opera file upload failed: HTTP ${uploadRes.status} - ${text}`);
}

console.log(`Registering package version ${wantedVersion}...`);
const newVer = await api(`/api/developer/package-versions/`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    package_id: Number(packageId),
    file_id: identifier,
    file_name: filename,
  }),
});

console.log(`Submitting version ${wantedVersion} for moderation...`);
await api(`/api/developer/package-versions/${packageId}-${wantedVersion}/submit_for_moderation/`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

console.log(`Successfully submitted ${wantedVersion} to Opera Add-ons!`);
