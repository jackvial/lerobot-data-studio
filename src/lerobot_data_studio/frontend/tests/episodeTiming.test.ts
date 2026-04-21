import { describe, expect, it } from 'vitest';
import {
  getEpisodeTimeRange,
  normalizeEpisodeTimestamp,
  normalizeIdleSpans,
} from '../src/utils/episodeTiming';

describe('episodeTiming', () => {
  it('returns a zero-length range for empty episode data', () => {
    expect(getEpisodeTimeRange()).toEqual({
      startTime: 0,
      endTime: 0,
      duration: 0,
    });
  });

  it('derives a slice range from the first and last timestamps', () => {
    expect(
      getEpisodeTimeRange([
        {
          episode_index: 7,
          action: [0],
          observation: [0],
          timestamp: 12.5,
        },
        {
          episode_index: 7,
          action: [1],
          observation: [1],
          timestamp: 18.75,
        },
      ])
    ).toEqual({
      startTime: 12.5,
      endTime: 18.75,
      duration: 6.25,
    });
  });

  it('normalizes timestamps relative to the episode slice start', () => {
    expect(normalizeEpisodeTimestamp(18.75, 12.5)).toBe(6.25);
    expect(normalizeEpisodeTimestamp(10, 12.5)).toBe(0);
  });

  it('normalizes idle spans into slice-relative times', () => {
    expect(
      normalizeIdleSpans(
        [
          {
            start_time: 12.5,
            end_time: 13.5,
          },
          {
            start_time: 17.5,
            end_time: 18.75,
          },
        ],
        12.5
      )
    ).toEqual([
      {
        start_time: 0,
        end_time: 1,
      },
      {
        start_time: 5,
        end_time: 6.25,
      },
    ]);
  });
});
