"""
WRITE path — the only code that should ever use the service-role Supabase client. Fetches one
squad's GitHub repo, derives the 5 DORA metrics + 2 SPACE (Activity) fields per ISO week, and
upserts one row per (squad_id, week_start) into metrics_snapshots — plus the individual PR/
commit/issue "receipts" behind each week's numbers into metric_records, so the dashboard's
drill-down page can read them back instead of live-fetching GitHub on every click.
"""

from __future__ import annotations

from dataclasses import dataclass

from app import derive
from app.adapt import DerivedInputs
from app.config import settings
from app.github_client import GithubClient, SquadFacts, fetch_squad_facts
from app.squads import Squad
from app.supabase_client import get_service_client

WEEKS_TO_INGEST = 12

METRIC_KEYS = [
    "deployment_frequency",
    "lead_time_for_changes",
    "change_failure_rate",
    "mttr",
    "pr_review_turnaround",
]


@dataclass
class IngestResult:
    squad_id: str
    has_actions: bool
    deploy_proxy: str | None
    rows_upserted: int
    weeks: list[dict]


def _build_week_row(squad_id: str, week: derive.WeekWindow, derived: DerivedInputs) -> dict:
    deploy_freq = derive.deployment_frequency(derived.deploy_events, week)
    lead_time = derive.lead_time_for_changes(derived.deploy_events, derived.pull_requests, week)
    change_failure = derive.change_failure_rate(derived.deploy_events, derived.incidents, week)
    mttr_result = derive.mttr(derived.incidents, week)
    review_turnaround = derive.pr_review_turnaround(derived.pull_requests, derived.reviews, week)

    prs_merged_in_week = [
        pr for pr in derived.pull_requests
        if pr.merged_at and week.start <= pr.merged_at < week.end
    ]

    commits_in_week = [c for c in derived.commits if week.start <= c.authored_at < week.end]
    distinct_engineers = {c.author_login for c in commits_in_week if c.author_login}
    commits_per_engineer = (
        len(commits_in_week) / len(distinct_engineers) if distinct_engineers else None
    )

    return {
        "squad_id": squad_id,
        "week_start": week.start.date().isoformat(),
        "week_end": week.end.date().isoformat(),
        "deployment_frequency": deploy_freq.value,
        "lead_time_for_changes_hours": lead_time.value,
        "change_failure_rate_pct": change_failure.value,
        "mttr_hours": mttr_result.value,
        "pr_review_turnaround_hours": review_turnaround.value,
        "prs_merged": len(prs_merged_in_week),
        "commits_per_engineer": commits_per_engineer,
        # Each metric gets its own sample size — they're not interchangeable (e.g. lead time's
        # count is "deploys that had a matched PR with a first commit," not "deploys").
        # sample_size (unqualified) is deployment_frequency's own, kept as the original column.
        "sample_size": deploy_freq.sample_size,
        "lead_time_for_changes_sample_size": lead_time.sample_size,
        "change_failure_rate_sample_size": change_failure.sample_size,
        "mttr_sample_size": mttr_result.sample_size,
        "pr_review_turnaround_sample_size": review_turnaround.sample_size,
    }


def _records_for_metric_week(
    squad: Squad,
    facts: SquadFacts,
    derived: DerivedInputs,
    metric_key: str,
    week: derive.WeekWindow,
) -> list[dict]:
    """The individual PR/commit/issue/workflow-run receipts behind one metric's number for one
    week — line-for-line the same branch logic that used to live in the (now-deleted) FastAPI
    metrics_service.get_squad_records and, until this change, its TS port in
    lib/metrics-repository.ts's getSquadRecordsInternal. Persisted now instead of recomputed
    live on every dashboard click."""
    repo_url = f"https://github.com/{squad.github_owner}/{squad.github_repo}"
    records: list[dict] = []

    if metric_key == "deployment_frequency":
        for deploy in derived.deploy_events:
            if not deploy.success or not (week.start <= deploy.occurred_at < week.end):
                continue
            pr = next(
                (p for p in facts.pull_requests if p.number == deploy.pull_request_number),
                None,
            )
            if pr:
                proxy_note = (
                    "" if facts.inspection.has_actions
                    else " (merge-to-default proxy, no CI/CD configured)"
                )
                records.append({
                    "record_id": f"pr-{pr.number}",
                    "occurred_at": deploy.occurred_at.isoformat(),
                    "title": pr.title,
                    "url": f"{repo_url}/pull/{pr.number}",
                    "actor_login": pr.author_login,
                    "detail": f"#{pr.number} merged to {facts.inspection.default_branch}{proxy_note}",
                })
            elif deploy.source == "commit":
                # Raw-commit proxy tier: no PR to point at (there was never one), and no
                # Actions run either — the receipt must be the commit itself, not a fabricated
                # "GitHub Actions run" label. deploy.occurred_at is exactly a commit's
                # authored_at (that's how derive_deploy_events builds this tier), so matching
                # on that timestamp finds the real commit.
                commit = next(
                    (c for c in facts.commits if c.authored_at == deploy.occurred_at), None
                )
                if commit:
                    records.append({
                        "record_id": f"commit-{commit.sha}",
                        "occurred_at": deploy.occurred_at.isoformat(),
                        "title": commit.message.splitlines()[0],
                        "url": f"{repo_url}/commit/{commit.sha}",
                        "actor_login": commit.author_login,
                        "detail": (
                            "Commit to default branch (raw-commit proxy — no CI/CD or PR "
                            "workflow configured)"
                        ),
                    })
            else:
                records.append({
                    "record_id": f"run-{deploy.occurred_at.isoformat()}",
                    "occurred_at": deploy.occurred_at.isoformat(),
                    "title": "GitHub Actions run",
                    "url": f"{repo_url}/actions",
                    "actor_login": None,
                    "detail": "Successful Actions run on default branch",
                })

    elif metric_key == "lead_time_for_changes":
        pr_by_number = {pr.number: pr for pr in derived.pull_requests}
        for deploy in derived.deploy_events:
            if not deploy.success or not (week.start <= deploy.occurred_at < week.end):
                continue
            pr = (
                pr_by_number.get(deploy.pull_request_number)
                if deploy.pull_request_number is not None
                else None
            )
            if pr and pr.first_commit_at:
                hours = (deploy.occurred_at - pr.first_commit_at).total_seconds() / 3600
                full_pr = next(p for p in facts.pull_requests if p.number == pr.number)
                records.append({
                    "record_id": f"pr-{pr.number}",
                    "occurred_at": deploy.occurred_at.isoformat(),
                    "title": full_pr.title,
                    "url": f"{repo_url}/pull/{pr.number}",
                    "actor_login": full_pr.author_login,
                    "detail": f"{hours:.1f}h from first commit to merge",
                })

    elif metric_key == "pr_review_turnaround":
        for pr in facts.pull_requests:
            if not (week.start <= pr.created_at < week.end) or not pr.reviews:
                continue
            first_review = min(pr.reviews, key=lambda r: r.submitted_at)
            hours = (first_review.submitted_at - pr.created_at).total_seconds() / 3600
            records.append({
                "record_id": f"pr-{pr.number}",
                "occurred_at": first_review.submitted_at.isoformat(),
                "title": pr.title,
                "url": f"{repo_url}/pull/{pr.number}",
                "actor_login": pr.author_login,
                "detail": f"First review {hours:.1f}h after opening",
            })

    elif metric_key in ("change_failure_rate", "mttr"):
        for issue in facts.issues:
            if week.start <= issue.created_at < week.end:
                resolved_note = (
                    f", closed {(issue.closed_at - issue.created_at).total_seconds() / 3600:.1f}h later"
                    if issue.closed_at
                    else " (still open)"
                )
                records.append({
                    "record_id": f"issue-{issue.number}",
                    "occurred_at": issue.created_at.isoformat(),
                    "title": issue.title,
                    "url": f"{repo_url}/issues/{issue.number}",
                    "actor_login": None,
                    "detail": f"Labeled bug/incident{resolved_note}",
                })
        for commit in facts.commits:
            if derive.REVERT_COMMIT_PATTERN.match(commit.message) and (
                week.start <= commit.authored_at < week.end
            ):
                records.append({
                    "record_id": f"commit-{commit.sha}",
                    "occurred_at": commit.authored_at.isoformat(),
                    "title": commit.message.splitlines()[0],
                    "url": f"{repo_url}/commit/{commit.sha}",
                    "actor_login": commit.author_login,
                    "detail": "Revert commit — self-resolves instantly by definition",
                })

    for record in records:
        record["squad_id"] = squad.id
        record["metric_key"] = metric_key
        record["week_start"] = week.start.date().isoformat()

    return records


def _build_metric_records(
    squad: Squad, facts: SquadFacts, derived: DerivedInputs, weeks: list[derive.WeekWindow]
) -> list[dict]:
    rows: list[dict] = []
    for week in weeks:
        for metric_key in METRIC_KEYS:
            rows.extend(_records_for_metric_week(squad, facts, derived, metric_key, week))
    return rows


async def ingest_squad(squad: Squad) -> IngestResult:
    async with GithubClient(settings.github_token) as gh:
        facts = await fetch_squad_facts(gh, squad.github_owner, squad.github_repo)

    derived = DerivedInputs(facts)
    weeks = derive.last_n_iso_weeks(WEEKS_TO_INGEST)
    week_starts = [week.start.date().isoformat() for week in weeks]
    rows = [_build_week_row(squad.id, week, derived) for week in weeks]
    record_rows = _build_metric_records(squad, facts, derived, weeks)

    client = get_service_client()
    client.table("metrics_snapshots").upsert(
        rows, on_conflict="squad_id,week_start", returning="minimal"
    ).execute()

    # Delete-then-insert, not upsert: the fetch window (max_age_days=180 in github_client.py)
    # rolls forward every run, so a record that was in scope last time can legitimately fall out
    # of it this time (or an issue gets unlabeled, a PR's state changes, etc.) — an upsert alone
    # would leave that stale row behind forever, since nothing in the freshly-derived set would
    # ever match it to overwrite or remove it.
    client.table("metric_records").delete().eq("squad_id", squad.id).in_(
        "week_start", week_starts
    ).execute()
    if record_rows:
        client.table("metric_records").insert(record_rows, returning="minimal").execute()

    # Keep the squads table's disclosure fields current — ingestion is the only place that
    # actually observes live GitHub state. Without this, a repo that later adopts real CI/CD or
    # starts using PRs would stay stuck showing the old, less-authoritative proxy tier forever.
    deploy_proxy = derived.deploy_events[0].source if derived.deploy_events else squad.deploy_proxy
    client.table("squads").update({
        "has_actions": facts.inspection.has_actions,
        "deploy_proxy": deploy_proxy,
    }).eq("id", squad.id).execute()

    return IngestResult(
        squad_id=squad.id,
        has_actions=facts.inspection.has_actions,
        deploy_proxy=deploy_proxy,
        rows_upserted=len(rows),
        weeks=rows,
    )
