import {test} from 'node:test';import assert from 'node:assert/strict';
import {nextConquestBuilding,conquestLoyalty,safeEnvoyAttack} from '../src/review/conquest-plan.js';
import {developedContext} from './control-fixtures.js';
test('conquest opening follows Hall13 then Barracks10, respecting live prerequisites',()=>{
 const c=developedContext(),v=c.state.villages[0];v.buildings.hall=5;v.buildings.barracks=3;
 assert.equal(nextConquestBuilding(v.buildings,c.rules),'hall');v.buildings.hall=13;
 assert.equal(nextConquestBuilding(v.buildings,c.rules),'barracks');v.buildings.barracks=10;v.buildings.smithy=1;
 assert.equal(nextConquestBuilding(v.buildings,c.rules),'smithy');v.buildings.smithy=10;v.buildings.market=0;v.buildings.storehouse=1;
 assert.equal(nextConquestBuilding(v.buildings,c.rules),'storehouse');v.buildings.storehouse=5;v.buildings.market=5;
 assert.equal(nextConquestBuilding(v.buildings,c.rules),'court');v.buildings.court=1;assert.equal(nextConquestBuilding(v.buildings,c.rules),null);
});
test('one Envoy needs a fourth hit when loyalty regenerates between trips',()=>{
 assert.deepEqual(conquestLoyalty([100,300,500,700],34,120),[66,34,2,-31]);
 assert.deepEqual(conquestLoyalty([100,100,100],34,120),[66,32,-2]);
});
test('winning while losing the only Envoy is not a safe conquest attack',()=>{
 const b:any={winner:'attacker',attackerLost:{raider:10,envoy:1},attackerSurvivors:{raider:90}};assert.equal(safeEnvoyAttack(b),false);
 b.attackerLost.envoy=0;b.attackerSurvivors.envoy=1;assert.equal(safeEnvoyAttack(b),true);
 b.attackerLost.raider=40;assert.equal(safeEnvoyAttack(b),false);
});

test('funding fallback includes the upgrade bill and lost building time, rather than spending for every shortage',async()=>{
 const {fundingUpgrade}=await import('../src/review/conquest-plan.js');
 const input={stockMilli:{timber:100000,stone:100000,iron:100000},incomeMilli:{timber:1000,stone:1000,iron:1000},bill:{timber:200,stone:0,iron:0},upgradeCost:{timber:60,stone:0,iron:0},ticks:20,resource:'timber' as const,newIncomeMilli:2000};
 assert.deepEqual(fundingUpgrade(input),{saveTicks:100,upgradeTicks:90,improves:true});
 assert.equal(fundingUpgrade({...input,ticks:100,upgradeCost:{timber:100,stone:0,iron:0}}).improves,false);
 assert.equal(fundingUpgrade({...input,resource:'stone'}).improves,false);
 assert.equal(fundingUpgrade({...input,upgradeCost:{timber:101,stone:0,iron:0}}).improves,false);
});
