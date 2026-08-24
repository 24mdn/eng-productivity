-- Squads move from hardcoded arrays (lib/squads.ts / api/app/squads.py) into a real table, and
-- ingestion starts persisting the individual PR/commit/issue "receipts" behind each week's
-- aggregate numbers instead of discarding them after computing metrics_snapshots. See the plan
-- file / CLAUDE.md for the full rationale.

-- ---------------------------------------------------------------------------
-- squads: single source of truth for squad -> GitHub repo mapping + proxy tier.
-- ---------------------------------------------------------------------------
create table public.squads (
  id           text primary key,
  name         text not null,
  github_owner text not null,
  github_repo  text not null,
  has_actions  boolean,
  deploy_proxy text check (deploy_proxy in ('workflow_run', 'merge_to_default', 'commit')),
  created_at   timestamptz not null default now()
);

comment on table public.squads is
  'Squad -> GitHub repo mapping. Single source of truth for both the Next.js read path and the
   Python ingestion job (previously hardcoded and hand-duplicated in both).';

insert into public.squads (id, name, github_owner, github_repo, has_actions, deploy_proxy) values
  ('backend', 'Backend', '24mdn', 'lhagli-api',        false, 'commit'),
  ('web',     'Web',     '24mdn', 'lhagli-user-panel', false, 'commit'),
  ('mobile',  'Mobile',  '24mdn', 'lhagli-mobile',     false, 'commit');

alter table public.squads enable row level security;

-- Non-sensitive reference data — every authenticated app user needs to read it (exec needs
-- every squad's name; engineer needs their own squad's hasActions/deployProxy for the caveat
-- banner). Gated on a matching public.users row existing, same idiom as every other policy in
-- this schema, not a bare auth.uid() check.
create policy "authenticated app users read squads"
  on public.squads
  for select
  using (exists (select 1 from public.users u where u.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- users.squad_id: make nullable + fix the exec demo account's 'none' sentinel, then add the FK.
-- ---------------------------------------------------------------------------
-- seed_users.py assigned the exec demo account squad_id='none' — a string sentinel meaning
-- "exec has no squad," since exec's RLS policy never checks squad_id anyway. A real NULL
-- expresses that correctly; a naive FK on the old NOT NULL column would otherwise force
-- inventing a phantom 4th squad row just to satisfy the constraint, which would leak into every
-- exec-scope squads listing (getScopeMeta's `squads: await getSquads()` branch).
alter table public.users alter column squad_id drop not null;
update public.users set squad_id = null where squad_id = 'none';

alter table public.users
  add constraint users_squad_id_fkey foreign key (squad_id) references public.squads (id);

-- metrics_snapshots.squad_id has only ever been written by ingest_squad() looping the real
-- squads list — no sentinel values, safe to add directly.
alter table public.metrics_snapshots
  add constraint metrics_snapshots_squad_id_fkey foreign key (squad_id) references public.squads (id);

-- ---------------------------------------------------------------------------
-- metric_records: the individual PR/commit/issue/workflow-run "receipts" behind each week's
-- aggregate numbers in metrics_snapshots — computed in-memory during ingestion and discarded
-- today. Persisting them lets the engineer drill-down page read them back instead of doing a
-- live, whole-repo GitHub fetch on every click.
-- ---------------------------------------------------------------------------
create table public.metric_records (
  id          bigint generated always as identity primary key,
  squad_id    text not null references public.squads (id),
  metric_key  text not null check (metric_key in (
                'deployment_frequency', 'lead_time_for_changes', 'change_failure_rate',
                'mttr', 'pr_review_turnaround'
              )),
  week_start  date not null,
  record_id   text not null,  -- e.g. "pr-42", "run-<iso>", "commit-<sha>", "issue-17" —
                               -- matches DrillDownRecord.id
  occurred_at timestamptz not null,
  title       text not null,
  url         text not null,
  actor_login text,
  detail      text not null,
  created_at  timestamptz not null default now(),

  unique (squad_id, metric_key, week_start, record_id)
);

comment on table public.metric_records is
  'Per-record receipts (PRs/commits/issues/workflow runs) behind each metrics_snapshots weekly
   aggregate. Written only by ingestion (service-role, upserts on the unique columns below);
   read by the engineer drill-down page, scoped by the same RLS pattern as metrics_snapshots.';

-- No separate lookup index: the unique constraint above already creates a btree index on
-- (squad_id, metric_key, week_start, record_id) — the read path's query (eq squad_id, eq
-- metric_key, eq week_start) uses its leftmost 3 columns as a free prefix scan.

alter table public.metric_records enable row level security;

create policy "exec reads all squads records"
  on public.metric_records
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'exec'
    )
  );

create policy "engineer reads own squad records"
  on public.metric_records
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'engineer'
        and u.squad_id = metric_records.squad_id
    )
  );

-- No insert/update/delete policies on purpose — same rationale as metrics_snapshots: only the
-- ingestion job, using the service-role key (which bypasses RLS entirely), should ever write to
-- metric_records.
