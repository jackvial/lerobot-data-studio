import { describe, expect, it } from 'vitest';
import { RltTransitionInfo } from '../src/types';
import {
  transitionStepMs,
  transitionTickX,
  transitionsSpanSeconds,
} from '../src/utils/rltTimeline';

const makeTransition = (
  index: number,
  tOffset: number
): RltTransitionInfo => ({
  index,
  ts: 100 + tOffset,
  t_offset_s: tOffset,
  action_summary: [0],
  reward: 0,
  done: false,
  success: false,
  failure: false,
  is_intervention: false,
  image_keys: [],
});

describe('rltTimeline', () => {
  it('places ticks proportionally to t_offset_s', () => {
    const transitions = [
      makeTransition(0, 0),
      makeTransition(1, 0.4),
      makeTransition(2, 1.2),
    ];
    const span = transitionsSpanSeconds(transitions);
    expect(span).toBeCloseTo(1.2);

    expect(transitionTickX(transitions[0], span, 600)).toBe(0);
    expect(transitionTickX(transitions[1], span, 600)).toBeCloseTo(200);
    expect(transitionTickX(transitions[2], span, 600)).toBe(600);
  });

  it('clamps tick position when given a zero span', () => {
    const transition = makeTransition(0, 5);
    expect(transitionTickX(transition, 0, 400)).toBe(0);
  });

  it('returns wall-clock delta for adjacent transitions when timestamps exist', () => {
    const a = makeTransition(0, 0);
    const b = makeTransition(1, 0.4);
    expect(transitionStepMs(a, b, 1.0, true, 5)).toBeCloseTo(400);
    expect(transitionStepMs(a, b, 0.5, true, 5)).toBeCloseTo(800);
    expect(transitionStepMs(a, b, 2.0, true, 5)).toBeCloseTo(200);
  });

  it('falls back to defaultFps spacing when inference timestamps are missing', () => {
    const a = makeTransition(0, 0);
    const b = makeTransition(1, 1);
    expect(transitionStepMs(a, b, 1.0, false, 5)).toBeCloseTo(200);
    expect(transitionStepMs(a, b, 2.0, false, 5)).toBeCloseTo(100);
  });

  it('treats negative deltas as zero so timeline does not run backwards', () => {
    const a = makeTransition(0, 1.0);
    const b = makeTransition(1, 0.5);
    expect(transitionStepMs(a, b, 1.0, true, 5)).toBe(0);
  });

  it('reports zero span for empty / single-transition lists', () => {
    expect(transitionsSpanSeconds([])).toBe(0);
    expect(transitionsSpanSeconds([makeTransition(0, 5)])).toBe(0);
  });
});
