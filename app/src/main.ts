import './style.css';
import source from './generated/stimuli.json';
import {acceptConsent, begin, createSession, current, deleteLocal, exportsFor, finish, markResultsViewed, parseRating, PROBABILITY_EPISODES,
  recover, save, STORAGE_KEY, submit, submitDemographics, TLX, withdraw} from './core.ts';
import {CONSENT_HTML, CONSENT_VERSION} from './consent.ts';
import type {Condition, Dataset, Demographics, Mode, Questionnaire, Session} from './core.ts';
import {contextFor, renderFrame} from './chart/frame.ts';
import {iv3} from './chart/iv3.ts';
import {iv4} from './chart/iv4.ts';
import {feedbackRows} from './feedback.ts';

const data: Dataset = source;
const renderers = { 'IV-3': iv3, 'IV-4': iv4 };
const root = document.querySelector<HTMLDivElement>('#app')!;
let session: Session | undefined;
let saved: string | null = null;
let researcher = true;
let clockStart: number | undefined;
let busy = false;
let storageFailed = false;
let changedElsewhere = false;
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
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
  try {
    save(localStorage, next); session = next; saved = JSON.stringify(next); storageFailed = false;
    return true;
  }
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
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function shell(content: string, title: string) {
  root.innerHTML = `<header class="topbar"><div class="wrap topbar-inner"><span class="brand"><span class="brand-mark" aria-hidden="true"></span><span><strong>TAIM</strong> / Wind transfer experiment</span></span></div>
    ${session?.mode === 'simulated' ? '<div class="simulation" role="note"><span class="tag">Simulation</span><span>Simulated session · not participant evidence</span></div>' : ''}</header>
    <main class="wrap"><div id="error" role="alert" tabindex="-1"></div>${content}</main>
    <footer><div class="wrap">TAIM 2026–27 · IV-B <span>Generated using Copernicus Climate Change Service information 2026. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.</span></div></footer>
    <dialog id="delete-dialog" aria-labelledby="delete-title"><h2 id="delete-title">Delete this browser’s session?</h2><p>This permanently removes its local responses, consent and session record. It cannot delete CSVs, JSON backups or scored files already downloaded. Ask the researcher to remove those copies using your session code.</p><p id="delete-reference"></p><div class="actions"><button class="secondary" id="keep-local">Keep local data</button><button class="danger" id="confirm-delete">Delete local data</button></div></dialog>`;
  $('#keep-local').onclick = () => $<HTMLDialogElement>('#delete-dialog').close();
  $('#confirm-delete').onclick = () => {
    try {
      if (changedElsewhere || localStorage.getItem(STORAGE_KEY) !== saved) throw Error('Another tab changed the saved session. Reload before deleting so you can check the target.');
      deleteLocal(localStorage);
      clockStart = undefined; session = undefined; saved = null; researcher = true; storageFailed = false;
      render(); notice('Local session deleted. Downloaded files and backups were not deleted; ask the researcher to remove those copies separately.');
    } catch (e) { $<HTMLDialogElement>('#delete-dialog').close(); notice((e as Error).message); }
  };
  document.title = `${title} · TAIM`;
  root.querySelector<HTMLElement>('h1')?.focus();
}
function requestDelete() {
  $('#delete-reference').textContent = session ? `Participant code: ${session.participant}. Session code: ${session.id}. Keep these codes to request removal of downloaded copies.` : 'This will remove the saved experiment session on this browser. Export its backup first if you need to identify downloaded copies.';
  $<HTMLDialogElement>('#delete-dialog').showModal();
}
function leave() {
  if (!session) return;
  clockStart = undefined;
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
  const status = session ? `${escape(session.participant)} · ${escape(session.condition)} · ${escape(session.phase)}` : saved ? 'A saved session is available on this browser.' : 'No saved session on this browser.';
  shell(`<section class="page-head"><p class="eyebrow">Researcher screen</p><h1 tabindex="-1">Session setup</h1>
    <p class="lead">Prepare a supervised session for the offshore wind-transfer task. Participants should not operate this screen.</p></section>
    <div class="setup-grid"><section class="card" aria-labelledby="start-title"><h2 id="start-title">Start a session</h2>
    <form id="setup">
      <label>Anonymous participant ID<input name="participant" required pattern="(?:[A-Za-z0-9_]|-){1,32}" maxlength="32" placeholder="For example, P01" autocomplete="off"></label>
      <div class="fields"><label>Condition<select name="condition"><option>IV-3</option><option>IV-4</option></select></label>
      <label>Order row<input name="row" type="number" min="1" max="20" step="1" value="1" required></label></div>
      <label>Session mode<select name="mode"><option value="simulated">Simulated walkthrough</option><option value="pilot">Real pilot (blocked)</option><option value="study">Real study (blocked)</option></select></label>
      <p class="hint">IV-3 draws box plots and IV-4 draws unconnected member dots from the supplied data. Real sessions remain blocked pending pilot review. Use matching order rows across conditions.</p>
      <label class="check"><input name="replace" type="checkbox" ${saved || session ? 'required' : ''}> I have exported any previous session before replacing it.</label>
      <div class="actions"><button type="submit">Start simulated session</button></div>
    </form></section>
    <div class="stack"><section class="card" aria-labelledby="saved-title"><div class="card-head"><h2 id="saved-title">Saved work</h2><span class="status${saved || session ? ' on' : ''}">${saved || session ? 'Stored locally' : 'Empty'}</span></div><p id="saved-status">${status}</p>
      <div class="actions"><button class="secondary" id="recover" ${saved ? '' : 'disabled'}>Recover saved session</button><button class="secondary" id="backup" ${saved || session ? '' : 'disabled'}>Export JSON backup</button><button class="danger" id="delete-local" ${saved || session ? '' : 'disabled'}>Delete local session</button></div></section>
      <section class="card" aria-labelledby="settings-title"><h2 id="settings-title">Study settings</h2><dl class="settings"><dt>Trials</dt><dd>20 episodes</dd><dt>Transfer window</dt><dd>3 hours</dd><dt>Wind limit</dt><dd>5 m/s at 100 m</dd><dt>Costs</dt><dd>€5,000 cancel / €40,000 abort</dd></dl></section>
    </div></div>`, 'Researcher setup');
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
}
function results() {
  const s = session!;
  const rows = feedbackRows(s, data);
  const totalDurationMs = s.attempts
    .filter(a => a.status === 'submitted')
    .reduce((sum, a) => sum + (a.durationMs ?? 0), 0);
  const totalSec = Math.round(totalDurationMs / 1000);
  const totalDurationStr = totalSec >= 60
    ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
    : `${totalSec}s`;
  const money = (v: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const badge = (ok: boolean, yes: string, no: string) => `<span class="badge ${ok ? 'good' : 'bad'}"><span aria-hidden="true">${ok ? '✓' : '✕'}</span>${ok ? yes : no}</span>`;
  shell(`<section class="page-head"><p class="eyebrow">Session complete</p><h1 tabindex="-1">Your decisions, explained.</h1>
    <p class="lead">All trials and your workload questionnaire are finished. Total time elapsed: <strong>${totalDurationStr}</strong>. This feedback does not change your saved answers.</p></section>
    <div class="result-groups"><section class="card result-group" aria-labelledby="quality-title"><p class="eyebrow">Measure 1</p><h2 id="quality-title">Decision quality</h2>
      <div class="stat-row"><p class="stat"><strong>${rows.filter(r => r.goodDecision).length} / 20</strong><span>Choices that minimise expected cost</span></p><p class="stat"><strong>${totalDurationStr}</strong><span>Total time elapsed</span></p></div>
      <p><strong>Decision quality</strong> uses the ensemble probability and the stated costs: GO has expected cost probability × €40,000, whereas CANCEL costs €5,000. GO minimises expected cost below 12.5%; CANCEL above it. This assumes minimising average monetary cost.</p></section>
    <section class="card result-group" aria-labelledby="outcome-title"><p class="eyebrow">Measure 2</p><h2 id="outcome-title">Outcome agreement</h2>
      <div class="stat-row"><p class="stat"><strong>${rows.filter(r => r.matchedOutcome).length} / 20</strong><span>Choices matching recorded weather outcomes</span></p><p class="stat"><strong>${money(rows.reduce((sum, r) => sum + r.cost!, 0))}</strong><span>Total realised scenario cost</span></p></div>
      <p><strong>Outcome agreement</strong> compares your choice with the recorded weather: GO when wind stayed at or below the limit; CANCEL when it went above. A sensible decision can have an unlucky outcome. Cancelling still costs €5,000 even if the weather turns out safe. The scenario costs are fictional.</p>
      <p class="simulation-note">Recorded outcomes are disclosed only after the questionnaire.</p></section></div>
    <div class="results-table" role="region" aria-label="Per-trial results" tabindex="0"><table><caption>Your 20 measured decisions, in presentation order</caption>
    <colgroup span="2"></colgroup><colgroup span="3"></colgroup><colgroup span="3"></colgroup>
    <thead><tr><td colspan="2"></td><th scope="colgroup" colspan="3" class="group-start">Decision quality</th><th scope="colgroup" colspan="3" class="group-start">Outcome agreement</th></tr>
    <tr><th scope="col">Trial</th><th scope="col">Your choice</th><th scope="col" class="group-start">Ensemble chance above limit</th><th scope="col">Cost-minimising choice</th><th scope="col">Decision quality</th><th scope="col" class="group-start">Recorded wind</th><th scope="col">Outcome agreement</th><th scope="col">Scenario cost</th></tr></thead>
    <tbody>${rows.map(r => `<tr><th scope="row">${r.position}</th><td class="choice-tag">${r.decision}</td><td class="group-start">${Math.round(r.probability * 100)}%</td><td>${r.recommended}</td><td>${badge(r.goodDecision, 'Matches rule', 'Does not match rule')}</td><td class="group-start">${r.observed ? 'Above limit' : 'At/below limit'}</td><td>${badge(r.matchedOutcome, 'Matches outcome', 'Does not match outcome')}</td><td>${money(r.cost)}</td></tr>`).join('')}</tbody></table></div>
    <section class="card" aria-labelledby="codes-title"><h2 id="codes-title">Your session codes</h2><dl class="codes"><dt>Participant code</dt><dd>${escape(s.participant)}</dd><dt>Session code</dt><dd>${escape(s.id)}</dd></dl>
    <p>Keep these codes to request deletion of downloaded copies.</p></section>`, 'Results');
}
function handoff() {
  const s = session!;
  shell(`<section class="reading"><div class="page-head"><p class="eyebrow">Facilitator handoff</p><h1 tabindex="-1">Session complete — export and handoff</h1>
    <p class="lead">Participant <strong>${escape(s.participant)}</strong> has finished viewing results. This screen is for the supervising facilitator only.</p></div>
    <div class="stack">
      <section class="card" aria-labelledby="exports-title"><h2 id="exports-title">Researcher exports</h2>
        <p class="hint">Export all three CSV files separately, then verify in your downloads folder that all three files exist and are non-empty before replacing this session.</p>
        <p class="callout"><strong>Verify all three downloaded CSVs before starting the next session.</strong> This completed session remains stored in browser storage until the next session is saved.</p>
        <div class="actions"><button class="secondary" data-export="session">Session CSV</button><button class="secondary" data-export="trials">Trials CSV</button><button class="secondary" data-export="questionnaire">Questionnaire CSV</button></div>
      </section>
      <section class="card" aria-labelledby="handoff-codes-title"><h2 id="handoff-codes-title">Completed session</h2>
        <dl class="codes"><dt>Participant code</dt><dd>${escape(s.participant)}</dd><dt>Session code</dt><dd>${escape(s.id)}</dd><dt>Condition</dt><dd>${escape(s.condition)}</dd><dt>Mode</dt><dd>${escape(s.mode)}</dd></dl>
        <div class="actions"><button id="start-next">Start next session</button></div>
      </section>
    </div></section>`, 'Facilitator handoff');
  wireExports();
  $('#start-next').onclick = () => {
    researcher = true;
    render();
  };
}
function consent() {
  shell(`<section class="reading"><div class="page-head"><p class="eyebrow">Participant information and consent</p><h1 tabindex="-1">Your choice to take part.</h1></div><div class="prose">${CONSENT_HTML}</div>
    <form id="consent" class="consent-box"><h2>Consent</h2><label class="check"><input type="checkbox" name="agree" required> I have read this information, had an opportunity to ask questions, and freely agree to participate.</label><div class="actions"><button type="submit">I agree — continue</button><button type="button" class="secondary" id="decline">I do not consent</button></div></form>
    <p class="version">Information version: ${CONSENT_VERSION}</p></section>`, 'Consent');
  $('#consent').onsubmit = event => { event.preventDefault(); action(() => acceptConsent(session!, new FormData(event.target as HTMLFormElement).get('agree') === 'on')); };
  $('#decline').onclick = leave;
}
function demographics() {
  shell(`<section class="reading centered demographics-section">
    <div class="page-head"><h1 tabindex="-1" class="accent-title">About you</h1></div>
    <form id="demographics-form" class="demographics-form">
      <fieldset class="demo-group">
        <legend class="demo-legend">Age</legend>
        <div class="pill-group">
          ${['18-20', '21-23', '24-26', '27-30', '31 or more', 'Prefer not to say'].map(v =>
            `<label class="pill-option"><input type="radio" name="age" value="${v}" required><span>${v}</span></label>`
          ).join('')}
        </div>
      </fieldset>

      <fieldset class="demo-group">
        <legend class="demo-legend">Field of study or work</legend>
        <div class="pill-group">
          ${['Computing / informatics', 'Other engineering', 'Design / multimedia', 'Other'].map(v =>
            `<label class="pill-option"><input type="radio" name="field" value="${v}" required><span>${v}</span></label>`
          ).join('')}
        </div>
      </fieldset>

      <fieldset class="demo-group">
        <legend class="demo-legend">How familiar are you with reading statistical charts?</legend>
        <div class="scale-wrap">
          <div class="scale-boxes">
            ${[1, 2, 3, 4, 5].map(v =>
              `<label class="scale-option"><input type="radio" name="chartFamiliarity" value="${v}" required><span>${v}</span></label>`
            ).join('')}
          </div>
          <div class="scale-labels">
            <span>not at all</span>
            <span>very</span>
          </div>
        </div>
      </fieldset>

      <fieldset class="demo-group">
        <legend class="demo-legend">How familiar are you with weather forecasts for outdoor activities (sailing, flying, hiking...)?</legend>
        <div class="scale-wrap">
          <div class="scale-boxes">
            ${[1, 2, 3, 4, 5].map(v =>
              `<label class="scale-option"><input type="radio" name="weatherFamiliarity" value="${v}" required><span>${v}</span></label>`
            ).join('')}
          </div>
          <div class="scale-labels">
            <span>not at all</span>
            <span>very</span>
          </div>
        </div>
      </fieldset>

      <fieldset class="demo-group">
        <legend class="demo-legend">Do you have normal colour vision?</legend>
        <div class="pill-group">
          ${['Yes', 'No', "Don't know"].map(v =>
            `<label class="pill-option"><input type="radio" name="normalColorVision" value="${v}" required><span>${v}</span></label>`
          ).join('')}
        </div>
      </fieldset>

      <div class="actions centered" style="margin-top: 1.5rem;">
        <button type="submit" id="continue-demo">Continue</button>
      </div>
    </form>
  </section>`, 'About you');

  $('#demographics-form').onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const demo = {
      age: String(form.get('age') ?? ''),
      field: String(form.get('field') ?? ''),
      chartFamiliarity: Number(form.get('chartFamiliarity')),
      weatherFamiliarity: Number(form.get('weatherFamiliarity')),
      normalColorVision: String(form.get('normalColorVision') ?? '')
    };
    action(() => submitDemographics(session!, demo));
  };
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
  shell(`<section class="reading"><div class="page-head"><p class="eyebrow">Before you begin</p><h1 tabindex="-1">Would you send the crew?</h1>
    <p class="lead">You are scheduling a helicopter transfer for maintenance on an offshore wind turbine.</p></div>
    <h2>The scenario</h2>
    <p>For this scenario, the transfer is blocked if wind at 100 m exceeds <strong>5 m/s</strong> during the highlighted <strong>3-hour transfer window</strong>. The preceding hours provide context.</p>
    <div class="costs"><div><strong>€5,000</strong><span>Cancel the transfer</span></div><div><strong>€40,000</strong><span>Send the crew, then abort because wind exceeds the limit</span></div><div><strong>€0</strong><span>Send the crew and wind stays safe</span></div></div>
    <h2>For each episode</h2>
    <ol class="steps"><li>Choose <strong>GO</strong> or <strong>CANCEL</strong>.</li><li>State how confident you are that your choice is correct (50–100%).</li><li>On some episodes, also estimate the chance that wind exceeds 5 m/s (0–100%).</li></ol>
    <p>Read the distribution of possible winds, not just a central value. You can edit a response before submitting it. After submission, it is locked and you cannot go back.</p>
    ${session!.condition === 'IV-3' ? '<h2>Reading the chart</h2><p>Each box summarizes ten possible wind speeds at one time: its bottom and top are the 25th and 75th percentiles (the middle 50%), the line inside is the median, and the whiskers reach the minimum and maximum. Individual member values are not shown. Read the box at zero hours for the transfer check; earlier boxes are context.</p>' : session!.condition === 'IV-4' ? '<h2>Reading the chart</h2><p>Each dot represents one ensemble member at the midpoint of a 3-hour interval. The dots are not connected between timesteps. Read the dots at zero hours for the transfer check; earlier dots are context.</p>' : ''}
    <h2>Session outline</h2>
    <p>Complete 20 measured trials, followed by a short workload questionnaire. Your decisions are timed from when each chart appears until you submit.</p>
    ${session!.mode === 'simulated' ? `<p class="simulation-note">The 20 measured-trial screens draw the supplied wind episodes. These responses are for testing the interface only.</p>` : ''}
    <div class="actions"><button id="start">Begin trials</button></div></section>`, 'Instructions');
  $('#start').onclick = () => action(() => begin(session!));
}
interface RatingSpec {
  name: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}
function ratingControl({name, label, hint, min, max, step}: RatingSpec): string {
  const midpoint = (min + max) / 2;
  const labelId = `rating-${name}-label`;
  const hintId = `rating-${name}-hint`;
  const rangeId = `rating-${name}-range`;
  const numberId = `rating-${name}-number`;
  return `<div class="rating-field" data-rating="${escape(name)}" data-answered="false">
    <label class="rating-label" for="${escape(numberId)}" id="${escape(labelId)}">${escape(label)}</label>
    <small id="${escape(hintId)}">${escape(hint)}</small>
    <div class="rating-controls">
      <div class="rating-slider-wrap">
        <input type="range" class="rating-range" id="${escape(rangeId)}" min="${min}" max="${max}" step="${step}" value="${midpoint}" aria-labelledby="${escape(labelId)}" aria-describedby="${escape(hintId)}">
        <div class="rating-bounds" aria-hidden="true"><span>${min}</span><span>${max}</span></div>
      </div>
      <input type="number" class="rating-number" id="${escape(numberId)}" name="${escape(name)}" min="${min}" max="${max}" step="${step}" required inputmode="numeric" aria-describedby="${escape(hintId)}">
    </div>
  </div>`;
}
function wireRatings(container: ParentNode) {
  container.querySelectorAll<HTMLElement>('[data-rating]').forEach(field => {
    const range = field.querySelector<HTMLInputElement>('.rating-range')!;
    const number = field.querySelector<HTMLInputElement>('.rating-number')!;
    const min = Number(range.min), max = Number(range.max), step = Number(range.step);
    const setAnswered = (answered: boolean) => {
      field.dataset.answered = answered ? 'true' : 'false';
    };
    const commitFromRange = () => {
      number.value = range.value;
      setAnswered(true);
    };
    range.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      commitFromRange();
    });
    range.addEventListener('input', commitFromRange);
    number.addEventListener('input', () => {
      const raw = number.value.trim();
      if (!raw) {
        setAnswered(false);
        return;
      }
      try {
        const parsed = parseRating(raw, min, max, step);
        range.value = String(parsed);
        setAnswered(true);
      } catch {
        setAnswered(false);
      }
    });
  });
}
function trial() {
  const s = session!, item = current(s);
  const renderer = renderers[s.condition];
  const probability = PROBABILITY_EPISODES.includes(item.id);
  const total = 20;
  shell(`<div class="trial-head"><div><p class="eyebrow">Measured trial</p><h1 tabindex="-1">Trial ${item.position} <span>of ${total}</span></h1><div class="progress" aria-hidden="true"><span style="width: ${(item.position - 1) / total * 100}%"></span></div></div><ul class="cost-chips" aria-label="Scenario costs"><li>Cancel <strong>€5,000</strong></li><li>Go, then abort <strong>€40,000</strong></li></ul></div>
    <section class="chart-card" aria-label="Wind chart"><div id="chart"></div>${renderer.implemented ? '' : '<p class="placeholder">Chart placeholder · wind values are not drawn</p>'}
    ${s.condition === 'IV-3' ? '<p class="chart-note">Box: middle 50% · line inside: median · whiskers: minimum–maximum. Transfer check at 0 h; shaded window: 0 to +3 h.</p>' : s.condition === 'IV-4' ? '<p class="chart-note">One dot per ensemble member at the midpoint of each 3-hour interval · dots are not connected. Transfer check at 0 h; shaded window: 0 to +3 h.</p>' : ''}</section>
    <form id="response" class="response card"><fieldset><legend>Do you send the crew?</legend><div class="decisions"><label><input type="radio" name="decision" value="GO" required><span class="choice"><b>GO</b><span>Send the crew</span></span></label><label><input type="radio" name="decision" value="CANCEL" required><span class="choice"><b>CANCEL</b><span>Cancel the transfer</span></span></label></div></fieldset>
    <div class="fields">${ratingControl({name: 'confidence', label: 'Confidence that your choice is correct (%)', hint: '50 = as uncertain as a coin toss · 100 = completely confident', min: 50, max: 100, step: 1})}
    ${probability ? ratingControl({name: 'probability', label: 'Chance that wind exceeds 5 m/s in the transfer window (%)', hint: '0 = no chance · 100 = certain', min: 0, max: 100, step: 1}) : ''}</div>
    <div class="submit-row"><button type="submit" id="submit" disabled>Submit response</button><span class="hint">Your response is locked after submission.</span></div></form>`, 'Trial');
  wireRatings($('#response'));
  const episode = data.episodes.find(e => e.id === item.id)!;
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
  shell(`<section class="reading"><div class="page-head"><p class="eyebrow">Final questionnaire</p><h1 tabindex="-1">How did the task feel?</h1><p class="lead">Rate each dimension from 0 to 100, in steps of 5. There are no preset answers.</p></div>
    <form id="questionnaire"><div class="tlx">${TLX.map(k => ratingControl({name: k, label: tlxLabels[k][0], hint: tlxLabels[k][1], min: 0, max: 100, step: 5})).join('')}</div>
    <label>Comments (optional)<textarea name="comments" maxlength="4000" rows="4" placeholder="What helped you decide? What was difficult?"></textarea><small>Do not include names or other identifying information. Maximum 4,000 characters.</small></label><div class="form-foot"><button type="submit">Finish session</button></div></form></section>`, 'Questionnaire');
  wireRatings($('#questionnaire'));
  $('#questionnaire').onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    action(() => {
      const q = Object.fromEntries([
        ...TLX.map(k => [k, parseRating(String(form.get(k) ?? ''), 0, 100, 5)]),
        ['comments', String(form.get('comments') ?? '')]
      ]) as Questionnaire;
      return finish(session!, q);
    });
  };
}
function render() {
  if (researcher) { setup(); return; }
  if (!session) { researcher = true; setup(); return; }
  switch (session.phase) {
    case 'consent': consent(); break;
    case 'demographics': demographics(); break;
    case 'instructions': instructions(); break;
    case 'trial': trial(); break;
    case 'between': {
      const n = session.cursor;
      shell(`<section class="reading centered"><div class="done-mark" aria-hidden="true">✓</div><p class="eyebrow">Response saved</p><h1 tabindex="-1">Ready to continue.</h1><p>${n} of 20 measured trials completed.</p><div class="progress" aria-hidden="true"><span style="width: ${n / 20 * 100}%"></span></div><div class="actions"><button id="next">${session.cursor === 20 ? 'Open questionnaire' : 'Next trial'}</button></div></section>`, 'Response saved');
      $('#next').onclick = () => action(() => begin(session!)); break;
    }
    case 'questionnaire': questionnaire(); break;
    case 'complete':
      if (session.resultsViewed) handoff();
      else {
        results();
        const done = document.createElement('div');
        done.className = 'actions';
        done.innerHTML = '<button id="done-results">Done viewing results</button>';
        done.querySelector<HTMLButtonElement>('#done-results')!.onclick = () => action(() => markResultsViewed(session!));
        root.querySelector('main')?.append(done);
      }
      break;
    case 'declined':
    case 'withdrawn':
      shell(`<section class="reading"><div class="page-head"><p class="eyebrow">Participation ended</p><h1 tabindex="-1">${session.phase === 'declined' ? 'You chose not to take part.' : 'You have left the experiment.'}</h1><p class="lead">No more answers are required.</p></div><p>Your recorded responses and questionnaire have been discarded from this session; only its consent/exit record remains if saving succeeded. This session cannot resume.</p>
        <section class="card" aria-labelledby="codes-title"><h2 id="codes-title">Your session codes</h2><dl class="codes"><dt>Participant code</dt><dd>${escape(session.participant)}</dd><dt>Session code</dt><dd>${escape(session.id)}</dd></dl><p>Ask the supervising researcher to discard the local session from setup and remove any previously downloaded CSVs, backups and scored copies using these codes.</p></section></section>`, 'Participation ended');
      break;
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
