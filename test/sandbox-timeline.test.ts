import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timeline } from '../scripts/sandbox/timeline.js';

const state = (tick: number, capital: any, extra: any = {}) => ({
  world: { tick }, villages: [{ id: 'v1', buildings: {}, units: { home: {}, away: {} }, ...capital }, ...(extra.villages ?? [])],
  commands: { outgoing: extra.outgoing ?? [], incoming: extra.incoming ?? [] },
});

test('timeline records the first tick of each capital milestone and skips the starting position', () => {
  const timeline = new Timeline();
  timeline.observe(state(0, { buildings: { hall: 1, wall: 0 } }));
  timeline.observe(state(40, { buildings: { hall: 2, wall: 1 }, units: { home: { pikeman: 30 }, away: { pikeman: 25 } } }));
  timeline.observe(state(90, { buildings: { hall: 5, wall: 1 }, units: { home: { pikeman: 20 }, away: {} } }));
  assert.deepEqual(timeline.rows(), [
    { tick: 40, key: 'Wall 1', major: true }, { tick: 40, key: 'Pikemen 1', major: true }, { tick: 40, key: 'Pikemen 50', major: true },
    { tick: 90, key: 'Hall 5', major: true },
  ]);
  assert.deepEqual(timeline.rows(false).filter(m => !m.major).map(m => m.key), ['Hall 2', 'Hall 3', 'Hall 4']);
  assert.match(timeline.markdown(), /\| 90 \| 1\.5 \| Hall 5 \|/);
});

test('timeline tracks conquest, outgoing sends and every incoming command once', () => {
  const timeline = new Timeline();
  const attack = { id: 'c1', kind: 'attack', arrivalTick: 500, sentTick: 300, units: null };
  timeline.observe(state(0, {}));
  timeline.observe(state(310, {}, { incoming: [attack], outgoing: [{ kind: 'attack', sentTick: 305, units: { raider: 140, envoy: 1 } }, { kind: 'attack', returning: true, sentTick: 1 }] }));
  timeline.observe(state(400, {}, { incoming: [{ ...attack, units: { lancer: 3 } }], villages: [{ id: 'v2', buildings: { hall: 9 } }] }));
  assert.deepEqual(timeline.rows().map(m => [m.tick, m.key]), [
    [305, 'First attack sent'], [305, 'First Envoy sent'], [310, 'First incoming attack seen'], [400, 'Village 2 held'], [500, 'First incoming attack lands'],
  ]);
  assert.deepEqual(timeline.incoming, { c1: { seenTick: 310, ...attack, units: { lancer: 3 } } });
});
