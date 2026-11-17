import type { Proposal } from "../../advisors/types.js";
import type { Pending } from "../../control/types.js";

export interface JournalIdentity {
  accountId: string;
  worldId: string;
  epoch: string;
  serverUrl: string;
  createdTick: number;
  expiresTick: number;
}

export function prepareJournalEntry(
  proposal: Proposal,
  identity: JournalIdentity,
  clientId: string,
): Pending {
  return {
    proposal,
    action: { ...proposal.action, clientId } as Pending["action"],
    ...identity,
    phase: "prepared",
  };
}

export function transitionJournalEntry(entry: Pending, phase: Pending["phase"], itemId?: string): Pending {
  return { ...entry, phase, ...(itemId ? { itemId } : {}) };
}
