import { compareProposals, type Proposal, type Selection } from "./types.js";

function proposalName(proposal: Proposal): string {
  return proposal.action.type === "trade"
    ? proposal.buildingName
    : `${proposal.buildingName} ${proposal.targetLevel}`;
}

/** Keep each village's budget for its highest-priority needed action, including production. */
export function selectProposal<P extends Proposal>(proposals: P[]): Selection<P["action"]> {
  const ranked = [...proposals].sort(compareProposals);
  const reservations: Selection["reservations"] = [],
    candidates: P[] = [];
  for (const villageId of new Set(ranked.map((p) => p.villageId))) {
    const top = ranked.find(
      (p) =>
        p.villageId === villageId &&
        p.status !== "queued" &&
        p.status !== "not-needed" &&
        !p.blockers.some(b => ["BUILD_QUEUE_BUSY", "TRAIN_QUEUE_BUSY", "EXECUTOR_QUEUE_BUSY"].includes(b)),
    );
    if (!top) continue;
    if (top.status === "ready") candidates.push(top);
    else if (
      top.blockers.length &&
      top.blockers.every((b) => b === "INSUFFICIENT_RESOURCES")
    )
      reservations.push({
        villageId,
        proposalId: top.id,
        reason: `Save for ${proposalName(top)} in ${top.villageName} (score ${top.importance}). Keep the budget for this needed action instead of spending on a lower priority.`,
      });
  }
  const selected = candidates.sort(compareProposals)[0] ?? null;
  const blocked = ranked.find((p) => p.status === "waiting");
  return {
    selected,
    reservations,
    reason: selected
      ? `${proposalName(selected)} in ${selected.villageName} is the highest-priority needed action and is affordable now (score ${selected.importance}).`
      : reservations.length
        ? reservations.map((r) => r.reason).join(" ")
        : blocked
          ? `Wait for ${blocked.buildingName}: ${blocked.blockers.map((b) => b.toLowerCase().replaceAll("_", " ")).join(", ")}.`
          : ranked.some((p) => p.status === "queued")
            ? "Construction is in progress; reassess when it finishes."
            : "No action is currently needed; retain resources.",
  };
}
