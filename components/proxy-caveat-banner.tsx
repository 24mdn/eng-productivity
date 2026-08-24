import { TriangleAlert } from "lucide-react";
import type { SquadMeta } from "@/lib/metrics-repository";

type ProxyTier = Exclude<SquadMeta["deployProxy"], "workflow_run" | null>;

const TIER_COPY: Record<ProxyTier, string> = {
  merge_to_default: "approximated from pull requests merged to the default branch",
  commit:
    "approximated from commits pushed directly to the default branch — this repo doesn't use pull requests",
};

const MIXED_TIER_COPY =
  "approximated from each squad's default-branch activity — some squads merge pull requests, others push commits directly, depending on the repo";

/** Renders nothing when every squad in scope has real CI/CD (has_actions). Otherwise picks
 * copy from the non-CI/CD squads' deploy_proxy tier — falls back to mixed-tier copy once
 * scope spans squads on different tiers (e.g. exec's cross-squad view), since claiming one
 * squad's tier applies to all of them would misstate what the other squads' numbers mean. */
export function ProxyCaveatBanner({ squads }: { squads: SquadMeta[] }) {
  const proxied = squads.filter((s) => s.hasActions === false);
  if (proxied.length === 0) return null;

  const tiers = new Set(
    proxied
      .map((s) => s.deployProxy)
      .filter((t): t is ProxyTier => t !== null && t !== "workflow_run")
  );
  const uniformTier = tiers.size === 1 ? [...tiers][0] : null;
  const copy = uniformTier ? TIER_COPY[uniformTier] : MIXED_TIER_COPY;
  const scopeWord = squads.length > 1 ? (proxied.length > 1 ? "some squads" : "this squad") : "this squad";

  return (
    <div
      className="flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm"
      style={{
        borderColor: "rgb(255 255 255 / 0.8)",
        background: "linear-gradient(135deg, var(--status-warn-bg), rgb(255 255 255 / 0.78))",
        color: "var(--foreground)",
      }}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--status-warn-bg)", color: "var(--status-warn)" }}>
        <TriangleAlert className="size-4" />
      </span>
      <p>
        <strong>{scopeWord === "this squad" ? "Deployment proxy" : "Deployment proxies"}:</strong>{" "}
        {copy}.
      </p>
    </div>
  );
}
