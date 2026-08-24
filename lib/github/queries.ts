import type { GithubClient } from "./client";

export const PULL_REQUESTS_QUERY = /* GraphQL */ `
  query PullRequests($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: 50
        after: $after
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          state
          createdAt
          mergedAt
          closedAt
          baseRefName
          headRefName
          author {
            login
          }
          mergeCommit {
            oid
          }
          commits(first: 100) {
            nodes {
              commit {
                committedDate
              }
            }
          }
          reviews(first: 50) {
            nodes {
              author {
                login
              }
              state
              submittedAt
            }
          }
        }
      }
    }
  }
`;

interface RawPullRequestNode {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string;
  headRefName: string;
  author: { login: string } | null;
  mergeCommit: { oid: string } | null;
  commits: { nodes: { commit: { committedDate: string } }[] };
  reviews: {
    nodes: { author: { login: string } | null; state: string; submittedAt: string }[];
  };
}

interface PullRequestsQueryResponse {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawPullRequestNode[];
    };
  };
}

export interface FetchedPullRequest {
  number: number;
  title: string;
  state: RawPullRequestNode["state"];
  authorLogin: string | null;
  createdAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  baseRefName: string;
  headRefName: string;
  mergeCommitSha: string | null;
  firstCommitAt: Date | null;
  additions: number;
  deletions: number;
  reviews: { reviewerLogin: string | null; state: string; submittedAt: Date }[];
}

/** Paginates PRs updated in the last `maxAgeDays` days (bounds cost on long-lived repos). */
export async function fetchPullRequests(
  octokit: GithubClient,
  owner: string,
  name: string,
  maxAgeDays = 180
): Promise<FetchedPullRequest[]> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const results: FetchedPullRequest[] = [];
  let after: string | null = null;
  let stop = false;

  while (!stop) {
    const response: PullRequestsQueryResponse = await octokit.graphql(
      PULL_REQUESTS_QUERY,
      { owner, name, after }
    );
    const { nodes, pageInfo } = response.repository.pullRequests;

    for (const node of nodes) {
      if (new Date(node.createdAt).getTime() < cutoff) {
        stop = true;
        continue;
      }
      const commitDates = node.commits.nodes.map((c) =>
        new Date(c.commit.committedDate).getTime()
      );
      results.push({
        number: node.number,
        title: node.title,
        state: node.state,
        authorLogin: node.author?.login ?? null,
        createdAt: new Date(node.createdAt),
        mergedAt: node.mergedAt ? new Date(node.mergedAt) : null,
        closedAt: node.closedAt ? new Date(node.closedAt) : null,
        baseRefName: node.baseRefName,
        headRefName: node.headRefName,
        mergeCommitSha: node.mergeCommit?.oid ?? null,
        firstCommitAt:
          commitDates.length > 0 ? new Date(Math.min(...commitDates)) : null,
        additions: 0,
        deletions: 0,
        reviews: node.reviews.nodes.map((r) => ({
          reviewerLogin: r.author?.login ?? null,
          state: r.state,
          submittedAt: new Date(r.submittedAt),
        })),
      });
    }

    if (!pageInfo.hasNextPage) stop = true;
    after = pageInfo.endCursor;
    if (!after) stop = true;
  }

  return results;
}

export interface FetchedWorkflowRun {
  githubRunId: number;
  workflowName: string;
  headBranch: string;
  conclusion: string | null;
  runStartedAt: Date;
  runCompletedAt: Date | null;
  headSha: string | null;
}

export async function fetchWorkflowRuns(
  octokit: GithubClient,
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<FetchedWorkflowRun[]> {
  const runs: FetchedWorkflowRun[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.actions.listWorkflowRunsForRepo,
    { owner, repo, branch: defaultBranch, per_page: 100 }
  )) {
    for (const run of response.data) {
      runs.push({
        githubRunId: run.id,
        workflowName: run.name ?? "unknown",
        headBranch: run.head_branch ?? defaultBranch,
        conclusion: run.conclusion,
        runStartedAt: new Date(run.run_started_at ?? run.created_at),
        runCompletedAt: run.updated_at ? new Date(run.updated_at) : null,
        headSha: run.head_sha ?? null,
      });
    }
  }
  return runs;
}

export interface FetchedIssue {
  number: number;
  title: string;
  createdAt: Date;
  closedAt: Date | null;
  labels: string[];
}

export async function fetchIncidentLabeledIssues(
  octokit: GithubClient,
  owner: string,
  repo: string
): Promise<FetchedIssue[]> {
  const issues: FetchedIssue[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.issues.listForRepo,
    { owner, repo, state: "all", labels: "bug,incident", per_page: 100 }
  )) {
    for (const issue of response.data) {
      if (issue.pull_request) continue; // GitHub returns PRs from this endpoint too
      issues.push({
        number: issue.number,
        title: issue.title,
        createdAt: new Date(issue.created_at),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
        labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
      });
    }
  }
  return issues;
}

export interface FetchedCommit {
  sha: string;
  message: string;
  authoredAt: Date;
  authorLogin: string | null;
}

export async function fetchDefaultBranchCommits(
  octokit: GithubClient,
  owner: string,
  repo: string,
  defaultBranch: string,
  maxAgeDays = 180
): Promise<FetchedCommit[]> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const commits: FetchedCommit[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.repos.listCommits,
    { owner, repo, sha: defaultBranch, per_page: 100 }
  )) {
    for (const commit of response.data) {
      const authoredAt = new Date(
        commit.commit.author?.date ?? commit.commit.committer?.date ?? 0
      );
      if (authoredAt.getTime() < cutoff) continue;
      // top-level `author` = linked GitHub account (nullable), distinct from commit.author
      // (just name/email/date) — matches github_client.py's author_login extraction.
      commits.push({
        sha: commit.sha,
        message: commit.commit.message,
        authoredAt,
        authorLogin: commit.author?.login ?? null,
      });
    }
  }
  return commits;
}
