"""
Squad -> GitHub repo mapping, read from the `squads` table (single source of truth, shared with
the Next.js app's copy in lib/squads.ts — both read the same rows now instead of hand-
duplicating a hardcoded list; see
supabase/migrations/20260807160000_squads_and_metric_records.sql).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.supabase_client import get_service_client


@dataclass(frozen=True)
class Squad:
    id: str
    name: str
    github_owner: str
    github_repo: str
    # Static cache of inspection results. None = not inspected yet.
    has_actions: bool | None = None
    # Which deploy_events proxy tier is actually active for this repo — see
    # derive.derive_deploy_events's docstring. Drives the UI caveat banner copy.
    deploy_proxy: str | None = None  # 'workflow_run' | 'merge_to_default' | 'commit'


def get_squads() -> list[Squad]:
    client = get_service_client()
    response = client.table("squads").select("*").order("id").execute()
    return [
        Squad(
            id=row["id"],
            name=row["name"],
            github_owner=row["github_owner"],
            github_repo=row["github_repo"],
            has_actions=row["has_actions"],
            deploy_proxy=row["deploy_proxy"],
        )
        for row in response.data
    ]


def get_squad(squad_id: str) -> Squad | None:
    return next((s for s in get_squads() if s.id == squad_id), None)
