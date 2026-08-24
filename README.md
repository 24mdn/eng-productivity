# Mal Engineering Productivity — prototype

An internal engineering-productivity platform prototype: pulls delivery data straight from the
GitHub API (no self-reported numbers), computes DORA's four keys plus PR review turnaround (and
a couple of SPACE Activity fields), and serves two dashboards behind real Role-Based Access
Control — a plain-language exec rollup aggregated across every squad, and a per-squad engineer
view where every number drills down to the underlying PRs/deploys/incidents ("receipts").

Built as a demo for an Engineering Productivity Lead application at Mal (AI-native Islamic
digital bank, Abu Dhabi). Styled to match Mal's actual brand (periwinkle background, black/white
pill buttons, Outfit/Inter type) so it reads as an internal Mal tool, not a generic template.

Migration history from the original two-service (FastAPI + Next.js) build to this single-service
Next.js app: `TRANSITION.md`.

**Live:** https://eng-productivity.vercel.app · **Source:** https://github.com/24mdn/eng-productivity

## Architecture

```
GitHub API --> api/ (Python, offline ingestion) --> Supabase Postgres (Row-Level Security)
                                                                ^
                                    Next.js Server Components (this directory)
```

A single Next.js app, deployable on Vercel alone. RBAC (`exec` sees every squad aggregated;
`engineer` sees only their own squad) is enforced by **Postgres Row-Level Security**, not just
application code: even if `lib/metrics-repository.ts`'s app-layer guard had a bug, the database
itself refuses to return another squad's rows. See `CLAUDE.md` for the full rationale.

Next.js holds the Supabase Auth session (cookie-based, via `@supabase/ssr`) and uses the user's
own access token to build an RLS-scoped Postgres client directly — no separate backend service
in the request path. `api/` (Python) still exists, but only as an offline ingestion job you run
manually to populate `metrics_snapshots`; it never serves a live request.

## Status

| Milestone | State |
|---|---|
| N1 — Pure metric formulas (17/17 tests, both Python and TS) | ✅ done |
| N2 — Supabase schema/RLS applied, 6 demo users seeded | ✅ done |
| N3 — Real GitHub ingestion for all 5 squads | ✅ done |
| N4 — RBAC matrix verified live (real JWTs, real data) | ✅ done |
| N5 — FastAPI read path removed, moved into Next.js Server Components | ✅ done |
| N6 — Manual end-to-end browser verification | ✅ done |
| Deployment (single Next.js project, Vercel) | ✅ done — https://eng-productivity.vercel.app |
| Scheduled ingestion (GitHub Actions, weekly + on-demand) | ✅ workflow in place |

**Demo accounts** (Supabase Auth, password `change-me-now-123!` for all): `exec@mal-demo.local`
(no squad, sees the aggregate) and one engineer account per squad — `engineer-backend@`,
`engineer-web@`, `engineer-mobile@`, `engineer-omnirealestate-api@`,
`engineer-omnirealestate-frontend@` (all `@mal-demo.local`) — each scoped to its own squad only.

**Squads** (each a real GitHub repo owned by `24mdn`, read from the `squads` table — see
`supabase/migrations/`): `backend` → `lhagli-api`, `web` → `lhagli-user-panel`, `mobile` →
`lhagli-mobile`, `omnirealestate-api` → `omnirealestate-api`, `omnirealestate-frontend` →
`omnirealestate-frontend`. All 5 now run on the **workflow_run** deploy-proxy tier
(`has_actions=true`) — each repo has a real GitHub Actions CI workflow (triggered on push to its
default branch), so `deployment_frequency`/`change_failure_rate`/`mttr` come from actual CI run
outcomes, not a commit- or merge-count proxy. 4 of the 5 repos (`web`, `mobile`,
`omnirealestate-api`, `omnirealestate-frontend`) have never used pull requests (solo/AI-assisted
development pushed straight to the default branch), so their PR-only metrics (lead time, review
turnaround) stay empty — a real, disclosed data gap, not a bug. `backend` (`lhagli-api`) is the
exception: it now has one real merged PR (opened, reviewed, and merged through this project, not
fabricated data — a genuine GitHub PR/review/merge, just a small one), which is why its lead time
and review turnaround are non-empty while the other 4 squads' aren't. `omnirealestate-api`'s
workflow predates this project and is a scheduled dependency-graph job, not an app deploy — see
**Known limitation** below.

## Data sources

Two live source systems, both under the GitHub umbrella but functionally distinct:

1. **GitHub REST + GraphQL API** (`lib/github/`, `api/app/github_client.py`) — commits, pull
   requests, reviews, issues. Backs lead time, review turnaround, and the change-failure/MTTR
   incident signal.
2. **GitHub Actions API** (workflow runs) — backs deployment frequency, change failure rate, and
   MTTR's deploy-correlation, via real CI run success/failure on each repo's default branch. This
   is the "CI/CD provider" source, not a restatement of #1: it's a separate endpoint, a separate
   event type (a completed run, not a commit or PR), and the thing that actually distinguishes
   "code was pushed" from "code was validated and would have shipped."

No project-management tool (Linear/Jira/Notion) is connected — everything here comes from the
two GitHub-family sources above. Nothing is fetched live on dashboard page load; both sources are
pulled by the offline ingestion job (`api/`) ahead of time into Postgres — see **Architecture**.

## Metrics: live vs. seeded

| Metric | Type | Status |
|---|---|---|
| Deployment frequency | DORA | Live — real Actions run outcomes, every squad |
| Lead time for changes | DORA | Live — non-empty for `backend` (1 real merged PR); empty for the other 4 squads (no PRs) |
| Change failure rate | DORA | Live — non-empty for `backend` (1 real closed `bug` issue); 0% elsewhere (no incidents) |
| MTTR | DORA | Live — non-empty for `backend` (1 real closed `bug` issue); empty elsewhere (no incidents) |
| PR review turnaround | SPACE (Efficiency/Flow) | Live — non-empty for `backend` (1 real review); empty for the other 4 squads (no PRs) |

**Every metric is computed from live data** — none are manually entered or hand-authored. The
only thing that's seeded/synthetic in this project is the **6 demo login accounts**
(fixed emails + one shared password, created by `api/app/seed_users.py`) — those exist because
this is a solo demo project with no real company directory to authenticate against, not because
any metric value is fabricated. A metric reading "empty" above means the underlying GitHub data
genuinely doesn't exist yet (e.g. 4 of the 5 repos have never had a pull request), not that it
was seeded with placeholder numbers.

**A note on `backend`'s 100% change failure rate this week:** that number is real, not a bug —
`change_failure_rate` correctly flags any successful deploy followed by a labeled incident within
2 days, and because this demo compressed a "week" of activity (4 CI deploys, 1 real bug issue
opened and closed) into a few minutes rather than spreading it across an actual week, every one
of `backend`'s deploys this week falls inside that 2-day window of the one incident. In a real
week of usage this same formula would produce a normal, much lower rate; the 100% here is an
artifact of demo timing, not a formula bug or a fabricated number.

## Known limitation (what I'd fix next)

**The deployment signal is CI success, not a literal production release.** `deployment_frequency`
counts a successful GitHub Actions run on the default branch as a "deploy" because none of the 5
demo repos have a real deploy target wired into Actions yet (no hosting credentials, no deploy
step beyond a placeholder echo — see each repo's `.github/workflows/ci.yml`). It's a legitimate,
hard-to-game proxy (a real CI pipeline genuinely has to pass), but it's not the same claim as "we
shipped code to production N times this week." The next fix: wire at least one repo's workflow to
a real deploy target (e.g. a Vercel/Render preview or production deploy step) so that squad's
number reflects an actual release, not just a passing build.

## 90-day plan

This prototype (5 demo repos, 2 sources, 5 metrics) is a proof of the architecture, not the
finished mandate. If this became the real role, here's what the next 90 days would actually
build on top of it, solo:

**Days 1-30 — replace the prototype's data with the real thing.**
- Point the same ingestion pipeline at the real Tech domain's repos instead of 5 demo ones — no
  architecture change, `squads` is already a table, not a hardcoded list, for exactly this
  reason.
- Add a genuine third source: a sprint/PM tool (Linear or Jira) for cycle time and sprint
  completion — the one metric family the JD explicitly names that this prototype doesn't have
  yet, since it only had GitHub-family sources to work with.
- Wire at least one squad's CI workflow to a real deploy target (not the CI-success proxy
  documented above as this build's known limitation) so deployment frequency starts meaning
  "shipped," not "passed a build."

**Days 31-60 — baselines, and the first intervention that moves them.**
- Publish a real cycle-time/deployment-frequency baseline per squad from 30 days of real data,
  not demo data.
- Ship the first concrete intervention the data justifies — e.g. surfacing PRs stuck past a
  review-time threshold directly on the squad lead's dashboard (not just a buried metric) — and
  measure whether that squad's review-turnaround number actually moves. A dashboard that only
  displays numbers doesn't satisfy "drive the interventions that move them"; something has to
  act on what it shows.

**Days 61-90 — prove the architecture generalizes past engineering.**
- Add one non-engineering domain's KPIs (whatever the CEO office's highest-priority function is
  — support, ops, whatever has its own source system) as a second tab on the same exec view,
  using the same ingestion → Postgres/RLS → dashboard pattern already built. This is the direct
  test of "system design — does the architecture scale to new domains without a rebuild": if it
  needs one, the architecture failed; if it's a new row in a table and a new ingestion adapter,
  it didn't.

**Day-90 proof point (checkable by a non-technical CEO-office reader, no engineer required):**
Open the exec dashboard, already logged in with an existing account. It shows, for every active
Tech squad: deployment frequency and change failure rate trending over the last 90 days against
their day-1 baseline, a "last updated" timestamp proving it's live rather than a snapshot someone
prepared for this meeting, and at least one non-engineering domain's KPI panel on the same page.
Nothing on that page was typed in by hand — every number traces back to a receipt, the same way
this prototype's drill-downs already do.

## Running locally

One service, one terminal:

```bash
pnpm install
pnpm dev                    # http://localhost:3000 -> /login
```

Needs `.env.local` at the root (copy from `.env.example` — just the public Supabase URL/anon
key; `GITHUB_TOKEN` there is optional, only needed to run `scripts/inspect-and-fetch.ts`). The
anon key is safe to expose client-side; it's meant to be public-facing (protected by RLS, not
secrecy). Never put the Supabase service-role key anywhere under the Next.js app — it's only
ever used by ingestion, in `api/.env`.

To (re-)populate `metrics_snapshots` (weekly aggregates) and `metric_records` (the drill-down
receipts behind them — delete-then-insert per squad/week on every run, not a bare upsert, so a
record that falls out of the fetch window gets removed instead of lingering) and refresh the
`squads` table's `has_actions`/`deploy_proxy` disclosure fields, run ingestion separately — it's
an offline job, not part of the running app:

```bash
cd api
source .venv/bin/activate   # or: uv venv && uv pip install -r requirements.txt, first time
python -m app.ingest_cli
```

Ingestion also now runs automatically every week via `.github/workflows/ingest.yml` (GitHub
Actions `schedule` + `workflow_dispatch`) — the manual command above still works for local/
on-demand runs; the scheduled workflow just triggers the same `python -m app.ingest_cli` on a
timer. It needs three repo secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`INGEST_GITHUB_TOKEN`) set under Settings → Secrets and variables → Actions — see the workflow
file for the exact env var mapping.

`scripts/inspect-and-fetch.ts` is a standalone verification CLI for one repo's live data
(`pnpm tsx scripts/inspect-and-fetch.ts`) — useful for spot-checking, not what populates the
dashboard (that's ingestion, above; the dashboard itself only ever reads Postgres, never GitHub
directly).

## Building for production

```bash
env -u NODE_ENV pnpm build
```

The `env -u NODE_ENV` matters in this dev environment — see **Known gotchas**. Vercel's own
build environment doesn't have this problem.

## Stack

**App:** Next.js 15.5.23 (App Router, TypeScript) · Tailwind v4 + shadcn/ui (Base UI) ·
`@supabase/ssr` + `@supabase/supabase-js` (both the auth session and the RLS-scoped Postgres
read path — the only data source the dashboard reads from) · `recharts` for sparklines · pnpm.
**Ingestion (offline, `api/`):** `supabase-py` · `httpx` (GitHub REST + GraphQL) · pytest ·
uv/venv.
**Data:** Supabase (Postgres + Auth + Row-Level Security).

## Known gotchas

- **This Supabase project signs JWTs with `ES256` (asymmetric), not a shared `HS256` secret.**
  Relevant if you ever need to verify a token outside the Supabase SDK — verify via Supabase's
  own Auth server (`supabase.auth.getUser(token)`), not a local decode.
  `SUPABASE_JWT_SECRET` is dead config, kept in `api/.env.example` only as a documented "not
  used" note. If you spin up a fresh Supabase project, don't assume either signing scheme —
  check the actual token's header (`{"alg": ...}`) before wiring auth.
- **Fine-grained GitHub PATs separate "which repos" from "what permissions" — selecting the
  right repos isn't enough on its own.** Hit this directly: a token scoped to the right 3 repos
  still 404'd on every one of them because "Repository permissions" (Contents/Issues/Actions/Pull
  requests → Read-only) hadn't been set. `GET /user/repos` with the token is the fast way to
  check what it can actually see, independent of what you think you selected.
- **4 of the 5 target repos have zero pull requests ever, not just zero this window** (`backend`/
  `lhagli-api` is now the exception — see below). Solo/AI-assisted development pushed straight to
  the default branch. The deploy-event proxy (`lib/metrics.ts`'s `deriveDeployEvents`, mirrored
  in `api/app/derive.py`'s `derive_deploy_events` for ingestion) has three tiers, most-to-least
  authoritative: real CI/CD (`hasActions`) → merged-PR-to-default-branch → raw commits on the
  default branch. All 5 squads now run on the first, most-authoritative tier (a CI workflow was
  added to each repo that lacked one) — surfaced via `deployProxy` on every squad and disclosed
  in the UI's caveat banner. Lead time and review turnaround still need a PR to measure from
  regardless of deploy-proxy tier, which is why they stay empty for the 4 PR-less squads.
- **`backend` (`lhagli-api`) has exactly one real pull request**, opened/reviewed/merged through
  this project specifically to prove the pipeline handles real PR data, not to inflate the
  numbers — see PR #1 on that repo. `derive_deploy_events`'s CI-tier branch now correlates a
  workflow run's `head_sha` back to that PR's `merge_commit_sha`, so both
  `lead_time_for_changes` and `pr_review_turnaround` are non-null for `backend` and only
  `backend` — that asymmetry is expected, not a bug, given only one squad has any PR history at
  all.
- **GitHub's REST `labels` query param is an AND filter across every label listed, not OR.**
  `fetch_incident_labeled_issues` called `/issues?labels=bug,incident`, which only matches an
  issue carrying *both* labels simultaneously — something no realistic issue does, so this had
  silently never matched a single issue in this project's history until it was caught while
  testing MTTR with a real labeled issue. Fixed by querying each label separately and deduping
  by issue number, in both `api/app/github_client.py` and its `lib/github/queries.ts` mirror.
- **`lhagli-mobile`'s CI workflow fails consistently, on purpose left unfixed.** It's a real
  strict-typecheck failure (10 genuine pre-existing TypeScript errors in that repo's `app/`/
  `src/`, confirmed unrelated to the workflow itself), not a broken workflow — so that squad's
  `deployment_frequency` correctly reads 0 (no successful run exists to count). Fixing the
  underlying app bugs is out of scope for this project; the honest signal was left as-is rather
  than loosened until it went green.
- **Next.js pinned to the 15.x line (currently 15.5.23), not 16.x.** 16.3.0 (npm `latest` at the
  time this was built) has a genuine bug in its static-export pipeline — `next build` crashes
  prerendering the internal `/404`/`/_global-error` fallback with `Cannot read properties of null
  (reading 'useContext')`, reproducible on a completely untouched `create-next-app` scaffold,
  both Turbopack and webpack. Don't upgrade past 15.x without checking if that's fixed upstream
  first.
- **`NODE_ENV` must be unset before `next build`** in this dev environment — it comes pre-set to
  `development` in the shell, which makes Next mix dev/prod React bundles during static export
  and produces the exact same `useContext` crash as the Next 16 bug above (a red herring that
  cost real time before finding this was the actual cause). `pnpm dev` doesn't need this; only
  `next build`.
- **GitHub client uses `@octokit/core` + `@octokit/plugin-rest-endpoint-methods` +
  `@octokit/plugin-paginate-rest` directly (`lib/github/client.ts`), not the kitchen-sink
  `octokit` package.** `octokit@5` pulls in `@octokit/oauth-app`, which depends on the pure-ESM
  `@octokit/auth-unauthenticated` — an OAuth App feature never used here — and `tsx` can't
  resolve it. `api/app/github_client.py` (ingestion's separate copy) doesn't have this problem;
  it's a plain `httpx` client.
- **`lib/metrics.ts`'s `lastNIsoWeeks` must use UTC methods (`getUTCDay`/`setUTCHours`/
  `setUTCDate`), not local-time equivalents.** It predates the live read path and originally used
  local time; week boundaries silently depending on the server's timezone would be a real bug in
  production (Vercel's function timezone isn't something to rely on staying UTC by convention
  alone). `api/app/derive.py`'s `last_n_iso_weeks` was always explicit about `timezone.utc` —
  match that, not the old JS version's original behavior, if you ever touch this function.

## Design tokens

Mal's brand palette lives in `app/globals.css` (`:root`, hex values, not oklch — deliberately, to
match the brand spec exactly rather than approximate it through a color-space conversion). Pill
buttons/badges, `rounded-lg` cards, Outfit headings + Inter body via `next/font/google` in
`app/layout.tsx`. Category-metric colors map to `--chart-1..5`.
