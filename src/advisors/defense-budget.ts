import type { Resources, VillageState } from "../shared/api.js";
export const RECRUIT_USE_TICKS = 60;
export const PRODUCER_CEILING = 20;
export const EARLY_GATE = { lumberyard: 14, quarry: 14, mine: 12 } as const;
export const EARLY_PIKEMEN_TARGET = 200;
/** Raiders the capital keeps trained for conquest. */
export const RAIDER_TARGET = 150;
/** Fewest home Raiders that may escort an Envoy; a wave takes every Raider at home. */
export const RAIDER_SEND_MIN = 100;
export const EARLY_WALL = 5;
export const EARLY_HALL = 10;
export const BARRACKS_CAP = 5;
export const RAIDER_MIN_BARRACKS = 5;
export const CONQUEST_PRODUCER_FLOOR = 15;
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
export function militaryUnlocked(v:VillageState) {
 return v.buildings.lumberyard>=EARLY_GATE.lumberyard&&v.buildings.quarry>=EARLY_GATE.quarry&&v.buildings.mine>=EARLY_GATE.mine;
}
export function earlyGoalMet(v:VillageState) {
 return producerLevel(v)>=CONQUEST_PRODUCER_FLOOR&&(v.units.home.pikeman??0)>=EARLY_PIKEMEN_TARGET;
}
export function hallRushActive(v:VillageState) {
 return v.buildings.barracks>=1&&v.buildings.wall>=EARLY_WALL&&v.buildings.hall<EARLY_HALL;
}
export function defenseReady(v:VillageState) { return militaryUnlocked(v) && v.buildings.barracks>=1; }
export function defenseSustainable(v:VillageState) {
 const b=defenseBudget(v);
 return !!b && (["timber","stone","iron"] as const).every(r=>v.productionPerTickMilli[r]/1000*(1-CONSTRUCTION_INCOME_SHARE)>=b.perTick[r]);
}
export function militaryEconomy(v:VillageState) {
 const b=defenseBudget(v),running=defenseReady(v)&&defenseSustainable(v);
 const targetPerTick=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,b?.perTick[r]??0])) as Resources;
 const burn=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,running?targetPerTick[r]:0])) as Resources;
 const availableMilli=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,Math.max(0,v.productionPerTickMilli[r]-burn[r]*1000)])) as Resources;
 const stage=producerLevel(v)<5?"Opening: producers to 5":producerLevel(v)<8?"Capacity as needed; producers to 8":v.buildings.hall<5?"Construction speed: Great Hall to 5":producerLevel(v)<10?"Producers to 10":!militaryUnlocked(v)?"Early gate: Lumberyard 14, Quarry 14, Mine 12":v.buildings.barracks<1?"Build Barracks 1":!running?"Grow income to sustain Pikemen + construction":v.buildings.wall<EARLY_WALL?"Early opening: Wall 5":v.buildings.hall<EARLY_HALL?"Early opening: Hall 10":v.buildings.barracks<BARRACKS_CAP?"Early opening: Barracks 5":!earlyGoalMet(v)?`Early goal: producers 15 plus ${EARLY_PIKEMEN_TARGET} home Pikemen`:"Continuous Pikemen + construction";
 return {budget:b,running,burn,targetPerTick,availableMilli,stage};
}
