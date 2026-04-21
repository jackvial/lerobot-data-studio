import { EpisodeDataPoint, IdleSpan } from '@/types';

export interface EpisodeTimeRange {
  startTime: number;
  endTime: number;
  duration: number;
}

export const getEpisodeTimeRange = (
  episodeData: EpisodeDataPoint[] = []
): EpisodeTimeRange => {
  if (episodeData.length === 0) {
    return {
      startTime: 0,
      endTime: 0,
      duration: 0,
    };
  }

  const rawStartTime = Number(episodeData[0]?.timestamp ?? 0);
  const rawEndTime = Number(
    episodeData[episodeData.length - 1]?.timestamp ?? rawStartTime
  );

  const startTime = Number.isFinite(rawStartTime) ? rawStartTime : 0;
  const endTime = Math.max(
    Number.isFinite(rawEndTime) ? rawEndTime : startTime,
    startTime
  );

  return {
    startTime,
    endTime,
    duration: Math.max(endTime - startTime, 0),
  };
};

export const normalizeEpisodeTimestamp = (
  timestamp: number,
  startTime: number
): number => {
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : startTime;
  return Math.max(safeTimestamp - startTime, 0);
};

export const normalizeIdleSpans = (
  spans: IdleSpan[],
  startTime: number
): IdleSpan[] => {
  return spans.map((span) => {
    const normalizedStart = normalizeEpisodeTimestamp(span.start_time, startTime);
    const normalizedEnd = normalizeEpisodeTimestamp(span.end_time, startTime);

    return {
      start_time: normalizedStart,
      end_time: Math.max(normalizedEnd, normalizedStart),
    };
  });
};
