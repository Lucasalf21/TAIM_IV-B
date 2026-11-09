import type {Renderer} from './frame.ts';

// Implement one box per timestep: p25–p75, median, min–max whiskers, no outlier points.
export const iv3: Renderer = {readyForStudy: false, marks: () => []};
