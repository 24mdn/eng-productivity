-- The 3 original squads (backend/web/mobile -> lhagli-*) have gone dormant (no pushes since
-- May/June 2026), so recent metrics_snapshots windows show sample_size=0 across the board.
-- The GitHub token now has access to more actively-pushed repos under the same account;
-- adding two of them as real squads gives manual verification something with real weekly
-- activity to check against. has_actions/deploy_proxy start null, same as every other squad at
-- creation time — ingestion inspects and fills them in on its next run (see api/app/ingest.py).
insert into public.squads (id, name, github_owner, github_repo) values
  ('omnirealestate-frontend', 'OmniRealEstate Frontend', '24mdn', 'omnirealestate-frontend'),
  ('omnirealestate-api',      'OmniRealEstate API',      '24mdn', 'omnirealestate-api');
