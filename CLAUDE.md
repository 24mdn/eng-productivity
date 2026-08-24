@AGENTS.md

# Project: Mal Engineering Productivity prototype

See README.md for what this is and current milestone status. This file is implementation-detail
context for future Claude Code sessions working in this (Next.js) directory. `api/` is now an
offline GitHub-ingestion job only (see `api/CLAUDE.md`) — it doesn't serve any live request;
`TRANSITION.md` has the full history of why the FastAPI read path was removed and moved here.

## Data flow / architecture

```
GitHub API --> api/ (Python, offline ingestion) --> Supabase Postgres (RLS enforced)
                                                                ^
                                    lib/metrics-repository.ts (the only data-access boundary)
                                                                ^
                                    app/dashboard/{exec,engineer}/**  (never fetches directly)
```

The dashboard never talks to GitHub. Every read — weekly aggregates *and* the per-metric
drill-down "receipts" — comes from Postgres, populated by ingestion ahead of time, not fetched
live on click (that live-fetch path existed briefly right after the FastAPI removal and was
replaced once it became clear it had no rate limiting and no resilience to GitHub being slow —
see `TRANSITION.md`/git history if you need the old design).

- `lib/metrics-repository.ts` — every exported function resolves the current user's Supabase
  access token (via `lib/supabase/server.ts`'s `getAccessToken()`) into an RLS-scoped Postgres
  client (`lib/supabase/rls-client.ts`) — bound by call site, not a shared branching function:
  `getAllLatestSnapshots`/`getPreviousSnapshot` (used only by `exec/page.tsx`'s summary cards)
  always hit the cross-squad aggregate, latest-vs-previous-week only; `getAggregateSnapshots`/
  `getAggregateDrillDownRecords` (used by `exec/[metric]/page.tsx`) are exec's counterpart to
  the engineer drill-down — same aggregate data, but the full `WEEKS_TO_RETURN` history plus
  records, tagged with each record's `squadName` since exec's records span multiple squads
  (engineer's drill-down omits that field — every record is already the caller's own squad).
  `getMetricSnapshots`/`getDrillDownRecords` (used by `engineer/**`) resolve the caller's own
  `squadId`. Both drill-down paths share `getRecordsInternal(squadId, ...)` — `squadId: null`
  means "every squad," used only by the exec path. `getDrillDownRecords`/
  `getAggregateDrillDownRecords` read `metric_records` scoped to the *latest ingested week* (via
  `metrics_snapshots`' most recent `week_start` — globally for exec, per-squad for engineer, not
  "today's calendar week" — ingestion is manual, those aren't the same thing) and return which
  week they resolved to alongside the records, so the UI can say what it's showing instead of
  implying the records cover every week in the snapshot table above them. A `requireExec()`/
  `requireSquadAccess()` guard mirrors the old FastAPI route-level RBAC as a fast-fail layer —
  RLS is still the real enforcement underneath. Each metric has its own sample-size column on
  `metrics_snapshots` (`METRIC_COLUMNS[key].sampleSizeColumn`) — don't reuse the bare
  `sample_size` column (deployment_frequency's own) as a stand-in weight for the other 4 metrics
  in `getAggregateSnapshotsInternal`'s cross-squad weighting; that was a real bug (each metric's
  weighted rollup was silently using deploy count as its weight regardless of that metric's own
  underlying volume) fixed via `supabase/migrations/20260824180000_per_metric_sample_size.sql`.
- `components/drill-down-table.tsx`'s `DrillDownTable` takes a `hideActor` prop, set on the exec
  drill-down page only (`app/dashboard/exec/[metric]/page.tsx`) — an org-level exec/CEO-office
  summary must never expose which individual engineer authored a PR/commit; the engineer
  (squad-level) drill-down keeps the Actor column since that audience needs per-person
  accountability within their own squad. If you add another cross-squad/exec-facing view that
  renders `DrillDownRecord`s, pass `hideActor` there too.
- `lib/squads.ts` — squad → GitHub repo metadata, read from the `squads` table (single source of
  truth, `cache()`-wrapped). `api/app/squads.py` is ingestion's separate copy of the same table
  access, kept in sync only in the sense that both read the same rows — there's no shared code
  between the two languages here, just a shared table.
- `lib/supabase/server.ts` — `getCurrentUser()` (trust decisions — validates against Supabase's
  Auth server), `getCurrentProfile()` (role/squad — `squadId` is nullable, `null` for the exec
  role, scoped by RLS's `users read own row` policy, not an explicit filter), `getAccessToken()`
  (used to build the RLS-scoped Postgres client directly). All wrapped in React `cache()` so
  `layout.tsx` and the page below it don't double-fetch. `lib/supabase/client.ts` is browser-only,
  used solely by the login form and the logout control.
- No `middleware.ts` — a deliberate choice for 6 fixed demo users in one sitting (a stale session
  just means re-login, not a security gap — RLS doesn't depend on middleware existing).
- `components/proxy-caveat-banner.tsx` takes a `squads: SquadMeta[]` prop and picks its copy from
  each squad's `deployProxy` tier (`workflow_run` | `merge_to_default` | `commit`) — don't
  hardcode caveat copy elsewhere; this is the one place it should change. Ingestion refreshes
  `deployProxy`/`hasActions` on every run so this can't silently go stale if a repo's CI/PR usage
  changes.
- `lib/metrics.ts`, `lib/github/*` are **not** part of the live read path — they back only
  `scripts/inspect-and-fetch.ts`, a standalone verification CLI. `api/app/derive.py` +
  `github_client.py` are ingestion's separate copy of the same formula/fetch logic, kept in sync
  manually; that's the code that actually populates `metrics_snapshots`/`metric_records`.

## Conventions

- Data-access functions in `metrics-repository.ts` are the only files UI components should read
  metrics from. Don't query Supabase or call GitHub directly from a page/component.
- Metric keys are the string union in `metrics-repository.ts` (`MetricKey`) — used as URL params
  (`/dashboard/engineer/[metric]`), object keys, and Postgres's `metric_key`-shaped columns. Keep
  them in sync across both languages if you ever rename one (`api/app/derive.py`'s
  `METRIC_COLUMNS`-equivalent naming is the Python side of this).
- Brand tokens are hex values in `app/globals.css` `:root` (see README's "Design tokens"). Reuse
  `var(--chart-1..5)` for anything metric-colored rather than picking new colors.
- No dark mode — Mal's brand here is a fixed light palette; don't add `prefers-color-scheme`
  handling unless asked.
- Role guards: `exec/page.tsx` redirects non-exec users to `/dashboard/engineer`, and
  `engineer/page.tsx`/`engineer/[metric]/page.tsx` redirect non-engineer users (i.e. exec) back to
  `/dashboard/exec` — both directions are UX only, the real backstop is
  `requireExec()`/`requireSquadAccess()` + RLS, both in `lib/metrics-repository.ts`.
  `dashboard-nav.tsx` hides each tab from the other role entirely rather than relying solely on
  the redirect (exec never sees "Engineer view", engineers never see "Exec summary"). The
  engineer-side redirect exists because `getMetricSnapshots`/`getDrillDownRecords` always key off
  `profile.squadId`, which is `null` for exec — without the redirect, exec would silently see an
  empty engineer view instead of an error or a real cross-squad drill-down.

## What's left

- A real deploy target on at least one repo's CI workflow — see README's "Known limitation."
- `lead_time_for_changes` stays null on every squad now that all 5 run on the `workflow_run`
  deploy-proxy tier — `derive_deploy_events`'s CI-tier branch never sets
  `pull_request_number` (`api/app/derive.py:217`, mirrored in `lib/metrics.ts`), so there's no
  deploy-event → PR correlation to compute lead time from even when a real PR exists (confirmed
  directly: merging a real PR on `lhagli-api` populated `pr_review_turnaround`, which doesn't
  need that correlation, but left `lead_time_for_changes` null). Fixing it means fetching each
  workflow run's `head_sha` and each PR's `merge_commit_sha` (neither is fetched today —
  `FetchedWorkflowRun`/`FetchedPullRequest` don't have those fields) and matching them, in both
  `derive.py` and its `lib/metrics.ts` mirror.

Done: scheduled ingestion (repo secrets set, weekly cron verified working end-to-end via a real
`workflow_dispatch` run against the live Supabase project), 90-day plan (in README.md),
deployment (https://eng-productivity.vercel.app, linked to

Done: deployment (https://eng-productivity.vercel.app, linked to
`github.com/24mdn/eng-productivity`), confirmed publicly reachable with no auth gate. N6
(manual RBAC/squad-isolation verification) confirmed against both the local dev server and the
deployed URL — exec sees the cross-squad aggregate, engineer accounts are scoped to their own
squad only.
