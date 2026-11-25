import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireCreatureCatalog, importFailureMessage } from '../../src/process/upload/creature-import-audit.ts';
test('catalog preflight fails closed on request failure, truncated result, and incorrect source', () => {
  assert.throws(() => requireCreatureCatalog(null, 873), /No writes/);
  assert.throws(() => requireCreatureCatalog([], 873, 22), /incomplete/);
  assert.throws(() => requireCreatureCatalog([{name:'Fox',content_source_id:240}],873), /No writes/);
  assert.deepEqual([...requireCreatureCatalog([{name:' Ember Fox ',content_source_id:873}],873,1)], ['ember fox']);
  assert.deepEqual([...requireCreatureCatalog([],873,0)], []);
  assert.equal(importFailureMessage(new Error('Spell reference unavailable')), 'Spell reference unavailable');
});
