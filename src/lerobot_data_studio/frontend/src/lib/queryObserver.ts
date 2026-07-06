/**
 * Minimal replacement for the slice of @tanstack/react-query this app used:
 * cached fetches keyed by a serializable key, stale-time reuse, retry policy,
 * and interval refetching. Framework-free so it can be unit tested directly;
 * React integration lives in hooks/useQuery.ts.
 */

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
}

export interface QueryObserverOptions<T> {
  fetcher: () => Promise<T>;
  enabled?: boolean;
  /** Serve cached data without refetching when younger than this. */
  staleTimeMs?: number;
  /** Return true to retry after a failed fetch. */
  retry?: (failureCount: number, error: unknown) => boolean;
  retryDelayMs?: number;
  /** Return a delay to refetch after a successful fetch, or false to stop. */
  refetchIntervalMs?: (data: T | undefined) => number | false;
}

interface CacheEntry {
  data: unknown;
  updatedAt: number;
}

const CACHE_GC_AGE_MS = 10 * 60 * 1000;

export class QueryCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, data: unknown, now: number): void {
    this.entries.set(key, { data, updatedAt: now });
    for (const [entryKey, entry] of this.entries) {
      if (now - entry.updatedAt > CACHE_GC_AGE_MS) {
        this.entries.delete(entryKey);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const defaultQueryCache = new QueryCache();

export const serializeQueryKey = (key: readonly unknown[]): string =>
  JSON.stringify(key);

const isDeepEqualJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export class QueryObserver<T> {
  private readonly key: string;
  private readonly cache: QueryCache;
  private readonly options: QueryObserverOptions<T>;
  private readonly onChange: (state: QueryState<T>) => void;
  private state: QueryState<T>;
  private refetchTimer: number | null = null;
  private failureCount = 0;
  private fetchId = 0;
  private stopped = false;

  constructor(
    key: string,
    options: QueryObserverOptions<T>,
    onChange: (state: QueryState<T>) => void,
    cache: QueryCache = defaultQueryCache
  ) {
    this.key = key;
    this.cache = cache;
    this.options = options;
    this.onChange = onChange;

    const cached = cache.get(key);
    this.state = {
      data: cached?.data as T | undefined,
      error: undefined,
      isLoading: false,
    };
  }

  getState(): QueryState<T> {
    return this.state;
  }

  start(): void {
    if (this.options.enabled === false) {
      return;
    }

    const cached = this.cache.get(this.key);
    const staleTime = this.options.staleTimeMs ?? 0;
    if (cached && Date.now() - cached.updatedAt < staleTime) {
      this.setState({
        data: cached.data as T,
        error: undefined,
        isLoading: false,
      });
      this.scheduleRefetch();
      return;
    }

    void this.fetch();
  }

  stop(): void {
    this.stopped = true;
    this.fetchId += 1;
    this.clearRefetchTimer();
  }

  refetch(): void {
    if (this.stopped || this.options.enabled === false) {
      return;
    }

    this.failureCount = 0;
    this.clearRefetchTimer();
    void this.fetch();
  }

  private async fetch(): Promise<void> {
    const currentFetchId = ++this.fetchId;

    if (this.state.data === undefined) {
      this.setState({ ...this.state, isLoading: true });
    }

    try {
      const data = await this.options.fetcher();
      if (this.stopped || currentFetchId !== this.fetchId) {
        return;
      }

      this.failureCount = 0;
      this.cache.set(this.key, data, Date.now());
      // Reuse the previous reference for identical payloads so React
      // effects/renders keyed on the data don't churn while polling.
      const nextData =
        this.state.data !== undefined && isDeepEqualJson(this.state.data, data)
          ? this.state.data
          : data;
      const unchanged =
        nextData === this.state.data &&
        this.state.error === undefined &&
        !this.state.isLoading;
      if (!unchanged) {
        this.setState({ data: nextData, error: undefined, isLoading: false });
      }
      this.scheduleRefetch();
    } catch (error) {
      if (this.stopped || currentFetchId !== this.fetchId) {
        return;
      }

      this.failureCount += 1;
      if (this.options.retry?.(this.failureCount, error)) {
        this.refetchTimer = setTimeout(
          () => void this.fetch(),
          this.options.retryDelayMs ?? 500
        ) as unknown as number;
        return;
      }

      this.setState({ ...this.state, error, isLoading: false });
    }
  }

  private scheduleRefetch(): void {
    this.clearRefetchTimer();
    const interval = this.options.refetchIntervalMs?.(this.state.data);
    if (interval === false || interval == null) {
      return;
    }

    this.refetchTimer = setTimeout(
      () => void this.fetch(),
      interval
    ) as unknown as number;
  }

  private clearRefetchTimer(): void {
    if (this.refetchTimer !== null) {
      clearTimeout(this.refetchTimer);
      this.refetchTimer = null;
    }
  }

  private setState(state: QueryState<T>): void {
    this.state = state;
    if (!this.stopped) {
      this.onChange(state);
    }
  }
}
