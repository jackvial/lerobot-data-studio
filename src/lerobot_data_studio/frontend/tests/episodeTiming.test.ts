import { describe, expect, it } from 'vitest';
import {
  clampToVideoRange,
  getVideoTimeRange,
} from '../src/utils/episodeTiming';

describe('episodeTiming', () => {
  it('returns a default range when video info is missing', () => {
    expect(getVideoTimeRange(undefined)).toEqual({
      fromTimestamp: 0,
      toTimestamp: null,
      duration: null,
    });
  });

  it('uses explicit from/to timestamps when provided', () => {
    expect(
      getVideoTimeRange({
        url: '/api/videos/foo.mp4',
        filename: 'foo.mp4',
        from_timestamp: 12.5,
        to_timestamp: 18.75,
      })
    ).toEqual({
      fromTimestamp: 12.5,
      toTimestamp: 18.75,
      duration: 6.25,
    });
  });

  it('treats null bounds as missing', () => {
    expect(
      getVideoTimeRange({
        url: '/api/videos/foo.mp4',
        filename: 'foo.mp4',
        from_timestamp: null,
        to_timestamp: null,
      })
    ).toEqual({
      fromTimestamp: 0,
      toTimestamp: null,
      duration: null,
    });
  });

  it('clamps absolute times into the video slice window', () => {
    const range = {
      fromTimestamp: 12.5,
      toTimestamp: 18.75,
      duration: 6.25,
    };
    expect(clampToVideoRange(10, range, 30)).toBe(12.5);
    expect(clampToVideoRange(20, range, 30)).toBe(18.75);
    expect(clampToVideoRange(15, range, 30)).toBe(15);
  });

  it('falls back to media duration when no upper bound is set', () => {
    const range = {
      fromTimestamp: 0,
      toTimestamp: null,
      duration: null,
    };
    expect(clampToVideoRange(20, range, 12)).toBe(12);
    expect(clampToVideoRange(5, range, 12)).toBe(5);
  });
});
