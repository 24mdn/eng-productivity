"""
Pure formulas — no I/O, called by ingest.py to persist weekly aggregates and drill-down
records. lib/metrics.ts is the TS mirror, used only by scripts/inspect-and-fetch.ts (a
verification CLI) — not the live dashboard, which reads Postgres only. Keep both in sync if
this logic ever changes.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

Unit = Literal["count", "hours", "percent"]

# GitHub has no native incident concept — a "change failure" is a deploy followed by an
# incident (labeled issue or revert commit) within this many days. Heuristic, not fact.
INCIDENT_WINDOW_DAYS = 2

REVERT_COMMIT_PATTERN = re.compile(r"^revert\b", re.IGNORECASE)


@dataclass
class DeployEvent:
    occurred_at: datetime
    success: bool
    pull_request_number: int | None = None
    # 'workflow_run' | 'merge_to_default' | 'commit' — which proxy tier produced this event.
    # Surfaced so the UI can disclose exactly what's backing "deploys" for a given repo.
    source: str = "workflow_run"


@dataclass
class PullRequestFact:
    number: int
    created_at: datetime
    merged_at: datetime | None
    first_commit_at: datetime | None
    state: str | None = None
    base_ref_name: str | None = None
    # The commit SHA this PR's merge produced — matched against a workflow run's head_sha to
    # correlate a CI-tier deploy event back to the PR that shipped it. None for unmerged PRs.
    merge_commit_sha: str | None = None


@dataclass
class ReviewFact:
    pull_request_number: int
    submitted_at: datetime


@dataclass
class IncidentFact:
    opened_at: datetime
    resolved_at: datetime | None


@dataclass
class WorkflowRunFact:
    conclusion: str | None
    run_started_at: datetime
    run_completed_at: datetime | None
    # The commit this run actually built — matched against a merged PR's merge_commit_sha.
    head_sha: str | None = None


@dataclass
class IssueFact:
    created_at: datetime
    closed_at: datetime | None


@dataclass
class CommitFact:
    message: str
    authored_at: datetime


@dataclass
class WeekWindow:
    start: datetime
    end: datetime


@dataclass
class MetricResult:
    value: float | None
    unit: Unit
    sample_size: int


def _in_window(dt: datetime, window: WeekWindow) -> bool:
    return window.start <= dt < window.end


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def _hours_between(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / 3600


def deployment_frequency(deploy_events: list[DeployEvent], window: WeekWindow) -> MetricResult:
    count = sum(1 for d in deploy_events if d.success and _in_window(d.occurred_at, window))
    return MetricResult(value=count, unit="count", sample_size=count)


def lead_time_for_changes(
    deploy_events: list[DeployEvent],
    pull_requests: list[PullRequestFact],
    window: WeekWindow,
) -> MetricResult:
    pr_by_number = {pr.number: pr for pr in pull_requests}
    hours: list[float] = []
    for deploy in deploy_events:
        if not deploy.success or not _in_window(deploy.occurred_at, window):
            continue
        pr = (
            pr_by_number.get(deploy.pull_request_number)
            if deploy.pull_request_number is not None
            else None
        )
        if pr and pr.first_commit_at:
            hours.append(_hours_between(deploy.occurred_at, pr.first_commit_at))
    return MetricResult(value=_median(hours), unit="hours", sample_size=len(hours))


def change_failure_rate(
    deploy_events: list[DeployEvent],
    incidents: list[IncidentFact],
    window: WeekWindow,
) -> MetricResult:
    successful = [d for d in deploy_events if d.success and _in_window(d.occurred_at, window)]
    if not successful:
        return MetricResult(value=None, unit="percent", sample_size=0)
    window_delta = timedelta(days=INCIDENT_WINDOW_DAYS)
    failed = sum(
        1
        for deploy in successful
        if any(
            deploy.occurred_at <= incident.opened_at <= deploy.occurred_at + window_delta
            for incident in incidents
        )
    )
    return MetricResult(
        value=(failed / len(successful)) * 100, unit="percent", sample_size=len(successful)
    )


def mttr(incidents: list[IncidentFact], window: WeekWindow) -> MetricResult:
    resolved = [i for i in incidents if i.resolved_at and _in_window(i.opened_at, window)]
    hours = [_hours_between(i.resolved_at, i.opened_at) for i in resolved]  # type: ignore[arg-type]
    return MetricResult(value=_mean(hours), unit="hours", sample_size=len(hours))


def pr_review_turnaround(
    pull_requests: list[PullRequestFact],
    reviews: list[ReviewFact],
    window: WeekWindow,
) -> MetricResult:
    first_review_by_pr: dict[int, datetime] = {}
    for review in reviews:
        existing = first_review_by_pr.get(review.pull_request_number)
        if existing is None or review.submitted_at < existing:
            first_review_by_pr[review.pull_request_number] = review.submitted_at

    hours: list[float] = []
    for pr in pull_requests:
        if not _in_window(pr.created_at, window):
            continue
        first_review = first_review_by_pr.get(pr.number)
        if first_review:
            hours.append(_hours_between(first_review, pr.created_at))
    return MetricResult(value=_median(hours), unit="hours", sample_size=len(hours))


def last_n_iso_weeks(n: int, from_dt: datetime | None = None) -> list[WeekWindow]:
    """Last `n` ISO (Mon-Sun) weeks, most recent last. Matches lib/metrics.ts's lastNIsoWeeks —
    Python's date.weekday() (Mon=0..Sun=6) is already "days since Monday", the same quantity
    the JS version computes by hand via (getDay() + 6) % 7."""
    reference = from_dt or datetime.now(timezone.utc)
    reference = reference.replace(hour=0, minute=0, second=0, microsecond=0)
    this_monday = reference - timedelta(days=reference.weekday())
    weeks: list[WeekWindow] = []
    for i in range(n - 1, -1, -1):
        start = this_monday - timedelta(days=i * 7)
        weeks.append(WeekWindow(start=start, end=start + timedelta(days=7)))
    return weeks


def derive_deploy_events(
    pull_requests: list[PullRequestFact],
    workflow_runs: list[WorkflowRunFact],
    has_actions: bool,
    default_branch: str,
    commits: list[CommitFact] | None = None,
) -> list[DeployEvent]:
    """The key abstraction: downstream metric code never cares which proxy is active. Three
    tiers, most-to-least authoritative:

    1. Real CI/CD (has_actions=True): a successful Actions run on the default branch IS a
       deploy. Matched back to the PR it shipped (if any) by comparing the run's head_sha
       against merged PRs' merge_commit_sha — a run on a repo with no PR workflow (raw commits
       straight to the default branch) simply won't match anything, and pull_request_number
       stays None, same as before this correlation existed.
    2. PR-merge proxy: no Actions workflows, but PRs get merged to the default branch — each
       merge stands in for a "deploy" (lhagli-api's confirmed profile when it still used PRs).
    3. Raw-commit proxy: no Actions AND zero merged PRs ever (confirmed empirically for all
       three lhagli-* repos — solo/AI-assisted development pushed straight to main, no PR
       workflow at all) — each commit on the default branch stands in for a "deploy". This is
       the least authoritative tier and should be disclosed most prominently in the UI.
    """
    if has_actions:
        merge_sha_to_pr = {
            pr.merge_commit_sha: pr.number
            for pr in pull_requests
            if pr.state == "MERGED" and pr.merge_commit_sha and pr.base_ref_name == default_branch
        }
        return [
            DeployEvent(
                occurred_at=run.run_completed_at or run.run_started_at,
                success=run.conclusion == "success",
                pull_request_number=merge_sha_to_pr.get(run.head_sha),
                source="workflow_run",
            )
            for run in workflow_runs
            if run.conclusion is not None
        ]

    merged_prs = [
        DeployEvent(
            occurred_at=pr.merged_at,  # type: ignore[arg-type]
            success=True,
            pull_request_number=pr.number,
            source="merge_to_default",
        )
        for pr in pull_requests
        if pr.state == "MERGED" and pr.merged_at and pr.base_ref_name == default_branch
    ]
    if merged_prs:
        return merged_prs

    return [
        DeployEvent(occurred_at=commit.authored_at, success=True, source="commit")
        for commit in (commits or [])
    ]


def derive_incidents(issues: list[IssueFact], commits: list[CommitFact]) -> list[IncidentFact]:
    """Revert commits self-resolve at the moment of the revert (0h by definition, opened ==
    resolved) — only labeled-issue incidents have a real open->close duration."""
    revert_commits = [c for c in commits if REVERT_COMMIT_PATTERN.match(c.message)]
    return [
        IncidentFact(opened_at=issue.created_at, resolved_at=issue.closed_at)
        for issue in issues
    ] + [
        IncidentFact(opened_at=c.authored_at, resolved_at=c.authored_at)
        for c in revert_commits
    ]
