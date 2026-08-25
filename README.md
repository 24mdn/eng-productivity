# Engineering Productivity

Engineering-productivity dashboard: pulls delivery data straight from GitHub (no self-reported
numbers), computes DORA + one SPACE metric, and serves two RBAC-separated views — an exec rollup
aggregated across every squad, and a per-squad engineer view where every number drills down to
the underlying PRs/deploys/incidents ("receipts").


Demo accounts (exec + one engineer per squad) are listed directly on the login page — click one
to fill the form, no credentials needed here.

## Architecture

```
GitHub API + GitHub Actions API --> api/ (Python, offline ingestion) --> Supabase Postgres (RLS)
                                                                                   ^
                                                       Next.js Server Components (this directory)
```

One Next.js app, deployed on Vercel. `api/` is an offline ingestion job (not a running service)
that pulls from GitHub, computes metrics, and writes into Postgres — the dashboard only ever
reads Postgres, never GitHub directly. Access control (`exec` sees every squad aggregated,
`engineer` sees only their own) is enforced by **Postgres Row-Level Security**, not just app
code — even a bug in the app-layer guard can't leak another squad's rows, because the database
itself refuses the query. Full implementation detail: `CLAUDE.md`.

## Data sources

Two live sources, both required to compute the metrics below:

1. **GitHub REST + GraphQL API** — commits, PRs, reviews, issues. Backs lead time, review
   turnaround, and the change-failure/MTTR incident signal.
2. **GitHub Actions API** (workflow runs) — backs deployment frequency and change failure rate,
   via real CI run success/failure on each repo's default branch.

No PM tool (Linear/Jira/Notion) is connected. Both sources are pulled ahead of time by the
offline ingestion job, not fetched live on page load.

## Metrics

| Metric | Type | This week |
|---|---|---|
| Deployment frequency | DORA | Live for every squad — real Actions run outcomes |
| Change failure rate | DORA | Live for every squad — `backend` reads 100%* |
| MTTR | DORA | Live for `backend` only (1 real incident); empty elsewhere |
| Lead time for changes | DORA | Live for `backend` only (1 real merged PR); empty elsewhere |
| PR review turnaround | SPACE | Live for `backend` only (1 real review); empty elsewhere |

Every value is computed from live GitHub data — nothing is manually entered. The only
seeded/synthetic thing in this project is the demo login accounts themselves; `backend`'s repo
has real PR and incident history because one was created through this project specifically to
prove the pipeline handles that data, not to inflate the numbers. The other 4 squads are empty
for PR/incident-based metrics because those repos genuinely have none yet — that's disclosed,
not hidden.

*`backend`'s 100% change failure rate is real, not a bug: the formula flags any deploy followed
by an incident within 2 days, and because this demo's activity was compressed into minutes
rather than a real week, all 4 deploys and the one incident fall inside that window. A real
week of usage would produce a normal, lower rate with the same formula.

## Known limitation (what I'd fix next)

**The deployment signal is CI success, not a literal production release.** None of the 5 demo
repos have a real deploy target wired into their Actions workflow yet, so `deployment_frequency`
counts a passing CI run as a "deploy." It's a hard-to-game proxy (a real pipeline genuinely has
to pass), but not the same claim as "shipped to production." Next fix: wire one repo's workflow
to a real deploy step (Vercel/Render) so that squad's number reflects an actual release.

## 90-day plan

This prototype (5 demo repos, 2 sources, 5 metrics) proves the architecture, not the finished
mandate. If this became the real role, solo, over the next 90 days:

- **Days 1-30:** point the same pipeline at the real Tech domain's repos (`squads` is a table,
  not a hardcoded list, for exactly this reason); add a genuine third source — a sprint/PM tool
  for cycle time and sprint completion, the metric family the JD names that this prototype
  doesn't have; wire a real deploy target on at least one workflow.
- **Days 31-60:** publish a real cycle-time/deployment-frequency baseline per squad from 30 days
  of real data, then ship one concrete intervention the data justifies (e.g. surfacing
  stuck-PR reviews on the lead's dashboard) and confirm it actually moves the number.
- **Days 61-90:** add one non-engineering domain's KPIs as a second tab on the same exec view,
  using the same ingestion → Postgres/RLS → dashboard pattern already built — the direct test of
  whether the architecture scales without a rebuild.

**Day-90 proof point**, checkable by a non-technical reader with no engineer involved: open the
exec dashboard (already logged in). It shows every active squad's deployment frequency and
change failure rate trending against their day-1 baseline, a "last updated" timestamp proving
it's live, and one non-engineering KPI panel on the same page. Nothing was typed in by hand —
every number traces back to a receipt.

## Running locally

```bash
pnpm install
pnpm dev   # http://localhost:3000 -> /login
```

Needs `.env.local` (copy `.env.example`) with the public Supabase URL/anon key. To
(re-)populate `metrics_snapshots`/`metric_records`, run ingestion separately — it's an offline
job, not part of the running app:

```bash
cd api
source .venv/bin/activate   # or: uv venv && uv pip install -r requirements.txt, first time
python -m app.ingest_cli
```

This also runs automatically every week via `.github/workflows/ingest.yml`, which needs
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `INGEST_GITHUB_TOKEN` set as **repository**
secrets (not variables) under Settings → Secrets and variables → Actions. If you're using a
fine-grained GitHub PAT, selecting the right repos isn't enough on its own — its **Repository
permissions** (Contents/Issues/Actions/Pull requests) also need to be set explicitly, or every
call 404s regardless of which repos you picked.

Production build needs `env -u NODE_ENV pnpm build` — a pre-set `NODE_ENV=development` in this
dev environment mixes dev/prod React bundles during static export otherwise. Vercel's own build
environment doesn't have this problem.

## Stack

**App:** Next.js 15 (App Router, TypeScript), Tailwind v4 + shadcn/ui, `@supabase/ssr` +
`@supabase/supabase-js`, `recharts`, pnpm.
**Ingestion:** Python, `supabase-py`, `httpx`, pytest, uv.
**Data:** Supabase (Postgres + Auth + Row-Level Security).
