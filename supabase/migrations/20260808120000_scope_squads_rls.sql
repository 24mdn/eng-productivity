-- squads' original policy allowed any authenticated user to read every squad's row (repo
-- mapping, deploy-proxy tier). No code path needs that: engineers only ever need their own
-- squad's row (lib/metrics-repository.ts's getScopeMeta already narrows to it in application
-- code); this makes RLS enforce the same scoping metric_records/metrics_snapshots already do.
drop policy "authenticated app users read squads" on public.squads;

create policy "exec reads all squads"
  on public.squads
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'exec'
    )
  );

create policy "engineer reads own squad"
  on public.squads
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'engineer'
        and u.squad_id = squads.id
    )
  );
