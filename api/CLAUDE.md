# api/ — GitHub ingestion (Python)

See the root `README.md` for the architecture overview and `TRANSITION.md` for why this used to
be a FastAPI service. This file is implementation-detail context for future Claude Code sessions
working specifically in this directory. For the Next.js side (the dashboard's read path, which
used to live here), see `../CLAUDE.md`.

**This is no longer a running service.** It's an offline ingestion job — run manually
(`python -m app.ingest_cli`, still works for local/on-demand runs) or on a weekly schedule via
`.github/workflows/ingest.yml` (GitHub Actions, `workflow_dispatch` also available for on-demand
triggering from the Actions tab) — to populate `metrics_snapshots` (weekly aggregates) and
`metric_records` (the drill-down receipts behind them — delete-then-insert per squad/week every
run, not a bare upsert, since the fetch window rolls forward and stale receipts must actually
go away) and refresh `squads`' `has_actions`/`deploy_proxy` disclosure fields. Nothing here
serves live requests — the dashboard reads only Postgres, never GitHub directly
(`lib/metrics-repository.ts` in the Next.js app).

## Layout

```
app/
  config.py            # pydantic-settings: env vars, see .env.example
  supabase_client.py    # get_service_client() — service-role key, bypasses RLS on purpose
  squads.py               # SQUADS — single source of truth for the 3 squad->repo mappings
                           #   (Next.js keeps its own copy in lib/squads.ts — keep both in sync)
  github_client.py        # httpx: REST + one GraphQL POST for PRs/reviews/first-commit
  derive.py                # pure formulas, no I/O — deployment frequency, lead time, change
                            #   failure rate, MTTR, review turnaround, deploy-event/incident
                            #   derivation. lib/metrics.ts is the TS mirror, used only by
                            #   scripts/inspect-and-fetch.ts — keep both in sync if either changes.
  adapt.py                  # converts github_client's fetched shapes -> derive.py's input shapes
  ingest.py                  # WRITE path — via the service-role client (bypasses RLS on purpose)
  ingest_cli.py                # `python -m app.ingest_cli` — loops SQUADS
  seed_users.py                 # one-time: creates the 4 demo accounts via the Admin API
tests/test_derive.py             # pytest on the pure formulas — 17 tests, run before anything else
```

## RLS is enforced by the service-role bypass being deliberate, not accidental

`ingest.py`/`seed_users.py` are the only code left here, and both intentionally use
`get_service_client()` (service-role key, bypasses RLS) because they write outside any user
session — there's no user token to scope a read to. This is the correct, narrow use of the
service-role key; the *read* path that used to also live here (behind a user-token-scoped
client) has moved to the Next.js app, where RLS is now the only enforcement layer (no more
route-level RBAC duplicating it — see `../CLAUDE.md`).

**Never add a user-facing read here using the service-role client.** If a future change needs
this service to read data back, use a token-scoped client the way the old `metrics_service.py`
did (see git history / `TRANSITION.md`), not the service-role one.

## The deploy-event proxy cascade (`derive.py`'s `derive_deploy_events`)

Three tiers, most-to-least authoritative — a real design decision made after real data forced it,
not speculative upfront design:
1. `has_actions=True` → successful GitHub Actions runs on the default branch are deploys.
2. No Actions, but PRs get merged to the default branch → each merge is a deploy.
3. No Actions **and** zero merged PRs ever (confirmed for all 3 current squads — solo/AI-assisted
   development pushed straight to `main`) → each commit on the default branch is a deploy. Least
   authoritative tier; surfaced via `Squad.deploy_proxy` and disclosed in the Next.js UI's caveat
   banner, never silently presented as equivalent to tier 1 or 2.

If you add a 4th squad/repo, don't assume its tier — `github_client.py`'s `inspect_repo` and the
ingestion's merged-PR count determine it empirically, same as the first 3 were. `lib/metrics.ts`'s
`deriveDeployEvents` is the TS mirror of this exact cascade (used only by
`scripts/inspect-and-fetch.ts` now) — keep both in sync if the logic ever changes.

## Conventions

- Pure logic lives in `derive.py`. If you're computing a metric or deriving deploy
  events/incidents from raw GitHub data, it belongs there, not inlined in `ingest.py` — and it
  needs a matching change in `lib/metrics.ts` on the Next.js side, so the two stay in sync (that
  copy backs `scripts/inspect-and-fetch.ts`, not the live dashboard).
- `squads.py` is ingestion's copy of the squad→repo mapping; `lib/squads.ts` is the Next.js
  app's copy. Keep both in sync manually if a squad is ever added/changed.
- Run `pytest` from `api/` before touching anything that needs network/Supabase access — the
  pure-formula tests catch regressions in seconds, independent of any external service.
