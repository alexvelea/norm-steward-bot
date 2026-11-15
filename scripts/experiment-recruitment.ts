/** Matched owner-only server experiments for bounded recruitment and executor recovery. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { evaluateMilitary } from "../src/advisors/military.js";
import { evaluateRecruitment } from "../src/advisors/recruitment.js";
import { selectProposal } from "../src/advisors/president.js";
import { Controller } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { SavedControl, Settings } from "../src/control/types.js";
import type { Action, ActionsResponse, RulesResponse, StateResponse } from "../src/shared/api.js";
const output = process.env.STEWARD_REVIEW_RUN! + "/recruitment-comparison.json";
const results: Record<string, any>[] = [];
const planning = (s: StateResponse): StateResponse => ({...s, world:{...s.world,status:"running"}});
const decide = (s: StateResponse, rules: RulesResponse, policy: string) => selectProposal([
  ...evaluateEconomy({state:planning(s),rules}), ...evaluateMilitary({state:planning(s),rules}),
  ...(policy === "candidate" ? evaluateRecruitment({state:planning(s),rules}) : []),
]);
async function save(passed: boolean, error?: string) {
  await writeFile(output, JSON.stringify({taskId:"military-recruitment",baseline:"deployed-economic-and-first-barracks",candidate:"plus-bounded-pikeman-recruitment",passed,error,results},null,2));
}
try {
  for (const scenario of ["useful", "too-late"])
    for (const policy of ["baseline", "candidate"]) {
      const s = new PrivateSandbox(73421, 3600);
      try {
        let state = s.join(); const rules = s.rules();
        const warmup: unknown[] = [];
        function act(action: Action) {
          const response = s.act([action]);
          assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
          state = response.state ?? s.state(); return response;
        }
        function complete() {
          const tick = Math.max(state.world.tick, state.player.nextActTick ?? 0, ...state.villages[0].buildQueue.map((q)=>q.endTick));
          if (tick > state.world.tick) state = s.step(tick - state.world.tick);
        }
        for (const building of ["hall", "hall", "barracks"] as const) {
          const o = state.villages[0].options.build.find((o)=>o.building === building)!;
          const tick = Math.max(state.world.tick,state.player.nextActTick ?? 0,o.affordableAtTick ?? 0);
          if (tick > state.world.tick) state = s.step(tick-state.world.tick);
          warmup.push(act({type:"build",village:state.villages[0].id,building}).results); complete();
        }
        for (let i=0; i<20; i++) {
          const choice = decide(state,rules,"candidate").selected;
          if (choice?.action.type === "train") break;
          if (choice) {warmup.push(act(choice.action).results);complete();}
          else { state=s.step(30); }
        }
        assert.equal(decide(state,rules,"candidate").selected?.action.type,"train","Warmup must reach useful recruitment");
        if (scenario === "too-late") {
          const ticks = state.villages[0].options.train.find((o)=>o.unit==="pikeman")!.ticksEach;
          state = s.step(state.world.endsAtTick - 5*ticks - 59 - state.world.tick);
          assert.ok(evaluateRecruitment({state:planning(state),rules})[0].blockers.includes("ROUND_END_TOO_SOON"));
        }
        const initial = structuredClone(state);
        const selected = decide(state,rules,policy).selected;
        const actions: unknown[] = [];
        const attempts: Action[] = [];
        const charges: unknown[] = [];
        let saved: SavedControl | null = null;
        let drop: "before" | "after" | null = null;
        const storage = {load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
        const settings: Settings = {serverUrl:"https://sandbox.invalid",worldId:s.world.id,apiKey:"sandbox-adapter-no-credential"};
        const remote: Remote = async <T>(_settings:Settings,path:string,body?:unknown):Promise<T> => {
          if(path === "/me") return {account:{id:initial.player.id,name:"Sandbox owner",createdAt:""},worlds:[],sandboxes:[]} as T;
          if(path === "/worlds") return [planning(state).world] as T;
          if(path.endsWith("/rules")) return rules as T;
          if(path.endsWith("/history")) return {samples:[]} as T;
          if(path.endsWith("/state")) {state=s.state();return planning(state) as T;}
          assert.ok(path.endsWith("/actions"));
          const action=(body as {actions:Action[]}).actions[0]; attempts.push(structuredClone(action));
          assert.equal(saved?.pending?.action.clientId,action.clientId,"Journal must precede POST");
          if(drop === "before") {drop="after";throw new RemoteError(0,1,"Simulated lost connection before sandbox POST");}
          const before=s.state().villages[0];
          const response=sandbox<ActionsResponse>({op:"act",world:s.world.id,requestId:action.clientId,actions:[action]});
          assert.equal(response.results[0].ok,true,JSON.stringify(response.results));
          state=response.state ?? s.state();
          charges.push({clientId:action.clientId,spend:Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,(before.resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000])),populationBefore:before.population,populationAfter:state.villages[0].population,results:response.results});
          actions.push(action);
          if(drop === "after") {drop=null;throw new RemoteError(0,1,"Simulated response lost after successful sandbox POST");}
          return response as T;
        };
        let recovery: Record<string,unknown> = {};
        if (policy === "candidate" && scenario === "useful") {
          let controller=await Controller.create(storage,settings,remote,()=>1000,{execute:false});
          await controller.cycle(); await controller.setAutomatic(true);
          drop="before"; await controller.cycle();
          assert.equal(saved!.pending?.phase,"uncertain");
          controller=await Controller.create(storage,settings,remote,()=>2000);await controller.cycle();
          assert.equal(saved!.pending?.phase,"uncertain");
          assert.deepEqual(attempts[1],attempts[0]);
          controller=await Controller.create(storage,settings,remote,()=>3000);await controller.cycle();
          assert.equal(attempts.length,2,"Observed server training must suppress replay");
          assert.equal(saved!.pending,null);
          const firstBatch=structuredClone(state.villages[0].training.barracks);
          assert.equal(firstBatch.length,1); assert.equal(firstBatch[0].count,5);
          state=s.step(firstBatch[0].endTick-state.world.tick);
          assert.equal(state.villages[0].units.home.pikeman,5);
          await controller.cycle();
          assert.equal(saved!.pending?.phase,"accepted");
          const secondBatch=state.villages[0].training.barracks[0];assert.equal(secondBatch.count,5);
          await controller.setAutomatic(false);
          state=s.step(secondBatch.endTick-state.world.tick); await controller.cycle();
          assert.ok(controller.snapshot().decisions.some(d=>d.kind==="confirmed"));
          assert.equal(state.villages[0].units.home.pikeman,10);
          assert.deepEqual(evaluateRecruitment({state:planning(state),rules}),[]);
          recovery={samePayloadRetried:true,observedQueueSuppressedReplay:true,confirmed:true,firstBatch,attempts};
        } else {
          // Baseline gets the same two decision opportunities and elapsed ticks.
          for(let i=0;i<(scenario === "useful" ? 2:1);i++) {
            const choice=decide(state,rules,policy).selected;
            if(choice) {
              assert.notEqual(choice.action.type,"train");
              const before=structuredClone(state.villages[0]); const response=act(choice.action);
              actions.push(choice.action);
              charges.push({spend:Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,(before.resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000])),results:response.results});
            }
            state=s.step(scenario === "useful" ? 40:Math.min(80,state.world.endsAtTick-state.world.tick));
          }
        }
        const home=state.villages[0].units.home.pikeman ?? 0;
        const u=(rules.rules.UNITS as Record<string,{defense:Record<string,number>}>).pikeman;
        const result={scenario,policy,worldId:s.world.id,tick:initial.world.tick,completionTick:state.world.tick,
          planningWorldStatus:"running",sandboxClockStatus:initial.world.status,selected:selected?.action ?? null,
          warmup,actions,charges,recovery,homePikemen:home,populationBefore:initial.villages[0].population,populationAfter:state.villages[0].population,
          buildingsBefore:initial.villages[0].buildings,buildingsAfter:state.villages[0].buildings,
          troopDefenseFromLiveRules:Object.fromEntries(Object.entries(u.defense).map(([kind,n])=>[kind,n*home])),
          combatMeasured:false};
        results.push(result); await save(false);
        console.log(JSON.stringify({scenario,policy,worldId:s.world.id,homePikemen:home,tick:state.world.tick}));
        assert.equal(home,scenario==="useful" && policy==="candidate" ? 10:0);
      } finally {s.close();}
    }
  for(const scenario of ["useful","too-late"]) {
    const pair=results.filter(r=>r.scenario===scenario);
    assert.equal(pair[0].tick,pair[1].tick);
    assert.deepEqual(pair[0].buildingsBefore,pair[1].buildingsBefore);
    assert.deepEqual(pair[0].populationBefore,pair[1].populationBefore);
  }
  await save(true);
} catch(error) {await save(false,String(error));throw error;}
