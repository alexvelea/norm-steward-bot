/** Public authoritative combat probes; complements the private policy/executor experiment.
 * This does not simulate a game locally or submit gameplay actions.
 */
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import type {Resources, RulesResponse, UnitCounts, UnitId, SimulateBattleResponse} from "../src/shared/api.js";
const origin="https://norn-steward.velea.cc/api/v1/worlds/blitz-1";
async function request(path:string,body?:unknown) {
  for(let attempt=0;attempt<6;attempt++) {
    const response=await fetch(origin+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
    if(response.status===429) {
      const delay=Number(response.headers.get("Retry-After")??1);assert.ok(Number.isFinite(delay)&&delay<=60);
      await new Promise(r=>setTimeout(r,Math.max(1,delay)*1000));continue;
    }
    assert.equal(response.status,200);return response.json();
  }
  throw new Error("Public simulator rate limit persisted");
}
const rules=await request("/rules") as RulesResponse;
const units=rules.rules.UNITS as Record<UnitId,{cost:Resources;pop:number}>;
const spend=(counts:UnitCounts):Resources=>Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,Object.entries(counts).reduce((sum,[id,n])=>sum+n!*units[id as UnitId].cost[r],0)])) as Resources;
const total=(r:Resources)=>r.timber+r.stone+r.iron;
const candidate={pikeman:10,shieldman:5};
const budgetPikes=Math.floor(total(spend(candidate))/total(units.pikeman.cost));
const compositions:Record<string,UnitCounts>={baseline:{pikeman:10},candidate,equalAggregateBudgetPikes:{pikeman:budgetPikes},replacementMix:{pikeman:5,shieldman:5}};
const attacks={infantry:{raider:10},cavalry:{lancer:4},ranged:{archer:10}};
const cases:unknown[]=[];
for(const [composition,defender] of Object.entries(compositions))for(const [kind,attacker] of Object.entries(attacks)) {
  const input={attacker,defender};const battle=await request("/simulate/battle",input) as SimulateBattleResponse;
  cases.push({composition,kind,input,cost:spend(defender),population:Object.entries(defender).reduce((sum,[id,n])=>sum+n!*units[id as UnitId].pop,0),battle,
    defenderLossCost:spend(battle.defenderLost),attackerLossCost:spend(battle.attackerLost)});
}
await writeFile(process.env.STEWARD_REVIEW_RUN!+"/composition-matrix.json",JSON.stringify({taskId:"defensive-composition",mode:"authoritative-server-simulation",rulesVersion:rules.version,
  note:"Aggregate budget comparison sums three resources; it does not assume those resources are interchangeable or that prerequisites are free. Physical battles are recorded separately in composition-comparison.json.",unitCosts:units,cases},null,2));
console.log(JSON.stringify({cases:cases.length,budgetPikes}));
