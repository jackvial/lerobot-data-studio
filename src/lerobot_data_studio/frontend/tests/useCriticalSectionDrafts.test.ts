import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CRITICAL_SECTION_STORAGE_KEY,
  criticalSectionsEqual,
  useCriticalSectionDrafts,
} from '../src/hooks/useCriticalSectionDrafts';
import { CriticalSection } from '../src/types';

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

describe('useCriticalSectionDrafts', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installRealLocalStorage();
  });

  afterEach(() => {
    store.clear();
  });

  it('starts equal to the saved snapshot when no draft exists', () => {
    const saved: CriticalSection[] = [
      { name: 'critical grasp', start: 0, end: 1, weight: 5 },
    ];
    const { result } = renderHook(() =>
      useCriticalSectionDrafts({
        datasetId: 'a/b',
        episodeId: 0,
        saved,
      })
    );
    expect(result.current.draft).toEqual(saved);
    expect(result.current.isDirty).toBe(false);
  });

  it('marks the draft dirty after edits and persists weight changes under the dedicated storage key', () => {
    const saved: CriticalSection[] = [
      { name: 'critical grasp', start: 0, end: 1, weight: 5 },
    ];
    const { result } = renderHook(() =>
      useCriticalSectionDrafts({
        datasetId: 'a/b',
        episodeId: 5,
        saved,
      })
    );

    act(() => {
      result.current.setDraft([
        { name: 'critical grasp', start: 0, end: 1, weight: 9 },
      ]);
    });

    expect(result.current.draft).toEqual([
      { name: 'critical grasp', start: 0, end: 1, weight: 9 },
    ]);
    expect(result.current.isDirty).toBe(true);

    const persisted = JSON.parse(
      store.get(CRITICAL_SECTION_STORAGE_KEY) ?? '{}'
    );
    expect(persisted['a/b']['5']).toEqual([
      { name: 'critical grasp', start: 0, end: 1, weight: 9 },
    ]);

    // Subtask drafts must not be touched by the critical-section hook.
    expect(store.get('subtaskAnnotationDrafts')).toBeUndefined();
  });

  it('clears the persisted draft when the draft matches saved again (including weight)', () => {
    const saved: CriticalSection[] = [
      { name: 'critical grasp', start: 0, end: 1, weight: 5 },
    ];
    const { result } = renderHook(() =>
      useCriticalSectionDrafts({
        datasetId: 'a/b',
        episodeId: 7,
        saved,
      })
    );

    act(() => {
      result.current.setDraft([
        { name: 'critical grasp', start: 0, end: 1, weight: 6 },
      ]);
    });
    let persisted = JSON.parse(
      store.get(CRITICAL_SECTION_STORAGE_KEY) ?? '{}'
    );
    expect(persisted['a/b']['7']).toBeDefined();

    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.isDirty).toBe(false);

    persisted = JSON.parse(store.get(CRITICAL_SECTION_STORAGE_KEY) ?? '{}');
    expect(persisted['a/b']?.['7']).toBeUndefined();
  });

  it('rehydrates the draft from localStorage on mount and preserves weight', () => {
    store.set(
      CRITICAL_SECTION_STORAGE_KEY,
      JSON.stringify({
        'a/b': {
          '3': [
            { name: 'critical contact', start: 4, end: 5, weight: 7.5 },
          ],
        },
      })
    );

    const saved: CriticalSection[] = [];
    const { result } = renderHook(() =>
      useCriticalSectionDrafts({
        datasetId: 'a/b',
        episodeId: 3,
        saved,
      })
    );

    expect(result.current.draft).toEqual([
      { name: 'critical contact', start: 4, end: 5, weight: 7.5 },
    ]);
    expect(result.current.isDirty).toBe(true);
  });

  it('clearDraft removes the persisted entry', () => {
    const saved: CriticalSection[] = [];
    const { result } = renderHook(() =>
      useCriticalSectionDrafts({
        datasetId: 'a/b',
        episodeId: 1,
        saved,
      })
    );

    act(() => {
      result.current.setDraft([
        { name: 'critical grasp', start: 0, end: 1, weight: 5 },
      ]);
    });

    act(() => {
      result.current.clearDraft();
    });

    const persisted = JSON.parse(
      store.get(CRITICAL_SECTION_STORAGE_KEY) ?? '{}'
    );
    expect(persisted['a/b']?.['1']).toBeUndefined();
  });
});

describe('criticalSectionsEqual', () => {
  it('returns true when content matches regardless of order', () => {
    const a: CriticalSection[] = [
      { name: 'critical grasp', start: 0, end: 1, weight: 5 },
      { name: 'critical contact', start: 2, end: 3, weight: 6 },
    ];
    const b: CriticalSection[] = [
      { name: 'critical contact', start: 2, end: 3, weight: 6 },
      { name: 'critical grasp', start: 0, end: 1, weight: 5 },
    ];
    expect(criticalSectionsEqual(a, b)).toBe(true);
  });

  it('returns false when weight differs', () => {
    const a: CriticalSection[] = [
      { name: 'critical grasp', start: 0, end: 1, weight: 5 },
    ];
    const b: CriticalSection[] = [
      { name: 'critical grasp', start: 0, end: 1, weight: 6 },
    ];
    expect(criticalSectionsEqual(a, b)).toBe(false);
  });
});
