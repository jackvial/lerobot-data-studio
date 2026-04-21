import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SubtaskSegment } from '@/types';

const STORAGE_KEY = 'subtaskAnnotationDrafts';

interface DraftKey {
  datasetId: string;
  episodeId: number;
}

interface DraftStore {
  [datasetId: string]: {
    [episodeId: string]: SubtaskSegment[];
  };
}

const readStore = (): DraftStore => {
  if (typeof window === 'undefined') {
    return {};
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as DraftStore;
    }
  } catch (err) {
    console.error('Failed to parse subtask drafts:', err);
  }
  return {};
};

const writeStore = (store: DraftStore): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const cloneSegments = (segments: SubtaskSegment[]): SubtaskSegment[] => {
  return segments.map((segment) => ({ ...segment }));
};

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

interface UseSubtaskAnnotationsOptions extends DraftKey {
  saved: SubtaskSegment[];
  enabled?: boolean;
}

export interface UseSubtaskAnnotationsResult {
  draft: SubtaskSegment[];
  isDirty: boolean;
  setDraft: (
    next: SubtaskSegment[] | ((prev: SubtaskSegment[]) => SubtaskSegment[])
  ) => void;
  resetToSaved: () => void;
  clearDraft: () => void;
}

export const useSubtaskAnnotations = ({
  datasetId,
  episodeId,
  saved,
  enabled = true,
}: UseSubtaskAnnotationsOptions): UseSubtaskAnnotationsResult => {
  const episodeKey = String(episodeId);
  const savedRef = useRef<SubtaskSegment[]>(saved);
  savedRef.current = saved;

  const [draft, setDraftState] = useState<SubtaskSegment[]>(() => {
    if (!enabled) {
      return cloneSegments(saved);
    }
    const store = readStore();
    const stored = store[datasetId]?.[episodeKey];
    if (stored) {
      return cloneSegments(stored);
    }
    return cloneSegments(saved);
  });

  // Reset draft when the active episode/dataset changes; rehydrate from
  // localStorage if available, otherwise mirror the saved snapshot.
  useEffect(() => {
    if (!enabled) {
      setDraftState(cloneSegments(savedRef.current));
      return;
    }
    const store = readStore();
    const stored = store[datasetId]?.[episodeKey];
    if (stored) {
      setDraftState(cloneSegments(stored));
    } else {
      setDraftState(cloneSegments(savedRef.current));
    }
  }, [datasetId, episodeKey, enabled]);

  const persistDraft = useCallback(
    (next: SubtaskSegment[]) => {
      const store = readStore();
      const datasetEntry = { ...(store[datasetId] ?? {}) };
      if (segmentsEqual(next, savedRef.current)) {
        delete datasetEntry[episodeKey];
      } else {
        datasetEntry[episodeKey] = cloneSegments(next);
      }
      const nextStore: DraftStore = { ...store };
      if (Object.keys(datasetEntry).length === 0) {
        delete nextStore[datasetId];
      } else {
        nextStore[datasetId] = datasetEntry;
      }
      writeStore(nextStore);
    },
    [datasetId, episodeKey]
  );

  const setDraft = useCallback<UseSubtaskAnnotationsResult['setDraft']>(
    (next) => {
      setDraftState((prev) => {
        const value =
          typeof next === 'function'
            ? (next as (prev: SubtaskSegment[]) => SubtaskSegment[])(prev)
            : next;
        const cloned = cloneSegments(value);
        if (enabled) {
          persistDraft(cloned);
        }
        return cloned;
      });
    },
    [enabled, persistDraft]
  );

  const resetToSaved = useCallback(() => {
    setDraft(cloneSegments(savedRef.current));
  }, [setDraft]);

  const clearDraft = useCallback(() => {
    if (!enabled) {
      return;
    }
    const store = readStore();
    if (!store[datasetId]) {
      return;
    }
    const datasetEntry = { ...store[datasetId] };
    delete datasetEntry[episodeKey];
    const nextStore: DraftStore = { ...store };
    if (Object.keys(datasetEntry).length === 0) {
      delete nextStore[datasetId];
    } else {
      nextStore[datasetId] = datasetEntry;
    }
    writeStore(nextStore);
  }, [datasetId, enabled, episodeKey]);

  const isDirty = useMemo(
    () => !segmentsEqual(draft, saved),
    [draft, saved]
  );

  // Warn the user if they try to navigate/close with unsaved changes.
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return {
    draft,
    isDirty,
    setDraft,
    resetToSaved,
    clearDraft,
  };
};
