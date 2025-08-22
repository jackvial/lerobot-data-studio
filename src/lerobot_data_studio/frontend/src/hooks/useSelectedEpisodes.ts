import { useState, useEffect } from 'react';

interface SelectedEpisodesState {
  [datasetId: string]: number[];
}

export const useSelectedEpisodes = (datasetId?: string) => {
  const [selectedEpisodes, setSelectedEpisodes] =
    useState<SelectedEpisodesState>({});

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('selectedEpisodes');
    if (stored) {
      try {
        setSelectedEpisodes(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse stored episodes:', e);
      }
    }
  }, []);

  // Save to localStorage whenever selectedEpisodes changes
  useEffect(() => {
    localStorage.setItem('selectedEpisodes', JSON.stringify(selectedEpisodes));
  }, [selectedEpisodes]);

  const toggleEpisode = (episodeId: number) => {
    if (!datasetId) return;

    setSelectedEpisodes((prev) => {
      const current = prev[datasetId] || [];
      const isSelected = current.includes(episodeId);

      if (isSelected) {
        return {
          ...prev,
          [datasetId]: current.filter((id) => id !== episodeId),
        };
      } else {
        return {
          ...prev,
          [datasetId]: [...current, episodeId].sort((a, b) => a - b),
        };
      }
    });
  };

  const clearSelection = () => {
    if (!datasetId) return;

    setSelectedEpisodes((prev) => ({
      ...prev,
      [datasetId]: [],
    }));
  };

  const selectAll = (episodeIds: number[]) => {
    if (!datasetId) return;

    setSelectedEpisodes((prev) => ({
      ...prev,
      [datasetId]: [...episodeIds].sort((a, b) => a - b),
    }));
  };

  const isSelected = (episodeId: number): boolean => {
    if (!datasetId) return false;
    return (selectedEpisodes[datasetId] || []).includes(episodeId);
  };

  const getSelectedForDataset = (): number[] => {
    if (!datasetId) return [];
    return selectedEpisodes[datasetId] || [];
  };

  return {
    selectedEpisodes: getSelectedForDataset(),
    toggleEpisode,
    clearSelection,
    selectAll,
    isSelected,
    selectedCount: getSelectedForDataset().length,
  };
};
