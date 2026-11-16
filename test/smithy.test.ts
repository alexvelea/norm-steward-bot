import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import {evaluateDefensiveSmithy} from "../src/advisors/smithy.js";
function ready(){const c=developedContext(),v=c.state.villages[0];v.buildings.hall=5;v.buildings.barracks=3;v.units.home={};
 v.options.train=[{unit:"pikeman",cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:7,maxCount:100,ok:true,blockers:[],affordableAtTick:null},{unit:"shieldman",cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:10,maxCount:0,ok:false,blockers:["REQUIREMENTS_NOT_MET"],affordableAtTick:null}];return c;}
test("Smithy unlock starts with zero units and funds a complete 3Pi1Sh cohort",()=>{const c=ready();const p=evaluateDefensiveSmithy(c)[0];assert.equal(p.status,"ready");assert.match(p.reason,/No initial troop quota/);c.state.villages[0].buildings.smithy=1;assert.deepEqual(evaluateDefensiveSmithy(c),[]);});
test("Smithy unlock respects production stage, real prerequisites, funding and round time",()=>{const c=ready(),v=c.state.villages[0];v.buildings.mine=9;assert.deepEqual(evaluateDefensiveSmithy(c),[]);v.buildings.mine=10;v.buildings.hall=4;assert.equal(evaluateDefensiveSmithy(c)[0].status,"not-needed");v.buildings.hall=5;v.resourcesMilli.iron=0;assert.equal(evaluateDefensiveSmithy(c)[0].status,"not-needed");v.resourcesMilli.iron=1000000;c.state.world.endsAtTick=110;assert.ok(evaluateDefensiveSmithy(c)[0].blockers.includes("ROUND_END_TOO_SOON"));});
