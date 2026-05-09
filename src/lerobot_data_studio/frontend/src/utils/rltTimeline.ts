import { RltTransitionInfo } from '@/types';

/** Pixel position for a transition tick on a timeline of `widthPx` pixels. */
export const transitionTickX = (
  transition: RltTransitionInfo,
  totalDurationS: number,
  widthPx: number
): number => {
  if (totalDurationS <= 0 || widthPx <= 0) {
    return 0;
  }
  const ratio = transition.t_offset_s / totalDurationS;
  return Math.max(0, Math.min(widthPx, ratio * widthPx));
};

/** Wall-clock delay (ms) between two adjacent transitions, scaled by playback speed. */
export const transitionStepMs = (
  current: RltTransitionInfo,
  next: RltTransitionInfo,
  speed: number,
  hasInferenceTs: boolean,
  defaultFps: number
): number => {
  const safeSpeed = Math.max(speed, 1e-6);
  if (!hasInferenceTs) {
    // Fallback: even spacing at `defaultFps`.
    const step = 1000 / Math.max(defaultFps, 1e-3);
    return step / safeSpeed;
  }
  const deltaS = Math.max(next.t_offset_s - current.t_offset_s, 0);
  return (deltaS * 1000) / safeSpeed;
};

/** Total span between the first and last transition in seconds. */
export const transitionsSpanSeconds = (transitions: RltTransitionInfo[]): number => {
  if (transitions.length < 2) {
    return 0;
  }
  const first = transitions[0].t_offset_s;
  const last = transitions[transitions.length - 1].t_offset_s;
  return Math.max(last - first, 0);
};
