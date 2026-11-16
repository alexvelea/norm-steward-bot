import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import {evaluateMilitaryDevelopment,evaluateWalls,evaluateCavalry} from "../src/advisors/military-development.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
import {selectProposal} from "../src/advisors/president.js";
function ready(){const c=developedContext(),v=c.state.villages[0];Object.assign(v.buildings,{hall:10,barracks:9,smithy:2,stable:0});v.resourcesMilli={timber:10000000,stone:10000000,iron:10000000};v.storage=20000;
 for(const o of v.options.build){o.level=v.buildings[o.building]+1;o.cost={timber:100,stone:100,iron:100};}return c;}
test("military construction targets Barracks 3 and Smithy 1, and defers cavalry infrastructure without sustainable surplus",()=>{
 const c=ready(),v=c.state.villages[0];v.buildings.barracks=2;v.buildings.smithy=0;v.options.build.find(o=>o.building==="barracks")!.level=3;
 assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"barracks");
 v.buildings.barracks=3;v.options.build.find(o=>o.building==="smithy")!.level=1;assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"smithy");
 v.buildings.smithy=1;assert.deepEqual(evaluateMilitaryDevelopment(c),[]);
 v.productionPerTickMilli={timber:100000,stone:100000,iron:100000};v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:7,maxCount:100,ok:true,blockers:[],affordableAtTick:null},{unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:10,maxCount:100,ok:true,blockers:[],affordableAtTick:null}];
 v.buildings.barracks=5;v.options.build.find(o=>o.building==="smithy")!.level=2;assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"smithy");
 v.buildings.smithy=5;v.buildings.stable=1;v.options.build.find(o=>o.building==="stable")!.level=2;assert.equal(evaluateMilitaryDevelopment(c)[0].action.building,"stable");
});
test("wall value grows with the home garrison and ignores troops stationed away",()=>{
 const c=ready(),v=c.state.villages[0];v.units.home={};v.units.away={pikeman:300,shieldman:100};
 assert.equal(evaluateWalls(c)[0].status,"not-needed");
 v.units.home={pikeman:300,shieldman:100};assert.equal(evaluateWalls(c)[0].status,"ready");assert.match(evaluateWalls(c)[0].reason,/base defence/);
 c.state.world.endsAtTick=c.state.world.tick+10;assert.ok(evaluateWalls(c)[0].blockers.includes("ROUND_END_TOO_SOON"));
});
test("cavalry uses its Stable queue independently and respects funding, population and end time",()=>{
 const c=ready(),v=c.state.villages[0];v.buildings.barracks=10;v.buildings.smithy=5;v.buildings.stable=3;
 v.productionPerTickMilli={timber:100000,stone:100000,iron:100000};
 v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:7,maxCount:100,ok:true,blockers:[],affordableAtTick:null},{unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:10,maxCount:100,ok:true,blockers:[],affordableAtTick:null},{unit:"lancer",cost:{timber:120,stone:110,iron:240},pop:4,ticksEach:12,maxCount:20,ok:true,blockers:[],affordableAtTick:null}];
 const p=evaluateCavalry(c)[0];assert.equal(p.action.count,6);assert.equal(p.status,"ready");
 v.population.used=150;assert.equal(evaluateCavalry(c)[0].status,"not-needed");
});
