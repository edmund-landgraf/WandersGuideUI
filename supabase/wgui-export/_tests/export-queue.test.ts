import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExportQueue } from '../_wgui-export/export-queue.ts';

test('catalog loading never overlaps another request compilation', async () => {
  const events: string[] = [];
  let current: string | undefined;
  const enqueue = createExportQueue<string>(pkg => { current = pkg; }, () => { current = undefined; events.push('clear'); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const first = enqueue(async () => { events.push('load A'); return 'A'; }, async () => {
    started(); await gate; assert.equal(current, 'A'); return 'first';
  });
  await ready;
  const second = enqueue(async () => { events.push('load B'); return 'B'; }, async () => {
    assert.equal(current, 'B'); return 'second';
  });
  await Promise.resolve();
  assert.deepEqual(events, ['load A']);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(events, ['load A', 'clear', 'load B', 'clear']);
  assert.equal(current, undefined);
});

test('load and compile failures release catalog and do not poison queue', async () => {
  let current: string | undefined;
  let clears = 0;
  const enqueue = createExportQueue<string>(pkg => { current = pkg; }, () => { current = undefined; clears++; });
  await assert.rejects(enqueue(async () => { throw Error('load failed'); }, async () => 'never'), /load failed/);
  await assert.rejects(enqueue(async () => 'A', async () => { throw Error('compile failed'); }), /compile failed/);
  assert.equal(current, undefined);
  assert.equal(await enqueue(async () => 'B', async () => current), 'B');
  assert.equal(current, undefined);
  assert.equal(clears, 3);
});
