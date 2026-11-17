import assert from "node:assert/strict";
import { test } from "node:test";
import { ScriptedAdapter } from "../src/bot/adapters/scripted.js";
import type { WorldObservation } from "../src/bot/adapters/types.js";
import { context } from "./control-fixtures.js";

test("scripted adapter consumes only scripted observations and outcomes",async()=>{
 const c=context();
 const observation:WorldObservation={
  state:c.state,rules:c.rules,scope:"fixture",observedTick:c.state.world.tick,
  observedAt:"2026-11-14T00:00:00.000Z",rulesVersion:c.rules.version,
 };
 const adapter=new ScriptedAdapter([{observation,membership:{villageId:"v1"},outcome:{tick:100,results:[]} }]);
 const signal=new AbortController().signal;
 assert.equal(adapter.capabilities().clock,"scripted");
 assert.equal((await adapter.observe(signal)).state.world.id,"test");
 assert.deepEqual(await adapter.recoverMembership(signal),{villageId:"v1"});
 assert.deepEqual(await adapter.submit({},signal),{tick:100,results:[]});
 await adapter.wait(10,signal);
 assert.deepEqual(adapter.calls,["observe","recoverMembership","submit","wait"]);
});
