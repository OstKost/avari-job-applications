import { readFile } from "node:fs/promises";

const {
  OPERA_SESSION_ID: sessionId,
  OPERA_CSRF_TOKEN: csrfToken,
  OPERA_PACKAGE_ID: packageId,
  TAG: tag,
} = process.env;

if (
  !sessionId ||
  !csrfToken ||
  !packageId ||
  !/^v\d+\.\d+\.\d+$/.test(tag || "")
) {
  throw new Error(
    "Missing Opera publishing configuration (OPERA_SESSION_ID, OPERA_CSRF_TOKEN, OPERA_PACKAGE_ID, TAG)",
  );
}

const wantedVersion = tag.slice(1);
const archivePath = process.argv[2];
if (!archivePath) {
  throw new Error(
    "Usage: node publish-opera.mjs <path-to-avari-extension.zip>",
  );
}

const cookieHeader = `sessionid=${sessionId}; csrftoken=${csrfToken}`;
const baseHeaders = {
  Accept: "application/json; version=1.0",
  "X-CSRFToken": csrfToken,
  Cookie: cookieHeader,
  Referer: `https://addons.opera.com/developer/package/${packageId}/`,
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
    throw new Error(
      `Opera API ${response.status} (${path}): ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data)}`,
    );
  }
  return data;
}

console.log(`Checking Opera package ${packageId}...`);
const pkg = await api(`/api/developer/packages/${packageId}/`);

if (process.env.OPERA_DIAGNOSTICS === "true") {
  console.log("Package response fields: " + Object.keys(pkg).join(", "));
  console.log("Versions: " + JSON.stringify(pkg.versions));
  const html = await (
    await fetch(`https://addons.opera.com/developer/package/${packageId}/`, {
      headers: baseHeaders,
    })
  ).text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(
    (m) => new URL(m[1], "https://addons.opera.com").href,
  );
  for (const url of scripts) {
    if (
      !url.startsWith("https://addons-static.operacdn.com/") &&
      !url.startsWith("https://addons.opera.com/static/")
    )
      continue;
    console.log("Opera developer script: " + url);
    const source = await (await fetch(url)).text();
    for (const key of [
      "package-versions",
      "file-upload",
      "flowIdentifier",
      "file_id",
    ]) {
      let at = source.indexOf(key),
        count = 0;
      while (at >= 0 && count++ < 5) {
        console.log(key + ": " + source.slice(Math.max(0, at - 250), at + 500));
        at = source.indexOf(key, at + key.length);
      }
    }
  }
  process.exit(0);
}

const existingVersion = pkg.versions?.find((v) => v.version === wantedVersion);
if (existingVersion && existingVersion.submitted_for_moderation) {
  console.log(
    `Version ${wantedVersion} is already submitted or published on Opera Add-ons`,
  );
  process.exit(0);
}

if (!existingVersion) {
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
    headers: baseHeaders,
    body: fd,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Opera file upload failed: HTTP ${uploadRes.status} - ${text}`,
    );
  }

  console.log(`Registering package version ${wantedVersion}...`);
  await api(
    `/api/developer/package-versions/?package_id=${encodeURIComponent(packageId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata_from: pkg.versions?.[0]?.version || null,
        file_id: identifier,
        file_name: filename,
      }),
    },
  );
}

console.log(`Submitting version ${wantedVersion} for moderation...`);
await api(
  `/api/developer/package-versions/${packageId}-${wantedVersion}/submit_for_moderation/`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  },
);

const confirmed = await api(`/api/developer/packages/${packageId}/`);
if (
  !confirmed.versions?.some(
    (v) => v.version === wantedVersion && v.submitted_for_moderation,
  )
) {
  throw new Error("Opera did not confirm submission for moderation");
}
console.log(`Successfully submitted ${wantedVersion} to Opera Add-ons!`);
