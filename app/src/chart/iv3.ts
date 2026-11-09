import * as Plot from '@observablehq/plot';
import type {Episode} from '../core.ts';
import {THEME} from './frame.ts';
import type {Renderer} from './frame.ts';

export function boxSummaries(episode: Episode) {
  if (!episode.hours.length || episode.members.length !== 10 ||
    episode.members.some(m => m.length !== episode.hours.length)) throw Error('A box plot requires ten aligned members.');
  return episode.hours.map((hour, step) => {
    const values = episode.members.map(member => member[step]).sort((a, b) => a - b);
    if (!Number.isFinite(hour) || values.some(v => !Number.isFinite(v))) throw Error('Box plot values must be finite.');
    // Linear interpolation (R-7), matching the source pipeline's NumPy percentiles.
    const quantile = (p: number) => {
      const index = (values.length - 1) * p, lower = Math.floor(index);
      return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
    };
    return {hour, min: values[0], q25: quantile(.25), median: quantile(.5), q75: quantile(.75), max: values.at(-1)!};
  });
}

export const iv3: Renderer = {
  implemented: true,
  readyForStudy: false,
  marks: ({episode}) => {
    const boxes = boxSummaries(episode);
    // Explicit marks preserve min–max whiskers without Plot's default outlier convention.
    return [
      Plot.ruleX(boxes, {x: 'hour', y1: 'min', y2: 'max', stroke: THEME.item, strokeWidth: 1.5, clip: true, ariaDescription: 'Minimum to maximum whiskers'}),
      Plot.ruleY(boxes, {y: 'min', x1: d => d.hour - .4, x2: d => d.hour + .4, stroke: THEME.item, strokeWidth: 1.5, clip: true, ariaDescription: 'Minimum caps'}),
      Plot.ruleY(boxes, {y: 'max', x1: d => d.hour - .4, x2: d => d.hour + .4, stroke: THEME.item, strokeWidth: 1.5, clip: true, ariaDescription: 'Maximum caps'}),
      Plot.rect(boxes, {x1: d => d.hour - .8, x2: d => d.hour + .8, y1: 'q25', y2: 'q75', fill: THEME.band, stroke: THEME.item, strokeWidth: 1.5, clip: true, ariaDescription: 'Middle 50 percent boxes'}),
      Plot.ruleY(boxes, {y: 'median', x1: d => d.hour - .8, x2: d => d.hour + .8, stroke: THEME.highlight, strokeWidth: 2, clip: true, ariaDescription: 'Median lines'})
    ];
  }
};
