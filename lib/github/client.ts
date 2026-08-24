// GitHub client backing scripts/inspect-and-fetch.ts (a standalone verification CLI) — not
// part of the live dashboard, which reads only Postgres. api/app/github_client.py (httpx) is a
// 1:1 port of this used by ingestion, kept separately under api/ since ingestion stays on
// Python.
import { Octokit as OctokitCore } from "@octokit/core";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";
import { paginateRest } from "@octokit/plugin-paginate-rest";

const Octokit = OctokitCore.plugin(restEndpointMethods, paginateRest);

export type GithubClient = InstanceType<typeof Octokit>;

export function createGithubClient(token: string | undefined): GithubClient {
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add a read-only, repo-scoped personal access token to .env.local."
    );
  }
  return new Octokit({ auth: token });
}
