import type { Application } from "./index";
import type { components } from "./generated-api";
import { jobIdentity } from "./job-sites";

export type VacancyPreview = components["schemas"]["VacancyPreview"];

// Invoke synchronously from the button click, before opening the modal.
export function readVacancyClipboard(): Promise<string> {
  try {
    return (
      navigator.clipboard
        ?.readText()
        .then((text) => {
          const value = text.trim();
          return value.length <= 2048 && jobIdentity(value) ? value : "";
        })
        .catch(() => "") ?? Promise.resolve("")
    );
  } catch {
    return Promise.resolve("");
  }
}

export function mergeVacancyPreview(
  current: Application,
  preview: VacancyPreview,
  baseline: Application = current,
): Application {
  const next = { ...current, salary: { ...current.salary } };
  for (const key of [
    "company",
    "position",
    "location",
    "workFormat",
    "companyLogo",
  ] as const) {
    const value = preview.fields[key];
    if (
      typeof value === "string" &&
      value.trim() &&
      current[key] === baseline[key]
    )
      next[key] = value;
  }
  for (const key of ["min", "max", "currency", "period", "tax"] as const) {
    const value = preview.fields.salary?.[key];
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      current.salary[key] === baseline.salary[key]
    ) {
      // Each key retains the corresponding Salary property type.
      Object.assign(next.salary, { [key]: value });
    }
  }
  if (current.url === baseline.url) next.url = preview.url;
  return next;
}
