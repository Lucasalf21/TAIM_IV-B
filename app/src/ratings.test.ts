import test from 'node:test';
import assert from 'node:assert/strict';
import data from './generated/stimuli.json' with {type: 'json'};
import {
  acceptConsent, begin, createSession, finish, parseRating, PROBABILITY_EPISODES,
  recover, submit, submitDemographics, TLX
} from './core.ts';
import type {Questionnaire} from './core.ts';

function readyTrialSession() {
  let s = createSession('P01', 'IV-3', 'simulated', 1, data, true);
  s = acceptConsent(s, true);
  s = submitDemographics(s, {
    age: '21-23',
    field: 'Computing / informatics',
    chartFamiliarity: 3,
    weatherFamiliarity: 3,
    normalColorVision: 'Yes'
  });
  return begin(s);
}

test('parseRating enforces integer bounds and step without rounding', () => {
  assert.equal(parseRating('50', 50, 100, 1), 50);
  assert.equal(parseRating(' 100 ', 50, 100, 1), 100);
  assert.equal(parseRating('0', 0, 100, 5), 0);
  assert.equal(parseRating('35', 0, 100, 5), 35);
  for (const bad of ['', '   ', '75.5', '75.0', '49', '101', '1e2', 'abc']) {
    assert.throws(() => parseRating(bad, 50, 100, 1));
  }
  for (const badTlx of ['', '12', '12.5', '-5', '105']) {
    assert.throws(() => parseRating(badTlx, 0, 100, 5));
  }
});

test('submit rejects decimal, blank, and out-of-range confidence and probability', () => {
  let s = readyTrialSession();
  // Move to a probability episode
  while (!PROBABILITY_EPISODES.includes(s.attempts.at(-1)!.episode)) {
    s = submit(s, 'GO', '75', '', 100);
    s = begin(s);
  }
  assert.throws(() => submit(s, 'GO', '75.5', '20', 100));
  assert.throws(() => submit(s, 'GO', '75', '20.5', 100));
  assert.throws(() => submit(s, 'GO', '', '20', 100));
  assert.throws(() => submit(s, 'GO', '75', '', 100));
  const ok = submit(s, 'GO', '75', '20', 100);
  assert.equal(ok.attempts.at(-1)!.confidence, 75);
  assert.equal(ok.attempts.at(-1)!.probability, 20);
});

test('finish rejects empty/coerced, decimal, and out-of-step TLX values and preserves optional comments', () => {
  let s = readyTrialSession();
  for (let i = 0; i < 20; i++) {
    if (i > 0) s = begin(s);
    s = submit(s, 'GO', '80', '10', 100);
  }
  s = begin(s);
  assert.equal(s.phase, 'questionnaire');

  const valid = Object.fromEntries([...TLX.map(k => [k, 25]), ['comments', '']]) as Questionnaire;
  assert.throws(() => finish(s, {...valid, mental: NaN}));
  assert.throws(() => finish(s, {...valid, mental: '' as unknown as number}));
  assert.throws(() => finish(s, {...valid, mental: 12}));
  assert.throws(() => finish(s, {...valid, mental: 12.5}));
  assert.throws(() => finish(s, {...valid, mental: 105}));

  const done = finish(s, valid);
  assert.equal(done.phase, 'complete');
  assert.equal(done.questionnaire?.comments, '');
});

test('recover still accepts previously recorded decimal confidence and probability sessions', () => {
  let s = readyTrialSession();
  while (!PROBABILITY_EPISODES.includes(s.attempts.at(-1)!.episode)) {
    s = submit(s, 'GO', '75', '', 100);
    s = begin(s);
  }
  s = submit(s, 'GO', '75', '20', 100);
  s.attempts.at(-1)!.confidence = 75.5;
  s.attempts.at(-1)!.probability = 12.5;
  const recovered = recover(JSON.stringify(s), data);
  assert.equal(recovered.attempts.at(-1)!.confidence, 75.5);
  assert.equal(recovered.attempts.at(-1)!.probability, 12.5);
});
