import './style.css';
import source from './generated/stimuli.json';
import {acceptConsent, begin, createSession, current, deleteLocal, exportsFor, finish, finishPractice, PROBABILITY_EPISODES,
  recover, save, STORAGE_KEY, submit, TLX, withdraw} from './core.ts';
import {CONSENT_HTML, CONSENT_VERSION} from './consent.ts';
import type {Condition, Dataset, Mode, Questionnaire, Session} from './core.ts';
import {contextFor, practiceEpisode, renderFrame} from './chart/frame.ts';
import {iv3} from './chart/iv3.ts';
import {iv4} from './chart/iv4.ts';
import {feedbackRows, readOutcomeFeedback} from './feedback.ts';
import type {OutcomeFeedback} from './feedback.ts';

const data: Dataset = source;
const renderers = {'IV-3': iv3, 'IV-4': iv4};
const root = document.querySelector<HTMLDivElement>('#app')!;
let session: Session | undefined;
let saved: string | null = null;
let researcher = true;
let clockStart: number | undefined;
let busy = false;
let storageFailed = false;
let changedElsewhere = false;
let outcomes: OutcomeFeedback | undefined;
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

function notice(message: string) {
  $('#error').textContent = message;
  $('#error').focus();
}
function commit(next: Session): boolean {
  if (changedElsewhere) {
    notice('Another tab changed the saved session. Export this tab’s backup, then reload before continuing.');
    return false;
  }
  try { save(localStorage, next); session = next; saved = JSON.stringify(next); storageFailed = false;
    if (outcomes?.sessionId !== next.id || next.phase !== 'complete') outcomes = undefined;
    return true; }
  catch (error) {
    storageFailed = true;
    if (session?.phase === 'trial') session.attempts.at(-1)!.flags.push('storage-write-failure');
    notice((error as Error).message); return false;
  }
}
function action(fn: () => Session, showParticipant = false) {
  if (busy) return;
  busy = true;
  try { if (commit(fn())) { if (showParticipant) researcher = false; render(); } } catch (e) { notice((e as Error).message); }
  finally { busy = false; }
}
function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function shell(content: string, title: string) {
  root.innerHTML = `<header><span class="brand">TAIM / Wind transfer experiment</span><nav aria-label="Session controls">${!researcher && session && !['declined', 'withdrawn'].includes(session.phase) ? '<button class="quiet" id="leave">Leave experiment</button>' : ''}<button class="quiet" id="researcher">${researcher ? 'Participant screen' : 'Researcher screen'}</button></nav></header>
    ${session?.mode === 'simulated' ? '<aside class="simulation">Simulated session · not participant evidence</aside>' : ''}
    <main><div id="error" role="alert" tabindex="-1"></div>${content}</main>
    <footer>TAIM 2026–27 · IV-B <span>Generated using Copernicus Climate Change Service information 2026. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.</span></footer>
    <dialog id="delete-dialog" aria-labelledby="delete-title"><h2 id="delete-title">Delete this browser’s session?</h2><p>This permanently removes its local responses, consent and session record. It cannot delete CSVs, JSON backups or scored files already downloaded. Ask the researcher to remove those copies using your session code.</p><p id="delete-reference"></p><div class="actions"><button id="keep-local">Keep local data</button><button id="confirm-delete">Delete local data</button></div></dialog>`;
  root.querySelector<HTMLButtonElement>('#leave')?.addEventListener('click', leave);
  $('#keep-local').onclick = () => $<HTMLDialogElement>('#delete-dialog').close();
  $('#confirm-delete').onclick = () => {
    try {
      if (changedElsewhere || localStorage.getItem(STORAGE_KEY) !== saved) throw Error('Another tab changed the saved session. Reload before deleting so you can check the target.');
      deleteLocal(localStorage);
      clockStart = undefined; session = undefined; saved = null; outcomes = undefined; researcher = true; storageFailed = false;
      render(); notice('Local session deleted. Downloaded files and backups were not deleted; ask the researcher to remove those copies separately.');
    } catch (e) { $<HTMLDialogElement>('#delete-dialog').close(); notice((e as Error).message); }
  };
  document.title = `${title} · TAIM`;
  $('#researcher').onclick = () => {
    if (!researcher && session?.phase === 'trial') {
      const next = structuredClone(session);
      const a = next.attempts.at(-1)!; a.status = 'interrupted'; a.ended = new Date().toISOString(); a.flags.push('researcher-pause');
      next.phase = next.cursor === 0 ? 'instructions' : 'between';
      if (!commit(next)) {
        researcher = true; render();
        notice('Saving failed. Export a JSON backup and partial CSVs before recovering this session.');
        return;
      }
    }
    researcher = !researcher; render();
  };
  root.querySelector<HTMLElement>('h1')?.focus();
}
function requestDelete() {
  $('#delete-reference').textContent = session ? `Participant code: ${session.participant}. Session code: ${session.id}. Keep these codes to request removal of downloaded copies.` : 'This will remove the saved experiment session on this browser. Export its backup first if you need to identify downloaded copies.';
  $<HTMLDialogElement>('#delete-dialog').showModal();
}
function leave() {
  if (!session) return;
  clockStart = undefined;
  outcomes = undefined;
  session = withdraw(session); researcher = false;
  let message = '';
  try {
    if (changedElsewhere) throw Error('Another tab changed browser storage. This session has stopped here; ask the researcher to remove any other copies.');
    save(localStorage, session); saved = JSON.stringify(session); storageFailed = false;
  } catch (e) {
    message = (e as Error).message;
    if (!changedElsewhere) {
      try { deleteLocal(localStorage); saved = null; message = 'The exit record could not be saved; the local session was deleted instead. Downloaded copies still need researcher removal.'; }
      catch { message = 'You have stopped. Browser storage could not be updated or deleted. Ask the researcher to clear the saved session and exported copies; do not resume it.'; }
    }
  }
  render();
  if (message) notice(message);
}
function setup() {
  shell(`<section class="intro"><p class="caption">Researcher setup</p><h1 tabindex="-1">One experiment.<br>Two ways to see uncertainty.</h1>
    <p class="lead">Prepare a supervised session for the offshore wind-transfer task.</p></section>
    <div class="setup-grid"><section class="panel"><h2>Start a session</h2>
    <form id="setup">
      <label>Anonymous participant ID<input name="participant" required pattern="(?:[A-Za-z0-9_]|-){1,32}" maxlength="32" placeholder="For example, P01" autocomplete="off"></label>
      <div class="fields"><label>Condition<select name="condition"><option>IV-3</option><option>IV-4</option></select></label>
      <label>Order row<input name="row" type="number" min="1" max="20" step="1" value="1" required></label></div>
      <label>Session mode<select name="mode"><option value="simulated">Simulated walkthrough</option><option value="pilot">Real pilot (blocked)</option><option value="study">Real study (blocked)</option></select></label>
      <p class="hint">IV-3 draws box plots from the supplied data. IV-4 is a placeholder. Real sessions remain blocked pending pilot review. Use matching order rows across conditions.</p>
      <label class="check"><input name="replace" type="checkbox" ${saved || session ? 'required' : ''}> I have exported any previous session before replacing it.</label>
      <button type="submit">Start simulated session</button>
    </form></section>
    <section class="panel"><h2>Saved work</h2><p id="saved-status">${session ? `${escape(session.participant)} · ${escape(session.condition)} · ${escape(session.phase)}` : saved ? 'A saved session is available on this browser.' : 'No saved session on this browser.'}</p>
      <div class="actions"><button id="recover" ${saved ? '' : 'disabled'}>Recover saved session</button><button id="backup" ${saved || session ? '' : 'disabled'}>Export JSON backup</button><button id="delete-local" ${saved || session ? '' : 'disabled'}>Delete local session</button></div>
      ${session ? '<h3>Researcher exports</h3><p class="hint">Export all three files separately. Practice and interrupted attempts remain marked. Back up files after every session.</p><div class="actions"><button data-export="session">Session CSV</button><button data-export="trials">Trials CSV</button><button data-export="questionnaire">Questionnaire CSV</button></div>' : ''}
      ${session?.phase === 'complete' ? '<hr><h3>End-of-session outcome feedback</h3><p class="hint">Export the session and trials CSVs, run scripts/score.py with the latest session CSV, then load the generated .debrief.json file. Outcomes are shown only after the questionnaire.</p><label>Completed-session debrief file<input id="debrief-file" type="file" accept="application/json,.json"></label><p id="debrief-status">'+(outcomes ? 'Outcome feedback loaded. Open Participant screen to show it.' : 'No outcome feedback file loaded.')+'</p>' : ''}
      <hr><h3>Study settings</h3><dl><dt>Trials</dt><dd>2 practices + 20 episodes</dd><dt>Transfer window</dt><dd>3 hours</dd><dt>Wind limit</dt><dd>5 m/s at 100 m</dd><dt>Costs</dt><dd>€5,000 cancel / €40,000 abort</dd></dl>
    </section></div>`, 'Researcher setup');
  $('#setup').onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    action(() => {
      const condition = form.get('condition') as Condition;
      const next = createSession(String(form.get('participant')), condition, form.get('mode') as Mode, Number(form.get('row')), data, renderers[condition].readyForStudy);
      return next;
    }, true);
  };
  $('#recover').onclick = () => {
    action(() => {
      const next = recover(saved!, data);
      if (next.mode !== 'simulated' && !renderers[next.condition].readyForStudy) throw Error('This real session cannot resume until its renderer is ready. Export its backup.');
      return next;
    }, true);
  };
  $('#backup').onclick = () => download(`taim-backup-${session?.id ?? 'saved'}.json`, session ? JSON.stringify(session, null, 2) : saved!, 'application/json');
  $('#delete-local').onclick = requestDelete;
  root.querySelector<HTMLInputElement>('#debrief-file')?.addEventListener('change', async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    const target = session;
    if (!file || !target) return;
    outcomes = undefined;
    try {
      if (file.size > 65536) throw Error('Choose the small .debrief.json file generated by the scorer.');
      const text = await file.text();
      if (session !== target || session.phase !== 'complete' || changedElsewhere) throw Error('Session changed; reload its debrief from the researcher screen.');
      outcomes = readOutcomeFeedback(text, target, data);
      render();
    } catch (e) {
      const status = root.querySelector('#debrief-status');
      if (status) status.textContent = 'No outcome feedback file loaded.';
      notice((e as Error).message);
    }
  });
  wireExports();
}
function results() {
  const s = session!;
  const rows = feedbackRows(s, data, outcomes);
  const money = (v: number) => new Intl.NumberFormat('en-IE', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0}).format(v);
  shell(`<section><p class="caption">Session complete</p><h1 tabindex="-1">Your decisions, explained.</h1>
    <p>All trials and your workload questionnaire are finished. This feedback does not change your saved answers.</p>
    <div class="costs"><div><strong>${rows.filter(r => r.goodDecision).length} / 20</strong><span>Choices that minimise expected cost</span></div><div><strong>${outcomes ? rows.filter(r => r.matchedOutcome).length+' / 20' : 'Pending'}</strong><span>Choices matching recorded weather outcomes</span></div><div><strong>${outcomes ? money(rows.reduce((sum, r) => sum + r.cost!, 0)) : 'Pending'}</strong><span>Total realised scenario cost</span></div></div>
    <p><strong>Decision quality</strong> uses the ensemble probability and the stated costs: GO has expected cost probability × €40,000, whereas CANCEL costs €5,000. GO minimises expected cost below 12.5%; CANCEL above it. This assumes minimising average monetary cost.</p>
    <p><strong>Outcome agreement</strong> compares your choice with the recorded weather: GO when wind stayed at or below the limit; CANCEL when it went above. A sensible decision can have an unlucky outcome. Cancelling still costs €5,000 even if the weather turns out safe. The scenario costs are fictional.</p>
    ${outcomes ? '' : '<p class="simulation-note">Decision-quality feedback is ready. Ask the researcher to load this completed session’s outcome debrief to show recorded weather and realised costs. Outcomes stay outside the participant app until that file is loaded.</p>'}
    <div class="results-table" role="region" aria-label="Per-trial results" tabindex="0"><table><caption>Your 20 measured decisions, in presentation order</caption><thead><tr><th scope="col">Trial</th><th scope="col">Your choice</th><th scope="col">Ensemble chance above limit</th><th scope="col">Cost-minimising choice</th><th scope="col">Decision quality</th><th scope="col">Recorded wind</th><th scope="col">Outcome agreement</th><th scope="col">Scenario cost</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${r.position}</th><td>${r.decision}</td><td>${Math.round(r.probability*100)}%</td><td>${r.recommended}</td><td>${r.goodDecision ? 'Matches rule' : 'Does not match rule'}</td><td>${r.observed === undefined ? 'Pending' : r.observed ? 'Above limit' : 'At/below limit'}</td><td>${r.matchedOutcome === undefined ? 'Pending' : r.matchedOutcome ? 'Matches outcome' : 'Does not match outcome'}</td><td>${r.cost === undefined ? 'Pending' : money(r.cost)}</td></tr>`).join('')}</tbody></table></div>
    <p>Participant code: <strong>${escape(s.participant)}</strong><br>Session code: <strong>${escape(s.id)}</strong></p><p>Keep these codes to request deletion of downloaded copies. You can still leave to withdraw your responses.</p><button id="delete-local">Delete local session</button></section>`, 'Results');
  $('#delete-local').onclick = requestDelete;
}
function consent() {
  shell(`<section class="reading"><p class="caption">Participant information and consent</p><h1 tabindex="-1">Your choice to take part.</h1>${CONSENT_HTML}
    <p class="hint">Information version: ${CONSENT_VERSION}</p><form id="consent"><label class="check"><input type="checkbox" name="agree" required> I have read this information, had an opportunity to ask questions, and freely agree to participate.</label><div class="actions"><button type="submit">I agree — continue to instructions</button><button type="button" id="decline">I do not consent</button></div></form></section>`, 'Consent');
  $('#consent').onsubmit = event => {event.preventDefault(); action(() => acceptConsent(session!, new FormData(event.target as HTMLFormElement).get('agree') === 'on'));};
  $('#decline').onclick = leave;
}
function wireExports() {
  root.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => button.onclick = () => {
    if (!session) return;
    const kind = button.dataset.export as keyof ReturnType<typeof exportsFor>;
    download(`${session.mode}-${session.participant}-${session.id}-${kind}.csv`, exportsFor(session)[kind]);
    button.textContent = `${kind[0].toUpperCase() + kind.slice(1)} CSV downloaded`;
  });
}
function instructions() {
  shell(`<section class="reading"><p class="caption">Before you begin</p><h1 tabindex="-1">Would you send the crew?</h1>
    <p class="lead">You are scheduling a helicopter transfer for maintenance on an offshore wind turbine.</p>
    <p>For this scenario, the transfer is blocked if wind at 100 m exceeds <strong>5 m/s</strong> during the highlighted <strong>3-hour transfer window</strong>. The preceding hours provide context.</p>
    <div class="costs"><div><strong>€5,000</strong><span>Cancel the transfer</span></div><div><strong>€40,000</strong><span>Send the crew, then abort because wind exceeds the limit</span></div><div><strong>€0</strong><span>Send the crew and wind stays safe</span></div></div>
    <p>For each episode, choose <strong>GO</strong> or <strong>CANCEL</strong>, then state how confident you are that your choice is correct (50–100%). On some episodes, also estimate the chance that wind exceeds 5 m/s (0–100%).</p>
    <p>Read the distribution of possible winds, not just a central value. You can edit a response before submitting it. After submission, it is locked and you cannot go back.</p>
    <p>First, complete two practice trials with feedback. Then complete 20 measured trials without feedback, followed by a short workload questionnaire. Your decisions are timed from when each chart appears until you submit.</p>
    ${session!.condition === 'IV-3' ? '<p>Each box summarizes ten possible wind speeds at one time: its bottom and top are the 25th and 75th percentiles (the middle 50%), the line inside is the median, and the whiskers reach the minimum and maximum. Individual member values are not shown. Read the box at zero hours for the transfer check; earlier boxes are context.</p>' : ''}
    ${session!.mode === 'simulated' ? `<p class="simulation-note">${renderers[session!.condition].implemented ? 'Practice uses synthetic examples. The 20 measured-trial screens draw the supplied wind episodes.' : 'This condition uses an empty chart frame; wind values are not drawn yet.'} These responses are for testing the interface only.</p>` : ''}
    <button id="start">Begin practice</button></section>`, 'Instructions');
  $('#start').onclick = () => action(() => begin(session!));
}
function trial() {
  const s = session!, item = current(s);
  const renderer = renderers[s.condition];
  const probability = !item.practice && PROBABILITY_EPISODES.includes(item.id);
  shell(`<div class="trial-heading"><div><p class="caption">${item.practice ? 'Practice' : 'Measured trial'}</p><h1 tabindex="-1">${item.practice ? `${item.position} of 2` : `${item.position} of 20`}</h1></div><p class="hint">Cancel €5,000<br>Go, then abort €40,000</p></div>
    <section class="chart-panel" aria-label="Wind chart"><div id="chart"></div>${renderer.implemented ? '' : '<p class="placeholder">Chart placeholder · wind values are not drawn</p>'}</section>
    ${s.condition === 'IV-3' ? '<p class="hint">Box: middle 50% · line inside: median · whiskers: minimum–maximum. Transfer check at 0 h; shaded window: 0 to +3 h.</p>' : ''}
    <form id="response"><fieldset><legend>Do you send the crew?</legend><div class="decisions"><label><input type="radio" name="decision" value="GO" required> GO <span>Send the crew</span></label><label><input type="radio" name="decision" value="CANCEL" required> CANCEL <span>Cancel the transfer</span></label></div></fieldset>
    <div class="fields"><label>Confidence that your choice is correct (%)<input type="number" name="confidence" min="50" max="100" step="any" required inputmode="decimal"><small>50 = as uncertain as a coin toss · 100 = completely confident</small></label>
    ${probability ? '<label>Chance that wind exceeds 5 m/s in the transfer window (%)<input type="number" name="probability" min="0" max="100" step="any" required inputmode="decimal"><small>0 = no chance · 100 = certain</small></label>' : ''}</div>
    <button type="submit" id="submit" disabled>Submit response</button><span class="hint save-note">Your response is locked after submission.</span></form>`, 'Trial');
  const episode = item.practice ? practiceEpisode(s.cursor) : data.episodes.find(e => e.id === item.id)!;
  const context = contextFor(data, episode);
  $('#chart').append(renderFrame(context, renderer.marks(context)));
  clockStart = undefined;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (session?.id !== s.id || researcher || session.phase !== 'trial' || session.attempts.at(-1)?.started !== s.attempts.at(-1)?.started) return;
    clockStart = performance.now();
    $('#submit').removeAttribute('disabled');
  }));
  $('#response').onsubmit = event => {
    event.preventDefault();
    if (clockStart === undefined || storageFailed) return;
    const elapsed = performance.now() - clockStart;
    const form = new FormData(event.target as HTMLFormElement);
    action(() => submit(session!, String(form.get('decision') ?? ''), String(form.get('confidence') ?? ''), String(form.get('probability') ?? ''), elapsed));
  };
}
const tlxLabels: Record<typeof TLX[number], [string, string]> = {
  mental: ['Mental demand', 'How mentally demanding was the task? 0 = very low; 100 = very high.'],
  physical: ['Physical demand', 'How physically demanding was the task? 0 = very low; 100 = very high.'],
  temporal: ['Temporal demand', 'How hurried or rushed was the pace? 0 = very low; 100 = very high.'],
  performance: ['Performance', 'How successful were you in accomplishing the task? 0 = perfect; 100 = failure.'],
  effort: ['Effort', 'How hard did you have to work to accomplish your level of performance? 0 = very low; 100 = very high.'],
  frustration: ['Frustration', 'How insecure, discouraged, irritated, stressed, or annoyed were you? 0 = very low; 100 = very high.']
};
function questionnaire() {
  shell(`<section class="reading"><p class="caption">Final questionnaire</p><h1 tabindex="-1">How did the task feel?</h1><p>Rate each dimension from 0 to 100. There are no preset answers.</p>
    <form id="questionnaire">${TLX.map(k => `<label>${tlxLabels[k][0]}<small>${tlxLabels[k][1]}</small><input name="${k}" type="number" min="0" max="100" step="5" required></label>`).join('')}
    <label>Comments (optional)<textarea name="comments" maxlength="4000" rows="4" placeholder="What helped you decide? What was difficult?"></textarea></label><button type="submit">Finish session</button></form></section>`, 'Questionnaire');
  $('#questionnaire').onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const q = Object.fromEntries([...TLX.map(k => [k, Number(form.get(k))]), ['comments', String(form.get('comments') ?? '')]]) as Questionnaire;
    action(() => finish(session!, q));
  };
}
function render() {
  if (researcher) {setup(); return;}
  if (!session) {researcher = true; setup(); return;}
  switch (session.phase) {
    case 'consent': consent(); break;
    case 'instructions': instructions(); break;
    case 'trial': trial(); break;
    case 'feedback': {
      const a = session.attempts.at(-1)!;
      const expected = a.episode === 'practice-1' ? 'GO' : 'CANCEL';
      shell(`<section class="reading"><p class="caption">Practice feedback</p><h1 tabindex="-1">${expected === 'GO' ? 'A clearly safe example' : 'A clearly unsafe example'}</h1><p>Your choice: <strong>${a.decision}</strong>.</p><p>The synthetic winds are ${expected === 'GO' ? 'all below' : 'all above'} the 5 m/s limit. <strong>${expected}</strong> is the lower-cost choice for this practice example.</p><p>Practice feedback is not shown during the measured trials.</p><button id="next">Continue</button></section>`, 'Practice feedback');
      $('#next').onclick = () => action(() => finishPractice(session!)); break;
    }
    case 'between': {
      const n = Math.max(0, session.cursor - 2);
      shell(`<section class="reading"><p class="caption">Response saved</p><h1 tabindex="-1">${session.cursor === 2 ? 'Practice complete.' : 'Ready to continue.'}</h1><p>${session.cursor < 2 ? 'One practice trial remains.' : `${n} of 20 measured trials completed.`}</p><button id="next">${session.cursor === 22 ? 'Open questionnaire' : session.cursor === 2 ? 'Begin measured trials' : 'Next trial'}</button></section>`, 'Response saved');
      $('#next').onclick = () => action(() => begin(session!)); break;
    }
    case 'questionnaire': questionnaire(); break;
    case 'complete':
      results(); break;
    case 'declined':
    case 'withdrawn':
      shell(`<section class="reading"><p class="caption">Participation ended</p><h1 tabindex="-1">${session.phase === 'declined' ? 'You chose not to take part.' : 'You have left the experiment.'}</h1><p>No more answers are required. Your recorded responses and questionnaire have been discarded from this session; only its consent/exit record remains if saving succeeded. This session cannot resume.</p><p>Participant code: <strong>${escape(session.participant)}</strong><br>Session code: <strong>${escape(session.id)}</strong></p><p>Ask the supervising researcher to remove any previously downloaded CSVs, backups and scored copies using these codes. Local deletion cannot remove those files.</p><button id="delete-local">Delete local session</button></section>`, 'Participation ended');
      $('#delete-local').onclick = requestDelete; break;
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || researcher || session?.phase !== 'trial') return;
  const next = structuredClone(session);
  next.attempts.at(-1)!.flags.push('page-hidden');
  // Keep the running clock; hidden time is retained and flagged for exclusion decisions.
  commit(next); // Keep the form and clock intact while recording the visibility flag.
});
// shortcut: storage events catch other-tab writes, use one tab until collection needs concurrent sessions.
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  changedElsewhere = true;
  notice('Another tab changed the saved session. Export a JSON backup from this tab, then reload.');
});
window.addEventListener('pagehide', () => {
  if (!changedElsewhere && session?.phase === 'trial') {
    const next = structuredClone(session); next.attempts.at(-1)!.flags.push('page-unloaded');
    try { save(localStorage, next); } catch { /* The last durable active attempt is recoverable. */ }
  }
});
try { saved = localStorage.getItem(STORAGE_KEY); }
catch { storageFailed = true; }
render();
if (storageFailed) notice('Browser storage is unavailable. Sessions cannot start until storage is enabled.');
