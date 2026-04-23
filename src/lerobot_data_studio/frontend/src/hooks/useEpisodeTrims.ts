import { useEffect, useState } from 'react';
import { EpisodeTrimBounds } from '@/types';

const STORAGE_KEY = 'episodeTrimBounds';

interface EpisodeTrimStore {
  [datasetId: string]: {
    [episodeId: string]: EpisodeTrimBounds;
  };
}

const isTrimBounds = (value: unknown): value is EpisodeTrimBounds => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybeTrim = value as EpisodeTrimBounds;
  return (
    Number.isFinite(maybeTrim.start_time) &&
    Number.isFinite(maybeTrim.end_time) &&
    maybeTrim.end_time > maybeTrim.start_time
  );
};

const parseTrimStore = (raw: string | null): EpisodeTrimStore => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const nextStore: EpisodeTrimStore = {};
    Object.entries(parsed).forEach(([datasetId, datasetValue]) => {
      if (!datasetValue || typeof datasetValue !== 'object') {
        return;
      }

      const nextDatasetEntry: Record<string, EpisodeTrimBounds> = {};
      Object.entries(datasetValue).forEach(([episodeId, trimValue]) => {
        if (isTrimBounds(trimValue)) {
          nextDatasetEntry[episodeId] = {
            start_time: trimValue.start_time,
            end_time: trimValue.end_time,
          };
        }
      });

      if (Object.keys(nextDatasetEntry).length > 0) {
        nextStore[datasetId] = nextDatasetEntry;
      }
    });

    return nextStore;
  } catch (error) {
    console.error('Failed to parse stored episode trims:', error);
    return {};
  }
};

export const useEpisodeTrims = (datasetId?: string) => {
  const [trimStore, setTrimStore] = useState<EpisodeTrimStore>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    setTrimStore(parseTrimStore(window.localStorage.getItem(STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimStore));
  }, [trimStore]);

  const getTrimForEpisode = (episodeId: number): EpisodeTrimBounds | null => {
    if (!datasetId) {
      return null;
    }
    return trimStore[datasetId]?.[String(episodeId)] ?? null;
  };

  const setTrimForEpisode = (episodeId: number, trim: EpisodeTrimBounds) => {
    if (!datasetId) {
      return;
    }

    setTrimStore((prev) => ({
      ...prev,
      [datasetId]: {
        ...(prev[datasetId] ?? {}),
        [String(episodeId)]: trim,
      },
    }));
  };

  const clearTrimForEpisode = (episodeId: number) => {
    if (!datasetId) {
      return;
    }

    setTrimStore((prev) => {
      const datasetEntry = { ...(prev[datasetId] ?? {}) };
      delete datasetEntry[String(episodeId)];

      if (Object.keys(datasetEntry).length === 0) {
        const nextStore = { ...prev };
        delete nextStore[datasetId];
        return nextStore;
      }

      return {
        ...prev,
        [datasetId]: datasetEntry,
      };
    });
  };

  const getTrimMapForEpisodes = (
    episodeIds: number[]
  ): Record<number, EpisodeTrimBounds> => {
    if (!datasetId) {
      return {};
    }

    const datasetEntry = trimStore[datasetId] ?? {};
    const trimMap: Record<number, EpisodeTrimBounds> = {};
    episodeIds.forEach((episodeId) => {
      const trim = datasetEntry[String(episodeId)];
      if (trim) {
        trimMap[episodeId] = trim;
      }
    });
    return trimMap;
  };

  return {
    getTrimForEpisode,
    setTrimForEpisode,
    clearTrimForEpisode,
    getTrimMapForEpisodes,
  };
};
