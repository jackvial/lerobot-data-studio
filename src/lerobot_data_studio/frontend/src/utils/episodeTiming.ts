import { EpisodeTrimBounds, IdleSpan, VideoInfo } from '@/types';

export interface VideoTimeRange {
  fromTimestamp: number;
  toTimestamp: number | null;
  duration: number | null;
}

const EPSILON = 1e-6;

export const getVideoTimeRange = (
  video: VideoInfo | undefined
): VideoTimeRange => {
  const rawFrom =
    video?.from_timestamp != null && Number.isFinite(video.from_timestamp)
      ? Number(video.from_timestamp)
      : 0;
  const fromTimestamp = Math.max(rawFrom, 0);

  const rawTo =
    video?.to_timestamp != null && Number.isFinite(video.to_timestamp)
      ? Number(video.to_timestamp)
      : null;
  const toTimestamp = rawTo != null ? Math.max(rawTo, fromTimestamp) : null;

  return {
    fromTimestamp,
    toTimestamp,
    duration: toTimestamp != null ? toTimestamp - fromTimestamp : null,
  };
};

export const clampToVideoRange = (
  absoluteTime: number,
  range: VideoTimeRange,
  videoDuration: number
): number => {
  const { fromTimestamp, toTimestamp } = range;
  const upperBound =
    toTimestamp != null
      ? Math.min(toTimestamp, videoDuration || toTimestamp)
      : videoDuration || fromTimestamp;
  const lowerBound = Math.min(fromTimestamp, upperBound);
  return Math.max(Math.min(absoluteTime, upperBound), lowerBound);
};

export const deriveEpisodeTrimFromIdleSpans = (
  spans: IdleSpan[],
  timestamps: number[]
): EpisodeTrimBounds | null => {
  if (timestamps.length < 2) {
    return null;
  }

  const firstTimestamp = timestamps[0];
  const lastTimestamp = timestamps[timestamps.length - 1];
  let keepStartIndex = 0;
  let keepEndIndex = timestamps.length - 1;

  spans.forEach((span) => {
    if (span.start_time <= firstTimestamp + EPSILON) {
      const nextStartIndex = timestamps.findIndex(
        (timestamp) => timestamp > span.end_time + EPSILON
      );
      if (nextStartIndex !== -1) {
        keepStartIndex = Math.max(keepStartIndex, nextStartIndex);
      }
    }

    if (span.end_time >= lastTimestamp - EPSILON) {
      const trailingStartIndex = timestamps.findIndex(
        (timestamp) => timestamp >= span.start_time - EPSILON
      );
      if (trailingStartIndex !== -1) {
        keepEndIndex = Math.min(keepEndIndex, trailingStartIndex - 1);
      }
    }
  });

  if (keepEndIndex - keepStartIndex + 1 < 2) {
    return null;
  }

  if (keepStartIndex === 0 && keepEndIndex === timestamps.length - 1) {
    return null;
  }

  return {
    start_time: timestamps[keepStartIndex],
    end_time: timestamps[keepEndIndex],
  };
};
