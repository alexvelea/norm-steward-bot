import { evaluateMilitaryHall } from "../src/advisors/military.js";
import assert from "node:assert/strict";
import {test} from "node:test";
import {developedContext} from "./control-fixtures.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
import {evaluateEconomy} from "../src/advisors/economic.js";
import {selectProposal} from "../src/advisors/president.js";
function ready(){
 const c=developedContext(),v=c.state.villages[0];
 v.buildings.barracks=1;v.buildings.smithy=2;v.hidden=1000;
 v.units.home={pikeman:30,shieldman:10,raider:10};
 v.productionPerTickMilli={timber:10000,stone:10000,iron:10000};
 v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:8,maxCount:100,ok:true,blockers:[],affordableAtTick:null},
 {unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:11,maxCount:100,ok:true,blockers:[],affordableAtTick:null}];
 return c;
}
test("repeatable 3Pi1Sh spends beyond starter caps and balances owned plus away troops",()=>{
 const c=ready(),v=c.state.villages[0];
 let p=evaluateSustainedDefense(c)[0];assert.equal(p.action.unit,"pikeman");assert.equal(p.action.count,3);
 v.units.away.pikeman=3;p=evaluateSustainedDefense(c)[0];assert.equal(p.action.unit,"shieldman");assert.equal(p.action.count,1);
 v.units.home.shieldman=11;p=evaluateSustainedDefense(c)[0];assert.equal(p.action.unit,"pikeman");
});
test("affordable military beats discretionary producers; resource starvation promotes the deficient income",()=>{
 const c=ready(),v=c.state.villages[0];v.storage=100000;
 assert.equal(selectProposal([...evaluateEconomy(c),...evaluateSustainedDefense(c)]).selected?.action.type,"train");
 v.productionPerTickMilli.timber=100;v.resourcesMilli.timber=0;v.resources.timber=0;
 const p=evaluateEconomy(c).find(p=>p.action.building==="lumberyard")!;assert.ok(p.importance>=80);assert.match(p.reason,/Recruitment resource shortage/);
 assert.equal(evaluateSustainedDefense(c)[0].status,"not-needed");assert.deepEqual(selectProposal(evaluateSustainedDefense(c)).reservations,[]);
});
test("opening, cap20, population expansion and late-round gates remain explicit",()=>{
 const c=ready(),v=c.state.villages[0];v.buildings.mine=4;assert.deepEqual(evaluateSustainedDefense(c),[]);
 v.buildings.mine=20;assert.equal(evaluateEconomy(c).find(p=>p.action.building==="mine")!.status,"not-needed");
 v.population.used=150;assert.equal(evaluateSustainedDefense(c)[0].status,"not-needed");
 assert.notEqual(evaluateEconomy(c).find(p=>p.action.building==="farm")!.status,"not-needed");
 v.population.used=30;c.state.world.endsAtTick=c.state.world.tick+83;
 assert.ok(evaluateSustainedDefense(c)[0].blockers.includes("ROUND_END_TOO_SOON"));
 c.state.world.endsAtTick=c.state.world.tick+84;assert.equal(evaluateSustainedDefense(c)[0].status,"ready");
});
test("queued work and manual orders prevent duplicate spending or a separate execution loop",()=>{
 const c=ready(),v=c.state.villages[0];
 v.training.barracks=[{id:"q",unit:"pikeman",count:3,remaining:3,costEach:{timber:45,stone:35,iron:15},nextTick:108,endTick:124}];
 let p=evaluateSustainedDefense(c)[0];assert.equal(p.action.unit,"shieldman");assert.ok(p.blockers.includes("TRAIN_QUEUE_BUSY"));
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
