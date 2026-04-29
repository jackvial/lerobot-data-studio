import { VideoInfo } from '@/types';

export interface VideoTimeRange {
  fromTimestamp: number;
  toTimestamp: number | null;
  duration: number | null;
}

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
