import { selectProposal } from "../../advisors/president.js";
import type { Proposal, Selection } from "../../advisors/types.js";
import type { PlanningReservation } from "../diagnostics/planning.js";
import { PLAN, type TaskKey } from "../plan/graph.js";

export interface AllocationDecision {
  selection: Selection;
  reasonCodes: string[];
  reservations: PlanningReservation[];
  excluded: { candidateId: string; reasonCode: string }[];
}

export function allocateWithPresident(
  proposals: Proposal[],
  options: { activeConquest?: { id: string; villageId: string; allowedTasks: TaskKey[] }; pending?: Proposal | null } = {},
): AllocationDecision {
  const reservations: PlanningReservation[] = [];
  const excluded: AllocationDecision["excluded"] = [];
  let eligible = proposals;
  if (options.activeConquest) {
    eligible = eligible.filter(proposal => {
      if(proposal.villageId!==options.activeConquest!.villageId||options.activeConquest!.allowedTasks.includes(proposal.task))return true;
      excluded.push({candidateId:proposal.id,reasonCode:"CONQUEST_EXCLUSIVE_SPENDING"});
      return false;
    });
    reservations.push({
      kind: "exclusiveSpending",
      id: `conquest:${options.activeConquest.id}`,
      ownerId: options.activeConquest.id,
      villageId: options.activeConquest.villageId,
      excludes: PLAN.nodes.filter(node=>node.kind==="task"&&!options.activeConquest!.allowedTasks.includes(node.key)).map(node=>node.key as TaskKey),
      reasonCode: "CONQUEST_EXCLUSIVE_SPENDING",
    });
  }
  if (options.pending) eligible = eligible.filter(proposal => {
    if(proposal.id===options.pending!.id)return true;
    excluded.push({candidateId:proposal.id,reasonCode:"PENDING_OPERATION_ONLY"});
    return false;
  });
  const selection = selectProposal(eligible);
  reservations.push(...selection.reservations.map(value => ({
    kind: "fundingGoal" as const,
    id: value.proposalId,
    ownerId: value.proposalId,
    villageId: value.villageId,
    goal: value.proposalId,
    reasonCode: "PRESIDENT_SAVING",
  })));
  const reasonCodes = selection.selected ? ["PRESIDENT_SELECTED"] :
      selection.reservations.length ? ["PRESIDENT_SAVING"] :
      eligible.some(proposal => proposal.status === "waiting") ? ["PRESIDENT_WAITING"] :
      eligible.length===0&&excluded.length ? [excluded[0].reasonCode] : ["NO_ACTION_NEEDED"];
  for(const proposal of eligible){
    if(proposal.status!=="ready"||proposal.id===selection.selected?.id)continue;
    excluded.push({candidateId:proposal.id,reasonCode:selection.reservations.length?"PRESIDENT_SAVING":"PRESIDENT_SELECTED_OTHER"});
  }
  return { selection, reasonCodes, reservations, excluded };
}
