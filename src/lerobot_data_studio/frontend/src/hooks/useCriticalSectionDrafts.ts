import { useCallback } from 'react';
import { CriticalSection } from '@/types';
import { useSegmentDrafts, UseSegmentDraftsResult } from './useSegmentDrafts';

export const CRITICAL_SECTION_STORAGE_KEY = 'criticalSectionDrafts';

const cloneSection = (section: CriticalSection): CriticalSection => ({
  ...section,
});

const sortSections = (sections: CriticalSection[]): CriticalSection[] => {
  return [...sections].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.end !== b.end) {
      return a.end - b.end;
    }
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name);
    }
    return a.weight - b.weight;
  });
};

export const criticalSectionsEqual = (
  a: CriticalSection[],
  b: CriticalSection[]
): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const left = sortSections(a);
  const right = sortSections(b);
  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i].name !== right[i].name ||
      left[i].start !== right[i].start ||
      left[i].end !== right[i].end ||
      left[i].weight !== right[i].weight
    ) {
      return false;
    }
  }
  return true;
};

interface UseCriticalSectionDraftsOptions {
  datasetId: string;
  episodeId: number;
  saved: CriticalSection[];
  enabled?: boolean;
}

export type UseCriticalSectionDraftsResult =
  UseSegmentDraftsResult<CriticalSection>;

export const useCriticalSectionDrafts = ({
  datasetId,
  episodeId,
  saved,
  enabled = true,
}: UseCriticalSectionDraftsOptions): UseCriticalSectionDraftsResult => {
  const isEqual = useCallback(criticalSectionsEqual, []);
  return useSegmentDrafts<CriticalSection>({
    storageKey: CRITICAL_SECTION_STORAGE_KEY,
    datasetId,
    episodeId,
    saved,
    enabled,
    isEqual,
    cloneOne: cloneSection,
  });
};
