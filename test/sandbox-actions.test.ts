import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retrySandboxAction } from '../scripts/sandbox/actions.js';

test('quota retries preserve requests, record every result and honor live executor backoff', async () => {
  const request = { actions: [{ type: 'build', clientId: 'journaled-id' }] };
  const delays: number[] = [], recorded: unknown[] = [], sent: unknown[] = [];
  const responses = [
    { results: [{ ok: false, error: { code: 'RATE_LIMITED', details: { retryAfterMs: 125 } } }] },
    { results: [{ ok: false, error: { code: 'RATE_LIMITED', details: { retryAfterMs: 12000 } } }] },
    { results: [{ ok: true }] },
  ];
  const response = await retrySandboxAction(async () => { sent.push(request); return responses[sent.length - 1]; },
    value => { recorded.push(value); }, async ms => { delays.push(ms); });
  assert.equal(response, responses[2]);
  assert.deepEqual(recorded, responses);
  assert.deepEqual(delays, [10000, 12000]);
  assert.ok(sent.every(value => value === request));
});

test('success and non-quota policy failures are returned without retrying', async () => {
  for (const outcome of [{ ok: true }, { ok: false, error: { code: 'INSUFFICIENT_RESOURCES' } }]) {
    let calls = 0;
    const response = { results: [outcome] };
    assert.equal(await retrySandboxAction(async () => { calls++; return response; }, () => {}, async () => { assert.fail('unexpected delay'); }), response);
    assert.equal(calls, 1);
  }
});

test('missing outcomes and unknown transport failures are not replayed; quota retries are bounded', async () => {
  await assert.rejects(retrySandboxAction(async () => ({ results: [] }), () => {}), /outcome unknown/);
  let calls = 0;
  await assert.rejects(retrySandboxAction(async () => { calls++; throw new Error('unknown write outcome'); }, () => {}), /unknown write outcome/);
  assert.equal(calls, 1);
  const delays: number[] = []; calls = 0;
  await assert.rejects(retrySandboxAction(async () => { calls++; return { results: [{ ok: false, error: { code: 'RATE_LIMITED' } }] }; },
    () => {}, async ms => { delays.push(ms); }), /quota retry bound/);
  assert.equal(calls, 30); assert.equal(delays.length, 29);
  assert.ok(delays.every(ms => ms === 10000));
});
