import {completionWindow} from './completion.js';
import {defenseBudget, militaryEconomy, RECRUIT_USE_TICKS} from './defense-budget.js';
import {selectProposal} from './president.js';
import type {AdvisorContext, Proposal} from './types.js';

/** Offer capacity before a selected long build consumes the remaining troop runway.
 * The President still allocates resources and the executor revalidates every write. */
export function prioritizeFarmRunway({state}: AdvisorContext, proposals: Proposal[]): void {
 for(const v of state.villages){
  if(!militaryEconomy(v).running||v.buildQueue.length||v.orders.build.length||v.orders.train.length)continue;
  const villageProposals=proposals.filter(p=>p.villageId===v.id);
  const selected=selectProposal(villageProposals).selected;
  if(selected?.action.type!=='build'||selected.action.building==='farm')continue;
  const otherBuilding=selected.action.building;
  const farm=villageProposals.find(p=>p.action.type==='build'&&p.action.building==='farm');
  if(!farm||farm.status!=='not-needed'||farm.blockers.some(b=>!['NOT_NEEDED','INSUFFICIENT_RESOURCES'].includes(b)))continue;
  const farmOption=v.options.build.find(o=>o.building==='farm');
  const otherOption=v.options.build.find(o=>o.building===otherBuilding);
  if(!farmOption||!otherOption)continue;
  const farmWindow=completionWindow(state,v,farmOption),otherWindow=completionWindow(state,v,otherOption);
  const budget=defenseBudget(v)!;
  const bundles=Math.ceil(61/budget.ticks),batchTicks=budget.ticks*bundles;
  const queueEnd=Math.max(state.world.tick,...v.training.barracks.map(q=>q.endTick));
  const interval=state.world.actIntervalTicks??0;
  // Retain the complete-batch/use deadline, independently of this earlier trigger.
  if(!farmWindow||!otherWindow||Math.max(farmWindow.completionTick+interval,queueEnd)+batchTicks+RECRUIT_USE_TICKS>state.world.endsAtTick)continue;
  const capacityAfterOther=otherWindow.completionTick+interval+farmOption.ticks+interval;
  const batchesBeforeCapacity=Math.max(0,Math.ceil((capacityAfterOther-queueEnd)/batchTicks));
  const required=Math.max(50,Math.ceil(v.population.max*.2))+batchesBeforeCapacity*budget.pop*bundles;
  // The proposed alternative also reserves population when accepted.
  const freeAfterOther=v.population.max-v.population.used-otherOption.pop;
  if(freeAfterOther>=required)continue;
  farm.blockers=farm.blockers.filter(b=>b!=='NOT_NEEDED');
  farm.status=farm.blockers.length?'waiting':'ready';farm.importance=95;
  farm.reason+=` Recruitment runway: ${selected.buildingName} then Farm would delay new capacity until tick ${capacityAfterOther}; ${batchesBeforeCapacity} future Pikeman batches need ${required} free slots including the buffer, versus ${freeAfterOther} after that build. Offer Farm first; existing paid troops already count in population used.`;
 }
}
