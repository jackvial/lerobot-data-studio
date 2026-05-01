import { useCallback } from 'react';
import { SubtaskSegment } from '@/types';
import { useSegmentDrafts, UseSegmentDraftsResult } from './useSegmentDrafts';

const STORAGE_KEY = 'subtaskAnnotationDrafts';

const cloneSegment = (segment: SubtaskSegment): SubtaskSegment => ({
  ...segment,
});

const sortSegments = (segments: SubtaskSegment[]): SubtaskSegment[] => {
  return [...segments].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.end !== b.end) {
      return a.end - b.end;
    }
    return a.name.localeCompare(b.name);
  });
};

export const segmentsEqual = (
  a: SubtaskSegment[],
  b: SubtaskSegment[]
): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const left = sortSegments(a);
  const right = sortSegments(b);
  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i].name !== right[i].name ||
      left[i].start !== right[i].start ||
      left[i].end !== right[i].end
    ) {
      return false;
    }
  }
  return true;
};

interface UseSubtaskAnnotationsOptions {
  datasetId: string;
  episodeId: number;
  saved: SubtaskSegment[];
  enabled?: boolean;
}

export type UseSubtaskAnnotationsResult = UseSegmentDraftsResult<SubtaskSegment>;

export const useSubtaskAnnotations = ({
  datasetId,
  episodeId,
  saved,
  enabled = true,
}: UseSubtaskAnnotationsOptions): UseSubtaskAnnotationsResult => {
  const isEqual = useCallback(segmentsEqual, []);
  return useSegmentDrafts<SubtaskSegment>({
    storageKey: STORAGE_KEY,
    datasetId,
    episodeId,
    saved,
    enabled,
    isEqual,
    cloneOne: cloneSegment,
  });
};
