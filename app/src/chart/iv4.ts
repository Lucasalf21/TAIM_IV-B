import * as Plot from '@observablehq/plot';
import type {Episode} from '../core.ts';
import {THEME} from './frame.ts';
import type {Renderer} from './frame.ts';

export function dotSeries(episode: Episode) {
  if (!episode.hours.length || episode.members.length !== 10 ||
    episode.members.some(member => member.length !== episode.hours.length)) {
    throw Error('A dot series requires ten aligned members.');
  }
  return episode.members.flatMap((member, memberIndex) => member.map((value, step) => {
    if (!Number.isFinite(episode.hours[step]) || !Number.isFinite(value)) {
      throw Error('Dot series values must be finite.');
    }
    return {hour: episode.hours[step] + 1.5, value, member: memberIndex + 1};
  }));
}

export const iv4: Renderer = {
  implemented: true,
  readyForStudy: false,
  marks: ({episode}) => {
    const dots = dotSeries(episode);
    return [Plot.dot(dots, {
      x: 'hour', y: 'value', r: 5.5, fill: THEME.item,
      stroke: THEME.background, strokeWidth: 1.5, clip: true,
      ariaDescription: 'Unconnected ensemble member values'
    })];
  }
};
