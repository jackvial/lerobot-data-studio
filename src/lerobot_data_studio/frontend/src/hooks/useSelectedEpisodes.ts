import { useState, useEffect, useCallback, useMemo } from 'react';

interface SelectedEpisodesState {
  [datasetId: string]: number[];
}

const EMPTY_SELECTION: number[] = [];

export const useSelectedEpisodes = (datasetId?: string) => {
  const [selectedByDataset, setSelectedByDataset] =
    useState<SelectedEpisodesState>({});

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('selectedEpisodes');
    if (stored) {
      try {
        setSelectedByDataset(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse stored episodes:', e);
      }
    }
  }, []);

  // Save to localStorage whenever the selection changes
  useEffect(() => {
    localStorage.setItem('selectedEpisodes', JSON.stringify(selectedByDataset));
  }, [selectedByDataset]);

  const toggleEpisode = useCallback(
    (episodeId: number) => {
      if (!datasetId) return;

      setSelectedByDataset((prev) => {
        const current = prev[datasetId] || [];
        const isSelected = current.includes(episodeId);

        if (isSelected) {
          return {
            ...prev,
            [datasetId]: current.filter((id) => id !== episodeId),
          };
        }

        return {
          ...prev,
          [datasetId]: [...current, episodeId].sort((a, b) => a - b),
        };
      });
    },
    [datasetId]
  );

  const clearSelection = useCallback(() => {
    if (!datasetId) return;

    setSelectedByDataset((prev) => ({
      ...prev,
      [datasetId]: [],
    }));
  }, [datasetId]);

  const selectAll = useCallback(
    (episodeIds: number[]) => {
      if (!datasetId) return;

      setSelectedByDataset((prev) => ({
        ...prev,
        [datasetId]: [...episodeIds].sort((a, b) => a - b),
      }));
    },
    [datasetId]
  );

  const selectedEpisodes = useMemo(
    () => (datasetId && selectedByDataset[datasetId]) || EMPTY_SELECTION,
    [datasetId, selectedByDataset]
  );

  const isSelected = useCallback(
    (episodeId: number): boolean => selectedEpisodes.includes(episodeId),
    [selectedEpisodes]
  );

  return {
    selectedEpisodes,
    toggleEpisode,
    clearSelection,
    selectAll,
    isSelected,
    selectedCount: selectedEpisodes.length,
  };
};
