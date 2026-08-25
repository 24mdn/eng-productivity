"""Run: python -m app.ingest_cli
Loops SQUADS, ingests each squad's repo independently (each repo is inspected for has_actions
on its own — one squad is confirmed to need the merge-proxy tier, the others are not assumed to
behave the same)."""

from __future__ import annotations

import asyncio

from app.ingest import ingest_squad
from app.squads import get_squads


async def main() -> None:
    for squad in get_squads():
        print(f"Ingesting {squad.id} ({squad.github_owner}/{squad.github_repo})...")
        result = await ingest_squad(squad)
        proxy_note = "" if result.has_actions else f" [{result.deploy_proxy} proxy — no CI/CD]"
        print(f"  has_actions={result.has_actions}{proxy_note}")
        print(f"  {result.rows_upserted} weekly rows upserted")
        latest = result.weeks[-1]
        print(
            f"  latest week ({latest['week_start']}): "
            f"deploys={latest['deployment_frequency']} "
            f"lead_time_hrs={latest['lead_time_for_changes_hours']} "
            f"change_failure_pct={latest['change_failure_rate_pct']} "
            f"mttr_hrs={latest['mttr_hours']} "
            f"review_turnaround_hrs={latest['pr_review_turnaround_hours']}"
        )
        print()


if __name__ == "__main__":
    asyncio.run(main())
