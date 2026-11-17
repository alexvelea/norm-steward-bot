import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { Controller } from "../src/control/controller.js";
import { FileControlStorage } from "../src/control/storage.js";
import type { Remote } from "../src/control/remote.js";
import type { Settings } from "../src/control/types.js";
import { decodeControlStore, isControlStoreV2 } from "../src/bot/persistence/schema.js";

const fixture=resolve(dirname(fileURLToPath(import.meta.url)),"fixtures/control-legacy.json");

test("version-2 persistence accepts recurring conquest mission instances without migration",()=>{
 const store={
  storeVersion:2,
  settings:{serverUrl:"https://sandbox.invalid",worldId:"w",apiKey:"fixture"},
  execution:{journalVersion:1,automatic:false,pending:null,active:[],decisions:[]},
  strategy:{schema:1,missions:[{definition:"conquest",sequence:2}],commitments:[]},
 };
 assert.equal(isControlStoreV2(store),true);
 const decoded=decodeControlStore(store);
 assert.equal(decoded.missions?.[0]?.definition,"conquest");
 assert.equal("commitments" in decoded,false);
});

test("legacy state migrates durable work and writes a private backup before v2",async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),"steward-migration-"));
 try{
  const source=await readFile(fixture,"utf8");await writeFile(resolve(directory,"control.json"),source,{mode:0o600});
  const storage=new FileControlStorage(directory);const saved=await storage.load();
  assert.ok(saved);assert.equal(saved.automatic,false);
  assert.equal(saved.pending?.proposal.id,"pending-build");assert.equal(saved.pending?.proposal.task,"economy.storehouse");
  assert.equal(saved.active?.length,1);assert.equal(saved.active?.[0]?.proposal.id,"active-train");
  assert.equal(saved.active?.[0]?.proposal.task,"military.pikemen-baseline");
  assert.equal(saved.missions?.length,1);assert.equal(saved.missions?.[0]?.status,"active");
  assert.equal(saved.missions?.[0]?.definition,"firstConquest");
  assert.equal("commitments" in saved,false);
  assert.equal(saved.production?.toTick,12);
  assert.equal(saved.decisions[0]?.kind,"cancelled");
  assert.ok(saved.decisions[0]?.text.includes("will not be replayed"));
  assert.equal("scouting" in saved,false);assert.equal("raids" in saved,false);
  const files=await readdir(directory);const backup=files.find(name=>name.startsWith("control.legacy-")&&name.endsWith(".json"));
  assert.ok(backup);assert.equal((await stat(resolve(directory,backup!))).mode&0o777,0o600);
  assert.equal(await readFile(resolve(directory,backup!),"utf8"),source);
  const current=JSON.parse(await readFile(resolve(directory,"control.json"),"utf8"));
  assert.equal(current.storeVersion,2);assert.equal(current.execution.automatic,false);
  assert.equal(current.strategy.missions.length,1);
  assert.equal("commitments" in current.strategy,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test("unsupported store versions block controller execution without rewriting state",async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),"steward-recovery-"));
 try{
  const original=JSON.stringify({storeVersion:99,settings:{serverUrl:"",worldId:"",apiKey:""}},null,2);
  await writeFile(resolve(directory,"control.json"),original,{mode:0o600});
  const storage=new FileControlStorage(directory);const initial:Settings={serverUrl:"https://sandbox.invalid",worldId:"w",apiKey:"fixture"};
  let requests=0;const request:Remote=async <T>()=>{requests++;throw new Error("Unexpected network request.");};
  const controller=await Controller.create(storage,initial,request);
  await controller.cycle();
  assert.equal(controller.snapshot().automatic,false);assert.equal(controller.snapshot().connection,"error");
  assert.equal(requests,0);assert.equal(await readFile(resolve(directory,"control.json"),"utf8"),original);
  assert.deepEqual((await readdir(directory)),["control.json"]);
  await assert.rejects(controller.setAutomatic(true),/recovery is required/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
