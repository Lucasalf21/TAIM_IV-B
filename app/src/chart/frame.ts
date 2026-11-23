import * as Plot from '@observablehq/plot';
import type {Dataset, Episode} from '../core.ts';

// Class palette, transcribed from the colour-scheme slide.
export const THEME = {background: '#000000', text: '#a9acb0', highlight: '#bcf4ec',
  item: '#5fd3c4', alternate: '#f2a65a', band: '#3c7d79', deepBand: '#1c3537'};
export interface ChartContext {episode: Episode; xMin: number; yMax: number; threshold: number; windowHours: number}
export interface Renderer {
  implemented?: boolean;
  readyForStudy: boolean;
  marks: (context: ChartContext) => Plot.Markish[];
}
export function renderFrame(context: ChartContext, marks: Plot.Markish[]) {
  const chart = Plot.plot({
    width: 900, height: 440, marginLeft: 65, marginRight: 96, marginTop: 42, marginBottom: 54,
    style: {background: THEME.background, color: THEME.text, fontSize: '14px', fontFamily: 'inherit'},
    ariaLabel: 'Wind speed at 100 metres over time. Horizontal scale varies with the available episode length. Highlighted transfer window starts at zero hours; limit is 5 metres per second.',
    x: {domain: [context.xMin, 3], label: 'Hours relative to transfer', ticks: xTicks(context.xMin)},
    y: {domain: [0, 16], ticks: Array.from({length: 17}, (_, i) => i), label: 'Wind speed at 100 m (m/s)', grid: true},
    marks: [
      Plot.rect([{x1: 0, x2: 3, y1: 0, y2: context.yMax}], {x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2', fill: THEME.deepBand}),
      Plot.ruleY([context.threshold], {stroke: THEME.alternate, strokeDasharray: '6,4'}),
      Plot.ruleX([0], {stroke: THEME.highlight, strokeOpacity: 0.6}),
      ...marks,
      // Labels sit outside the data area (right margin / above the window) so they never cover marks.
      Plot.text([{x: 3, y: context.threshold, label: '5 m/s limit'}], {x: 'x', y: 'y', text: 'label', textAnchor: 'start', dx: 8, fill: THEME.alternate, clip: false}),
      Plot.text([{x: 1.5, y: context.yMax, label: '3 h window'}], {x: 'x', y: 'y', text: 'label', textAnchor: 'middle', dy: -18, fill: THEME.highlight})
    ]
  });
  // Plot labels SVG groups without roles; explicit grouping keeps those labels valid.
  chart.querySelectorAll('g[aria-label]').forEach(group => group.setAttribute('role', 'group'));
  return chart;
}
export function xTicks(xMin: number) {
  const ticks: number[] = [];
  for (let hour = xMin; hour < 0; hour += 3) ticks.push(hour);
  ticks.push(0, 3);
  return ticks;
}
export function contextFor(data: Dataset, episode: Episode): ChartContext {
  if (!episode.hours.length) throw Error('An episode requires at least one timestep.');
  if (!episode.hours.includes(0)) throw Error('An episode requires a timestep at 0 hours.');
  const xMin = Math.min(...episode.hours);
  if (episode.members.some(member => member.some(v => !Number.isFinite(v) || v < 0 || v > 16))) throw Error('Wind values fall outside the agreed 0–16 m/s axis. Review the dataset before proceeding.');
  return {episode, xMin, yMax: 16, threshold: data.threshold, windowHours: data.windowHours};
}
