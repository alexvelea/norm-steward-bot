/** Bounded composition comparison: private recruitment/executor and real combat fixtures.
 * The owner provides no credentials: PrivateSandbox handles every private operation.
 */
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {PrivateSandbox, sandbox} from "../src/review/sandbox-client.js";
import {evaluateEconomy} from "../src/advisors/economic.js";
import {evaluateMilitary} from "../src/advisors/military.js";
import {evaluateRecruitment} from "./legacy-advisors/recruitment.js";
import {selectProposal} from "../src/advisors/president.js";
import {Controller} from "../src/control/controller.js";
import type {Remote} from "../src/control/remote.js";
import type {SavedControl, Settings} from "../src/control/types.js";
import type {Action, ActionsResponse, RulesResponse, StateResponse, ReportsResponse, SimulateBattleResponse} from "../src/shared/api.js";
const output=process.env.STEWARD_REVIEW_RUN!+"/composition-comparison.json";
const results:Record<string,any>[]=[];
const planning=(s:StateResponse):StateResponse=>({...s,world:{...s.world,status:"running"}});
function decide(s:StateResponse,rules:RulesResponse,policy:string) {
  const context={state:planning(s),rules};
  // Filtering the new Shieldman proposal retains the unchanged deployed Pikeman policy.
  return selectProposal([...evaluateEconomy(context),...evaluateMilitary(context),
    ...evaluateRecruitment(context).filter(p=>policy==="candidate" || p.action.unit==="pikeman")]);
}
async function save(passed:boolean,error?:string) {
  await writeFile(output,JSON.stringify({taskId:"defensive-composition",baseline:"ten-pikemen",candidate:"ten-pikemen-plus-five-already-unlocked-shieldmen",passed,error,results},null,2));
}
try {
  for (const policy of ["baseline","candidate"]) {
    const s=new PrivateSandbox(73421,10800,{warden:1,reaver:0,sovereign:0});
    try {
      let state=s.join();const rules=s.rules();const warmup:unknown[]=[];
      function act(action:Action) {
        const response=s.act([action]);assert.equal(response.results[0].ok,true,JSON.stringify(response.results));
        state=response.state ?? s.state();return response;
      }
      function stepTo(tick:number) {if(tick>state.world.tick)state=s.step(tick-state.world.tick);}
      function complete() {stepTo(Math.max(state.world.tick,state.player.nextActTick??0,...state.villages[0].buildQueue.map(q=>q.endTick),...Object.values(state.villages[0].training).flat().map(q=>q.endTick)));}
      function build(building:Extract<Action,{type:"build"}>["building"]) {
        const o=state.villages[0].options.build.find(o=>o.building===building)!;
        stepTo(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));
        warmup.push(act({type:"build",village:state.villages[0].id,building}).results);complete();
      }
      for(const b of ["hall","hall","barracks","hall","hall","smithy","cellar","cellar","cellar"] as const)build(b);
      const pike=state.villages[0].options.train.find(o=>o.unit==="pikeman")!;
      if(pike.maxCount<10)stepTo(state.world.tick+300);
      act({type:"train",village:state.villages[0].id,unit:"pikeman",count:10});complete();
      // A common funding point avoids changing the clock based on either policy's choice.
      stepTo(800);
      for(let i=0;i<10;i++) {
        const selected=decide(state,rules,"candidate").selected;
        if(selected?.action.type==="train")break;
        assert.ok(selected && selected.action.type==="build","Expected common capacity/protection warmup");
        warmup.push(act(selected.action).results);complete();
      }
      assert.equal(decide(state,rules,"candidate").selected?.action.type,"train");
      const initial=structuredClone(state),selected=decide(state,rules,policy).selected;
      const charges:unknown[]=[];let recovery:unknown=null;
      if(policy==="candidate") {
        let saved:SavedControl|null=null;
        const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
        const settings:Settings={serverUrl:"https://sandbox.invalid",worldId:s.world.id,apiKey:"sandbox-adapter-no-credential"};
        const remote:Remote=async<T>(_settings:Settings,path:string,body?:unknown):Promise<T>=>{
          if(path==="/me")return {account:{id:state.player.id,name:"Sandbox owner",createdAt:""},worlds:[],sandboxes:[]} as T;
          if(path==="/worlds")return [planning(state).world] as T;
          if(path.endsWith("/rules"))return rules as T;
          if(path.endsWith("/history"))return {samples:[]} as T;
          if(path.endsWith("/state")){state=s.state();return planning(state) as T;}
          assert.ok(path.endsWith("/actions"));
          const action=(body as {actions:Action[]}).actions[0];
          assert.equal(saved?.pending?.action.clientId,action.clientId,"Journal before submission");
          const before=structuredClone(state.villages[0]);
          const response=sandbox<ActionsResponse>({op:"act",world:s.world.id,requestId:action.clientId,actions:[action]});
          assert.equal(response.results[0].ok,true,JSON.stringify(response.results));state=response.state??s.state();
          charges.push({action,spend:Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,(before.resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000])),results:response.results});return response as T;
        };
        let controller=await Controller.create(storage,settings,remote,()=>1000,{execute:false});
        await controller.cycle();await controller.setAutomatic(true);await controller.cycle();
        assert.equal(saved!.pending?.action.type,"train");
        assert.equal(saved!.pending?.phase,"accepted");
        await controller.setAutomatic(false);complete();
        controller=await Controller.create(storage,settings,remote,()=>2000);await controller.cycle();
        assert.equal(saved!.pending,null);assert.equal(charges.length,1);
        assert.ok(controller.snapshot().decisions.some(d=>d.kind==="confirmed"));
        recovery={journalBeforePost:true,restartConfirmed:true,submissions:charges.length};
      }else if(selected) {
        const before=structuredClone(state.villages[0]);const response=act(selected.action);
        charges.push({action:selected.action,spend:Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,(before.resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000])),results:response.results});
      }
      stepTo(initial.world.tick+55);complete();
      const recruited=structuredClone(state.villages[0].units.home);
      assert.equal(recruited.pikeman,10);assert.equal(recruited.shieldman??0,policy==="candidate"?5:0);
      // Locked and late variants are fresh policy decisions over authoritative state/options.
      const locked=structuredClone(state);locked.villages[0].units.home.shieldman=0;locked.villages[0].buildings.smithy=0;
      assert.equal(evaluateRecruitment({state:planning(locked),rules}).find(p=>p.action.unit==="shieldman")?.status,"not-needed");
      const late=structuredClone(state);late.villages[0].units.home.shieldman=0;
      late.world.endsAtTick=late.world.tick+5*late.villages[0].options.train.find(o=>o.unit==="shieldman")!.ticksEach+59;
      assert.equal(evaluateRecruitment({state:planning(late),rules}).find(p=>p.action.unit==="shieldman")?.status,"not-needed");
      const result:Record<string,any>={policy,worldId:s.world.id,initialTick:initial.world.tick,completionTick:state.world.tick,
        planningWorldStatus:"running",sandboxClockStatus:initial.world.status,buildingsBefore:initial.villages[0].buildings,
        populationBefore:initial.villages[0].population,populationAfter:state.villages[0].population,selected:selected?.action,recruited,charges,recovery,warmup,
        guards:{locked:true,late:true}};
      results.push(result);await save(false);
      // Physical battle fixture: place our defensive stack in a Warden village, then
      // attack that foreign village with an identical army. The Warden also defends;
      // this is explicitly a supported-village fixture, not an isolated duel.
      build("smithy");stepTo(1800);act({type:"train",village:state.villages[0].id,unit:"raider",count:20});complete();
      stepTo(2000);
      const log=sandbox<{entries:{by:string;action:Action}[]}>({op:"read",world:s.world.id,resource:"log"});
      const target=(log.entries.find(e=>e.by==="house_bot")!.action as {village:string}).village;
      act({type:"send",kind:"support",village:state.villages[0].id,target,units:recruited,arriveAtTick:5000});
      const support={arrivalTick:5000};stepTo(support.arrivalTick);
      const beforeBattle=structuredClone(state.villages[0]);
      act({type:"send",kind:"attack",village:state.villages[0].id,target,units:{raider:20}});
      const attack=state.commands.outgoing.find(c=>c.kind==="attack")!;stepTo(attack.arrivalTick);
      const afterBattle=structuredClone(state.villages[0]);
      const reports=sandbox<ReportsResponse>({op:"read",world:s.world.id,resource:"reports"});
      assert.ok(beforeBattle.supportAbroad.length,"Fixture defenders must be stationed before combat");
      assert.ok(reports.reports.some(r=>r.role==="supporter" && r.tick===attack.arrivalTick));
      assert.ok(reports.reports.some(r=>r.role==="attacker" && r.tick===attack.arrivalTick));
      result.physicalBattle={target,supportArrival:support.arrivalTick,attackArrival:attack.arrivalTick,
        attacker:{raider:20},defendersBefore:beforeBattle.supportAbroad,defendersAfter:afterBattle.supportAbroad,
        ownedDefenderLoss:Object.fromEntries((["pikeman","shieldman"] as const).map(u=>[u,(beforeBattle.units.away[u]??0)-(afterBattle.units.away[u]??0)])),
        reports:reports.reports,includesWardenDefenders:true};
      console.log(JSON.stringify({policy,worldId:s.world.id,recruited,physicalBattle:result.physicalBattle}));await save(false);
    }finally{s.close();}
  }
  assert.equal(results[0].initialTick,results[1].initialTick);
  assert.deepEqual(results[0].buildingsBefore,results[1].buildingsBefore);
  // Public authoritative simulator needs no credentials. It isolates the recruited
  // force from the Warden's defenders and exposes the actual server loss calculation.
  const attacks={infantry:{raider:10},cavalry:{lancer:4},ranged:{archer:10}};
  for(const result of results) {
    result.serverSimulations=[];
    for(const [kind,attacker] of Object.entries(attacks)) {
      let response:Response;
      for(;;) {
        response=await fetch("https://norn-steward.velea.cc/api/v1/worlds/blitz-1/simulate/battle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({attacker,defender:result.recruited})});
        if(response.status!==429)break;
        const delay=Number(response.headers.get("Retry-After")??1);assert.ok(delay<=60);await new Promise(r=>setTimeout(r,Math.max(1,delay)*1000));
      }
      assert.equal(response.status,200);const battle=await response.json() as SimulateBattleResponse;
      result.serverSimulations.push({kind,attacker,defender:result.recruited,battle,mode:"authoritative-server-simulation"});
    }
  }
  assert.equal(results[0].serverSimulations[0].battle.winner,"attacker");
  assert.equal(results[1].serverSimulations[0].battle.winner,"defender");
  await save(true);
}catch(error){await save(false,String(error));throw error;}
