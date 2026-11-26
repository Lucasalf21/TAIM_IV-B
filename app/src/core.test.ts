import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptConsent, begin, createSession, csv, deleteLocal, exportsFor, finish, latinSquare, markResultsViewed, PROBABILITY_EPISODES,
  recover, save, STORAGE_KEY, submit, submitDemographics, TLX, withdraw} from './core.ts';
import type {Dataset, Session} from './core.ts';
import {contextFor, practiceEpisode} from './chart/frame.ts';
import {readFileSync} from 'node:fs';
const data: Dataset = {version: 'test', threshold: 5, windowHours: 3,
  episodes: Array.from({length: 20}, (_, i) => ({id: `E${String(i + 1).padStart(2, '0')}`, hours: [0], members: [], windowStart: 0, observed: 0 as const}))};
const unconsented = () => createSession('P01', 'IV-3', 'simulated', 1, data, false);
const create = () => acceptConsent(unconsented(), true);
test('dynamic Y axis boundaries with margin contain all real and practice values and threshold', () => {
  const real = JSON.parse(readFileSync(new URL('./generated/stimuli.json', import.meta.url), 'utf8')) as Dataset;
  for (const episode of [...real.episodes, practiceEpisode(0), practiceEpisode(1)]) {
    const ctx = contextFor(real, episode);
    const minVal = Math.min(...episode.members.flat());
    const maxVal = Math.max(...episode.members.flat());
    assert.ok(ctx.yMin <= minVal, `yMin ${ctx.yMin} must be <= minVal ${minVal}`);
    assert.ok(ctx.yMax >= maxVal, `yMax ${ctx.yMax} must be >= maxVal ${maxVal}`);
    assert.ok(ctx.yMin <= real.threshold, `yMin ${ctx.yMin} must be <= threshold`);
    assert.ok(ctx.yMax >= real.threshold, `yMax ${ctx.yMax} must be >= threshold`);
  }
  assert.throws(() => contextFor(real, {id: 'bad', hours: [0], windowStart: 0, members: [[-1]]}));
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
  assert.equal(recover(JSON.stringify(accepted), data).phase, 'demographics');
  assert.throws(() => recover(JSON.stringify({...accepted, consent: undefined}), data));
  for (const protocol of ['ivb-template-1', 'ivb-template-2', 'ivb-template-3']) assert.throws(() => recover(JSON.stringify({...accepted, protocol}), data));
});
test('declining and withdrawing discard responses and remain terminal after recovery', () => {
  const declined = withdraw(unconsented());
  assert.equal(declined.phase, 'declined');
  assert.equal(recover(JSON.stringify(declined), data).phase, 'declined');
  let s = begin(create()); s = submit(s, 'GO', '80', '20', 10); s = begin(s);
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
test('all measured trials, scheduled questions and TLX export correctly', () => {
  let s = create();
  for (let i = 0; i < 20; i++) {
    s = begin(s);
    s = submit(s, 'GO', '75', '20', 1234);
    assert.throws(() => submit(s, 'GO', '75', '20', 10));
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
  s = {...s, cursor: 1, attempts: [{...s.attempts[0], episode: 'E01', practice: false}]};
  assert.throws(() => submit(s, 'GO', '60', '', 1));
  assert.equal(submit(s, 'GO', '60', '0', 1).attempts[0].probability, 0);
});
test('recovery preserves submitted work and records repeated exposure', () => {
  let s = begin(create()); s = submit(s, 'GO', '80', '20', 100); s = begin(s);
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
test('demographics collection, validation, transition, and CSV export', () => {
  let s = acceptConsent(unconsented(), true);
  assert.equal(s.phase, 'demographics');
  assert.throws(() => submitDemographics(s, {
    age: '', field: 'Computing / informatics', chartFamiliarity: 3, weatherFamiliarity: 3, normalColorVision: 'Yes'
  }));
  assert.throws(() => submitDemographics(s, {
    age: '21-23', field: 'Computing / informatics', chartFamiliarity: 0, weatherFamiliarity: 3, normalColorVision: 'Yes'
  }));
  s = submitDemographics(s, {
    age: '21-23', field: 'Computing / informatics', chartFamiliarity: 4, weatherFamiliarity: 2, normalColorVision: 'Yes'
  });
  assert.equal(s.phase, 'instructions');
  assert.equal(s.demographics?.age, '21-23');
  assert.equal(s.demographics?.chartFamiliarity, 4);
  assert.equal(recover(JSON.stringify(s), data).phase, 'instructions');
  const sessionCsv = exportsFor(s).session;
  assert.match(sessionCsv, /"21-23"/);
  assert.match(sessionCsv, /"Computing \/ informatics"/);
});
test('recovery handles interruption before trial 1, questionnaire, results, and rejects 22-trial cursors', () => {
  const demo = {age: '21-23', field: 'Computing / informatics', chartFamiliarity: 3, weatherFamiliarity: 3, normalColorVision: 'Yes'};
  const withDemo = submitDemographics(create(), demo);
  const interruptedFirst = recover(JSON.stringify(begin(withDemo)), data);
  assert.equal(interruptedFirst.phase, 'instructions');
  assert.equal(interruptedFirst.cursor, 0);
  assert.equal(interruptedFirst.attempts[0].status, 'interrupted');
  assert.ok(interruptedFirst.attempts[0].flags.includes('recovered-interruption'));
  assert.equal(recover(JSON.stringify(interruptedFirst), data).phase, 'instructions');
  const retriedFirst = begin(interruptedFirst);
  assert.equal(retriedFirst.attempts[1].attempt, 2);
  assert.equal(retriedFirst.attempts[1].repeated, true);
  assert.equal(retriedFirst.attempts[1].position, 1);

  const interruptedNoDemo = recover(JSON.stringify(begin(create())), data);
  assert.equal(interruptedNoDemo.phase, 'demographics');

  let s = withDemo;
  for (let i = 0; i < 20; i++) {
    s = begin(s);
    if (i === 0) assert.equal(recover(JSON.stringify(submit(s, 'GO', '75', '20', 100)), data).phase, 'between');
    s = submit(s, 'GO', '75', '20', 100);
  }
  assert.equal(s.phase, 'between');
  assert.equal(s.cursor, 20);
  assert.equal(recover(JSON.stringify(s), data).phase, 'between');
  const atQuestionnaire = begin(s);
  assert.equal(atQuestionnaire.phase, 'questionnaire');
  assert.equal(recover(JSON.stringify(atQuestionnaire), data).phase, 'questionnaire');
  const q = {...Object.fromEntries(TLX.map(k => [k, 25])), comments: ''};
  const completed = finish(atQuestionnaire, q as Parameters<typeof finish>[1]);
  assert.equal(recover(JSON.stringify(completed), data).phase, 'complete');

  assert.throws(() => recover(JSON.stringify({...s, cursor: 21}), data));
  assert.throws(() => recover(JSON.stringify({...s, cursor: 22}), data));
  assert.throws(() => recover(JSON.stringify({...atQuestionnaire, phase: 'trial'}), data));
  assert.throws(() => recover(JSON.stringify({...withDemo, phase: 'between', cursor: 0}), data));
});
test('recovery keeps compatibility for valid old consent without misrepresenting it', () => {
  const oldSave = create();
  oldSave.consent = {version: 'ivb-consent-2026-11-23', accepted: '2026-11-23T12:00:00.000Z'};
  const recovered = recover(JSON.stringify(oldSave), data);
  assert.equal(recovered.consent?.version, 'ivb-consent-2026-11-23');
  let s = submitDemographics(recovered, {age: '21-23', field: 'Other', chartFamiliarity: 2, weatherFamiliarity: 2, normalColorVision: 'Yes'});
  for (let i = 0; i < 20; i++) { s = begin(s); s = submit(s, 'GO', '75', '20', 100); }
  s = begin(s);
  s = finish(s, {...Object.fromEntries(TLX.map(k => [k, 20])), comments: ''} as Parameters<typeof finish>[1]);
  assert.equal(recover(JSON.stringify(s), data).consent?.version, 'ivb-consent-2026-11-23');
  assert.throws(() => recover(JSON.stringify({...oldSave, consent: {version: 'ivb-consent-unknown', accepted: '2026-11-23T12:00:00.000Z'}}), data));
});
test('resultsViewed gate requires complete state, preserves CSV phase, and recovers handoff', () => {
  let s = create();
  assert.throws(() => markResultsViewed(s));
  for (let i = 0; i < 20; i++) {
    s = begin(s);
    s = submit(s, 'GO', '75', '20', 100);
  }
  s = begin(s);
  assert.throws(() => markResultsViewed(s));
  const q = {...Object.fromEntries(TLX.map(k => [k, 25])), comments: ''};
  const completed = finish(s, q as Parameters<typeof finish>[1]);
  assert.equal(completed.resultsViewed, undefined);
  assert.equal(recover(JSON.stringify(completed), data).resultsViewed, undefined);

  const handoffReady = markResultsViewed(completed);
  assert.equal(handoffReady.phase, 'complete');
  assert.equal(handoffReady.resultsViewed, true);
  assert.equal(markResultsViewed(handoffReady), handoffReady);

  const recoveredHandoff = recover(JSON.stringify(handoffReady), data);
  assert.equal(recoveredHandoff.phase, 'complete');
  assert.equal(recoveredHandoff.resultsViewed, true);

  const exported = exportsFor(handoffReady);
  assert.match(exported.session, /,"complete",/);
  assert.match(exported.trials, /,"complete",/);
  assert.match(exported.questionnaire, /,"complete",/);

  assert.throws(() => recover(JSON.stringify({...completed, resultsViewed: false}), data));
  assert.throws(() => recover(JSON.stringify({...completed, resultsViewed: 'yes'}), data));
  assert.throws(() => recover(JSON.stringify({...s, resultsViewed: true}), data));
  const withdrawn = withdraw(handoffReady);
  assert.equal(withdrawn.resultsViewed, undefined);
  assert.throws(() => markResultsViewed(withdrawn));
});
