import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import {evaluateMilitaryDevelopment,evaluateWalls,evaluateCavalry} from "../src/advisors/military-development.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
import {selectProposal} from "../src/advisors/president.js";
function ready(){const c=developedContext(),v=c.state.villages[0];Object.assign(v.buildings,{hall:10,barracks:9,smithy:2,stable:0});v.resourcesMilli={timber:10000000,stone:10000000,iron:10000000};v.storage=20000;
 for(const o of v.options.build){o.level=v.buildings[o.building]+1;o.cost={timber:100,stone:100,iron:100};}return c;}
test("military construction progresses Barracks 10, Smithy 5 and Stable while units train",()=>{
 const c=ready(),v=c.state.villages[0];v.training.barracks=[{id:"q",unit:"pikeman",count:10,remaining:10,costEach:{timber:45,stone:35,iron:15},nextTick:108,endTick:180}];
 assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"barracks");assert.equal(evaluateMilitaryDevelopment(c)[0].status,"ready");
 v.buildings.barracks=10;assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"smithy");
 v.buildings.smithy=5;assert.deepEqual(evaluateMilitaryDevelopment(c),[]); // Scout readiness funds Stable 1.
 v.buildings.stable=1;v.options.build.find(o=>o.building==="stable")!.level=2;assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"stable");
 v.buildings.stable=3;assert.deepEqual(evaluateMilitaryDevelopment(c),[]);
});
test("wall value grows with the home garrison and ignores troops stationed away",()=>{
 const c=ready(),v=c.state.villages[0];v.units.home={};v.units.away={pikeman:300,shieldman:100};
 assert.equal(evaluateWalls(c)[0].status,"not-needed");
 v.units.home={pikeman:300,shieldman:100};assert.equal(evaluateWalls(c)[0].status,"ready");assert.match(evaluateWalls(c)[0].reason,/base defence/);
 c.state.world.endsAtTick=c.state.world.tick+10;assert.ok(evaluateWalls(c)[0].blockers.includes("ROUND_END_TOO_SOON"));
});
test("cavalry uses its Stable queue independently and respects funding, population and end time",()=>{
 const c=ready(),v=c.state.villages[0];v.buildings.barracks=10;v.buildings.smithy=5;v.buildings.stable=3;
 v.options.train=[{unit:"lancer",cost:{timber:120,stone:110,iron:240},pop:4,ticksEach:12,maxCount:20,ok:true,blockers:[],affordableAtTick:null}];
 const p=evaluateCavalry(c)[0];assert.equal(p.action.count,6);assert.equal(p.status,"ready");
 v.population.used=150;assert.equal(evaluateCavalry(c)[0].status,"not-needed");
});

test("scarce defensive input funds the next whole cohort before military development",()=>{
 const c=ready(),v=c.state.villages[0];
 v.buildings.barracks=1;v.units.home={pikeman:10,shieldman:5,raider:10};
 v.options.build.find(o=>o.building==="barracks")!.level=2;
 v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:8,maxCount:100,ok:true,blockers:[],affordableAtTick:null},
 {unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:11,maxCount:100,ok:true,blockers:[],affordableAtTick:null}];
 v.productionPerTickMilli={timber:3000,stone:10000,iron:10000};
 v.resourcesMilli.timber=439999; // 100 for construction plus the 340-timber 6+2 cohort.
 assert.ok(evaluateMilitaryDevelopment(c)[0].blockers.includes("DEFENSE_RESOURCE_RUNWAY"));
 assert.equal(evaluateMilitaryDevelopment(c)[0].status,"not-needed");
 const held=selectProposal([...evaluateMilitaryDevelopment(c),...evaluateSustainedDefense(c)]);
 assert.equal(held.selected?.action.type,"train","the President can fund recruitment instead of reserving blocked construction");
 assert.deepEqual(held.reservations,[]);
 v.resourcesMilli.timber=440000;assert.equal(evaluateMilitaryDevelopment(c)[0].status,"ready");
 assert.equal(selectProposal([...evaluateMilitaryDevelopment(c),...evaluateSustainedDefense(c)]).selected?.action.type,"build","funding both paths releases the higher-priority construction");
 v.resourcesMilli.timber=100000;v.productionPerTickMilli.timber=10000;
 assert.equal(evaluateMilitaryDevelopment(c)[0].status,"ready","no extra buffer for adequately supplied inputs");
 v.productionPerTickMilli.timber=3000;
 v.units.home.raider=9;assert.equal(evaluateMilitaryDevelopment(c)[0].status,"ready","starter paths remain available");
 v.units.home.raider=10;v.units.home.pikeman=0;v.units.away.pikeman=10;
 assert.ok(evaluateMilitaryDevelopment(c)[0].blockers.includes("DEFENSE_RESOURCE_RUNWAY"));
 v.orders.train=[{unit:"pikeman",keep:60}];assert.equal(evaluateMilitaryDevelopment(c)[0].status,"ready");
 v.orders.train=[];
 v.training.barracks=[{id:"q",unit:"pikeman",count:6,remaining:6,costEach:{timber:45,stone:35,iron:15},nextTick:108,endTick:170}];
 assert.ok(evaluateMilitaryDevelopment(c)[0].blockers.includes("DEFENSE_RESOURCE_RUNWAY"),"training in progress still needs a funded successor");
 v.training.barracks[0].endTick=c.state.world.endsAtTick-50;
 assert.equal(evaluateMilitaryDevelopment(c)[0].status,"ready","do not retain funding for a cohort that cannot be used");
});
