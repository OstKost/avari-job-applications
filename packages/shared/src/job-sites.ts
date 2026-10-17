export const jobSitesLabel =
  "hh.ru, LinkedIn, Getmatch, Hirify, Geekjob и Хабр Карьера";
export type JobSite =
  "hh" | "linkedin" | "getmatch" | "hirify" | "geekjob" | "habr";

export function jobSite(raw: string): JobSite | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return;
    for (const [site, domain] of Object.entries({
      hh: "hh.ru",
      linkedin: "linkedin.com",
      getmatch: "getmatch.ru",
      hirify: "hirify.me",
      geekjob: "geekjob.ru",
      habr: "career.habr.com",
    })) {
      if (url.hostname === domain || url.hostname.endsWith("." + domain))
        return site as JobSite;
    }
  } catch {}
}

export function jobIdentity(raw: string) {
  const site = jobSite(raw);
  if (!site) return;
  const url = new URL(raw);
  let id: string | undefined;
  if (site === "hh") id = url.pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1];
  if (site === "linkedin") {
    id = url.pathname.match(/^\/jobs\/view\/(?:[^/]+-)?(\d+)\/?$/)?.[1];
    if (
      !id &&
      /^\/jobs\/(?:search|search-results|collections)(?:\/|$)/.test(
        url.pathname,
      )
    )
      id = url.searchParams.get("currentJobId")?.match(/^\d+$/)?.[0];
  }
  if (site === "getmatch")
    id = url.pathname.match(/^\/vacancies\/(\d+)(?:-[^/]+)?\/?$/)?.[1];
  if (site === "hirify")
    id = url.pathname.match(/^\/jobs\/(\d+)(?:-[^/]+)?\/?$/)?.[1];
  if (site === "geekjob")
    id = url.pathname.match(/^\/vacancy\/([a-zA-Z0-9]+)\/?$/)?.[1];
  if (site === "habr") id = url.pathname.match(/^\/vacancies\/(\d+)\/?$/)?.[1];
  if (!id) return;
  const canonical =
    {
      hh: "https://hh.ru/vacancy/",
      linkedin: "https://www.linkedin.com/jobs/view/",
      getmatch: "https://getmatch.ru/vacancies/",
      hirify: "https://hirify.me/jobs/",
      geekjob: "https://geekjob.ru/vacancy/",
      habr: "https://career.habr.com/vacancies/",
    }[site] + id;
  return { site, id, url: canonical };
}

export function jobResponsesSite(raw: string): JobSite | undefined {
  const site = jobSite(raw);
  if (!site) return;
  const path = new URL(raw).pathname;
  if (site === "hh" && /^\/applicant\/negotiations\/?$/.test(path)) return site;
  if (
    (site === "getmatch" || site === "hirify") &&
    /^\/applications\/?$/.test(path)
  )
    return site;
}

// Dedicated saved-job lists, plus Habr's list where each row must prove its state.
export function jobFavoritesSite(raw: string): JobSite | undefined {
  const site = jobSite(raw);
  if (!site) return;
  const path = new URL(raw).pathname;
  if (site === "hh" && /^\/applicant\/(?:vacancies|favorites?)\/?$/.test(path))
    return site;
  if (
    site === "linkedin" &&
    /^\/(?:my-items\/saved-jobs|jobs\/collections\/saved)\/?$/.test(path)
  )
    return site;
  if (site === "hirify" && /^\/account\/favorites\/?$/.test(path)) return site;
  if (site === "habr" && /^\/vacancies\/?$/.test(path)) return site;
}

export function observationBelongsToPage(
  observation: {
    hhId?: string;
    vacancyUrl?: string;
    url: string;
    status?: string;
  },
  pageURL: string,
) {
  const site = jobSite(pageURL);
  if (!site || jobSite(observation.url) !== site) return false;
  const page = jobIdentity(pageURL);
  if (site === "hh") {
    return (
      !!observation.hhId &&
      !observation.vacancyUrl &&
      (page
        ? page.id === observation.hhId
        : jobResponsesSite(pageURL) === site ||
          (observation.status === "favorite" &&
            /^\/(?:applicant\/(?:vacancies|favorites?)|search\/vacancy)\/?$/.test(
              new URL(pageURL).pathname,
            )))
    );
  }
  const vacancy = jobIdentity(observation.vacancyUrl ?? "");
  if (observation.hhId || !vacancy || vacancy.site !== site) return false;
  return page
    ? page.url === vacancy.url && jobIdentity(observation.url)?.url === page.url
    : (jobResponsesSite(pageURL) === site &&
        jobResponsesSite(observation.url) === site) ||
        (observation.status === "favorite" &&
          jobFavoritesSite(pageURL) === site &&
          jobFavoritesSite(observation.url) === site);
}
