import assert from "node:assert/strict";
import { test } from "node:test";
import { BotRunner } from "../src/bot/runner/runner.js";

test("runner prevents overlapping cycles and stop awaits the active cycle",async()=>{
 let finish!:()=>void,active=0,maximum=0;
 const runner=new BotRunner(async()=>{
  active++;maximum=Math.max(maximum,active);
  await new Promise<void>(resolve=>{finish=resolve;});
  active--;
 });
 const first=runner.cycle(),overlap=runner.cycle();
 assert.equal(first,overlap);assert.equal(maximum,1);
 let stopped=false;const stopping=runner.stop().then(()=>{stopped=true;});
 await Promise.resolve();assert.equal(stopped,false);
 finish();await Promise.all([first,stopping]);
 assert.equal(stopped,true);assert.equal(active,0);assert.equal(maximum,1);
 await assert.rejects(runner.cycle(),/stopped/);
});
