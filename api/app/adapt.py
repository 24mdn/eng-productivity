"""Adapts github_client's fetched-data shapes into derive.py's pure-formula input shapes, for
ingest.py — the only caller. No TS equivalent exists anymore; the dashboard reads Postgres
only, never GitHub."""

from __future__ import annotations

from app import derive
from app.github_client import SquadFacts


class DerivedInputs:
    def __init__(self, facts: SquadFacts):
        self.pull_requests = [
            derive.PullRequestFact(
                number=pr.number,
                created_at=pr.created_at,
                merged_at=pr.merged_at,
                first_commit_at=pr.first_commit_at,
                state=pr.state,
                base_ref_name=pr.base_ref_name,
            )
            for pr in facts.pull_requests
        ]
        self.reviews = [
            derive.ReviewFact(pull_request_number=pr.number, submitted_at=review.submitted_at)
            for pr in facts.pull_requests
            for review in pr.reviews
        ]
        workflow_runs = [
            derive.WorkflowRunFact(
                conclusion=run.conclusion,
                run_started_at=run.run_started_at,
                run_completed_at=run.run_completed_at,
            )
            for run in facts.workflow_runs
        ]
        issues = [
            derive.IssueFact(created_at=issue.created_at, closed_at=issue.closed_at)
            for issue in facts.issues
        ]
        commits = [
            derive.CommitFact(message=c.message, authored_at=c.authored_at)
            for c in facts.commits
        ]
        # kept as raw FetchedCommit (not CommitFact) since author_login isn't part of the pure
        # derive.py vocabulary — it's only needed for the SPACE commits_per_engineer field
        self.commits = facts.commits

        self.deploy_events = derive.derive_deploy_events(
            self.pull_requests,
            workflow_runs,
            facts.inspection.has_actions,
            facts.inspection.default_branch,
            commits,
        )
        self.incidents = derive.derive_incidents(issues, commits)
