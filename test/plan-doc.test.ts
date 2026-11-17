import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PLAN, validatePlan, type PlanDefinition } from "../src/bot/plan/graph.js";
import { renderPlanDoc } from "../scripts/plan-doc.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");

test("PLAN has a valid rooted containment tree and acyclic prerequisites",()=>{
  assert.doesNotThrow(()=>validatePlan());
  assert.throws(()=>validatePlan({...PLAN,nodes:[...PLAN.nodes,PLAN.nodes[0]]} as PlanDefinition),/Duplicate/);
  assert.throws(()=>validatePlan({...PLAN,edges:[...PLAN.edges,{from:"missing",to:"round",kind:"requires"}]}),/Unknown plan edge/);
  assert.throws(()=>validatePlan({...PLAN,edges:[...PLAN.edges,{from:"conquest.dispatch",to:"conquest.infrastructure",kind:"requires"}]}),/Requires cycle/);
});

test("docs/plan.md is generated from PLAN",()=>{
  assert.equal(readFileSync(resolve(root,"docs/plan.md"),"utf8"),renderPlanDoc());
});
