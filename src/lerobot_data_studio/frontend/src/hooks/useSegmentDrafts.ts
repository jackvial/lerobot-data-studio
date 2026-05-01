import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface DraftStore<T> {
  [datasetId: string]: {
    [episodeId: string]: T[];
  };
}

const readStore = <T>(storageKey: string): DraftStore<T> => {
  if (typeof window === 'undefined') {
    return {};
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as DraftStore<T>;
    }
  } catch (err) {
    console.error(`Failed to parse drafts at ${storageKey}:`, err);
  }
  return {};
};

const writeStore = <T>(storageKey: string, store: DraftStore<T>): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(store));
};

const cloneSegments = <T>(segments: T[], cloneOne: (s: T) => T): T[] => {
  return segments.map((segment) => cloneOne(segment));
};

interface UseSegmentDraftsOptions<T> {
  storageKey: string;
  datasetId: string;
  episodeId: number;
  saved: T[];
  enabled?: boolean;
  isEqual: (a: T[], b: T[]) => boolean;
  cloneOne: (segment: T) => T;
}

export interface UseSegmentDraftsResult<T> {
  draft: T[];
  isDirty: boolean;
  setDraft: (next: T[] | ((prev: T[]) => T[])) => void;
  resetToSaved: () => void;
  clearDraft: () => void;
}

/**
 * Generic per-episode draft store backed by localStorage. The Subtask and
 * Critical Section panels both wrap this so each gets isolated drafts under
 * their own storage key while sharing the dirty-tracking + rehydrate logic.
 */
export const useSegmentDrafts = <T>({
  storageKey,
  datasetId,
  episodeId,
  saved,
  enabled = true,
  isEqual,
  cloneOne,
}: UseSegmentDraftsOptions<T>): UseSegmentDraftsResult<T> => {
  const episodeKey = String(episodeId);
  const savedRef = useRef<T[]>(saved);
  savedRef.current = saved;

  const [draft, setDraftState] = useState<T[]>(() => {
    if (!enabled) {
      return cloneSegments(saved, cloneOne);
    }
    const store = readStore<T>(storageKey);
    const stored = store[datasetId]?.[episodeKey];
    if (stored) {
      return cloneSegments(stored, cloneOne);
    }
    return cloneSegments(saved, cloneOne);
  });

  // Reset draft when the active episode/dataset changes; rehydrate from
  // localStorage if available, otherwise mirror the saved snapshot.
  useEffect(() => {
    if (!enabled) {
      setDraftState(cloneSegments(savedRef.current, cloneOne));
      return;
    }
    const store = readStore<T>(storageKey);
    const stored = store[datasetId]?.[episodeKey];
    if (stored) {
      setDraftState(cloneSegments(stored, cloneOne));
    } else {
      setDraftState(cloneSegments(savedRef.current, cloneOne));
    }
  }, [datasetId, episodeKey, enabled, storageKey, cloneOne]);

  const persistDraft = useCallback(
    (next: T[]) => {
      const store = readStore<T>(storageKey);
      const datasetEntry = { ...(store[datasetId] ?? {}) };
      if (isEqual(next, savedRef.current)) {
        delete datasetEntry[episodeKey];
      } else {
        datasetEntry[episodeKey] = cloneSegments(next, cloneOne);
      }
      const nextStore: DraftStore<T> = { ...store };
      if (Object.keys(datasetEntry).length === 0) {
        delete nextStore[datasetId];
      } else {
        nextStore[datasetId] = datasetEntry;
      }
      writeStore(storageKey, nextStore);
    },
    [datasetId, episodeKey, isEqual, cloneOne, storageKey]
  );

  const setDraft = useCallback<UseSegmentDraftsResult<T>['setDraft']>(
    (next) => {
      setDraftState((prev) => {
        const value =
          typeof next === 'function'
            ? (next as (prev: T[]) => T[])(prev)
            : next;
        const cloned = cloneSegments(value, cloneOne);
        if (enabled) {
          persistDraft(cloned);
        }
        return cloned;
      });
    },
    [enabled, persistDraft, cloneOne]
  );

  const resetToSaved = useCallback(() => {
    setDraft(cloneSegments(savedRef.current, cloneOne));
  }, [setDraft, cloneOne]);

  const clearDraft = useCallback(() => {
    if (!enabled) {
      return;
    }
    const store = readStore<T>(storageKey);
    if (!store[datasetId]) {
      return;
    }
    const datasetEntry = { ...store[datasetId] };
    delete datasetEntry[episodeKey];
    const nextStore: DraftStore<T> = { ...store };
    if (Object.keys(datasetEntry).length === 0) {
      delete nextStore[datasetId];
    } else {
      nextStore[datasetId] = datasetEntry;
    }
    writeStore(storageKey, nextStore);
  }, [datasetId, enabled, episodeKey, storageKey]);

  const isDirty = useMemo(
    () => !isEqual(draft, saved),
    [draft, saved, isEqual]
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
