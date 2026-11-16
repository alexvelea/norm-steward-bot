import { evaluateMilitaryHall } from "../src/advisors/military.js";
import assert from "node:assert/strict";
import {test} from "node:test";
import {developedContext} from "./control-fixtures.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
import {evaluateEconomy} from "../src/advisors/economic.js";
import {selectProposal} from "../src/advisors/president.js";
function ready(): import("../src/advisors/types.js").AdvisorContext {
 const c=developedContext(),v=c.state.villages[0];
 v.buildings.barracks=1;v.buildings.smithy=2;v.hidden=1000;
 v.units.home={pikeman:30,shieldman:10,raider:10};
 v.productionPerTickMilli={timber:10000,stone:10000,iron:10000};
 v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:8,maxCount:100,ok:true,blockers:[],affordableAtTick:null},
 {unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:11,maxCount:100,ok:true,blockers:[],affordableAtTick:null}];
 return c;
}
test("minute-long 3Pi1Sh cohort queues both parts once, counts away troops and drains",()=>{
 const c=ready(),v=c.state.villages[0];
 let p=evaluateSustainedDefense(c)[0];assert.equal(p.action.unit,"pikeman");assert.equal(p.action.count,6);assert.equal(p.defenseBatch!.ticks,70);
 c.activeProposals=[p];v.units.away.pikeman=6;
 p=evaluateSustainedDefense(c)[0];assert.equal(p.action.unit,"shieldman");assert.equal(p.action.count,2);
 c.activeProposals.push(p);v.training.barracks=[{id:"s",unit:"shieldman",count:2,remaining:2,costEach:{timber:35,stone:30,iron:65},nextTick:108,endTick:124}];
 assert.deepEqual(evaluateSustainedDefense(c),[]);
});
test("affordable military beats discretionary producers; resource starvation promotes the deficient income",()=>{
 const c=ready(),v=c.state.villages[0];v.storage=100000;
 assert.equal(selectProposal([...evaluateEconomy(c),...evaluateSustainedDefense(c)]).selected?.action.type,"train");
 v.productionPerTickMilli.timber=100;v.resourcesMilli.timber=0;v.resources.timber=0;
 const p=evaluateEconomy(c).find(p=>p.action.building==="lumberyard")!;assert.ok(p.importance>=80);assert.match(p.reason,/Recruitment resource shortage/);
 assert.equal(evaluateSustainedDefense(c)[0].status,"waiting");assert.equal(selectProposal(evaluateSustainedDefense(c)).reservations.length,1);
});
test("opening, cap20, population expansion and late-round gates remain explicit",()=>{
 const c=ready(),v=c.state.villages[0];v.buildings.mine=4;assert.deepEqual(evaluateSustainedDefense(c),[]);
 v.buildings.mine=20;assert.equal(evaluateEconomy(c).find(p=>p.action.building==="mine")!.status,"not-needed");
 v.population.used=150;assert.equal(evaluateSustainedDefense(c)[0].status,"not-needed");
 assert.notEqual(evaluateEconomy(c).find(p=>p.action.building==="farm")!.status,"not-needed");
 v.population.used=30;c.state.world.endsAtTick=c.state.world.tick+129;
 assert.ok(evaluateSustainedDefense(c)[0].blockers.includes("ROUND_END_TOO_SOON"));
 c.state.world.endsAtTick=c.state.world.tick+130;assert.equal(evaluateSustainedDefense(c)[0].status,"ready");
});
test("queued work and manual orders prevent duplicate spending or a separate execution loop",()=>{
 const c=ready(),v=c.state.villages[0];
 v.training.barracks=[{id:"q",unit:"pikeman",count:3,remaining:3,costEach:{timber:45,stone:35,iron:15},nextTick:108,endTick:124}];
 let p=evaluateSustainedDefense(c)[0];assert.ok(p.blockers.includes("TRAIN_QUEUE_BUSY"));
 v.training.barracks=[];v.orders.train=[{unit:"pikeman",keep:60}];p=evaluateSustainedDefense(c)[0];assert.ok(p.blockers.includes("EXTERNAL_ORDERS"));
});

test("military Hall unlock follows live Barracks and Smithy prerequisites only after the opening",()=>{
 const c=ready(),v=c.state.villages[0];
 v.buildings.barracks=0;v.buildings.smithy=0;v.buildings.hall=1;
 let p=evaluateMilitaryHall(c)[0];assert.equal(p.action.building,"hall");assert.equal(p.importance,79);
 v.buildings.hall=3;assert.deepEqual(evaluateMilitaryHall(c),[]);
 v.buildings.barracks=1;assert.equal(evaluateMilitaryHall(c)[0].action.building,"hall");
 v.buildings.hall=5;assert.deepEqual(evaluateMilitaryHall(c),[]);
 v.buildings.hall=1;v.buildings.mine=4;assert.deepEqual(evaluateMilitaryHall(c),[]);
});

test("Barracks 5 queues exactly 9 Pikemen plus 3 Shieldmen, independent of the pre-existing force ratio",()=>{
 const c=ready(),v=c.state.villages[0];v.units.home={pikeman:10,shieldman:5,raider:10};v.buildings.barracks=5;
 v.options.train[0].ticksEach=6;v.options.train[1].ticksEach=9;
 const p=evaluateSustainedDefense(c)[0];assert.equal(p.action.count,9);assert.equal(p.defenseBatch!.shieldmen,3);assert.equal(p.defenseBatch!.ticks,81);
});


test("whole-cohort resource waits reserve discretionary spending but release impossible or late batches",()=>{
 const c=ready(),v=c.state.villages[0];v.storage=100000;
 v.resourcesMilli.timber=200000;v.resources.timber=200;
 let p=evaluateSustainedDefense(c)[0];
 assert.equal(p.status,"waiting");assert.deepEqual(p.blockers,["INSUFFICIENT_RESOURCES"]);
 assert.equal(p.affordableAtTick,c.state.world.tick+14);
 assert.equal(selectProposal([...evaluateEconomy(c),p]).reservations[0]?.proposalId,p.id);
 assert.equal(selectProposal([...evaluateEconomy(c),p]).selected,null);
 // The live per-unit maxCount can be resource-limited; it must not invalidate a future funded batch.
 v.options.train[0].maxCount=4;p=evaluateSustainedDefense(c)[0];assert.equal(p.status,"waiting");
 v.resourcesMilli.timber=0;v.options.train[0].ok=false;v.options.train[0].blockers=["INSUFFICIENT_RESOURCES"];v.options.train[0].maxCount=0;
 assert.equal(evaluateSustainedDefense(c)[0].status,"waiting");
 c.state.world.endsAtTick=c.state.world.tick+163; // 34 funding + 70 training + 60 use needs 164.
 assert.equal(evaluateSustainedDefense(c)[0].status,"not-needed");
 c.state.world.endsAtTick=c.state.world.tick+164;assert.equal(evaluateSustainedDefense(c)[0].status,"waiting");
 v.productionPerTickMilli.timber=0;assert.equal(evaluateSustainedDefense(c)[0].status,"not-needed");
 v.productionPerTickMilli.timber=10000;v.options.train[0].blockers=["REQUIREMENTS_NOT_MET"];
 assert.equal(evaluateSustainedDefense(c)[0].status,"not-needed");
});
