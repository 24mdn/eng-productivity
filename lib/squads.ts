/**
 * Squad -> GitHub repo mapping, read from the `squads` table (single source of truth, shared
 * with ingestion's copy in api/app/squads.py — both read the same rows now instead of hand-
 * duplicating a hardcoded list; see supabase/migrations/20260807160000_squads_and_metric_records.sql).
 */
import { cache } from "react";
import { getRlsSupabaseClient } from "@/lib/supabase/rls-client";

export interface SquadMeta {
  id: string;
  name: string;
  githubOwner: string;
  githubRepo: string;
  // Static cache of inspection results — the squad/aggregate read paths don't need a live
  // GitHub call on every page load, only ingestion re-inspects it.
  hasActions: boolean | null;
  // Which deploy_events proxy tier is actually active for this repo — see
  // lib/metrics.ts's deriveDeployEvents. Drives the UI caveat banner copy.
  deployProxy: "workflow_run" | "merge_to_default" | "commit" | null;
}

interface SquadRow {
  id: string;
  name: string;
  github_owner: string;
  github_repo: string;
  has_actions: boolean | null;
  deploy_proxy: SquadMeta["deployProxy"];
}

function mapSquadRow(row: SquadRow): SquadMeta {
  return {
    id: row.id,
    name: row.name,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    hasActions: row.has_actions,
    deployProxy: row.deploy_proxy,
  };
}

/** cache()-wrapped so multiple calls within one render (e.g. getScopeMeta +
 * getAggregateSnapshotsInternal) collapse into a single query, same convention as
 * getCurrentProfile()/getAccessToken(). */
export const getSquads = cache(async (): Promise<SquadMeta[]> => {
  const supabase = await getRlsSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from("squads").select("*").order("id");
  if (error) throw error;
  return (data ?? []).map(mapSquadRow);
});

export async function getSquad(squadId: string): Promise<SquadMeta | undefined> {
  return (await getSquads()).find((s) => s.id === squadId);
}
