import type { Proposal, Selection } from "./types.js";

/** One new build globally per cycle, never borrowing resources between villages. */
export function selectProposal(proposals: Proposal[]): Selection {
  const ranked = [...proposals].sort(
    (a, b) =>
      b.importance - a.importance ||
      a.villageId.localeCompare(b.villageId) ||
      a.action.building.localeCompare(b.action.building),
  );
  const reservations: Selection["reservations"] = [];
  const candidates: Proposal[] = [];
  for (const villageId of new Set(ranked.map((p) => p.villageId))) {
    const local = ranked.filter((p) => p.villageId === villageId && p.status !== "queued");
    const top = local[0];
    if (!top) continue;
    const save = local.find(
      (p) =>
        p.importance >= 70 &&
        p.status === "waiting" &&
        p.blockers.length > 0 &&
        p.blockers.every((b) => b === "INSUFFICIENT_RESOURCES"),
    );
    if (save && !local.some((p) => p.status === "ready" && p.importance >= save.importance)) {
      reservations.push({
        villageId,
        proposalId: save.id,
        reason: `Save for ${save.buildingName} ${save.targetLevel} (score ${save.importance}); do not spend this village's resources on lower priorities.`,
      });
      continue;
    }
    const ready = local.find((p) => p.status === "ready");
    if (ready) candidates.push(ready);
  }
  const selected = candidates.sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))[0] ?? null;
  return {
    selected,
    reservations,
    reason: selected
      ? `${selected.buildingName} in ${selected.villageName} is the highest-ranked affordable, unblocked proposal (score ${selected.importance}). Ties use village ID then building name.`
      : reservations.length
        ? reservations.map((r) => r.reason).join(" ")
        : ranked.length
          ? `Wait: ${ranked.find((p) => p.status !== "queued")?.buildingName ?? ranked[0].buildingName} is highest priority, but ${(ranked.find((p) => p.status !== "queued") ?? ranked[0]).blockers.map((b) => b.toLowerCase().replaceAll("_", " ")).join(", ") || "existing construction"} prevents a new action.`
          : "No economic upgrades are currently proposed.",
  };
}
