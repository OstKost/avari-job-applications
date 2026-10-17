import { useState, useEffect, useRef, useMemo, useCallback, type SetStateAction } from "react";
import type { Application, Field, Task, User } from "@avari/shared";
import { stages, states, sortTasks, APIError, dateToday } from "@avari/shared";

export interface StoredListPreferences {
  search?: string;
  stage?: string;
  state?: string;
  priority?: string;
  vacancyGroup?: string;
  vacancyTag?: string;
  hasTask?: boolean;
  order?: string;
  selectedGroup?: string;
  grouping?: string;
  cards?: boolean;
  statistics?: boolean;
  page?: number;
  collapsed?: string[];
}

export function getListStorageKey(userId: string, pageType: "applications" | "favorites"): string {
  return `avari-filters:${pageType}:${userId}`;
}

export function loadStoredListPreferences(
  userId: string,
  pageType: "applications" | "favorites",
): StoredListPreferences {
  const key = getListStorageKey(userId, pageType);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const validated: StoredListPreferences = {};
        if (typeof parsed.search === "string") validated.search = parsed.search;
        if (typeof parsed.stage === "string" && (parsed.stage in stages || parsed.stage === "")) {
          validated.stage = parsed.stage;
        }
        if (typeof parsed.state === "string" && (parsed.state in states || parsed.state === "")) {
          validated.state = parsed.state;
        }
        if (typeof parsed.priority === "string") validated.priority = parsed.priority;
        if (typeof parsed.vacancyGroup === "string") validated.vacancyGroup = parsed.vacancyGroup;
        if (typeof parsed.vacancyTag === "string") validated.vacancyTag = parsed.vacancyTag;
        if (typeof parsed.hasTask === "boolean") validated.hasTask = parsed.hasTask;
        if (typeof parsed.order === "string" && ["recent", "company", "task"].includes(parsed.order)) {
          validated.order = parsed.order;
        }
        if (typeof parsed.selectedGroup === "string") validated.selectedGroup = parsed.selectedGroup;
        if (typeof parsed.grouping === "string" && ["stage", "state", "group", "priority"].includes(parsed.grouping)) {
          validated.grouping = parsed.grouping;
        } else if (parsed.grouping === "") {
          validated.grouping = "";
        }
        if (typeof parsed.cards === "boolean") validated.cards = parsed.cards;
        if (typeof parsed.statistics === "boolean") validated.statistics = parsed.statistics;

        // Finite integer page >= 0
        if (typeof parsed.page === "number" && Number.isFinite(parsed.page) && Math.floor(parsed.page) === parsed.page && parsed.page >= 0) {
          validated.page = parsed.page;
        }

        // Validate collapsed array of non-empty strings
        if (Array.isArray(parsed.collapsed)) {
          validated.collapsed = parsed.collapsed.filter((x: unknown): x is string => typeof x === "string");
        }

        return validated;
      }
    }
  } catch {
    /* ignore storage failure */
  }

  // Fallback to legacy avari-table:userId for view preferences if primary key empty
  try {
    const legacyRaw = localStorage.getItem("avari-table:" + userId);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (parsed && typeof parsed === "object") {
        return {
          grouping: ["stage", "state", "group", "priority"].includes(parsed.group)
            ? parsed.group
            : "",
          cards: parsed.cards === true,
          statistics: parsed.statistics !== false,
        };
      }
    }
  } catch {}

  return {};
}

export function saveStoredListPreferences(
  userId: string,
  pageType: "applications" | "favorites",
  prefs: StoredListPreferences,
) {
  const key = getListStorageKey(userId, pageType);
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {}

  // Also maintain avari-table:userId for general card/stat preferences
  try {
    localStorage.setItem(
      "avari-table:" + userId,
      JSON.stringify({
        group: prefs.grouping ?? "",
        cards: prefs.cards === true,
        statistics: prefs.statistics !== false,
      }),
    );
  } catch {}
}

export interface UseApplicationListOptions {
  user: User;
  applications: Application[];
  tasks: Task[];
  fields: Field[];
  favoriteOnly?: boolean;
  api: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  refresh: () => Promise<void> | void;
}

export function useApplicationList({
  user,
  applications,
  tasks,
  fields,
  favoriteOnly = false,
  api,
  refresh,
}: UseApplicationListOptions) {
  const pageType = favoriteOnly ? "favorites" : "applications";
  const initialPrefs = useMemo(
    () => loadStoredListPreferences(user.id, pageType),
    [user.id, pageType],
  );

  const [vacancyGroup, setVacancyGroupRaw] = useState<string>(
    () => (typeof initialPrefs.vacancyGroup === "string" ? initialPrefs.vacancyGroup : ""),
  );
  const [vacancyTag, setVacancyTagRaw] = useState<string>(
    () => (typeof initialPrefs.vacancyTag === "string" ? initialPrefs.vacancyTag : ""),
  );
  const [search, setSearchRaw] = useState<string>(
    () => (typeof initialPrefs.search === "string" ? initialPrefs.search : ""),
  );
  const [stage, setStageRaw] = useState<string>(
    () => (typeof initialPrefs.stage === "string" ? initialPrefs.stage : ""),
  );
  const [state, setStateRaw] = useState<string>(
    () => (typeof initialPrefs.state === "string" ? initialPrefs.state : ""),
  );
  const [priority, setPriorityRaw] = useState<string>(
    () => (typeof initialPrefs.priority === "string" ? initialPrefs.priority : ""),
  );
  const [hasTask, setHasTaskRaw] = useState<boolean>(
    () => Boolean(initialPrefs.hasTask),
  );
  const [order, setOrderRaw] = useState<string>(() =>
    ["recent", "company", "task"].includes(initialPrefs.order ?? "")
      ? initialPrefs.order!
      : "recent",
  );
  const [selectedGroup, setSelectedGroup] = useState<string>(
    () => (typeof initialPrefs.selectedGroup === "string" ? initialPrefs.selectedGroup : ""),
  );
  const [grouping, setGroupingRaw] = useState<string>(() =>
    ["stage", "state", "group", "priority"].includes(initialPrefs.grouping ?? "")
      ? initialPrefs.grouping!
      : "",
  );
  const [cards, setCards] = useState<boolean>(
    () => Boolean(initialPrefs.cards),
  );
  const [statistics, setStatistics] = useState<boolean>(
    () => initialPrefs.statistics !== false,
  );
  const [page, setPage] = useState<number>(() =>
    typeof initialPrefs.page === "number" && initialPrefs.page >= 0
      ? initialPrefs.page
      : 0,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    Array.isArray(initialPrefs.collapsed)
      ? new Set(initialPrefs.collapsed)
      : new Set(),
  );

  const resetPaginationOnFilterChange = useCallback(() => {
    setPage(0);
    setCollapsed(new Set());
    setSelectedGroup("");
  }, []);

  const setVacancyGroup = useCallback((value: SetStateAction<string>) => {
    setVacancyGroupRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setVacancyTag = useCallback((value: SetStateAction<string>) => {
    setVacancyTagRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setSearch = useCallback((value: SetStateAction<string>) => {
    setSearchRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setStage = useCallback((value: SetStateAction<string>) => {
    setStageRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setState = useCallback((value: SetStateAction<string>) => {
    setStateRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setPriority = useCallback((value: SetStateAction<string>) => {
    setPriorityRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setHasTask = useCallback((value: SetStateAction<boolean>) => {
    setHasTaskRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setOrder = useCallback((value: SetStateAction<string>) => {
    setOrderRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const setGrouping = useCallback((value: SetStateAction<string>) => {
    setGroupingRaw(value);
    resetPaginationOnFilterChange();
  }, [resetPaginationOnFilterChange]);

  const pf = fields.find((f) => f.role === "priority");

  const vacancyGroups = useMemo(
    () =>
      Array.from(
        new Set(applications.flatMap((a) => a.groups ?? [])),
      ).sort((a, b) => a.localeCompare(b, "ru")),
    [applications],
  );

  const vacancyTags = useMemo(
    () =>
      Array.from(
        new Set(applications.flatMap((a) => a.tags ?? [])),
      ).sort((a, b) => a.localeCompare(b, "ru")),
    [applications],
  );

  const next = useMemo(() => {
    const taskMap = new Map<string, Task>();
    for (const t of sortTasks(tasks.filter((taskItem) => taskItem.state === "open"))) {
      if (!taskMap.has(t.applicationId)) {
        taskMap.set(t.applicationId, t);
      }
    }
    return (id: string) => taskMap.get(id);
  }, [tasks]);

  const baseList = useMemo(() => {
    return applications
      .filter((a) => {
        if (favoriteOnly && !a.favorite) return false;
        if (
          search &&
          !(a.company + " " + a.position)
            .toLocaleLowerCase("ru")
            .includes(search.toLocaleLowerCase("ru"))
        ) {
          return false;
        }
        if (vacancyGroup) {
          if (vacancyGroup === "__ungrouped") {
            if (a.groups?.length) return false;
          } else {
            if (!a.groups?.includes(vacancyGroup)) return false;
          }
        }
        if (vacancyTag && !a.tags?.includes(vacancyTag)) return false;
        if (stage && a.stage !== stage) return false;
        if (state && a.state !== state) return false;
        if (priority && pf && a.custom[pf.id] !== priority) return false;
        if (hasTask && !next(a.id)) return false;
        return true;
      })
      .sort((a, b) =>
        order === "company"
          ? a.company.localeCompare(b.company, "ru")
          : order === "task"
            ? (next(a.id)?.date ?? "9999").localeCompare(
                next(b.id)?.date ?? "9999",
              )
            : b.savedDate.localeCompare(a.savedDate) ||
              b.createdAt.localeCompare(a.createdAt),
      );
  }, [
    applications,
    favoriteOnly,
    search,
    vacancyGroup,
    vacancyTag,
    stage,
    state,
    priority,
    pf,
    hasTask,
    next,
    order,
  ]);

  const groupKey = (a: Application) =>
    grouping === "group"
      ? (a.groups?.[0] ?? "Без группы")
      : grouping === "priority"
        ? String(pf ? (a.custom[pf.id] ?? "Без приоритета") : "Без приоритета")
        : grouping === "state"
          ? a.state
          : a.stage;

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (grouping) {
      for (const application of baseList) {
        const key = groupKey(application);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [grouping, baseList, pf]);

  const list = useMemo(() => {
    return selectedGroup
      ? baseList.filter((a) => groupKey(a) === selectedGroup)
      : baseList;
  }, [baseList, selectedGroup, grouping, pf]);

  const pageCount = Math.max(1, Math.ceil(list.length / 20));
  const currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const visible = list.slice(currentPage * 20, currentPage * 20 + 20);

  const grouped = useMemo(() => {
    if (!grouping) {
      return [["", visible] as [string, Application[]]];
    }
    const map = new Map<string, Application[]>();
    for (const a of visible) {
      const key = groupKey(a);
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      grouping === "stage"
        ? Object.keys(stages).indexOf(a) - Object.keys(stages).indexOf(b)
        : grouping === "group"
          ? a === "Без группы"
            ? 1
            : b === "Без группы"
              ? -1
              : a.localeCompare(b, "ru")
          : a.localeCompare(b, "ru"),
    );
  }, [grouping, visible, pf]);

  const groupLabel = (key: string) =>
    grouping === "stage"
      ? stages[key] || key
      : grouping === "state"
        ? states[key] || key
        : key;

  const toggleCollapsed = (key: string) => {
    setCollapsed((previous) => {
      const updated = new Set(previous);
      if (updated.has(key)) updated.delete(key);
      else updated.add(key);
      return updated;
    });
  };

  const resetFilters = () => {
    setVacancyGroup("");
    setVacancyTag("");
    setSearch("");
    setStage("");
    setState("");
    setPriority("");
    setHasTask(false);
    setSelectedGroup("");
    setPage(0);
  };

  // Persist filter & view preferences per account & page
  useEffect(() => {
    // During initial async empty applications load, do NOT overwrite saved page with clamped zero
    const pageToPersist = applications.length === 0 ? page : currentPage;
    saveStoredListPreferences(user.id, pageType, {
      search,
      stage,
      state,
      priority,
      vacancyGroup,
      vacancyTag,
      hasTask,
      order,
      selectedGroup,
      grouping,
      cards,
      statistics,
      page: pageToPersist,
      collapsed: Array.from(collapsed),
    });
  }, [
    user.id,
    pageType,
    applications.length,
    page,
    currentPage,
    search,
    stage,
    state,
    priority,
    vacancyGroup,
    vacancyTag,
    hasTask,
    order,
    selectedGroup,
    grouping,
    cards,
    statistics,
    currentPage,
    collapsed,
  ]);

  // Save handling with synchronous ref lock and 409 conflict safety
  const savingIdsRef = useRef<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<unknown>();
  const [conflictApp, setConflictApp] = useState<{
    local: Application;
    server: Application;
    patch?: {
      type: "stage" | "state" | "favorite";
      stage?: string;
      state?: string;
      outcome?: string;
      favorite?: boolean;
    };
  } | null>(null);
  const [outcomeModalApp, setOutcomeModalApp] = useState<Application | null>(null);
  const [staleModalApp, setStaleModalApp] = useState<Application | null>(null);

  const saveApplication = async (
    updated: Application,
    patchIntent?: {
      type: "stage" | "state" | "favorite";
      stage?: string;
      state?: string;
      outcome?: string;
      favorite?: boolean;
    },
  ) => {
    if (savingIdsRef.current.has(updated.id)) return;
    savingIdsRef.current.add(updated.id);
    setSavingIds(new Set(savingIdsRef.current));
    setSaveError(undefined);
    try {
      await api<Application>("/applications/" + updated.id, "PUT", updated);
      setConflictApp(null);
      await refresh();
    } catch (err) {
      if (err instanceof APIError && err.status === 409) {
        // Retain server version, do not blindly overwrite, refresh queries
        const serverApp = err.current as Application | undefined;
        if (serverApp) {
          setConflictApp({ local: updated, server: serverApp, patch: patchIntent });
          setOutcomeModalApp((current) =>
            current && current.id === serverApp.id ? serverApp : current,
          );
          setStaleModalApp((current) =>
            current && current.id === serverApp.id ? serverApp : current,
          );
        }
        await refresh();
      }
      setSaveError(err);
      throw err;
    } finally {
      savingIdsRef.current.delete(updated.id);
      setSavingIds(new Set(savingIdsRef.current));
    }
  };

  const handleStageChange = async (a: Application, newStage: string) => {
    if (a.stage === newStage || savingIdsRef.current.has(a.id)) return;
    const appliedDate =
      newStage !== "saved" && !a.appliedDate ? dateToday(user.timezone) : a.appliedDate;
    try {
      await saveApplication(
        { ...a, stage: newStage, appliedDate },
        { type: "stage", stage: newStage },
      );
    } catch {
      /* error captured in saveError state */
    }
  };

  const handleStateChange = async (a: Application, newState: string) => {
    if (a.state === newState || savingIdsRef.current.has(a.id)) return;
    if (newState === "closed") {
      setOutcomeModalApp(a);
      return;
    }
    // Paused or active clears incompatible outcome via API rules
    try {
      await saveApplication(
        { ...a, state: newState, outcome: "" },
        { type: "state", state: newState, outcome: "" },
      );
    } catch {
      /* error captured in saveError state */
    }
  };

  const handleConfirmOutcome = async (outcome: string) => {
    if (!outcomeModalApp) return;
    const app = outcomeModalApp;
    // Do NOT dismiss modal before await; outcome modal stays open until success
    await saveApplication(
      { ...app, state: "closed", outcome },
      { type: "state", state: "closed", outcome },
    );
    setOutcomeModalApp(null);
  };

  const handleCancelOutcome = () => {
    setOutcomeModalApp(null);
  };

  const toggleFavorite = async (a: Application) => {
    if (savingIdsRef.current.has(a.id)) return;
    const nextFavorite = !a.favorite;
    try {
      await saveApplication(
        { ...a, favorite: nextFavorite },
        { type: "favorite", favorite: nextFavorite },
      );
    } catch {
      /* error captured in saveError state */
    }
  };

  const handleStalePause = async () => {
    if (!staleModalApp) return;
    const app = staleModalApp;
    await saveApplication(
      { ...app, state: "paused", outcome: "" },
      { type: "state", state: "paused", outcome: "" },
    );
    setStaleModalApp(null);
  };

  const handleStaleCloseOutcome = async (outcome: string) => {
    if (!staleModalApp) return;
    const app = staleModalApp;
    await saveApplication(
      { ...app, state: "closed", outcome },
      { type: "state", state: "closed", outcome },
    );
    setStaleModalApp(null);
  };

  const creatingTaskRef = useRef(false);

  const handleStaleCreateTask = async (task: { title: string; date: string; time: string }) => {
    if (!staleModalApp || creatingTaskRef.current) return;
    creatingTaskRef.current = true;
    const app = staleModalApp;
    try {
      await api("/tasks", "POST", {
        applicationId: app.id,
        title: task.title,
        date: task.date,
        time: task.time,
        state: "open",
      });
      await refresh();
      setStaleModalApp(null);
    } finally {
      creatingTaskRef.current = false;
    }
  };

  const filterCount =
    (vacancyGroup ? 1 : 0) +
    (vacancyTag ? 1 : 0) +
    (stage ? 1 : 0) +
    (priority ? 1 : 0) +
    (hasTask ? 1 : 0) +
    (search ? 1 : 0);

  const activeFilters = !!(
    vacancyGroup ||
    vacancyTag ||
    search ||
    stage ||
    state ||
    priority ||
    hasTask ||
    selectedGroup
  );

  const active = list.filter((a) => a.state === "active").length;
  const advanced = list.filter((a) =>
    ["hr", "interview", "final", "offer"].includes(a.stage),
  ).length;
  const rate = list.length ? Math.round((advanced / list.length) * 100) : 0;

  return {
    vacancyGroup,
    setVacancyGroup,
    vacancyGroups,
    vacancyTag,
    setVacancyTag,
    vacancyTags,
    search,
    setSearch,
    stage,
    setStage,
    state,
    setState,
    priority,
    setPriority,
    hasTask,
    setHasTask,
    order,
    setOrder,
    selectedGroup,
    setSelectedGroup,
    grouping,
    setGrouping,
    cards,
    setCards,
    statistics,
    setStatistics,
    page,
    setPage,
    collapsed,
    toggleCollapsed,
    baseList,
    list,
    visible,
    grouped,
    groupCounts,
    groupLabel,
    pageCount,
    currentPage,
    resetFilters,
    filterCount,
    activeFilters,
    active,
    advanced,
    rate,
    pf,
    next,
    savingIds,
    saveError,
    setSaveError,
    conflictApp,
    setConflictApp,
    retryConflict: async () => {
      if (!conflictApp || !conflictApp.patch) return;
      const { server: serverApp, patch } = conflictApp;
      let patchFields: Partial<Application> = {};

      if (patch.type === "stage" && patch.stage !== undefined) {
        // Sparse stage update: preserve concurrent server changes to favorite, state, outcome, contact, salary, etc.
        // appliedDate auto-fill is derived: preserve latest nonempty server appliedDate; fill only if current still empty
        const appliedDate =
          (serverApp.stage === "saved" || !serverApp.appliedDate) && patch.stage !== "saved"
            ? (serverApp.appliedDate || dateToday(user.timezone))
            : serverApp.appliedDate;
        patchFields = {
          stage: patch.stage,
          appliedDate,
        };
      } else if (patch.type === "state" && patch.state !== undefined) {
        // Sparse state update: preserve concurrent company, contact, salary, favorite, etc.
        patchFields = {
          state: patch.state,
          outcome: patch.outcome ?? (patch.state === "closed" ? conflictApp.local.outcome : ""),
        };
      } else if (patch.type === "favorite" && patch.favorite !== undefined) {
        // Sparse favorite update
        patchFields = {
          favorite: patch.favorite,
        };
      } else {
        // Untracked patch intent: do not blindly overwrite, require refresh
        return;
      }

      const toSave: Application = {
        ...serverApp,
        ...patchFields,
        version: serverApp.version,
      };

      try {
        await saveApplication(toSave, patch);
      } catch {
        /* rejection captured in saveError state, prevent unhandled rejection */
      }
    },
    outcomeModalApp,
    setOutcomeModalApp,
    staleModalApp,
    setStaleModalApp,
    handleStageChange,
    handleStateChange,
    handleConfirmOutcome,
    handleCancelOutcome,
    toggleFavorite,
    handleStalePause,
    handleStaleCloseOutcome,
    handleStaleCreateTask,
  };
}
