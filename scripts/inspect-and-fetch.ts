/**
 * Standalone verification/inspection CLI for one repo's live GitHub data — not the ingestion
 * path (that's api/app/ingest_cli.py, writing to Supabase) and not part of the live dashboard
 * (which reads only Postgres, never GitHub). Useful for spot-checking derive.py's formulas
 * against real data by hand.
 * Run: pnpm tsx scripts/inspect-and-fetch.ts
 */
import { createGithubClient } from "../lib/github/client";
import { inspectRepo } from "../lib/github/inspect";
import {
  fetchPullRequests,
  fetchWorkflowRuns,
  fetchIncidentLabeledIssues,
  fetchDefaultBranchCommits,
} from "../lib/github/queries";
import {
  deploymentFrequency,
  leadTimeForChanges,
  changeFailureRate,
  mttr,
  prReviewTurnaround,
  lastNIsoWeeks,
  deriveDeployEvents,
  deriveIncidents,
  type PullRequestFact,
  type ReviewFact,
} from "../lib/metrics";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present yet — fine for now, GITHUB_TOKEN may already be in the shell env
}

async function main() {
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo) {
    throw new Error(
      "Set GITHUB_REPO_OWNER and GITHUB_REPO_NAME in .env.local (e.g. 24mdn / lhagli-api)."
    );
  }

  const octokit = createGithubClient(token);

  console.log(`Inspecting ${owner}/${repo}...`);
  const inspection = await inspectRepo(octokit, owner, repo);
  console.log(inspection);

  console.log("Fetching pull requests + reviews + commits (GraphQL)...");
  const pullRequests = await fetchPullRequests(octokit, owner, repo);
  console.log(`  ${pullRequests.length} pull requests fetched`);

  console.log("Fetching default-branch commits (REST)...");
  const commits = await fetchDefaultBranchCommits(
    octokit,
    owner,
    repo,
    inspection.defaultBranch
  );
  console.log(`  ${commits.length} commits fetched`);

  console.log("Fetching bug/incident-labeled issues (REST)...");
  const issues = await fetchIncidentLabeledIssues(octokit, owner, repo);
  console.log(`  ${issues.length} labeled issues fetched`);

  let workflowRuns: Awaited<ReturnType<typeof fetchWorkflowRuns>> = [];
  if (inspection.hasActions) {
    console.log("Fetching Actions workflow runs (REST)...");
    workflowRuns = await fetchWorkflowRuns(
      octokit,
      owner,
      repo,
      inspection.defaultBranch
    );
    console.log(`  ${workflowRuns.length} workflow runs fetched`);
  } else {
    console.log(
      "  No Actions workflows on this repo — deployment frequency/change-failure-rate/MTTR " +
        "will use a merge-to-default-branch proxy instead of real CI/CD data."
    );
  }

  // --- Derive deploy_events + incidents -------------------------------------------------
  const pullRequestFacts: PullRequestFact[] = pullRequests.map((pr) => ({
    number: pr.number,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    firstCommitAt: pr.firstCommitAt,
    state: pr.state,
    baseRefName: pr.baseRefName,
    mergeCommitSha: pr.mergeCommitSha,
  }));

  const deployEvents = deriveDeployEvents(
    pullRequestFacts,
    workflowRuns.map((run) => ({
      conclusion: run.conclusion,
      runStartedAt: run.runStartedAt,
      runCompletedAt: run.runCompletedAt,
      headSha: run.headSha,
    })),
    inspection.hasActions,
    inspection.defaultBranch,
    commits.map((c) => ({ message: c.message, authoredAt: c.authoredAt }))
  );

  const incidents = deriveIncidents(
    issues.map((issue) => ({ createdAt: issue.createdAt, closedAt: issue.closedAt })),
    commits.map((c) => ({ message: c.message, authoredAt: c.authoredAt }))
  );

  const reviewFacts: ReviewFact[] = pullRequests.flatMap((pr) =>
    pr.reviews.map((r) => ({
      pullRequestNumber: pr.number,
      submittedAt: r.submittedAt,
    }))
  );

  // --- Compute metrics for the last 4 ISO weeks -------------------------------------------------
  const weeks = lastNIsoWeeks(4);
  const rows = weeks.map((week) => {
    const label = `${week.start.toISOString().slice(0, 10)}`;
    return {
      week: label,
      deploy_freq: deploymentFrequency(deployEvents, week).value,
      lead_time_hrs: leadTimeForChanges(deployEvents, pullRequestFacts, week).value,
      change_fail_pct: changeFailureRate(deployEvents, incidents, week).value,
      mttr_hrs: mttr(incidents, week).value,
      review_turnaround_hrs: prReviewTurnaround(pullRequestFacts, reviewFacts, week)
        .value,
    };
  });

  console.log("\nMetrics — last 4 ISO weeks (week = Monday start date):");
  console.table(rows);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
