import { readFile } from "node:fs/promises";

const {
  CHROME_ACCESS_TOKEN: token,
  CHROME_PUBLISHER_ID: publisher,
  CHROME_EXTENSION_ID: extension,
  TAG: tag,
} = process.env;
if (!token || !publisher || !extension || !/^v\d+\.\d+\.\d+$/.test(tag || ""))
  throw new Error("Missing Chrome publishing configuration");
if (!/^[a-z0-9_-]+$/i.test(publisher) || !/^[a-p]{32}$/.test(extension))
  throw new Error("Invalid Chrome publisher or extension ID");
const name = `publishers/${publisher}/items/${extension}`;
const base = `https://chromewebstore.googleapis.com/v2/${name}`;
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `Chrome Web Store API ${response.status}: ${JSON.stringify(data)}`,
    );
  return data;
}
function version(status) {
  return status?.distributionChannels?.[0]?.crxVersion;
}
const wanted = tag.slice(1);
const current = await request(`${base}:fetchStatus`);
const submitted = current.submittedItemRevisionStatus;
if (
  version(current.publishedItemRevisionStatus) === wanted ||
  (version(submitted) === wanted && submitted.state === "PENDING_REVIEW")
) {
  console.log(`Version ${wanted} is already published or submitted`);
  process.exit(0);
}
if (submitted && !["REJECTED", "CANCELLED"].includes(submitted.state))
  throw new Error(
    "Another version is under review or staged; resolve it in the Developer Dashboard",
  );
if (version(submitted) === wanted)
  throw new Error(
    "This version was rejected or cancelled; resolve the submission or release a new version",
  );
const archive = await readFile(process.argv[2]);
const uploaded = await request(
  `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
  {
    method: "POST",
    body: archive,
    headers: { "Content-Type": "application/zip" },
  },
);
const pendingStates = ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"];
const successStates = ["SUCCEEDED", "SUCCESS"];
if (pendingStates.includes(uploaded.uploadState)) {
  let complete = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await request(`${base}:fetchStatus`);
    if (pendingStates.includes(status.lastAsyncUploadState)) continue;
    if (!successStates.includes(status.lastAsyncUploadState))
      throw new Error(`Chrome upload failed: ${status.lastAsyncUploadState}`);
    complete = true;
    break;
  }
  if (!complete)
    throw new Error("Chrome upload timed out; check status before retrying");
}
if (![...successStates, ...pendingStates].includes(uploaded.uploadState))
  throw new Error(`Chrome upload failed: ${uploaded.uploadState}`);
if (uploaded.crxVersion && uploaded.crxVersion !== wanted)
  throw new Error("Uploaded Chrome version does not match the release");
const result = await request(`${base}:publish`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
console.log(`Submitted ${wanted} for Chrome review: ${JSON.stringify(result)}`);
