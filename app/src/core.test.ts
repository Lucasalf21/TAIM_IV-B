import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptConsent, begin, createSession, csv, deleteLocal, exportsFor, finish, finishPractice, latinSquare, PROBABILITY_EPISODES,
  recover, save, STORAGE_KEY, submit, TLX, withdraw} from './core.ts';
import type {Dataset, Session} from './core.ts';
import {contextFor, practiceEpisode} from './chart/frame.ts';
import {readFileSync} from 'node:fs';
const data: Dataset = {version: 'test', threshold: 5, windowHours: 3,
  episodes: Array.from({length: 20}, (_, i) => ({id: `E${String(i + 1).padStart(2, '0')}`, hours: [0], members: [], windowStart: 0}))};
const unconsented = () => createSession('P01', 'IV-3', 'simulated', 1, data, false);
const create = () => acceptConsent(unconsented(), true);
test('fixed 0–16 axis contains all real and practice values and rejects clipping', () => {
  const real = JSON.parse(readFileSync(new URL('./generated/stimuli.json', import.meta.url), 'utf8')) as Dataset;
  for (const episode of [...real.episodes, practiceEpisode(0), practiceEpisode(1)]) assert.equal(contextFor(real, episode).yMax, 16);
  assert.throws(() => contextFor(real, {id: 'bad', hours: [0], windowStart: 0, members: [[16.01]]}));
});
test('consent is explicit, versioned and enforced beyond the screen', () => {
  const s = unconsented();
  assert.equal(s.phase, 'consent');
  assert.equal(s.attempts.length, 0);
  assert.throws(() => acceptConsent(s, false));
  assert.throws(() => begin({...s, phase: 'instructions'}));
  assert.throws(() => submit({...s, phase: 'trial'}, 'GO', '80', '', 1));
  const accepted = acceptConsent(s, true);
  assert.ok(accepted.consent?.accepted);
  assert.equal(recover(JSON.stringify(accepted), data).phase, 'instructions');
  assert.throws(() => recover(JSON.stringify({...accepted, consent: undefined}), data));
  assert.throws(() => recover(JSON.stringify({...accepted, protocol: 'ivb-template-1'}), data));
});
test('declining and withdrawing discard responses and remain terminal after recovery', () => {
  const declined = withdraw(unconsented());
  assert.equal(declined.phase, 'declined');
  assert.equal(recover(JSON.stringify(declined), data).phase, 'declined');
  let s = begin(create()); s = submit(s, 'GO', '80', '', 10); s = finishPractice(s); s = begin(s);
  const stopped = withdraw(s);
  assert.equal(stopped.phase, 'withdrawn');
  assert.equal(stopped.cursor, 0);
  assert.deepEqual(stopped.attempts, []);
  assert.ok(stopped.withdrawn);
  assert.equal(recover(JSON.stringify(stopped), data).phase, 'withdrawn');
  assert.throws(() => begin(stopped));
  assert.throws(() => finish(stopped, {} as Parameters<typeof finish>[1]));
  assert.throws(() => acceptConsent(stopped, true));
  assert.equal(exportsFor(stopped).trials.split('\r\n').filter(Boolean).length, 1);
  assert.match(exportsFor(stopped).session, /withdrawn/);
});
test('local deletion is scoped to the experiment key and reports failures', () => {
  const store = new Map([[STORAGE_KEY, 'session'], ['unrelated', 'preserve']]);
  deleteLocal({removeItem: key => {store.delete(key);}, getItem: key => store.get(key) ?? null});
  assert.equal(store.get('unrelated'), 'preserve');
  assert.equal(store.has(STORAGE_KEY), false);
  assert.throws(() => deleteLocal({removeItem: () => {throw Error('denied');}, getItem: () => 'session'}), /deletion failed/);
  assert.throws(() => deleteLocal({removeItem: () => {}, getItem: () => 'session'}), /deletion failed/);
});
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
