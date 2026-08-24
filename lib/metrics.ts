import { differenceInHours } from "date-fns";

export interface DeployEvent {
  occurredAt: Date;
  success: boolean;
  pullRequestNumber?: number | null;
  // 'workflow_run' | 'merge_to_default' | 'commit' — which proxy tier produced this event.
  // Surfaced so the UI can disclose exactly what's backing "deploys" for a given repo.
  source: "workflow_run" | "merge_to_default" | "commit";
}

export interface PullRequestFact {
  number: number;
  createdAt: Date;
  mergedAt: Date | null;
  firstCommitAt: Date | null;
  state?: string | null;
  baseRefName?: string | null;
}

export interface ReviewFact {
  pullRequestNumber: number;
  submittedAt: Date;
}

export interface IncidentFact {
  openedAt: Date;
  resolvedAt: Date | null;
}

export interface WorkflowRunFact {
  conclusion: string | null;
  runStartedAt: Date;
  runCompletedAt: Date | null;
}

export interface IssueFact {
  createdAt: Date;
  closedAt: Date | null;
}

export interface CommitFact {
  message: string;
  authoredAt: Date;
}

export interface WeekWindow {
  start: Date;
  end: Date;
}

export interface MetricResult {
  value: number | null;
  unit: "count" | "hours" | "percent";
  sampleSize: number;
}

/** GitHub has no native incident concept — a "change failure" is a deploy followed by an
 * incident (labeled issue or revert commit) within this many days. Heuristic, not fact. */
export const INCIDENT_WINDOW_DAYS = 2;

export const REVERT_COMMIT_PATTERN = /^revert\b/i;

function inWindow(date: Date, window: WeekWindow): boolean {
  return date >= window.start && date < window.end;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function deploymentFrequency(
  deployEvents: DeployEvent[],
  window: WeekWindow
): MetricResult {
  const count = deployEvents.filter(
    (d) => d.success && inWindow(d.occurredAt, window)
  ).length;
  return { value: count, unit: "count", sampleSize: count };
}

export function leadTimeForChanges(
  deployEvents: DeployEvent[],
  pullRequests: PullRequestFact[],
  window: WeekWindow
): MetricResult {
  const prByNumber = new Map(pullRequests.map((pr) => [pr.number, pr]));
  const hours: number[] = [];
  for (const deploy of deployEvents) {
    if (!deploy.success || !inWindow(deploy.occurredAt, window)) continue;
    const pr =
      deploy.pullRequestNumber != null
        ? prByNumber.get(deploy.pullRequestNumber)
        : undefined;
    if (pr?.firstCommitAt) {
      hours.push(differenceInHours(deploy.occurredAt, pr.firstCommitAt));
    }
  }
  return { value: median(hours), unit: "hours", sampleSize: hours.length };
}

export function changeFailureRate(
  deployEvents: DeployEvent[],
  incidents: IncidentFact[],
  window: WeekWindow
): MetricResult {
  const successful = deployEvents.filter(
    (d) => d.success && inWindow(d.occurredAt, window)
  );
  if (successful.length === 0) {
    return { value: null, unit: "percent", sampleSize: 0 };
  }
  const windowMs = INCIDENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const failed = successful.filter((deploy) =>
    incidents.some(
      (incident) =>
        incident.openedAt.getTime() >= deploy.occurredAt.getTime() &&
        incident.openedAt.getTime() <= deploy.occurredAt.getTime() + windowMs
    )
  ).length;
  return {
    value: (failed / successful.length) * 100,
    unit: "percent",
    sampleSize: successful.length,
  };
}

export function mttr(
  incidents: IncidentFact[],
  window: WeekWindow
): MetricResult {
  const resolved = incidents.filter(
    (i) => i.resolvedAt && inWindow(i.openedAt, window)
  );
  const hours = resolved.map((i) =>
    differenceInHours(i.resolvedAt as Date, i.openedAt)
  );
  return { value: mean(hours), unit: "hours", sampleSize: hours.length };
}

export function prReviewTurnaround(
  pullRequests: PullRequestFact[],
  reviews: ReviewFact[],
  window: WeekWindow
): MetricResult {
  const firstReviewByPr = new Map<number, Date>();
  for (const review of reviews) {
    const existing = firstReviewByPr.get(review.pullRequestNumber);
    if (!existing || review.submittedAt < existing) {
      firstReviewByPr.set(review.pullRequestNumber, review.submittedAt);
    }
  }
  const hours: number[] = [];
  for (const pr of pullRequests) {
    if (!inWindow(pr.createdAt, window)) continue;
    const firstReview = firstReviewByPr.get(pr.number);
    if (firstReview) hours.push(differenceInHours(firstReview, pr.createdAt));
  }
  return { value: median(hours), unit: "hours", sampleSize: hours.length };
}

/** Last `n` ISO (Mon-Sun) weeks, most recent last. UTC throughout — matches derive.py's
 * last_n_iso_weeks (datetime.now(timezone.utc)); week boundaries must not depend on the
 * server's local timezone. */
export function lastNIsoWeeks(n: number, from: Date = new Date()): WeekWindow[] {
  const weeks: WeekWindow[] = [];
  const day = from.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const thisMonday = new Date(from);
  thisMonday.setUTCHours(0, 0, 0, 0);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - diffToMonday);
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(thisMonday);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    weeks.push({ start, end });
  }
  return weeks;
}

/** The key abstraction: downstream metric code never cares which proxy is active. Three
 * tiers, most-to-least authoritative:
 * 1. Real CI/CD (hasActions=true): a successful Actions run on the default branch IS a deploy.
 * 2. PR-merge proxy: no Actions workflows, but PRs get merged to the default branch — each
 *    merge stands in for a "deploy".
 * 3. Raw-commit proxy: no Actions AND zero merged PRs ever — each commit on the default
 *    branch stands in for a "deploy". Least authoritative tier, disclosed via `source`. */
export function deriveDeployEvents(
  pullRequests: PullRequestFact[],
  workflowRuns: WorkflowRunFact[],
  hasActions: boolean,
  defaultBranch: string,
  commits: CommitFact[] = []
): DeployEvent[] {
  if (hasActions) {
    return workflowRuns
      .filter((run) => run.conclusion !== null)
      .map((run) => ({
        occurredAt: run.runCompletedAt ?? run.runStartedAt,
        success: run.conclusion === "success",
        pullRequestNumber: null,
        source: "workflow_run" as const,
      }));
  }

  const mergedPrs = pullRequests
    .filter((pr) => pr.state === "MERGED" && pr.mergedAt && pr.baseRefName === defaultBranch)
    .map((pr) => ({
      occurredAt: pr.mergedAt as Date,
      success: true,
      pullRequestNumber: pr.number,
      source: "merge_to_default" as const,
    }));
  if (mergedPrs.length > 0) return mergedPrs;

  return commits.map((c) => ({
    occurredAt: c.authoredAt,
    success: true,
    source: "commit" as const,
  }));
}

/** Revert commits self-resolve at the moment of the revert (0h by definition, opened ==
 * resolved) — only labeled-issue incidents have a real open->close duration. */
export function deriveIncidents(issues: IssueFact[], commits: CommitFact[]): IncidentFact[] {
  const revertCommits = commits.filter((c) => REVERT_COMMIT_PATTERN.test(c.message));
  return [
    ...issues.map((issue) => ({ openedAt: issue.createdAt, resolvedAt: issue.closedAt })),
    ...revertCommits.map((c) => ({ openedAt: c.authoredAt, resolvedAt: c.authoredAt })),
  ];
}
