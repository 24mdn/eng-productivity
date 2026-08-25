"""
httpx-based GitHub client. REST for repo/workflows/runs/issues/commits, one GraphQL POST for
PRs+reviews+first-commit (ported 1:1 from lib/github/{inspect,queries}.ts — same query shape,
same endpoints, same pagination/cutoff behavior).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

import httpx

GITHUB_API = "https://api.github.com"
GITHUB_GRAPHQL = "https://api.github.com/graphql"

PULL_REQUESTS_QUERY = """
query PullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      first: 50
      after: $after
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        createdAt
        mergedAt
        closedAt
        baseRefName
        headRefName
        mergeCommit { oid }
        author { login }
        commits(first: 100) { nodes { commit { committedDate } } }
        reviews(first: 50) { nodes { author { login } state submittedAt } }
      }
    }
  }
}
"""


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass
class RepoInspection:
    github_id: int
    default_branch: str
    has_actions: bool


@dataclass
class FetchedReview:
    reviewer_login: str | None
    state: str
    submitted_at: datetime


@dataclass
class FetchedPullRequest:
    number: int
    title: str
    state: str  # OPEN | CLOSED | MERGED
    author_login: str | None
    created_at: datetime
    merged_at: datetime | None
    closed_at: datetime | None
    base_ref_name: str
    head_ref_name: str
    first_commit_at: datetime | None
    reviews: list[FetchedReview]
    merge_commit_sha: str | None = None


@dataclass
class FetchedWorkflowRun:
    github_run_id: int
    workflow_name: str
    head_branch: str
    conclusion: str | None
    run_started_at: datetime
    run_completed_at: datetime | None
    head_sha: str | None = None


@dataclass
class FetchedIssue:
    number: int
    title: str
    created_at: datetime
    closed_at: datetime | None
    labels: list[str]


@dataclass
class FetchedCommit:
    sha: str
    message: str
    authored_at: datetime
    author_login: str | None = None


class GithubClient:
    def __init__(self, token: str):
        self._client = httpx.AsyncClient(
            base_url=GITHUB_API,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "GithubClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def inspect_repo(self, owner: str, repo: str) -> RepoInspection:
        """Checked at the start of every ingestion — never assume a repo has CI/CD. This is
        exactly the check that surfaces whether a repo has no workflows."""
        repo_resp = await self._client.get(f"/repos/{owner}/{repo}")
        repo_resp.raise_for_status()
        repo_data = repo_resp.json()

        workflows_resp = await self._client.get(f"/repos/{owner}/{repo}/actions/workflows")
        workflows_resp.raise_for_status()
        workflows_data = workflows_resp.json()

        return RepoInspection(
            github_id=repo_data["id"],
            default_branch=repo_data["default_branch"],
            has_actions=workflows_data["total_count"] > 0,
        )

    async def _paginate(
        self, url: str, params: dict[str, Any] | None = None
    ) -> AsyncIterator[Any]:
        next_url: str | None = url
        next_params: dict[str, Any] | None = params
        while next_url:
            resp = await self._client.get(next_url, params=next_params)
            resp.raise_for_status()
            yield resp.json()
            next_url = resp.links.get("next", {}).get("url")
            next_params = None  # the next-page URL already carries its own query params

    async def fetch_workflow_runs(
        self, owner: str, repo: str, default_branch: str
    ) -> list[FetchedWorkflowRun]:
        runs: list[FetchedWorkflowRun] = []
        async for page in self._paginate(
            f"/repos/{owner}/{repo}/actions/runs",
            {"branch": default_branch, "per_page": 100},
        ):
            for run in page.get("workflow_runs", []):
                runs.append(
                    FetchedWorkflowRun(
                        github_run_id=run["id"],
                        workflow_name=run.get("name") or "unknown",
                        head_branch=run.get("head_branch") or default_branch,
                        conclusion=run.get("conclusion"),
                        run_started_at=_parse_iso(run.get("run_started_at") or run["created_at"]),
                        run_completed_at=(
                            _parse_iso(run["updated_at"]) if run.get("updated_at") else None
                        ),
                        head_sha=run.get("head_sha"),
                    )
                )
        return runs

    async def fetch_incident_labeled_issues(self, owner: str, repo: str) -> list[FetchedIssue]:
        """GitHub's REST `labels` query param is an AND filter across every label listed, not
        OR — a single `labels=bug,incident` call only ever matches an issue carrying *both*
        labels at once, which none realistically do. To get "has bug OR incident", fetch each
        label separately and dedupe by issue number."""
        by_number: dict[int, FetchedIssue] = {}
        for label in ("bug", "incident"):
            async for page in self._paginate(
                f"/repos/{owner}/{repo}/issues",
                {"state": "all", "labels": label, "per_page": 100},
            ):
                for issue in page:
                    if "pull_request" in issue:
                        continue  # GitHub returns PRs from this endpoint too
                    by_number[issue["number"]] = FetchedIssue(
                        number=issue["number"],
                        title=issue["title"],
                        created_at=_parse_iso(issue["created_at"]),
                        closed_at=(
                            _parse_iso(issue["closed_at"]) if issue.get("closed_at") else None
                        ),
                        labels=[
                            label["name"] if isinstance(label, dict) else label
                            for label in issue.get("labels", [])
                        ],
                    )
        return list(by_number.values())

    async def fetch_default_branch_commits(
        self, owner: str, repo: str, default_branch: str, max_age_days: int = 180
    ) -> list[FetchedCommit]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        commits: list[FetchedCommit] = []
        async for page in self._paginate(
            f"/repos/{owner}/{repo}/commits",
            {"sha": default_branch, "per_page": 100},
        ):
            for commit in page:
                author = commit["commit"].get("author") or commit["commit"].get("committer")
                if not author:
                    continue
                authored_at = _parse_iso(author["date"])
                if authored_at < cutoff:
                    continue
                github_user = commit.get("author")  # top-level = linked GitHub account, nullable
                commits.append(
                    FetchedCommit(
                        sha=commit["sha"],
                        message=commit["commit"]["message"],
                        authored_at=authored_at,
                        author_login=github_user["login"] if github_user else None,
                    )
                )
        return commits

    async def fetch_pull_requests(
        self, owner: str, repo: str, max_age_days: int = 180
    ) -> list[FetchedPullRequest]:
        """Paginates PRs updated in the last `max_age_days` days (bounds cost on long-lived
        repos), same cutoff behavior as lib/github/queries.ts's fetchPullRequests."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        results: list[FetchedPullRequest] = []
        after: str | None = None

        while True:
            resp = await self._client.post(
                GITHUB_GRAPHQL,
                json={
                    "query": PULL_REQUESTS_QUERY,
                    "variables": {"owner": owner, "name": repo, "after": after},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if "errors" in data:
                raise RuntimeError(f"GitHub GraphQL error: {data['errors']}")

            pr_connection = data["data"]["repository"]["pullRequests"]
            stop = False
            for node in pr_connection["nodes"]:
                created_at = _parse_iso(node["createdAt"])
                if created_at < cutoff:
                    stop = True
                    continue
                commit_dates = [
                    _parse_iso(c["commit"]["committedDate"])
                    for c in node["commits"]["nodes"]
                ]
                results.append(
                    FetchedPullRequest(
                        number=node["number"],
                        title=node["title"],
                        state=node["state"],
                        author_login=(node.get("author") or {}).get("login"),
                        created_at=created_at,
                        merged_at=_parse_iso(node["mergedAt"]) if node.get("mergedAt") else None,
                        closed_at=_parse_iso(node["closedAt"]) if node.get("closedAt") else None,
                        base_ref_name=node["baseRefName"],
                        head_ref_name=node["headRefName"],
                        first_commit_at=min(commit_dates) if commit_dates else None,
                        merge_commit_sha=(node.get("mergeCommit") or {}).get("oid"),
                        reviews=[
                            FetchedReview(
                                reviewer_login=(review.get("author") or {}).get("login"),
                                state=review["state"],
                                submitted_at=_parse_iso(review["submittedAt"]),
                            )
                            for review in node["reviews"]["nodes"]
                        ],
                    )
                )

            page_info = pr_connection["pageInfo"]
            if stop or not page_info["hasNextPage"] or not page_info["endCursor"]:
                break
            after = page_info["endCursor"]

        return results


@dataclass
class SquadFacts:
    inspection: RepoInspection
    pull_requests: list[FetchedPullRequest]
    commits: list[FetchedCommit]
    issues: list[FetchedIssue]
    workflow_runs: list[FetchedWorkflowRun]


async def fetch_squad_facts(client: GithubClient, owner: str, repo: str) -> SquadFacts:
    """One fetch pass per repo, for ingest.py — the only caller. The dashboard never fetches
    GitHub directly; it reads what this function's output was used to persist into Postgres."""
    inspection = await client.inspect_repo(owner, repo)
    pull_requests = await client.fetch_pull_requests(owner, repo)
    commits = await client.fetch_default_branch_commits(owner, repo, inspection.default_branch)
    issues = await client.fetch_incident_labeled_issues(owner, repo)
    workflow_runs = (
        await client.fetch_workflow_runs(owner, repo, inspection.default_branch)
        if inspection.has_actions
        else []
    )
    return SquadFacts(
        inspection=inspection,
        pull_requests=pull_requests,
        commits=commits,
        issues=issues,
        workflow_runs=workflow_runs,
    )
