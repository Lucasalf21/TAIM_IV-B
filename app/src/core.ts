export type Condition = 'IV-3' | 'IV-4';
export type Mode = 'simulated' | 'pilot' | 'study';
export type Decision = 'GO' | 'CANCEL';
import {COMPATIBLE_CONSENT_VERSIONS, CONSENT_VERSION} from './consent.ts';
const hasAcceptedConsent = (s: Session) => !!s.consent && (COMPATIBLE_CONSENT_VERSIONS as readonly string[]).includes(s.consent.version);
export type Phase = 'consent' | 'demographics' | 'instructions' | 'trial' | 'feedback' | 'between' | 'questionnaire' | 'complete' | 'declined' | 'withdrawn';
export interface Episode {id: string; hours: number[]; members: number[][]; windowStart: number; observed?: number}
export interface Dataset {version: string; threshold: number; windowHours: number; episodes: Episode[]}
export const PROTOCOL = 'ivb-template-4';
export const STORAGE_KEY = 'taim-ivb-session-v1';
export const PROBABILITY_EPISODES = ['E01', 'E07', 'E10', 'E13', 'E16'];
export const TLX = ['mental', 'physical', 'temporal', 'performance', 'effort', 'frustration'] as const;
export type Questionnaire = Record<typeof TLX[number], number> & {comments: string};
export interface Demographics {
  age: string;
  field: string;
  chartFamiliarity: number;
  weatherFamiliarity: number;
  normalColorVision: string;
}
export interface Attempt {
  episode: string; practice: boolean; position: number; attempt: number;
  started: string; ended?: string; status: 'active' | 'interrupted' | 'submitted';
  repeated: boolean; decision?: Decision; confidence?: number; probability?: number;
  durationMs?: number; flags: string[];
}
export interface Session {
  schema: 1; protocol: string; dataset: string; id: string; participant: string;
  condition: Condition; mode: Mode; orderRow: number; sequence: string[];
  created: string; phase: Phase; cursor: number; attempts: Attempt[];
  demographics?: Demographics;
  questionnaire?: Questionnaire; completed?: string; resultsViewed?: true;
  consent?: {version: string; accepted: string};
  withdrawn?: string;
}

export function latinSquare(ids: string[], row: number): string[] {
  if (ids.length % 2 || !Number.isInteger(row) || row < 1 || row > ids.length) throw Error('Invalid Latin-square row.');
  const n = ids.length;
  return Array.from({length: n}, (_, i) => ids[((i % 2 ? n - (i + 1) / 2 : i / 2) + row - 1) % n]);
}
export function createSession(participant: string, condition: Condition, mode: Mode, orderRow: number,
  data: Dataset, readyForStudy: boolean): Session {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(participant)) throw Error('Use an anonymous ID: 1–32 letters, numbers, underscores or hyphens.');
  if (!['IV-3', 'IV-4'].includes(condition) || !['simulated', 'pilot', 'study'].includes(mode)) throw Error('Invalid session setup.');
  if (mode === 'study' && !readyForStudy) throw Error('Real study sessions remain blocked pending pilot review.');
  return {schema: 1, protocol: PROTOCOL, dataset: data.version, id: crypto.randomUUID(), participant,
    condition, mode, orderRow, sequence: latinSquare(data.episodes.map(e => e.id), orderRow),
    created: new Date().toISOString(), phase: 'consent', cursor: 0, attempts: []};
}
export function acceptConsent(s: Session, agreed: boolean): Session {
  if (s.phase !== 'consent' || agreed !== true) throw Error('Explicit consent is required before practice.');
  return {...s, consent: {version: CONSENT_VERSION, accepted: new Date().toISOString()}, phase: 'demographics'};
}
export function submitDemographics(s: Session, demographics: Demographics): Session {
  if (!hasAcceptedConsent(s)) throw Error('Consent is required.');
  if (s.phase !== 'demographics') throw Error('Demographics form is not active.');
  if (!demographics.age || !demographics.field || !demographics.normalColorVision ||
      !Number.isFinite(demographics.chartFamiliarity) || demographics.chartFamiliarity < 1 || demographics.chartFamiliarity > 5 ||
      !Number.isFinite(demographics.weatherFamiliarity) || demographics.weatherFamiliarity < 1 || demographics.weatherFamiliarity > 5) {
    throw Error('Please answer all questions before continuing.');
  }
  return {...s, demographics, phase: 'instructions'};
}
export function withdraw(s: Session): Session {
  if (['declined', 'withdrawn'].includes(s.phase)) return s;
  return {...s, phase: s.consent ? 'withdrawn' : 'declined', withdrawn: new Date().toISOString(),
    cursor: 0, attempts: [], questionnaire: undefined, completed: undefined, resultsViewed: undefined};
}
export function deleteLocal(storage: Pick<Storage, 'removeItem' | 'getItem'>) {
  try {
    storage.removeItem(STORAGE_KEY);
    if (storage.getItem(STORAGE_KEY) !== null) throw Error('Still present');
  } catch { throw Error('Local deletion failed. Ask the researcher to clear this browser’s experiment data before leaving. Downloaded copies are separate.'); }
}
export function current(s: Session) {
  if (s.cursor < 0 || s.cursor >= s.sequence.length) throw Error('No trial remains.');
  return {id: s.sequence[s.cursor], practice: false, position: s.cursor + 1};
}
export function begin(s: Session): Session {
  if (!hasAcceptedConsent(s)) throw Error('Consent is required before any trial.');
  if (!['instructions', 'between', 'demographics'].includes(s.phase)) throw Error('Cannot begin a trial now.');
  const next = structuredClone(s);
  if (next.cursor === 20) { next.phase = 'questionnaire'; return next; }
  const item = current(next);
  const previous = next.attempts.filter(a => a.episode === item.id);
  next.attempts.push({episode: item.id, practice: item.practice, position: item.position,
    attempt: previous.length + 1, repeated: previous.length > 0, started: new Date().toISOString(),
    status: 'active', flags: []});
  next.phase = 'trial';
  return next;
}
export function parseRating(value: string, min: number, max: number, step: number): number {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    throw Error(`Enter a whole number from ${min} to ${max}${step > 1 ? ` in steps of ${step}` : ''}.`);
  }
  const number = Number(trimmed);
  if (!Number.isInteger(number) || number < min || number > max || (number - min) % step !== 0) {
    throw Error(`Enter a whole number from ${min} to ${max}${step > 1 ? ` in steps of ${step}` : ''}.`);
  }
  return number;
}
export function submit(s: Session, decision: string, confidence: string, probability: string, durationMs: number): Session {
  if (!hasAcceptedConsent(s)) throw Error('Consent is required.');
  if (s.phase !== 'trial' || !Number.isFinite(durationMs) || durationMs < 0) throw Error('Trial is not ready.');
  if (!['GO', 'CANCEL'].includes(decision)) throw Error('Choose GO or CANCEL.');
  const next = structuredClone(s);
  const a = next.attempts.at(-1)!;
  if (a.status !== 'active') throw Error('This response is already locked.');
  a.decision = decision as Decision;
  a.confidence = parseRating(confidence, 50, 100, 1);
  if (PROBABILITY_EPISODES.includes(a.episode)) a.probability = parseRating(probability, 0, 100, 1);
  a.durationMs = Math.round(durationMs);
  a.ended = new Date().toISOString();
  a.status = 'submitted';
  next.phase = 'between';
  next.cursor++;
  return next;
}
export function finish(s: Session, q: Questionnaire): Session {
  if (!hasAcceptedConsent(s)) throw Error('Consent is required.');
  if (s.phase !== 'questionnaire') throw Error('Complete the trials first.');
  for (const key of TLX) {
    if (typeof q[key] !== 'number' || !Number.isInteger(q[key]) || q[key] < 0 || q[key] > 100 || q[key] % 5 !== 0) {
      throw Error('Answer every workload question from 0 to 100 in steps of 5.');
    }
  }
  if (typeof q.comments !== 'string' || q.comments.length > 4000) throw Error('Comments must be at most 4,000 characters.');
  return {...s, questionnaire: q, phase: 'complete', completed: new Date().toISOString()};
}
export function markResultsViewed(s: Session): Session {
  if (!hasAcceptedConsent(s)) throw Error('Consent is required.');
  if (s.phase !== 'complete') throw Error('Complete the session before opening facilitator handoff.');
  if (s.resultsViewed) return s;
  return {...s, resultsViewed: true};
}
export function recover(text: string, data: Dataset): Session {
  const s = JSON.parse(text) as Session;
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (!s || s.schema !== 1 || s.protocol !== PROTOCOL || s.dataset !== data.version ||
    typeof s.id !== 'string' || !s.id || !date(s.created) ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(s.participant) || !['IV-3', 'IV-4'].includes(s.condition) ||
    !['simulated', 'pilot', 'study'].includes(s.mode) ||
    !['consent', 'demographics', 'instructions', 'trial', 'between', 'questionnaire', 'complete', 'declined', 'withdrawn'].includes(s.phase) ||
    !Number.isInteger(s.cursor) || s.cursor < 0 || s.cursor > 20 || !Array.isArray(s.attempts) ||
    JSON.stringify(s.sequence) !== JSON.stringify(latinSquare(data.episodes.map(e => e.id), s.orderRow))) {
    throw Error('Saved session is incompatible or damaged. Export its backup before starting again.');
  }
  const stopped = ['withdrawn', 'declined'].includes(s.phase);
  if (s.consent && (!(COMPATIBLE_CONSENT_VERSIONS as readonly string[]).includes(s.consent.version) || !date(s.consent.accepted))) throw Error('Saved consent is incompatible or damaged.');
  if ((!['consent', 'declined'].includes(s.phase) && !s.consent) ||
    (['consent', 'declined'].includes(s.phase) && s.consent) ||
    (['consent', 'declined', 'withdrawn'].includes(s.phase) && (s.cursor !== 0 || s.attempts.length || s.questionnaire || s.completed)) ||
    (stopped && !date(s.withdrawn)) || (!stopped && s.withdrawn)) throw Error('Saved consent/withdrawal history is inconsistent.');
  let completed = 0;
  const counts = new Map<string, number>();
  for (const [index, a] of s.attempts.entries()) {
    const expected = s.sequence[completed];
    const count = (counts.get(expected) ?? 0) + 1;
    if (!a || a.episode !== expected || a.practice !== false ||
      a.position !== completed + 1 || a.attempt !== count ||
      a.repeated !== (count > 1) || !date(a.started) || !Array.isArray(a.flags) ||
      !a.flags.every(f => typeof f === 'string') || !['active', 'submitted', 'interrupted'].includes(a.status) ||
      (a.status !== 'active' && !date(a.ended)) ||
      (a.status === 'active' && (index !== s.attempts.length - 1 || s.phase !== 'trial'))) {
      throw Error('Saved attempt history is damaged.');
    }
    counts.set(expected, count);
    if (a.status !== 'submitted') continue;
    if (!['GO', 'CANCEL'].includes(a.decision!) ||
      !Number.isFinite(a.confidence) || a.confidence! < 50 || a.confidence! > 100 ||
      !Number.isFinite(a.durationMs) || a.durationMs! < 0 ||
      (PROBABILITY_EPISODES.includes(a.episode) && (!Number.isFinite(a.probability) || a.probability! < 0 || a.probability! > 100))) {
      throw Error('Saved response is damaged.');
    }
    completed++;
  }
  if (completed !== s.cursor ||
    ((['demographics', 'instructions'].includes(s.phase)) && s.cursor !== 0) ||
    (s.phase === 'between' && s.cursor < 1) ||
    (['questionnaire', 'complete'].includes(s.phase) && s.cursor !== 20) ||
    (s.phase === 'trial' && s.cursor === 20)) throw Error('Saved trial history is inconsistent.');
  if (s.resultsViewed !== undefined && s.resultsViewed !== true) {
    throw Error('Saved completion state is incompatible or damaged.');
  }
  if (s.resultsViewed && s.phase !== 'complete') {
    throw Error('Saved completion state is inconsistent.');
  }
  if (s.phase === 'complete') {
    if (!date(s.completed) || !s.questionnaire) throw Error('Saved questionnaire is damaged.');
    finish({...s, phase: 'questionnaire'}, s.questionnaire);
  }
  if (s.phase === 'trial') {
    const a = s.attempts.at(-1);
    if (!a || a.status !== 'active' || a.episode !== current(s).id) throw Error('Saved active trial is damaged.');
    a.status = 'interrupted'; a.ended = new Date().toISOString(); a.flags.push('recovered-interruption');
    s.phase = s.cursor === 0 ? (s.demographics ? 'instructions' : 'demographics') : 'between';
  }
  return s;
}
export function save(storage: Pick<Storage, 'setItem'>, s: Session) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(s)); }
  catch { throw Error('Progress could not be saved. Export a backup from the researcher screen and resolve browser storage before continuing.'); }
}
export function csv(headers: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    let text = v === undefined || v === null ? '' : String(v);
    if (/^[\s]*[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function exportsFor(s: Session) {
  const common = ['session_id', 'participant_id', 'condition', 'mode', 'protocol', 'dataset_version', 'order_row', 'session_phase', 'consent_version', 'consent_at', 'withdrawn_at'];
  const values = [s.id, s.participant, s.condition, s.mode, s.protocol, s.dataset, s.orderRow, s.phase, s.consent?.version, s.consent?.accepted, s.withdrawn];
  const q = s.questionnaire;
  const d = s.demographics;
  return {
    session: csv([...common, 'created', 'completed', 'phase', 'sequence', 'age', 'field_of_study', 'chart_familiarity', 'weather_familiarity', 'normal_color_vision'],
      [[...values, s.created, s.completed, s.phase, s.sequence.join('|'), d?.age ?? '', d?.field ?? '', d?.chartFamiliarity ?? '', d?.weatherFamiliarity ?? '', d?.normalColorVision ?? '']]),
    trials: csv([...common, 'episode', 'practice', 'position', 'attempt', 'status', 'repeated_exposure', 'started', 'ended', 'decision', 'confidence', 'probability', 'duration_ms', 'flags'],
      s.attempts.map(a => [...values, a.episode, a.practice, a.position, a.attempt, a.status, a.repeated, a.started, a.ended, a.decision, a.confidence, a.probability, a.durationMs, a.flags.join('|')])),
    questionnaire: csv([...common, ...TLX, 'raw_tlx', 'comments'], q ? [[...values, ...TLX.map(k => q[k]), TLX.reduce((n, k) => n + q[k], 0) / 6, q.comments]] : [])
  };
}
