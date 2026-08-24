import type { GithubClient } from "./client";

export interface RepoInspection {
  githubId: number;
  defaultBranch: string;
  hasActions: boolean;
}

/**
 * Checked at the start of every ingestion — never assume a repo has CI/CD.
 * `lhagli-api` (the reference repo for this prototype) has no `.github/workflows`,
 * so deployment frequency/change-failure-rate/MTTR fall back to a merge-to-default-branch
 * proxy. The UI must disclose that proxy rather than silently fake real CI/CD data.
 */
export async function inspectRepo(
  octokit: GithubClient,
  owner: string,
  repo: string
): Promise<RepoInspection> {
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
  const { data: workflows } = await octokit.rest.actions.listRepoWorkflows({
    owner,
    repo,
  });

  return {
    githubId: Number(repoData.id),
    defaultBranch: repoData.default_branch,
    hasActions: workflows.total_count > 0,
  };
}
