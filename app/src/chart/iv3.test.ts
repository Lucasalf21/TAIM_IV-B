import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boxSummaries, iv3} from './iv3.ts';
import {iv4} from './iv4.ts';
import {contextFor, practiceEpisode} from './frame.ts';
import type {Dataset, Episode} from '../core.ts';

test('quartiles use all ten members, with min–max whiskers including extreme values', () => {
  const episode: Episode = {id: 'test', hours: [-3, 0], windowStart: 1,
    members: [0, 1, 2, 3, 4, 5, 6, 7, 8, 100].map(v => [v, 10 - v])};
  assert.deepEqual(boxSummaries(episode)[0], {hour: -3, min: 0, q25: 2.25, median: 4.5, q75: 6.75, max: 100});
  assert.equal(boxSummaries(episode)[1].min, -90);
  assert.deepEqual(episode.members[9], [100, -90]);
});
test('every real episode and both practices have one ordered summary per actual timestep', () => {
  const data = JSON.parse(readFileSync(new URL('../generated/stimuli.json', import.meta.url), 'utf8')) as Dataset;
  for (const episode of [...data.episodes, practiceEpisode(0), practiceEpisode(1)]) {
    const boxes = boxSummaries(episode);
    assert.equal(boxes.length, episode.hours.length);
    boxes.forEach((b, i) => {
      assert.equal(b.hour, episode.hours[i]);
      assert.equal(b.min, Math.min(...episode.members.map(m => m[i])));
      assert.equal(b.max, Math.max(...episode.members.map(m => m[i])));
      assert.ok(b.min <= b.q25 && b.q25 <= b.median && b.median <= b.q75 && b.q75 <= b.max);
    });
    assert.equal(boxes[episode.windowStart].hour, 0);
    assert.equal(iv3.marks(contextFor(data, episode)).length, 5);
  }
  assert.equal(boxSummaries(data.episodes.find(e => e.id === 'E13')!).length, 16);
  assert.equal(boxSummaries(data.episodes.find(e => e.id === 'E19')!).length, 9);
  assert.ok(boxSummaries(practiceEpisode(0)).at(-1)!.max < 5);
  assert.ok(boxSummaries(practiceEpisode(1)).at(-1)!.min > 5);
});
test('invalid member alignment rejected, rendering availability is separate from study readiness', () => {
  const episode = practiceEpisode(0);
  assert.throws(() => boxSummaries({...episode, members: episode.members.slice(1)}));
  const broken = structuredClone(episode); broken.members[0].pop();
  assert.throws(() => boxSummaries(broken));
  const nonfinite = structuredClone(episode); nonfinite.members[0][0] = NaN;
  assert.throws(() => boxSummaries(nonfinite));
  assert.equal(iv3.implemented, true);
  assert.equal(iv3.readyForStudy, false);
  assert.ok(!iv4.implemented);
  assert.equal(iv4.readyForStudy, false);
});
