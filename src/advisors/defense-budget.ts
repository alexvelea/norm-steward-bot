import type { Resources, VillageState } from "../shared/api.js";
export const RECRUIT_USE_TICKS = 60;
export const PRODUCER_CEILING = 20;
/** Average cost of the requested 3Pi1Sh mix at this village's live Barracks speed. */
export function defenseBudget(v: VillageState) {
  const p = v.options.train.find(o => o.unit === "pikeman"), s = v.options.train.find(o => o.unit === "shieldman");
  if (!p || !s || ![p.ticksEach,s.ticksEach,p.pop,s.pop].every(n => Number.isSafeInteger(n) && n > 0)) return null;
  const ticks = 3 * p.ticksEach + s.ticksEach;
  const cost = Object.fromEntries((["timber","stone","iron"] as const).map(r => [r, 3*p.cost[r]+s.cost[r]])) as Resources;
  if (Object.values(cost).some(n => !Number.isFinite(n) || n < 0)) return null;
  const perTick = Object.fromEntries((["timber","stone","iron"] as const).map(r => [r,cost[r]/ticks])) as Resources;
  return { ticks, cost, perTick, pop:3*p.pop+s.pop };
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
 const lancer=v.options.train.find(o=>o.unit==="lancer");
 const cavalryRemaining=(v.units.home.lancer??0)+(v.units.away.lancer??0)+v.training.stable.filter(q=>q.unit==="lancer").reduce((n,q)=>n+q.remaining,0)<30;
 const cavalry=running&&v.buildings.stable>=3&&v.buildings.smithy>=3&&cavalryRemaining&&lancer&&lancer.ticksEach>0&&(["timber","stone","iron"] as const).every(r=>v.productionPerTickMilli[r]/1000*.8>=b!.perTick[r]+lancer.cost[r]/lancer.ticksEach);
 const targetPerTick=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,(b?.perTick[r]??0)+(cavalry?lancer!.cost[r]/lancer!.ticksEach:0)])) as Resources;
 const burn=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,running?targetPerTick[r]:0])) as Resources;
 const availableMilli=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,Math.max(0,v.productionPerTickMilli[r]-burn[r]*1000)])) as Resources;
 const stage=producerLevel(v)<5?"Opening: producers to 5":producerLevel(v)<8?"Capacity as needed; producers to 8":v.buildings.hall<5?"Construction speed: Great Hall to 5":producerLevel(v)<10?"Producers to 10":!defenseReady(v)?"Unlock Barracks 3 and Smithy 1":!running?"Grow income to sustain 3Pi1Sh + construction":"Continuous 3Pi1Sh + construction";
 return {budget:b,running,burn,targetPerTick,availableMilli,stage};
}
