import { useCallback, useEffect, useRef, useState } from 'react';
import {
  QueryObserver,
  QueryObserverOptions,
  QueryState,
  serializeQueryKey,
} from '@/lib/queryObserver';

export interface UseQueryOptions<T>
  extends Omit<QueryObserverOptions<T>, 'fetcher'> {
  key: readonly unknown[];
  fetcher: () => Promise<T>;
}

export interface UseQueryResult<T> extends QueryState<T> {
  refetch: () => void;
}

export const useQuery = <T>({
  key,
  fetcher,
  enabled = true,
  staleTimeMs,
  retry,
  retryDelayMs,
  refetchIntervalMs,
}: UseQueryOptions<T>): UseQueryResult<T> => {
  const serializedKey = serializeQueryKey(key);
  const observerRef = useRef<QueryObserver<T> | null>(null);

  // Keep latest callbacks without restarting the observer on every render.
  const latestRef = useRef({ fetcher, retry, refetchIntervalMs });
  latestRef.current = { fetcher, retry, refetchIntervalMs };

  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    error: undefined,
    isLoading: enabled,
  });

  useEffect(() => {
    if (!enabled) {
      observerRef.current = null;
      return undefined;
    }

    const observer = new QueryObserver<T>(
      serializedKey,
      {
        fetcher: () => latestRef.current.fetcher(),
        enabled,
        staleTimeMs,
        retry: (failureCount, error) =>
          latestRef.current.retry?.(failureCount, error) ?? false,
        retryDelayMs,
        refetchIntervalMs: (data) =>
          latestRef.current.refetchIntervalMs?.(data) ?? false,
      },
      setState
    );

    observerRef.current = observer;
    const initialState = observer.getState();
    setState({ ...initialState, isLoading: initialState.data === undefined });
    observer.start();

    return () => {
      observer.stop();
      if (observerRef.current === observer) {
        observerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedKey, enabled, staleTimeMs, retryDelayMs]);

  const refetch = useCallback(() => {
    observerRef.current?.refetch();
  }, []);

  return { ...state, refetch };
};
