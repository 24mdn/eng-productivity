# Removing FastAPI — transition plan to Vercel-only deployment

**Status: done.** This describes the plan as originally written; the migration is complete
(`api/app/main.py`/`auth.py`/`metrics_service.py`/`rate_limit.py` are deleted,
`lib/metrics-repository.ts` reads Postgres/GitHub directly). Kept as historical record of the
rationale — see root `CLAUDE.md` for the current architecture, not this file.

## Why

The current setup (`README.md`'s "Architecture" section) is two services: FastAPI on a
persistent Python host + Next.js on Vercel. FastAPI doesn't fit Vercel's serverless model — it'd
need a separate host (Render/Fly/Railway), which is exactly the deployment complexity we're
cutting. The read path FastAPI serves today can move directly into Next.js Server Components,
which already hold the Supabase session and forward the user's access token — the only thing
that changes is *where* that token gets used to query Postgres, not the security model.

**Postgres Row-Level Security is the actual enforcement today, not FastAPI's route checks**
(`api/CLAUDE.md`, `supabase/migrations/20260807102145_init_schema.sql`) — the `"exec reads all
squads"` / `"engineer reads own squad"` policies on `metrics_snapshots`, and `"users read own
row"` on `users`, don't care what language issues the query. Moving the read path to Next.js
keeps the exact same RLS policies doing the exact same job; only the app-layer code around them
changes language.

## Before / after

```
Before:
GitHub API -> api/ (FastAPI) -> Supabase Postgres (RLS)
                                          ^
                          Next.js Server Components (HTTP call to FastAPI)

After:
GitHub API -> [ingestion, unchanged] -> Supabase Postgres (RLS)
                                                  ^
                          Next.js Server Components (@supabase/supabase-js, direct query)
```

Only the **read path** and the **live drill-down GitHub fetch** move. Ingestion is a separate,
offline concern — see "What doesn't move" below.

## What doesn't move (and why that's fine)

- **Ingestion** (`api/app/ingest.py`, `ingest_cli.py`, `github_client.py`, `derive.py`,
  `adapt.py`) writes to `metrics_snapshots` using the service-role key, outside any user
  session, on your own schedule (`python -m app.ingest_cli`, currently run manually). It's never
  in the request path of a page load — nothing about deploying the *web app* to Vercel requires
  touching it. Leave it running exactly as documented in `README.md`'s "To (re-)populate..."
  section — it now also runs automatically every week (and on-demand via `workflow_dispatch`)
  via `.github/workflows/ingest.yml`, a scheduled GitHub Actions workflow decoupled from Vercel;
  the manual `python -m app.ingest_cli` path documented there still works unchanged.
- **Supabase schema + RLS policies** — unchanged. Same tables, same two `metrics_snapshots`
  policies, same `users` policy.
- **Auth (login/logout)** — already bypasses FastAPI entirely today (`login-form.tsx` and
  `user-menu.tsx` call `supabase.auth.*` directly). Nothing to do here.
- **Demo accounts, squads, `.env` values for Supabase** — unchanged.

## What moves, file by file

| FastAPI today | Becomes | Notes |
|---|---|---|
| `metrics_service.get_squad_snapshots` | a function in `lib/metrics-repository.ts` | Straight `metrics_snapshots` select, same RLS. |
| `metrics_service.get_aggregate_snapshots` | same file | The `pandas`-based weighted aggregation (sum for counts, sample-size-weighted mean for rates/times) becomes a plain `reduce`/`groupBy` in TS — real logic to port, but it's ~40 lines, not a rewrite. |
| `metrics_service.get_squad_records` (live GitHub fetch + `derive.py` on demand) | new logic in `lib/metrics-repository.ts`, using GitHub calls | The good news: **this was TypeScript first.** `lib/github/client.ts`, `lib/github/queries.ts`, `lib/github/inspect.ts`, and `lib/metrics.ts` are the original implementation — `api/app/github_client.py` and `derive.py` are a verified 1:1 Python port of them (see the "SUPERSEDED" headers in those files). Un-superseding them is closer to "delete a comment and confirm it still works" than porting from scratch. |
| `auth.py` (`get_current_user`, `require_exec`, `require_squad_access`) | a small helper alongside `lib/supabase/server.ts` | `getCurrentUser()` + `getCurrentProfile()` already give you the user/role/squad; you need the equivalent of "engineer can only request their own squad_id" as a guard before querying — a few lines, not a new subsystem. RLS still backstops it either way. |
| `rate_limit.py` (in-memory sliding window, 20 req/60s on the records endpoint) | **needs a real decision, not a direct port** | It's `defaultdict` state in one process — that assumption breaks on Vercel, where each function invocation can land in a different, short-lived instance with no shared memory. Options: drop rate limiting for now (lowest effort, matches "just get it demoable"), or add a real store (Upstash Redis via the Vercel Marketplace) if you want to keep it. Don't port the in-memory version as-is; it'll silently do nothing. |
| `squads.py` (`SQUADS` list) | a `const` in `lib/metrics-repository.ts` or a new `lib/squads.ts` | Static data, trivial move. |
| `FASTAPI_URL` env var, `apiFetch()` in `lib/metrics-repository.ts` | deleted | No more HTTP hop — replace with a Supabase client call using the same access token (`getAccessToken()` already exists). |

## Step-by-step

1. **Add a server-side Supabase query client** next to `lib/supabase/server.ts` — same shape as
   `api/app/supabase_client.py`'s `get_user_scoped_client(token)`: `@supabase/supabase-js`'s
   `createClient(url, anonKey)` with the caller's access token attached, so RLS evaluates as that
   user. (`@supabase/supabase-js` is already a dependency — nothing new to install.)
2. **Port `get_squad_snapshots` / `get_aggregate_snapshots`** into `lib/metrics-repository.ts`,
   replacing the `apiFetch("/api/metrics/...")` calls with direct `.from("metrics_snapshots")`
   queries through that client. Keep the exported function signatures
   (`getMetricSnapshots`, `getAllLatestSnapshots`, `getPreviousSnapshot`, `getScopeMeta`)
   identical so `app/dashboard/**` pages don't need to change at all.
3. **Port the squad-access guard** (mirrors `require_squad_access`): before querying a specific
   `squad_id`, check `profile.role === "exec" || profile.squadId === squad_id`, else return
   empty/throw — same shape as the FastAPI 403, just in TS.
4. **Un-supersede the GitHub client** for the drill-down "records" endpoint: revive
   `lib/github/client.ts` + `lib/github/queries.ts`, drop the "SUPERSEDED" file-header comments,
   and add a `getDrillDownRecords`-equivalent that runs the live GitHub fetch through
   `lib/metrics.ts`'s formulas (also currently marked reference-only) — this is the piece
   `derive.py`/`github_client.py` mirror, so cross-check outputs against the Python version
   before deleting it, not after.
5. **Decide on rate limiting** for the records endpoint (see table above) and implement whichever
   option you pick, or explicitly skip it for now.
6. **Delete the FastAPI plumbing**: `FASTAPI_URL` from `.env.local`/`.env.example`,
   `apiFetch()` from `lib/metrics-repository.ts`, and the `next.config.ts` CSP's `connect-src`
   stays as-is (it never needed FASTAPI_URL — that was always a server-to-server call, per the
   comment already in that file).
7. **Verify against the Python version before deleting `api/`**: log in as each of the 4 demo
   accounts, compare every dashboard number and drill-down record against what the live FastAPI
   version currently shows for the same account. Two independently-arrived-at implementations of
   the same query are exactly what you want to diff before trusting the new one.
8. **Remove `api/`** (and drop `api/CLAUDE.md`'s reference from the root `CLAUDE.md`) once step 7
   passes. Keep the Supabase migration file — that part never moved.
9. **Update `README.md`**: single-service "Running locally" section (`pnpm install && pnpm dev`),
   updated architecture diagram, drop the FastAPI stack line, drop `FASTAPI_URL` from the env
   setup instructions.

## Env vars after the move

- **Drop**: `FASTAPI_URL` (root `.env.local`), the entire `api/.env` (`SUPABASE_SERVICE_ROLE_KEY`
  moves to wherever ingestion ends up running — never in the Next.js/Vercel env, same rule as
  today).
- **Keep as-is**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — unchanged, still
  public-facing/RLS-protected, still what the new direct-query client uses.
- **Decided: ingestion runs as a scheduled GitHub Actions workflow** (`.github/workflows/ingest.yml`),
  not a Vercel Cron route. `GITHUB_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are GitHub Actions repo
  secrets, never Vercel env vars — keeps both out of the Next.js/Vercel environment entirely, per
  the "Known gotchas" rule in `README.md`. GitHub reserves the `GITHUB_` secret-name prefix, so
  the token is stored as `INGEST_GITHUB_TOKEN` and mapped to the `GITHUB_TOKEN` env var inside the
  workflow's job step.

## Verification checklist

- [ ] All 4 demo accounts log in and see the same numbers as the current FastAPI-backed version
- [ ] Engineer accounts still can't see another squad's data (try requesting another squad's
      metrics directly, confirm empty/blocked — this is the one behavior that must not regress)
- [ ] Exec account still sees the cross-squad aggregate with the same weighted math
- [ ] Drill-down records for each of the 5 metrics match the FastAPI version's output
- [ ] `pnpm build` succeeds with no `FASTAPI_URL` in the environment
- [ ] `vercel deploy` (or `pnpm dlx vercel deploy`) succeeds as a single project, no second host
      needed
