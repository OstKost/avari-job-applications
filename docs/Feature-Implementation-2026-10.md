# Approved feature implementation (2026-10)

> **Исторический документ планирования (Октябрь 2026):** Данный документ фиксирует утверждённый план и отчёт о приёмке семи функциональных областей (T0–T7: активность, избранное, резюме, логотипы, напоминания) от 17 октября 2026 года. Последующие работы по PWA, офлайн-режиму, Web Push и автозаполнению ссылок специфицированы в `docs/PWA-Tasks.md` и отражены в `docs/Usage.md`.

Implement through supervised Orca Antigravity workers; coordinator owns integration and acceptance. Preserve unrelated untracked promotional media. Workers commit only their own changes and report commit IDs and tests. Do not deploy or publish.

## T0/T1/T2/T3 UI/T5/T6 UI: web
- Extract reusable application-list state/components from App.tsx where useful; applications and favorites share list behavior.
- Persist search, stage, state, priority, group, tag, has-task, sort and grouping in browser per account and per applications/favorites page. Restore page/collapsed groups on return from detail; filters reset page only on user changes, not initial restore. Invalid storage is harmless; clamp page. Reset filters preserves view/statistics preferences.
- Existing stage/state badges become compact dropdown triggers with unchanged resting visuals, pointer/hover/focus, no permanent arrow. Accessible keyboard and outside/Escape dismissal; portal/positioning avoids clipping. Save immediately except closed state asks required outcome in modal; cancel is no-op. Honor versions/409 without blind overwrite, block duplicate saves, retain old value on error. Support mobile cards without nested interactive links.
- Active application with >240h meaningful inactivity gets warning button immediately left of detail action, also larger by company in detail header. Shared modal offers pause, close with outcome, or editable task form prefilled 'Связаться по вакансии' for next weekday (account timezone, weekends only), no time. Save only after explicit form submission; refresh application/calendar after actions.
- /favorites and sidebar 'Избранные вакансии' reuse list filtered favorite=true; toggle from table/cards/detail. Existing favorite proposals remain confirmation-based. Repeated source observation after manual unfavorite may propose again, not auto-restore; dedupe identical pending proposals. No source-removal sync.
- /resumes and sidebar 'Резюме': named logical resumes, immutable sequential uploaded versions, latest current. Upload as new resume or new version; list filename/format/size/date, download any version, rename resume, confirm deleting version/resume, remove empty resume after last version. Formats PDF MD TXT DOCX DOC ODT RTF; 20MiB/file, 500MiB/account. No preview/extraction/letters now. JSON journal export UI must clearly say resumes are excluded; full DB backup includes them.

## T3/T4 backend: activity and automatic reminders
- Server computes/maintains last meaningful activity and stale flag. Stage/state change, note create/edit, task create/reschedule/complete count. Cosmetic/favorite/logo edits, empty saves, system reminder creation do not. Recover existing timestamps from events, fallback creation.
- Only applications first created after rollout are eligible for automation (not historic imports). Active, saved, no appliedDate, 48h since meaningful activity => one automatic 'Сделать отклик по вакансии' task lifetime per application. Any open linked task suppresses creation while present. User action before trigger restarts 48h.
- Trigger day in user timezone; weekends -> Monday, no time. Startup catch-up uses current available weekday, no past flood. Minute scheduler and startup reconciliation, transactional concurrency/idempotence. User-deleting automatic task does not recreate it. Mark open automatic task done on actual application, pause or close. System task does not count as meaningful activity. Include in normal calendar and ICS.
- Default weekends Sat/Sun, no holiday calendar. Server runs with closed tabs; offline desktop catches up on next start.

## T6 backend: resume originals
- SQLite BLOB table for originals plus metadata so existing VACUUM backup/restore includes files. Stable version IDs/checksums for future extraction. 20MiB/file, 500MiB/account, validate extension/content, safe attachment downloads, existing account auth/CSRF and ownership everywhere, interrupted upload/limit errors. Immutable versions, sequential under concurrency; rename, list, upload, download, delete version/resume. Separate from current JSON journal transfer; document exclusion.
- Publish API contract to coordinator before frontend depends on it; add OpenAPI generator paths and generated types. No office converter/dependency.

## T7 logos
- Fix production CSP to permit HTTPS company images without weakening other directives. Test production middleware.
- Inspect parser -> extension -> API -> persistence -> avatar. Normalize relative logo URLs, lazy DOM/JSON-LD variants; ensure compatibility retry only strips logo for genuinely incompatible server; empty value must not erase saved logo. Existing records enriched on revisiting job with extension, no bulk fetch. Initial fallback survives missing/broken image.

## Validation and ownership
- Backend owns server/core/httpapi/API schema; logo worker owns only CSP change in server.go plus extension changes; coordinate overlaps. Web owner owns web/shared UI. Integration owner merges commits and regenerates shared API after backend changes.
- Tests: controlled clock 48/240h boundaries, timezone/weekends, startup, dedupe/concurrency, user isolation, migration, backup/restore, multipart file validation; UI storage/back navigation, dropdown keyboard/outcome/409, stale actions/calendar, favorites, resume versions; logo real HTTPS and fallback under CSP.
- Run typecheck, Vitest, Go race/vet, API generation consistency, web/extension builds and relevant browser E2E. QA worker independently reviews assembled version and routes fixes to owners.

## Final acceptance — 2026-10-17
- All seven feature areas implemented and committed to `main`; final production source: `1de5c72`.
- Passed TypeScript checking, 119 Vitest tests in 11 files, production web/extension builds, Go race tests and vet, and exact OpenAPI/generated-type consistency.
- Passed all 18 real browser scenarios against temporary authenticated HTTP servers, including MV3 extension and local mode. New coverage verifies filter/page restoration, independent favorites preferences, inline stage/state and outcome cancellation, inactivity actions and calendar reminders, original resume download bytes and versions, modal validation, mobile navigation, dropdown focus/Escape and viewport positioning.
- Browser acceptance exposed and fixed mobile navigation overflow and a dropdown portal focus race. The expanded feature suite reuses its real UI-created session to respect production login rate limits.
- Feature implementation and independent source reviews ran through supervised Orca Antigravity workers. Antigravity exhausted its quota during final browser-test correction; the Codex replacement hit Orca readiness timeout. The coordinator completed acceptance corrections and the final passing run. Failed/superseded attempts have explicit outcomes; no feature blocker remains.
- Resume preview/text extraction remains outside this release as agreed. Automatic reminders apply only to newly created eligible applications after rollout. No deployment or remote publication performed.
