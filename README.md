# Mal Engineering Productivity — prototype

An internal engineering-productivity platform prototype: pulls delivery data straight from the
GitHub API (no self-reported numbers), computes DORA's four keys plus PR review turnaround (and
a couple of SPACE Activity fields), and serves two dashboards behind real Role-Based Access
Control — a plain-language exec rollup aggregated across every squad, and a per-squad engineer
view where every number drills down to the underlying PRs/deploys/incidents ("receipts").

Built as a demo for an Engineering Productivity Lead application at Mal (AI-native Islamic
digital bank, Abu Dhabi). Styled to match Mal's actual brand (periwinkle background, black/white
pill buttons, Outfit/Inter type) so it reads as an internal Mal tool, not a generic template.

Full architecture/design rationale: `~/.claude/plans/what-is-your-plan-cuddly-lynx.md`.
Migration history from the original two-service (FastAPI + Next.js) build to this single-service
Next.js app: `TRANSITION.md`.

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
| N2 — Supabase schema/RLS applied, 4 demo users seeded | ✅ done |
| N3 — Real GitHub ingestion for all 3 squads | ✅ done |
| N4 — RBAC matrix verified live (real JWTs, real data) | ✅ done |
| N5 — FastAPI read path removed, moved into Next.js Server Components | ✅ done |
| N6 — Manual end-to-end browser verification | ⏳ up to you |
| Deployment (single Next.js project, Vercel) | ⏳ not started |
| Scheduled ingestion (GitHub Actions, weekly + on-demand) | ✅ done |

**Demo accounts** (Supabase Auth, password `change-me-now-123!` for all): `exec@mal-demo.local`
(no squad), `engineer-backend@mal-demo.local` → `backend`, `engineer-web@mal-demo.local` →
`omnirealestate-frontend`, `engineer-mobile@mal-demo.local` → `omnirealestate-api`.
`engineer-web`/`engineer-mobile` were reassigned from their original dormant `lhagli-*` squads
so at least two engineer logins have real, non-empty drill-down data to manually verify against
— `users.squad_id` is a live column, not a fixed mapping, so this is a normal data change, not a
schema change.

**Squads** (each a real GitHub repo owned by `24mdn`, read from the `squads` table — see
`supabase/migrations/`): `backend` → `lhagli-api`, `web` → `lhagli-user-panel`, `mobile` →
`lhagli-mobile`, `omnirealestate-api` → `omnirealestate-api`, `omnirealestate-frontend` →
`omnirealestate-frontend`. The three `lhagli-*` squads run on the **raw-commit** deploy-proxy
tier (see Known gotchas) — none of them use pull requests at all, so `deployment_frequency`
counts commits on the default branch, and PR-only metrics (lead time, review turnaround) stay
empty for them. `omnirealestate-frontend` is also raw-commit (it has zero PRs too — the real
work lives on its `develop` branch, which is why `develop`, not `main`, is now each
`omnirealestate-*` repo's GitHub default branch). `omnirealestate-api` is the one squad with
real CI/CD (`has_actions=true`, `deploy_proxy=workflow_run`) — a scheduled dependency-graph
Actions workflow, not an application deploy, so treat its "shipping pace" number as a real but
not especially meaningful signal.

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
- **All 3 target repos have zero pull requests ever, not just zero this window.** Solo/AI-assisted
  development (commits authored by `replit-agent`) pushed straight to `main`. The deploy-event
  proxy (`lib/metrics.ts`'s `deriveDeployEvents`, mirrored in `api/app/derive.py`'s
  `derive_deploy_events` for ingestion) has three tiers, most-to-least authoritative: real CI/CD
  (`hasActions`) → merged-PR-to-default-branch → raw commits on the default branch. All 3 squads
  currently run on the last, least-authoritative tier — surfaced via `deployProxy` on every squad
  and disclosed in the UI's caveat banner.
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
