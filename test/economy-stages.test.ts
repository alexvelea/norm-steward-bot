import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import {evaluateEconomy,forecastEconomy} from "../src/advisors/economic.js";
import {militaryAdvisor} from "../src/advisors/military.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
function ready(){const c=developedContext(),v=c.state.villages[0];v.buildings.barracks=3;v.buildings.smithy=1;v.hidden=1000;v.units.home={};v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:7,maxCount:100,ok:true,blockers:[],affordableAtTick:null},{unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:10,maxCount:100,ok:true,blockers:[],affordableAtTick:null}];return c;}
test("zero army proceeds directly to minute-long 3:1 cohorts, without starter quotas",()=>{const c=ready();const p=evaluateSustainedDefense(c)[0];assert.equal(p.status,"ready");assert.equal(p.defenseBatch!.pikemen,6);assert.equal(p.defenseBatch!.shieldmen,2);assert.ok(militaryAdvisor.evaluate(c).every(p=>p.action.type!=="train"||p.action.unit!=="raider"));});
test("production milestones suppress early troops and Cellar; Hall starts after level 8",()=>{const c=ready(),v=c.state.villages[0];v.buildings.mine=4;v.hidden=0;assert.equal(evaluateEconomy(c).find(p=>p.action.building==="cellar")!.status,"not-needed");assert.deepEqual(evaluateSustainedDefense(c),[]);v.buildings.mine=7;v.buildings.hall=4;assert.equal(evaluateEconomy(c).find(p=>p.action.building==="hall")!.status,"not-needed");v.buildings.mine=8;assert.equal(evaluateEconomy(c).find(p=>p.action.building==="hall")!.importance,86);v.buildings.mine=9;assert.deepEqual(evaluateSustainedDefense(c),[]);});
test("gross income must sustain every resource plus 20 percent construction headroom",()=>{const c=ready(),v=c.state.villages[0];v.productionPerTickMilli.iron=4000;const p=evaluateSustainedDefense(c)[0];assert.equal(p.status,"not-needed");assert.ok(p.blockers.includes("INCOME_CANNOT_SUSTAIN_TRAINING_AND_CONSTRUCTION"));v.productionPerTickMilli.iron=5000;assert.equal(evaluateSustainedDefense(c)[0].status,"ready");});
test("advisor forecasts reserve military burn and expose genuine construction income",()=>{const c=ready(),v=c.state.villages[0],f=forecastEconomy(v);assert.ok(f.militaryBurnPerMinute.timber>0);assert.ok(f.netProductionPerMinute.timber<600);assert.ok(Math.abs(f.netProductionPerMinute.timber+f.militaryBurnPerMinute.timber-600)<1e-6);v.buildings.mine=9;assert.equal(forecastEconomy(v).militaryBurnPerMinute.timber,0);});

test("recruitment-only Farm needs a complete cohort after construction, funding and Council waits",()=>{
 const c=ready(),v=c.state.villages[0],farm=v.options.build.find(o=>o.building==='farm')!;
 v.population={used:146,max:200}; // Four free above the buffer, but the eight-troop cohort needs more.
 farm.ticks=20;
 const status=()=>evaluateEconomy(c).find(p=>p.action.building==='farm')!.status;
 c.state.world.endsAtTick=241; // tick 100 + Farm 20 + full cohort 62 + useful life 60 - 1.
 assert.equal(status(),'not-needed');
 c.state.world.endsAtTick=242;assert.equal(status(),'ready');
 farm.affordableAtTick=110;assert.equal(status(),'not-needed');
 c.state.world.endsAtTick=252;assert.equal(status(),'ready');
 farm.affordableAtTick=null;c.state.player.nextActTick=110;c.state.world.actIntervalTicks=5;
 c.state.world.endsAtTick=256;assert.equal(status(),'not-needed');
 c.state.world.endsAtTick=257;assert.equal(status(),'waiting');
 c.state.player.nextActTick=null;c.state.world.actIntervalTicks=null;
 v.training.barracks=[{id:'paid',unit:'pikeman',count:1,remaining:1,costEach:{timber:45,stone:35,iron:15},nextTick:150,endTick:150}];
 c.state.world.endsAtTick=271;assert.equal(status(),'not-needed');
 c.state.world.endsAtTick=272;assert.equal(status(),'ready');
 // Basic capacity is still needed even when another full cohort cannot finish.
 v.population.used=151;c.state.world.endsAtTick=150;assert.equal(status(),'ready');
});
