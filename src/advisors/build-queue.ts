import type {StateResponse,VillageState,Resources} from '../shared/api.js';
import type {AdvisorContext} from './types.js';

/** One paid running item, with no already-waiting successor. Threshold is real seconds. */
export function earlyBuildWindow(state:StateResponse,v:VillageState){
 if(state.world.status!=='running'||v.buildQueue.length!==1||v.orders.build.length)return null;
 const q=v.buildQueue[0],speed=state.world.speed;
 if(!Number.isFinite(speed)||speed<=0||!Number.isSafeInteger(q.startTick)||q.startTick!>state.world.tick||!Number.isSafeInteger(q.endTick))return null;
 const ticks=q.endTick-state.world.tick;
 return ticks>0&&ticks/speed<10?{ticks,seconds:ticks/speed}:null;
}
/** Build-only forecast; money, population and server blockers remain those payable now.
 * Live option levels already include queued work. Today's Hall duration plus the wait is
 * conservative when the paid item is a Hall. Never use this forecast to unlock training/sends.
 */
export function constructionContext(context:AdvisorContext):AdvisorContext{
 return {...context,state:{...context.state,villages:context.state.villages.map(v=>{
  const window=earlyBuildWindow(context.state,v);if(!window)return v;
  const q=v.buildQueue[0],buildings={...v.buildings,[q.building]:q.level};
  const rates={...v.productionPerTickMilli};
  const resource=({lumberyard:'timber',quarry:'stone',mine:'iron'} as Partial<Record<string,keyof Resources>>)[q.building];
  if(resource){
   const before=context.rules.tables.production.find(p=>p.level===v.buildings[q.building]);
   const after=context.rules.tables.production.find(p=>p.level===q.level);
   if(before&&after&&before.perTickMilli>0)rates[resource]=Math.round(rates[resource]*after.perTickMilli/before.perTickMilli);
  }
  return {...v,buildings,productionPerTickMilli:rates,production:{timber:rates.timber*.06,stone:rates.stone*.06,iron:rates.iron*.06},buildQueue:[],options:{...v.options,build:v.options.build.map(o=>({...o,ticks:o.ticks+window.ticks}))}};
 })}};
}
