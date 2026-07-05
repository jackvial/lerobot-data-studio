import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QueryCache,
  QueryObserver,
  QueryState,
  serializeQueryKey,
} from '../src/lib/queryObserver';

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('serializeQueryKey', () => {
  it('serializes mixed keys deterministically', () => {
    expect(serializeQueryKey(['episode', 'ns', 'name', 3])).toBe(
      '["episode","ns","name",3]'
    );
  });
});

describe('QueryObserver', () => {
  let cache: QueryCache;
  let states: QueryState<unknown>[];

  const onChange = (state: QueryState<unknown>): void => {
    states.push(state);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new QueryCache();
    states = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and reports data', async () => {
    const observer = new QueryObserver(
      'key',
      { fetcher: async () => 42 },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();

    expect(states.at(-1)).toEqual({ data: 42, error: undefined, isLoading: false });
    expect(cache.get('key')?.data).toBe(42);
  });

  it('serves fresh cached data without fetching', async () => {
    cache.set('key', 'cached', Date.now());
    const fetcher = vi.fn(async () => 'fetched');
    const observer = new QueryObserver(
      'key',
      { fetcher, staleTimeMs: 60_000 },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();

    expect(fetcher).not.toHaveBeenCalled();
    expect(states.at(-1)?.data).toBe('cached');
  });

  it('refetches stale cached data', async () => {
    cache.set('key', 'cached', Date.now() - 10_000);
    const fetcher = vi.fn(async () => 'fetched');
    const observer = new QueryObserver(
      'key',
      { fetcher, staleTimeMs: 1_000 },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(states.at(-1)?.data).toBe('fetched');
  });

  it('retries per the retry policy and then reports the error', async () => {
    const error = new Error('boom');
    const fetcher = vi.fn(async () => {
      throw error;
    });
    const observer = new QueryObserver(
      'key',
      {
        fetcher,
        retry: (failureCount) => failureCount < 3,
        retryDelayMs: 100,
      },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.error).toBeUndefined();

    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(states.at(-1)?.error).toBe(error);

    // No further retries scheduled after the policy gives up.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('polls on the configured interval', async () => {
    let value = 0;
    const fetcher = vi.fn(async () => ++value);
    const observer = new QueryObserver(
      'key',
      { fetcher, refetchIntervalMs: () => 1_000 },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.data).toBe(2);

    observer.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops polling when the interval callback returns false', async () => {
    const fetcher = vi.fn(async () => 'ready');
    const observer = new QueryObserver(
      'key',
      {
        fetcher,
        refetchIntervalMs: (data) => (data === 'ready' ? false : 1_000),
      },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous data reference when a poll returns an identical payload', async () => {
    const fetcher = vi.fn(async () => ({ status: 'ready', progress: 1 }));
    const observer = new QueryObserver(
      'key',
      { fetcher, refetchIntervalMs: () => 1_000 },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();
    const firstData = states.at(-1)?.data;
    const emissionsAfterFirstFetch = states.length;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.data).toBe(firstData);
    // An identical payload must not emit (and therefore not re-render) at all.
    expect(states.length).toBe(emissionsAfterFirstFetch);
  });

  it('ignores results that resolve after stop', async () => {
    let resolveFetch: (value: string) => void = () => undefined;
    const fetcher = vi.fn(
      () => new Promise<string>((resolve) => (resolveFetch = resolve))
    );
    const observer = new QueryObserver('key', { fetcher }, onChange, cache);

    observer.start();
    observer.stop();
    resolveFetch('late');
    await flushMicrotasks();

    expect(states.every((state) => state.data === undefined)).toBe(true);
  });

  it('refetch forces a new fetch even with fresh cache', async () => {
    cache.set('key', 'cached', Date.now());
    const fetcher = vi.fn(async () => 'fetched');
    const observer = new QueryObserver(
      'key',
      { fetcher, staleTimeMs: 60_000 },
      onChange,
      cache
    );

    observer.start();
    await flushMicrotasks();
    expect(fetcher).not.toHaveBeenCalled();

    observer.refetch();
    await flushMicrotasks();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(states.at(-1)?.data).toBe('fetched');
  });

  it('does not fetch when disabled', async () => {
    const fetcher = vi.fn(async () => 'value');
    const observer = new QueryObserver(
      'key',
      { fetcher, enabled: false },
      onChange,
      cache
    );

    observer.start();
    observer.refetch();
    await flushMicrotasks();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
