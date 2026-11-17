import type { AdvisorContext, CityRoles, Proposal } from "../../advisors/types.js";
import type { CityRole } from "../plan/graph.js";
import type { TaskKey } from "../plan/graph.js";
import type { MissionInstance } from "./missions/conquest.js";

export function cityRoles(
  context: AdvisorContext,
  missions: readonly MissionInstance[],
): Map<string, { role: CityRole; reason: string }> {
  const owned = new Set(context.state.villages.map(village => village.id));
  const origin = missions
    .filter(mission => owned.has(mission.villageId))
    .sort((a, b) => a.startedTick - b.startedTick)[0];
  const capital = origin?.villageId ?? context.state.villages[0]?.id;
  const captured = new Map(
    missions
      .filter(mission => mission.targetId && mission.status === "completed")
      .map(mission => [mission.targetId!, mission.memory.capturedTick]),
  );
  return new Map(context.state.villages.map(village => [village.id, village.id === capital
    ? { role: "capital", reason: origin ? `Origin of the first conquest (started tick ${origin.startedTick}).` : "No conquest origin owned; first listed city." }
    : { role: "economic", reason: captured.has(village.id) ? `Captured${captured.get(village.id) === undefined ? "" : ` at tick ${captured.get(village.id)}`}; every non-capital city is economic.` : "Every non-capital city is economic." }]));
}

export function filterProposalsByRole(
  proposals: readonly Proposal[],
  roles: CityRoles,
  effectiveRoles: (task: TaskKey) => readonly CityRole[] | undefined,
): Proposal[] {
  return proposals.filter(proposal => {
    const allowed = effectiveRoles(proposal.task);
    if (!allowed) return true;
    const role = roles.get(proposal.villageId)?.role;
    return role !== undefined && allowed.includes(role);
  });
}
