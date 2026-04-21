import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  segmentsEqual,
  useSubtaskAnnotations,
} from '../src/hooks/useSubtaskAnnotations';
import { SubtaskSegment } from '../src/types';

const STORAGE_KEY = 'subtaskAnnotationDrafts';

const installRealLocalStorage = () => {
  const store = new Map<string, string>();
  const real: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: real,
    configurable: true,
  });
  return store;
};

describe('useSubtaskAnnotations', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installRealLocalStorage();
  });

  afterEach(() => {
    store.clear();
  });

  it('starts equal to the saved snapshot when no draft exists', () => {
    const saved: SubtaskSegment[] = [
      { name: 'pick', start: 0, end: 1 },
    ];
    const { result } = renderHook(() =>
      useSubtaskAnnotations({
        datasetId: 'a/b',
        episodeId: 0,
        saved,
      })
    );
    expect(result.current.draft).toEqual(saved);
    expect(result.current.isDirty).toBe(false);
  });

  it('marks the draft dirty after edits and persists to localStorage', () => {
    const saved: SubtaskSegment[] = [];
    const { result } = renderHook(() =>
      useSubtaskAnnotations({
        datasetId: 'a/b',
        episodeId: 5,
        saved,
      })
    );

    act(() => {
      result.current.setDraft([{ name: 'pick', start: 1, end: 2 }]);
    });

    expect(result.current.draft).toEqual([
      { name: 'pick', start: 1, end: 2 },
    ]);
    expect(result.current.isDirty).toBe(true);

    const persisted = JSON.parse(store.get(STORAGE_KEY) ?? '{}');
    expect(persisted['a/b']['5']).toEqual([
      { name: 'pick', start: 1, end: 2 },
    ]);
  });

  it('clears the persisted draft when the draft matches saved again', () => {
    const saved: SubtaskSegment[] = [{ name: 'pick', start: 0, end: 1 }];
    const { result } = renderHook(() =>
      useSubtaskAnnotations({
        datasetId: 'a/b',
        episodeId: 7,
        saved,
      })
    );

    act(() => {
      result.current.setDraft([{ name: 'pick', start: 0, end: 2 }]);
    });
    let persisted = JSON.parse(store.get(STORAGE_KEY) ?? '{}');
    expect(persisted['a/b']['7']).toBeDefined();

    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.isDirty).toBe(false);

    persisted = JSON.parse(store.get(STORAGE_KEY) ?? '{}');
    expect(persisted['a/b']?.['7']).toBeUndefined();
  });

  it('rehydrates the draft from localStorage on mount', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        'a/b': {
          '3': [{ name: 'place', start: 4, end: 5 }],
        },
      })
    );

    const saved: SubtaskSegment[] = [];
    const { result } = renderHook(() =>
      useSubtaskAnnotations({
        datasetId: 'a/b',
        episodeId: 3,
        saved,
      })
    );

    expect(result.current.draft).toEqual([
      { name: 'place', start: 4, end: 5 },
    ]);
    expect(result.current.isDirty).toBe(true);
  });

  it('clearDraft removes the persisted entry', () => {
    const saved: SubtaskSegment[] = [];
    const { result } = renderHook(() =>
      useSubtaskAnnotations({
        datasetId: 'a/b',
        episodeId: 1,
        saved,
      })
    );

    act(() => {
      result.current.setDraft([{ name: 'pick', start: 0, end: 1 }]);
    });

    act(() => {
      result.current.clearDraft();
    });

    const persisted = JSON.parse(store.get(STORAGE_KEY) ?? '{}');
    expect(persisted['a/b']?.['1']).toBeUndefined();
  });
});

describe('segmentsEqual', () => {
  it('returns true when content matches regardless of order', () => {
    const a: SubtaskSegment[] = [
      { name: 'pick', start: 0, end: 1 },
      { name: 'place', start: 2, end: 3 },
    ];
    const b: SubtaskSegment[] = [
      { name: 'place', start: 2, end: 3 },
      { name: 'pick', start: 0, end: 1 },
    ];
    expect(segmentsEqual(a, b)).toBe(true);
  });

  it('returns false when any field differs', () => {
    const a: SubtaskSegment[] = [{ name: 'pick', start: 0, end: 1 }];
    const b: SubtaskSegment[] = [{ name: 'pick', start: 0, end: 1.5 }];
    expect(segmentsEqual(a, b)).toBe(false);
  });
});
