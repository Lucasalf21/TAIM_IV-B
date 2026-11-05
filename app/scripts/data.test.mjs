import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {output, prepare} from './prepare-data.mjs';

test('participant payload contains only allowlisted fields, preserving truncated lead-ups', () => {
  assert.deepEqual(Object.keys(output), ['version', 'threshold', 'windowHours', 'episodes']);
  for (const e of output.episodes) assert.deepEqual(Object.keys(e), ['id', 'hours', 'members', 'windowStart']);
  assert.equal(output.episodes.reduce((n, e) => n + e.hours.length * 10, 0), 3310);
  assert.equal(output.episodes.find(e => e.id === 'E13').hours.length, 16);
  assert.equal(output.episodes.find(e => e.id === 'E19').hours.length, 9);
});
test('data preparation rejects broken windows, nonfinite wind and time gaps', () => {
  const raw = JSON.parse(readFileSync(new URL('../../data/episodes_members.json', import.meta.url), 'utf8'));
  for (const mutate of [r => r.episodes.E01.members[0].pop(), r => r.episodes.E01.window_len = 2,
    r => r.episodes.E01.members[0][0] = NaN, r => r.episodes.E01.times[0] = r.episodes.E01.times[1]]) {
    const changed = structuredClone(raw); mutate(changed); assert.throws(() => prepare(changed));
  }
});
