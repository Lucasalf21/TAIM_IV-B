import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {acceptConsent, begin, createSession, exportsFor, finish, finishPractice, submit, TLX, withdraw} from './core.ts';
import type {Dataset, Questionnaire} from './core.ts';
import {feedbackRows, readOutcomeFeedback} from './feedback.ts';
const data = JSON.parse(readFileSync(new URL('./generated/stimuli.json', import.meta.url), 'utf8')) as Dataset;
function complete() {
  let s = acceptConsent(createSession('FEEDBACK-TEST', 'IV-3', 'simulated', 1, data, false), true);
  for (let i = 0; i < 22; i++) {
    s = begin(s); s = submit(s, 'GO', '75', '20', 100);
    if (s.phase === 'feedback') s = finishPractice(s);
  }
  s = begin(s);
  return finish(s, {...Object.fromEntries(TLX.map(k => [k, 20])), comments: ''} as Questionnaire);
}
test('decision feedback uses presentation order, all members, and the 12.5% cost threshold', () => {
  const s = complete(), rows = feedbackRows(s, data);
  assert.deepEqual(rows.map(r => r.episode), s.sequence);
  assert.equal(rows.length, 20);
  assert.equal(rows.find(r => r.episode === 'E07')!.recommended, 'GO');
  assert.equal(rows.find(r => r.episode === 'E10')!.recommended, 'CANCEL');
  assert.equal(rows.find(r => r.episode === 'E13')!.probability, .3);
  assert.equal(rows.filter(r => r.goodDecision).length, 9);
  assert.ok(rows.every(r => r.cost === undefined && r.matchedOutcome === undefined));
});
test('outcomes are session-bound; sound decisions can have unlucky results', () => {
  const s = complete();
  const d = {schema: 1, sessionId: s.id, dataset: s.dataset, protocol: s.protocol, condition: s.condition, mode: s.mode,
    trials: s.sequence.map(episode => ({episode, decision: 'GO', observed: 1}))};
  const loaded = readOutcomeFeedback(JSON.stringify(d), s, data);
  const row = feedbackRows(s, data, loaded).find(r => r.episode === 'E07')!;
  assert.equal(row.goodDecision, true); assert.equal(row.matchedOutcome, false); assert.equal(row.cost, 40000);
  for (const mutate of [x => x.sessionId = 'other', x => x.dataset = 'other', x => x.trials.pop(),
    x => x.trials.reverse(), x => x.trials[0].decision = 'CANCEL', x => x.trials[0].observed = 2]) {
    const bad = structuredClone(d); mutate(bad); assert.throws(() => readOutcomeFeedback(JSON.stringify(bad), s, data));
  }
  assert.throws(() => readOutcomeFeedback('{invalid', s, data));
  assert.throws(() => readOutcomeFeedback(' '.repeat(65537), s, data));
});
test('no feedback before questionnaire completion or after withdrawal', () => {
  const s = complete();
  for (const phase of ['trial', 'between', 'questionnaire', 'consent'] as const) {
    assert.throws(() => feedbackRows({...s, phase}, data));
  }
  assert.throws(() => feedbackRows({...s, questionnaire: undefined}, data));
  assert.throws(() => feedbackRows(withdraw(s), data));
});
test('real scorer output loads into feedback with consistent totals and no overwritten outputs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'taim-feedback-'));
  try {
    const s = complete(), exported = exportsFor(s);
    const trials = join(folder, 'trials.csv'), session = join(folder, 'session.csv'), scored = join(folder, 'scored.csv');
    writeFileSync(trials, exported.trials); writeFileSync(session, exported.session);
    const script = fileURLToPath(new URL('../scripts/score.py', import.meta.url));
    const args = [script, trials, scored, '--session', session, '--allow-simulated'];
    execFileSync('python3', args);
    const loaded = readOutcomeFeedback(readFileSync(join(folder, 'scored.debrief.json'), 'utf8'), s, data);
    const rows = feedbackRows(s, data, loaded);
    assert.equal(rows.filter(r => r.goodDecision).length, 9);
    assert.equal(rows.filter(r => r.matchedOutcome).length, 13);
    assert.equal(rows.reduce((n, r) => n + r.cost!, 0), 280000);
    assert.throws(() => execFileSync('python3', args, {stdio: 'pipe'}));
  } finally { rmSync(folder, {recursive: true, force: true}); }
});
