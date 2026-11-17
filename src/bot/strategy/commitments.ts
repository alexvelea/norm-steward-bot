import type { Proposal } from "../../advisors/types.js";
import type { Pending } from "../../control/types.js";

export interface StrategicCommitment {
  id: string;
  scope: string;
  villageId: string;
  kind: "defenceCohort";
  targets: { pikemen: number; shieldmen: number };
  baselines: { pikemen: number; shieldmen: number };
  ownerTask: "defense.cohort";
  createdTick: number;
  proposal: Proposal;
  serverUrl: string;
  worldId: string;
  epoch: string;
  accountId: string;
}

export function commitmentFromPending(
  pending: Pending,
  scope: string,
): StrategicCommitment | null {
  const batch = pending.proposal.defenseBatch;
  if (pending.action.type !== "train" || pending.action.unit !== "pikeman" || !batch) return null;
  return {
    id: `${scope}:defenseCohort:${pending.proposal.id}`,
    scope,
    villageId: pending.proposal.villageId,
    kind: "defenceCohort",
    targets: { pikemen: batch.pikemen, shieldmen: batch.shieldmen },
    baselines: { pikemen: batch.baselinePikemen, shieldmen: batch.baselineShieldmen },
    ownerTask: "defense.cohort",
    createdTick: pending.createdTick,
    proposal: structuredClone(pending.proposal),
    serverUrl: pending.serverUrl,
    worldId: pending.worldId,
    epoch: pending.epoch,
    accountId: pending.accountId,
  };
}

export function reconcileCommitments(
  commitments: readonly StrategicCommitment[],
  villages: readonly { id: string; units: { home: Record<string, number | undefined>; away: Record<string, number | undefined> }; training: { barracks: { unit: string; remaining: number }[] } }[],
  scope: { value: string; serverUrl: string; worldId: string; epoch: string; accountId: string; ended: boolean },
): StrategicCommitment[] {
  return commitments.filter(commitment => {
    const village = villages.find(value => value.id === commitment.villageId);
    if (!village || scope.ended || commitment.scope !== scope.value || commitment.serverUrl !== scope.serverUrl ||
      commitment.worldId !== scope.worldId || commitment.epoch !== scope.epoch || commitment.accountId !== scope.accountId) return false;
    const ownedPikemen = (village.units.home.pikeman ?? 0) + (village.units.away.pikeman ?? 0);
    if (ownedPikemen < commitment.baselines.pikemen + commitment.targets.pikemen) return false;
    const ownedShieldmen = (village.units.home.shieldman ?? 0) + (village.units.away.shieldman ?? 0);
    const queuedShieldmen = village.training.barracks.filter(item => item.unit === "shieldman").reduce((sum, item) => sum + item.remaining, 0);
    return ownedShieldmen + queuedShieldmen < commitment.baselines.shieldmen + commitment.targets.shieldmen;
  });
}
