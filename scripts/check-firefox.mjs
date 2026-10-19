import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const source = process.argv[2] || "dist/firefox-unpacked";
const result = JSON.parse(
  execFileSync(
    "npx",
    [
      "--yes",
      "web-ext@10.8.0",
      "lint",
      "--source-dir",
      source,
      "--output",
      "json",
    ],
    { encoding: "utf8" },
  ),
);
function usesRawHTML(directory) {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? usesRawHTML(file)
      : /\.tsx?$/.test(file) &&
          readFileSync(file, "utf8").includes("dangerouslySetInnerHTML");
  });
}
const rawHTML =
  usesRawHTML("apps/extension/src") || usesRawHTML("packages/shared/src");
const unexpected = result.warnings.filter((warning) => {
  // React ships its generic __html renderer even though the app never uses it.
  // No other code warning, file or manifest warning is accepted.
  if (
    rawHTML ||
    warning.code !== "UNSAFE_VAR_ASSIGNMENT" ||
    !/^assets\/styles-[\w-]+\.js$/.test(warning.file)
  )
    return true;
  const line = readFileSync(path.join(source, warning.file), "utf8").split(
    "\n",
  )[warning.line - 1];
  return !line
    .slice(Math.max(0, warning.column - 100), warning.column + 50)
    .includes("__html");
});
if (result.errors.length || unexpected.length)
  throw new Error(
    JSON.stringify({ errors: result.errors, warnings: unexpected }, null, 2),
  );
console.log(
  `Firefox validation: no errors or unexpected warnings (${result.warnings.length} known React renderer warnings; no application raw HTML).`,
);
