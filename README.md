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

This prototype proves the core pattern — automated ingestion, RLS-backed access control, squad
and exec views, metric receipts. In the real role, solo, the next 90 days turn it from a demo
into the org's actual operating system for engineering productivity:

**Days 1-15 — metric contract and source mapping.**
- Lock the metric contract with Tech leadership and the CEO office: deployment frequency, cycle
  time, review turnaround, sprint completion, change failure rate, MTTR — each with a defined
  source of truth, denominator, and known way it can be gamed.
- Map every Tech squad to its repos, CI/CD workflows, and sprint-board projects.
- Set the access rule everything downstream depends on: CEO office sees squad/org-level trends
  and receipts, never a raw engineer-level ranking.

*Deliverable: a versioned metric dictionary and source map covering every squad.*

**Days 16-30 — production data foundation.**
- Replace demo repos with the real Tech-org repos, CI/CD, and sprint-board integrations — same
  ingestion pattern already proven here, pointed at real sources.
- Add freshness timestamps, backfill support, and failure alerts, so a broken source fails
  loudly instead of silently going stale.
- Surface data-quality gaps as they appear (unmapped squads, a CI run that doesn't represent a
  real deploy) rather than hiding them behind a clean-looking number.

*Deliverable: live ingestion from GitHub, CI/CD, and sprint boards for every squad, with
data-quality status visible, not just the metrics themselves.*

**Days 31-45 — the unified dashboard.**
- Ship the production dashboard for both audiences: engineering leads get squad-level detail
  (cycle time, stuck PRs, sprint completion, receipts); the CEO office gets aggregate trends and
  risk flags, no raw engineer comparison.
- Add "why this changed" drilldowns so a metric move is explainable, not decorative.
- Role-based access control, not URL-based — the same RLS pattern from this prototype, pointed
  at real accounts.

*Deliverable: one dashboard replacing fragmented manual tracking for the whole Tech org.*

**Days 46-60 — baseline and first intervention.**
- Establish baseline ranges per squad for deployment frequency, cycle time, review turnaround,
  and sprint completion.
- Find the first bottleneck the data actually supports (e.g. PRs stuck waiting on first review)
  and ship one intervention for it inside the platform — a stale-review alert, not a slide.
- Measure the before/after against the baseline; it only counts if the number moved.

*Deliverable: one measurable improvement against a real baseline, visible to Tech and the CEO
office.*

**Days 61-75 — CEO-office operating view.**
- Partner with business/ops to pick one non-engineering domain (support, compliance ops,
  whatever's the CEO office's real priority) and model its KPIs with the same discipline: source
  system, calculation, freshness, receipts.
- Add it as a second panel on the same exec view — the direct test of whether the architecture
  scales without a rebuild.

*Deliverable: a first cross-domain KPI rollup next to engineering health, on the same page.*

**Days 76-90 — trust and operating rhythm.**
- Start the operating rhythm: the CEO office's weekly view comes straight from the platform, not
  copied screenshots.
- Add the minimum trust layer a real system needs on top of the day-30 failure alerts: basic
  access logging and a documented "how each metric is calculated" page. Full governance tooling
  is a later project, not a day-90 claim.
- Use the first 90 days of real data to name the next two interventions, not ship them yet.

*Deliverable: a system the CEO office checks weekly on its own, with the next two moves already
identified from real data.*

**Day-90 proof point**, checkable by a non-technical reader with no engineer involved: open one
dashboard and see every Tech squad on the same metric set — deployment frequency, cycle time,
review turnaround, sprint completion, change failure rate, MTTR — trending against its day-1
baseline; at least one documented improvement from an intervention shipped in the first 60 days;
one non-engineering domain's KPI panel on the same page; and a freshness timestamp plus a
receipt behind every number, with no raw engineer ranking anywhere in it.

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
