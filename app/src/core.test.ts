import test from 'node:test';
import assert from 'node:assert/strict';
import {begin, createSession, csv, exportsFor, finish, finishPractice, latinSquare, PROBABILITY_EPISODES,
  recover, save, submit, TLX} from './core.ts';
import type {Dataset, Session} from './core.ts';
const data: Dataset = {version: 'test', threshold: 5, windowHours: 3,
  episodes: Array.from({length: 20}, (_, i) => ({id: `E${String(i + 1).padStart(2, '0')}`, hours: [0], members: [], windowStart: 0}))};
const create = () => createSession('P01', 'IV-3', 'simulated', 1, data, false);
test('balanced Latin square covers all positions and directed adjacent pairs', () => {
  const ids = data.episodes.map(e => e.id), rows = ids.map((_, i) => latinSquare(ids, i + 1));
  for (const row of rows) assert.equal(new Set(row).size, 20);
  for (let i = 0; i < 20; i++) assert.equal(new Set(rows.map(r => r[i])).size, 20);
  const pairs = rows.flatMap(r => r.slice(1).map((v, i) => `${r[i]}/${v}`));
  assert.equal(new Set(pairs).size, 20 * 19);
  assert.throws(() => latinSquare(ids, 0));
});
test('real modes blocked; anonymous ID validated', () => {
  for (const mode of ['pilot', 'study'] as const) assert.throws(() => createSession('P01', 'IV-3', mode, 1, data, false));
  assert.throws(() => createSession('person@example.com', 'IV-3', 'simulated', 1, data, false));
});
test('all practices, measured trials, scheduled questions and TLX export correctly', () => {
  let s = create();
  for (let i = 0; i < 22; i++) {
    s = begin(s);
    s = submit(s, 'GO', '75', '20', 1234);
    assert.throws(() => submit(s, 'GO', '75', '20', 10));
    if (s.phase === 'feedback') s = finishPractice(s);
  }
  s = begin(s);
  const q = {...Object.fromEntries(TLX.map(k => [k, 25])), comments: 'A comma, "quote"\nand a line'};
  s = finish(s, q as Parameters<typeof finish>[1]);
  assert.equal(s.phase, 'complete');
  assert.equal(s.attempts.filter(a => a.probability !== undefined).length, 5);
  assert.deepEqual(s.attempts.filter(a => a.probability !== undefined).map(a => a.episode).sort(), [...PROBABILITY_EPISODES].sort());
  assert.match(exportsFor(s).questionnaire, /"25","A comma, ""quote""\nand a line"/);
  assert.equal(recover(JSON.stringify(s), data).phase, 'complete');
});
test('blank and out-of-range values rejected without mutating session', () => {
  let s = begin(create());
  for (const confidence of ['', '49', '101', 'NaN']) assert.throws(() => submit(s, 'GO', confidence, '', 1));
  assert.throws(() => submit(s, '', '60', '', 1));
  assert.equal(s.attempts[0].status, 'active');
  s = {...s, cursor: 2, attempts: [{...s.attempts[0], episode: 'E01', practice: false}]};
  assert.throws(() => submit(s, 'GO', '60', '', 1));
  assert.equal(submit(s, 'GO', '60', '0', 1).attempts[0].probability, 0);
});
test('recovery preserves submitted work and records repeated exposure', () => {
  let s = begin(create()); s = submit(s, 'GO', '80', '', 100); s = finishPractice(s); s = begin(s);
  s = recover(JSON.stringify(s), data);
  assert.equal(s.attempts[0].status, 'submitted');
  assert.equal(s.attempts[1].status, 'interrupted');
  s = begin(s);
  assert.equal(s.attempts[2].attempt, 2); assert.equal(s.attempts[2].repeated, true);
  assert.throws(() => recover(JSON.stringify({...s, dataset: 'changed'}), data));
  assert.throws(() => recover('{broken', data));
  assert.throws(() => recover(JSON.stringify({...s, cursor: 4}), data));
  assert.throws(() => recover('null', data));
  const damaged = structuredClone(s); damaged.attempts[0].flags = null as unknown as string[];
  assert.throws(() => recover(JSON.stringify(damaged), data));
  const badAttempt = structuredClone(s); badAttempt.attempts[0].attempt = 99;
  assert.throws(() => recover(JSON.stringify(badAttempt), data));
});
test('storage failure is explicit and CSV protects spreadsheet formulas', () => {
  assert.throws(() => save({setItem: () => {throw Error('quota');}}, create()), /could not be saved/);
  assert.match(csv(['comments'], [['=HYPERLINK("bad")']]), /'=HYPERLINK/);
  assert.equal(exportsFor(create()).questionnaire.split('\r\n').filter(Boolean).length, 1);
});
