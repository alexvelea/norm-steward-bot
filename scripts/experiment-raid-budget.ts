/** Authoritative hypothetical sizing from a retained real outpost observation, not fresh raid intel. */
import { readFile, writeFile } from 'node:fs/promises';
import { PrivateSandbox } from '../src/review/sandbox-client.js';
import { privateRead } from './experiment-raids.js';
import type { SimulateBattleResponse } from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!;
const source=JSON.parse(await readFile(run+'/raid-outpost-plan.json','utf8'));
const s=new PrivateSandbox(73421,10800);
const row:Record<string,any>={taskId:'risk-gated-raid-execution',worldId:s.world.id,source:run+'/raid-outpost-plan-observation.json',scouting:source.scouting,plans:[],limitation:'Explicit historical defender scenario for sizing only. Does not authorize a raid or assert current enemy strength.'};
try {
 s.join();
 const intel=source.scouting.detail.intel;
 const defender={...intel.unitsHome};
 for(const [unit,count] of Object.entries(intel.supportTotal)) defender[unit]=(defender[unit]??0)+(count as number);
 const units={raider:40,ram:8,trebuchet:20,scout:4};
 const battle=privateRead<SimulateBattleResponse>(s,'/simulate/battle',{attacker:units,defender,wall:intel.buildings.wall,aim:'barracks',aimLevel:intel.buildings.barracks,resources:intel.resources,hidden:0});
 row.plans.push({units,battle});
 console.log(JSON.stringify({units,battle}));
} finally {s.close();row.deleted=true;await writeFile(run+'/raid-outpost-plan.json',JSON.stringify(row,null,2));}
