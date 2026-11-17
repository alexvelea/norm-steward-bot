import type { Resources, VillageState } from "../shared/api.js";
export const RECRUIT_USE_TICKS = 60;
export const PRODUCER_CEILING = 20;
/** Per-tick cost of one Pikeman at this village's live Barracks speed. */
export function defenseBudget(v: VillageState) {
  const p = v.options.train.find(o => o.unit === "pikeman");
  if (!p || ![p.ticksEach,p.pop].every(n => Number.isSafeInteger(n) && n > 0)) return null;
  const ticks = p.ticksEach;
  const cost = { ...p.cost };
  if (Object.values(cost).some(n => !Number.isFinite(n) || n < 0)) return null;
  const perTick = Object.fromEntries((["timber","stone","iron"] as const).map(r => [r,cost[r]/ticks])) as Resources;
  return { ticks, cost, perTick, pop:p.pop };
}

export const CONSTRUCTION_INCOME_SHARE = 0.2;
export const producerLevel = (v:VillageState) => Math.min(v.buildings.lumberyard,v.buildings.quarry,v.buildings.mine);
export function defenseReady(v:VillageState) { return producerLevel(v)>=10 && v.buildings.barracks>=3 && v.buildings.smithy>=1; }
export function defenseSustainable(v:VillageState) {
 const b=defenseBudget(v);
 return !!b && (["timber","stone","iron"] as const).every(r=>v.productionPerTickMilli[r]/1000*(1-CONSTRUCTION_INCOME_SHARE)>=b.perTick[r]);
}
export function militaryEconomy(v:VillageState) {
 const b=defenseBudget(v),running=defenseReady(v)&&defenseSustainable(v);
 const targetPerTick=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,b?.perTick[r]??0])) as Resources;
 const burn=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,running?targetPerTick[r]:0])) as Resources;
 const availableMilli=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,Math.max(0,v.productionPerTickMilli[r]-burn[r]*1000)])) as Resources;
 const stage=producerLevel(v)<5?"Opening: producers to 5":producerLevel(v)<8?"Capacity as needed; producers to 8":v.buildings.hall<5?"Construction speed: Great Hall to 5":producerLevel(v)<10?"Producers to 10":!defenseReady(v)?"Unlock Barracks 3 and Smithy 1":!running?"Grow income to sustain Pikemen + construction":"Continuous Pikemen + construction";
 return {budget:b,running,burn,targetPerTick,availableMilli,stage};
}
