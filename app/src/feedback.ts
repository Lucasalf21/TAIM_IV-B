import type {Dataset, Decision, Session} from './core.ts';

export interface OutcomeFeedback {
  schema: 1; sessionId: string; dataset: string; protocol: string; condition: string; mode: string;
  trials: {episode: string; decision: Decision; observed: 0 | 1}[];
}
export function feedbackRows(s: Session, data: Dataset, outcomes?: OutcomeFeedback) {
  if (s.phase !== 'complete' || !s.questionnaire || s.cursor !== 22 || s.sequence.length !== 20 || s.dataset !== data.version) throw Error('Feedback is available only after the trials and questionnaire are complete.');
  return s.sequence.map((id, i) => {
    const a = s.attempts.find(a => !a.practice && a.status === 'submitted' && a.episode === id);
    const e = data.episodes.find(e => e.id === id);
    if (!a?.decision || !e) throw Error('Completed trial data is missing.');
    const probability = e.members.filter(m => m.slice(e.windowStart).some(v => v > data.threshold)).length / e.members.length;
    const recommended: Decision = probability * 40000 <= 5000 ? 'GO' : 'CANCEL';
    const observed = outcomes?.trials[i].observed;
    return {episode: id, position: i + 1, decision: a.decision, probability, recommended,
      goodDecision: a.decision === recommended, observed,
      matchedOutcome: observed === undefined ? undefined : a.decision === (observed ? 'CANCEL' : 'GO'),
      cost: observed === undefined ? undefined : a.decision === 'CANCEL' ? 5000 : observed * 40000};
  });
}
export function readOutcomeFeedback(text: string, s: Session, data: Dataset): OutcomeFeedback {
  feedbackRows(s, data);
  if (text.length > 65536) throw Error('The debrief file is too large.');
  const d = JSON.parse(text) as OutcomeFeedback;
  const rows = feedbackRows(s, data);
  if (!d || d.schema !== 1 || d.sessionId !== s.id || d.dataset !== s.dataset || d.protocol !== s.protocol ||
    d.condition !== s.condition || d.mode !== s.mode || !Array.isArray(d.trials) || d.trials.length !== 20 ||
    d.trials.some((t, i) => !t || t.episode !== rows[i].episode || t.decision !== rows[i].decision || (t.observed !== 0 && t.observed !== 1))) {
    throw Error('The debrief file does not match this completed session.');
  }
  return d;
}
