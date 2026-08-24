from datetime import datetime, timedelta, timezone

from app.derive import (
    CommitFact,
    DeployEvent,
    IncidentFact,
    IssueFact,
    PullRequestFact,
    ReviewFact,
    WeekWindow,
    WorkflowRunFact,
    change_failure_rate,
    deployment_frequency,
    derive_deploy_events,
    derive_incidents,
    last_n_iso_weeks,
    lead_time_for_changes,
    mttr,
    pr_review_turnaround,
)

UTC = timezone.utc


def dt(y, m, d, h=0):
    return datetime(y, m, d, h, tzinfo=UTC)


def week(y, m, d):
    start = dt(y, m, d)
    return WeekWindow(start=start, end=start + timedelta(days=7))


# --- last_n_iso_weeks ---------------------------------------------------------------


def test_last_n_iso_weeks_returns_monday_starts_most_recent_last():
    # 2026-08-06 is a Thursday
    weeks = last_n_iso_weeks(3, from_dt=dt(2026, 8, 6, 15))
    assert [w.start.date().isoformat() for w in weeks] == [
        "2026-07-20",
        "2026-07-27",
        "2026-08-03",
    ]
    assert weeks[-1].end == weeks[-1].start + timedelta(days=7)


def test_last_n_iso_weeks_sunday_belongs_to_the_week_that_started_the_prior_monday():
    # 2026-08-09 is a Sunday; the ISO week containing it starts Monday 2026-08-03
    weeks = last_n_iso_weeks(1, from_dt=dt(2026, 8, 9, 23))
    assert weeks[0].start.date().isoformat() == "2026-08-03"


def test_last_n_iso_weeks_monday_is_the_start_of_its_own_week():
    weeks = last_n_iso_weeks(1, from_dt=dt(2026, 8, 3, 0))
    assert weeks[0].start.date().isoformat() == "2026-08-03"


# --- deployment_frequency -----------------------------------------------------------


def test_deployment_frequency_counts_only_successful_events_in_window():
    w = week(2026, 1, 5)
    events = [
        DeployEvent(occurred_at=dt(2026, 1, 6), success=True),
        DeployEvent(occurred_at=dt(2026, 1, 7), success=False),  # not success
        DeployEvent(occurred_at=dt(2026, 1, 20), success=True),  # outside window
    ]
    result = deployment_frequency(events, w)
    assert result.value == 1
    assert result.sample_size == 1
    assert result.unit == "count"


# --- lead_time_for_changes -----------------------------------------------------------


def test_lead_time_for_changes_is_median_hours_from_first_commit_to_deploy():
    w = week(2026, 1, 5)
    prs = [
        PullRequestFact(number=1, created_at=dt(2026, 1, 5), merged_at=dt(2026, 1, 6),
                         first_commit_at=dt(2026, 1, 5, 12)),
        PullRequestFact(number=2, created_at=dt(2026, 1, 5), merged_at=dt(2026, 1, 6),
                         first_commit_at=dt(2026, 1, 5, 0)),
    ]
    events = [
        DeployEvent(occurred_at=dt(2026, 1, 6, 12), success=True, pull_request_number=1),  # 24h
        DeployEvent(occurred_at=dt(2026, 1, 6, 12), success=True, pull_request_number=2),  # 36h
    ]
    result = lead_time_for_changes(events, prs, w)
    assert result.value == 30.0  # median of [24, 36]
    assert result.sample_size == 2


def test_lead_time_for_changes_skips_deploys_with_no_matching_pr():
    w = week(2026, 1, 5)
    events = [DeployEvent(occurred_at=dt(2026, 1, 6), success=True, pull_request_number=999)]
    result = lead_time_for_changes(events, [], w)
    assert result.value is None
    assert result.sample_size == 0


# --- change_failure_rate -----------------------------------------------------------


def test_change_failure_rate_flags_deploys_with_incident_within_window():
    w = week(2026, 1, 5)
    events = [
        DeployEvent(occurred_at=dt(2026, 1, 6), success=True),
        DeployEvent(occurred_at=dt(2026, 1, 7), success=True),
    ]
    incidents = [
        # within 2 days of the first deploy
        IncidentFact(opened_at=dt(2026, 1, 6, 6), resolved_at=None),
    ]
    result = change_failure_rate(events, incidents, w)
    assert result.value == 50.0
    assert result.sample_size == 2


def test_change_failure_rate_no_deploys_returns_none_not_zero():
    result = change_failure_rate([], [], week(2026, 1, 5))
    assert result.value is None
    assert result.sample_size == 0


def test_change_failure_rate_incident_outside_window_does_not_count():
    w = week(2026, 1, 5)
    events = [DeployEvent(occurred_at=dt(2026, 1, 6), success=True)]
    incidents = [IncidentFact(opened_at=dt(2026, 1, 10), resolved_at=None)]  # 4 days later
    result = change_failure_rate(events, incidents, w)
    assert result.value == 0.0


# --- mttr -----------------------------------------------------------------------------


def test_mttr_is_mean_hours_open_to_resolved():
    w = week(2026, 1, 5)
    incidents = [
        IncidentFact(opened_at=dt(2026, 1, 6), resolved_at=dt(2026, 1, 6, 4)),  # 4h
        IncidentFact(opened_at=dt(2026, 1, 6), resolved_at=dt(2026, 1, 6, 8)),  # 8h
    ]
    result = mttr(incidents, w)
    assert result.value == 6.0
    assert result.sample_size == 2


def test_mttr_unresolved_incidents_are_excluded():
    w = week(2026, 1, 5)
    incidents = [IncidentFact(opened_at=dt(2026, 1, 6), resolved_at=None)]
    result = mttr(incidents, w)
    assert result.value is None
    assert result.sample_size == 0


# --- pr_review_turnaround -----------------------------------------------------------


def test_pr_review_turnaround_uses_first_review_only():
    w = week(2026, 1, 5)
    prs = [PullRequestFact(number=1, created_at=dt(2026, 1, 5), merged_at=None, first_commit_at=None)]
    reviews = [
        ReviewFact(pull_request_number=1, submitted_at=dt(2026, 1, 5, 10)),  # first: 10h
        ReviewFact(pull_request_number=1, submitted_at=dt(2026, 1, 5, 20)),  # later, ignored
    ]
    result = pr_review_turnaround(prs, reviews, w)
    assert result.value == 10.0
    assert result.sample_size == 1


# --- derive_deploy_events -----------------------------------------------------------


def test_derive_deploy_events_uses_merge_proxy_when_no_actions():
    prs = [
        PullRequestFact(number=1, created_at=dt(2026, 1, 1), merged_at=dt(2026, 1, 2),
                         first_commit_at=None, state="MERGED", base_ref_name="main"),
        PullRequestFact(number=2, created_at=dt(2026, 1, 1), merged_at=dt(2026, 1, 2),
                         first_commit_at=None, state="MERGED", base_ref_name="staging"),  # wrong branch
        PullRequestFact(number=3, created_at=dt(2026, 1, 1), merged_at=None,
                         first_commit_at=None, state="OPEN", base_ref_name="main"),  # not merged
    ]
    events = derive_deploy_events(prs, workflow_runs=[], has_actions=False, default_branch="main")
    assert len(events) == 1
    assert events[0].pull_request_number == 1
    assert events[0].success is True
    assert events[0].source == "merge_to_default"


def test_derive_deploy_events_falls_back_to_raw_commits_when_no_prs_merged_ever():
    # confirmed real-world case: solo/AI-assisted repos pushed straight to main, zero PRs
    commits = [
        CommitFact(message="Add feature", authored_at=dt(2026, 1, 1)),
        CommitFact(message="Fix bug", authored_at=dt(2026, 1, 2)),
    ]
    events = derive_deploy_events(
        pull_requests=[], workflow_runs=[], has_actions=False, default_branch="main",
        commits=commits,
    )
    assert len(events) == 2
    assert all(e.source == "commit" and e.success and e.pull_request_number is None for e in events)


def test_derive_deploy_events_prefers_merged_prs_over_commit_fallback_when_both_exist():
    prs = [
        PullRequestFact(number=1, created_at=dt(2026, 1, 1), merged_at=dt(2026, 1, 2),
                         first_commit_at=None, state="MERGED", base_ref_name="main"),
    ]
    commits = [CommitFact(message="unrelated commit", authored_at=dt(2026, 1, 3))]
    events = derive_deploy_events(
        prs, workflow_runs=[], has_actions=False, default_branch="main", commits=commits,
    )
    assert len(events) == 1
    assert events[0].source == "merge_to_default"


def test_derive_deploy_events_uses_workflow_runs_when_actions_exist():
    runs = [
        WorkflowRunFact(conclusion="success", run_started_at=dt(2026, 1, 1),
                         run_completed_at=dt(2026, 1, 1, 1)),
        WorkflowRunFact(conclusion="failure", run_started_at=dt(2026, 1, 2), run_completed_at=None),
        WorkflowRunFact(conclusion=None, run_started_at=dt(2026, 1, 3), run_completed_at=None),  # in progress, skipped
    ]
    events = derive_deploy_events([], workflow_runs=runs, has_actions=True, default_branch="main")
    assert len(events) == 2
    assert events[0].success is True
    assert events[1].success is False


# --- derive_incidents -----------------------------------------------------------


def test_derive_incidents_combines_issues_and_revert_commits():
    issues = [IssueFact(created_at=dt(2026, 1, 1), closed_at=dt(2026, 1, 2))]
    commits = [
        CommitFact(message='Revert "Add retry queue"', authored_at=dt(2026, 1, 3)),
        CommitFact(message="Add retry queue", authored_at=dt(2026, 1, 2)),  # not a revert
    ]
    incidents = derive_incidents(issues, commits)
    assert len(incidents) == 2
    revert_incident = next(i for i in incidents if i.opened_at == dt(2026, 1, 3))
    assert revert_incident.opened_at == revert_incident.resolved_at  # self-resolves instantly
