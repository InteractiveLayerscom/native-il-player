import test from 'node:test';
import assert from 'node:assert/strict';
import { planRenewal } from '../src/plan-renewal.js';
const valid = () => ({ version: 2, asset_id: 'a', native_gam: { contract: 'native-gam-plan-v1' },
  expires_at: new Date(Date.now()+60000).toISOString(), cuts: [] });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
test('renews once without credentials and refuses a different asset or expired authorization', async () => {
  const calls = [], applied = [];
  let response = valid();
  const renewal = planRenewal({ url: '/plan', origin: 'https://player.test', assetId: 'a',
    fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => response }; },
    onPlan: plan => applied.push(plan) });
  renewal.expired(); renewal.expired();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(applied.length, 1);
  response = { ...valid(), asset_id: 'other' };
  renewal.expired(); await flush();
  assert.equal(applied.length, 1);
  renewal.destroy();
});
test('does not renew against another origin or attach a late response after destroy', async () => {
  const wrong = planRenewal({ url: 'https://other.test/plan', origin: 'https://player.test', assetId: 'a',
    fetchImpl: () => assert.fail('foreign URL'), onPlan: () => assert.fail('foreign plan') });
  wrong.expired(); wrong.destroy();
  let answer;
  const renewal = planRenewal({ url: '/plan', origin: 'https://player.test', assetId: 'a',
    fetchImpl: () => new Promise(resolve => { answer = resolve; }), onPlan: () => assert.fail('late response') });
  renewal.expired(); await flush();
  renewal.destroy();
  answer({ ok: true, json: async () => valid() });
  await flush();
});
