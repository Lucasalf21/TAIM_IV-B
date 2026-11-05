import './style.css';
import source from './generated/stimuli.json';
import {begin, createSession, current, exportsFor, finish, finishPractice, PROBABILITY_EPISODES,
  recover, save, STORAGE_KEY, submit, TLX} from './core.ts';
import type {Condition, Dataset, Mode, Questionnaire, Session} from './core.ts';
import {contextFor, practiceEpisode, renderFrame} from './chart/frame.ts';
import {iv3} from './chart/iv3.ts';
import {iv4} from './chart/iv4.ts';

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
  try { save(localStorage, next); session = next; saved = JSON.stringify(next); storageFailed = false; return true; }
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
  root.innerHTML = `<header><span class="brand">TAIM / Wind transfer experiment</span><button class="quiet" id="researcher">${researcher ? 'Participant screen' : 'Researcher screen'}</button></header>
    ${session?.mode === 'simulated' ? '<aside class="simulation">Simulated session · placeholder chart · not participant evidence</aside>' : ''}
    <main><div id="error" role="alert" tabindex="-1"></div>${content}</main>
    <footer>TAIM 2026–27 · IV-B <span>Generated using Copernicus Climate Change Service information 2026. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.</span></footer>`;
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
function setup() {
  shell(`<section class="intro"><p class="caption">Researcher setup</p><h1 tabindex="-1">One experiment.<br>Two ways to see uncertainty.</h1>
    <p class="lead">Prepare a supervised session for the offshore wind-transfer task.</p></section>
    <div class="setup-grid"><section class="panel"><h2>Start a session</h2>
    <form id="setup">
      <label>Anonymous participant ID<input name="participant" required pattern="[A-Za-z0-9_-]{1,32}" maxlength="32" placeholder="For example, P01" autocomplete="off"></label>
      <div class="fields"><label>Condition<select name="condition"><option>IV-3</option><option>IV-4</option></select></label>
      <label>Order row<input name="row" type="number" min="1" max="20" step="1" value="1" required></label></div>
      <label>Session mode<select name="mode"><option value="simulated">Simulated walkthrough</option><option value="pilot">Real pilot (blocked)</option><option value="study">Real study (blocked)</option></select></label>
      <p class="hint">Both chart renderers are placeholders. Real pilot and study sessions are blocked. Use matching order rows across conditions.</p>
      <label class="check"><input name="replace" type="checkbox" ${saved || session ? 'required' : ''}> I have exported any previous session before replacing it.</label>
      <button type="submit">Start simulated session</button>
    </form></section>
    <section class="panel"><h2>Saved work</h2><p id="saved-status">${session ? `${escape(session.participant)} · ${escape(session.condition)} · ${escape(session.phase)}` : saved ? 'A saved session is available on this browser.' : 'No saved session on this browser.'}</p>
      <div class="actions"><button id="recover" ${saved ? '' : 'disabled'}>Recover saved session</button><button id="backup" ${saved || session ? '' : 'disabled'}>Export JSON backup</button></div>
      ${session ? '<h3>Researcher exports</h3><p class="hint">Export all three files separately. Practice and interrupted attempts remain marked. Back up files after every session.</p><div class="actions"><button data-export="session">Session CSV</button><button data-export="trials">Trials CSV</button><button data-export="questionnaire">Questionnaire CSV</button></div>' : ''}
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
  wireExports();
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
    ${session!.mode === 'simulated' ? '<p class="simulation-note">This walkthrough uses an empty chart frame. Practice feedback describes the synthetic examples, but the wind values are not drawn yet. These responses are for testing the interface only.</p>' : ''}
    <button id="start">Begin practice</button></section>`, 'Instructions');
  $('#start').onclick = () => action(() => begin(session!));
}
function trial() {
  const s = session!, item = current(s);
  const probability = !item.practice && PROBABILITY_EPISODES.includes(item.id);
  shell(`<div class="trial-heading"><div><p class="caption">${item.practice ? 'Practice' : 'Measured trial'}</p><h1 tabindex="-1">${item.practice ? `${item.position} of 2` : `${item.position} of 20`}</h1></div><p class="hint">Cancel €5,000<br>Go, then abort €40,000</p></div>
    <section class="chart-panel" aria-label="Wind chart"><div id="chart"></div><p class="placeholder">Chart placeholder · wind values are not drawn</p></section>
    <form id="response"><fieldset><legend>Do you send the crew?</legend><div class="decisions"><label><input type="radio" name="decision" value="GO" required> GO <span>Send the crew</span></label><label><input type="radio" name="decision" value="CANCEL" required> CANCEL <span>Cancel the transfer</span></label></div></fieldset>
    <div class="fields"><label>Confidence that your choice is correct (%)<input type="number" name="confidence" min="50" max="100" step="any" required inputmode="decimal"><small>50 = as uncertain as a coin toss · 100 = completely confident</small></label>
    ${probability ? '<label>Chance that wind exceeds 5 m/s in the transfer window (%)<input type="number" name="probability" min="0" max="100" step="any" required inputmode="decimal"><small>0 = no chance · 100 = certain</small></label>' : ''}</div>
    <button type="submit" id="submit" disabled>Submit response</button><span class="hint save-note">Your response is locked after submission.</span></form>`, 'Trial');
  const episode = item.practice ? practiceEpisode(s.cursor) : data.episodes.find(e => e.id === item.id)!;
  const context = contextFor(data, episode);
  $('#chart').append(renderFrame(context, s.mode === 'simulated' ? [] : renderers[s.condition].marks(context)));
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
      shell('<section class="reading"><p class="caption">Session complete</p><h1 tabindex="-1">Thank you.</h1><p>Your responses have been saved on this browser. Please hand the laptop back to the researcher so they can export the session.</p></section>', 'Complete'); break;
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
