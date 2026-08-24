-- Mal Engineering Productivity — initial schema + RLS
-- See ~/.claude/plans/what-is-your-plan-cuddly-lynx.md §1 for the full design rationale.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users: maps auth.users -> role + squad. One row per authenticated person.
-- ---------------------------------------------------------------------------
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('exec', 'engineer')),
  squad_id   text not null,
  created_at timestamptz not null default now()
);

comment on table public.users is
  'Maps auth.users -> role + squad for RBAC. RLS policies below join back to this table.';

-- ---------------------------------------------------------------------------
-- metrics_snapshots: one row per squad per ISO week. Aggregation happens
-- upstream in the ingestion job — there is no per-engineer identity column
-- here, so there is nothing to leak even if RLS were misconfigured.
-- ---------------------------------------------------------------------------
create table public.metrics_snapshots (
  id         bigint generated always as identity primary key,
  squad_id   text not null,
  week_start date not null,
  week_end   date not null,

  -- DORA
  deployment_frequency        numeric,   -- deploys / week (count)
  lead_time_for_changes_hours numeric,
  change_failure_rate_pct     numeric,   -- 0-100
  mttr_hours                  numeric,

  -- SPACE slice (Efficiency + Activity)
  pr_review_turnaround_hours  numeric,   -- Efficiency / flow
  commits_per_engineer        numeric,   -- Activity
  prs_merged                  numeric,   -- Activity

  sample_size  integer not null default 0,
  computed_at  timestamptz not null default now(),

  unique (squad_id, week_start)
);

create index metrics_snapshots_squad_week_idx
  on public.metrics_snapshots (squad_id, week_start desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.users             enable row level security;
alter table public.metrics_snapshots enable row level security;

-- Everyone can read their own users row (needed so the app can resolve its
-- own role/squad client-side, and so the FastAPI dependency can do the
-- lookup using the caller's own JWT instead of a service-role key).
create policy "users read own row"
  on public.users
  for select
  using (id = auth.uid());

-- metrics_snapshots: two permissive SELECT policies, combined with OR by
-- Postgres — exec sees every squad, engineer sees only their own.
create policy "exec reads all squads"
  on public.metrics_snapshots
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'exec'
    )
  );

create policy "engineer reads own squad"
  on public.metrics_snapshots
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'engineer'
        and u.squad_id = metrics_snapshots.squad_id
    )
  );

-- No insert/update/delete policies on purpose: with RLS enabled and no
-- write policy, authenticated/anon roles are blocked from writing by
-- default. Only the ingestion job, using the service-role key (which
-- bypasses RLS entirely), should ever write to metrics_snapshots.
