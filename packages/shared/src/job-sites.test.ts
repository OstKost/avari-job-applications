import { describe, expect, it } from "vitest";
import { jobIdentity, jobSite, observationBelongsToPage } from "./job-sites";

describe("job identity", () => {
  it.each([
    ["https://spb.hh.ru/vacancy/123?from=search", "https://hh.ru/vacancy/123"],
    [
      "https://ru.linkedin.com/jobs/view/developer-at-example-123/?trackingId=x",
      "https://www.linkedin.com/jobs/view/123",
    ],
    [
      "https://www.linkedin.com/jobs/search/?currentJobId=123",
      "https://www.linkedin.com/jobs/view/123",
    ],
    [
      "https://getmatch.ru/vacancies/123-backend?s=offers",
      "https://getmatch.ru/vacancies/123",
    ],
    [
      "https://hirify.me/jobs/123-backend?utm_source=x",
      "https://hirify.me/jobs/123",
    ],
    [
      "https://geekjob.ru/vacancy/6acce1f84f35ccbd760b3413?from=search",
      "https://geekjob.ru/vacancy/6acce1f84f35ccbd760b3413",
    ],
    [
      "https://career.habr.com/vacancies/1000169149?s=search",
      "https://career.habr.com/vacancies/1000169149",
    ],
  ])("normalizes %s", (raw, canonical) =>
    expect(jobIdentity(raw)?.url).toBe(canonical),
  );

  it.each([
    "https://linkedin.com.evil.example/jobs/view/123",
    "https://evil.example/hirify.me/jobs/123",
    "https://user@getmatch.ru/vacancies/123",
    "https://hirify.me:444/jobs/123",
    "http://getmatch.ru/vacancies/123",
    "not a url",
  ])("rejects %s", (raw) => expect(jobSite(raw)).toBeUndefined());
  it.each([
    "https://getmatch.ru/vacancies",
    "https://hirify.me/",
    "https://geekjob.ru/vacancies",
    "https://geekjob.ru/geeks",
    "https://career.habr.com/vacancies",
    "https://career.habr.com/companies",
    "https://career.habr.com/salaries",
    "https://www.linkedin.com/in/example",
    "https://getmatch.ru/vacancies/123/apply",
  ])("does not treat unrelated pages as jobs", (raw) =>
    expect(jobIdentity(raw)).toBeUndefined(),
  );
});

describe("observations belong to the opened site", () => {
  it("recognizes new LinkedIn search results", () =>
    expect(
      jobIdentity(
        "https://www.linkedin.com/jobs/search-results/?currentJobId=123",
      )?.url,
    ).toBe("https://www.linkedin.com/jobs/view/123"));
  it.each(["getmatch", "hirify"])(
    "allows %s responses only for its own jobs",
    (site) => {
      const domain = site === "getmatch" ? "getmatch.ru" : "hirify.me";
      const path = site === "getmatch" ? "vacancies" : "jobs";
      const o = {
        vacancyUrl: `https://${domain}/${path}/123`,
        url: `https://${domain}/applications`,
      };
      expect(observationBelongsToPage(o, o.url + "?page=1")).toBe(true);
      expect(observationBelongsToPage(o, `https://${domain}/profile`)).toBe(
        false,
      );
      expect(
        observationBelongsToPage(
          { ...o, vacancyUrl: "https://www.linkedin.com/jobs/view/123" },
          o.url,
        ),
      ).toBe(false);
      expect(
        observationBelongsToPage(
          { ...o, url: `https://${domain}/profile` },
          `https://${domain}/applications`,
        ),
      ).toBe(false);
      expect(observationBelongsToPage(o, `https://${domain}/${path}/456`)).toBe(
        false,
      );
    },
  );
});
