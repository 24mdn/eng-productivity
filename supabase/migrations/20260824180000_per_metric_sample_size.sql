-- metrics_snapshots.sample_size was being reused as every metric's weight in exec's
-- cross-squad aggregation (lib/metrics-repository.ts's getAggregateSnapshotsInternal), but it
-- only ever held deployment_frequency's count (api/app/ingest.py's _build_week_row). Lead
-- time, change failure rate, MTTR, and review turnaround each have their own, usually
-- different, underlying sample size — weighting them by deploy count made the rollups
-- mathematically wrong. Give each metric its own column instead of sharing one.
alter table public.metrics_snapshots
  add column lead_time_for_changes_sample_size integer,
  add column change_failure_rate_sample_size  integer,
  add column mttr_sample_size                 integer,
  add column pr_review_turnaround_sample_size integer;

comment on column public.metrics_snapshots.sample_size is
  'deployment_frequency''s own sample size (successful deploy count in the week). The other 4
   metrics have their own dedicated *_sample_size columns — they do not share this one.';
