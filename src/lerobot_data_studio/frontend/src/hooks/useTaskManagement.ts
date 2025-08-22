import { useState, useEffect } from 'react';

interface TaskData {
  availableTasks: string[];
  episodeTasks: Record<number, string>; // episodeId -> selected task
}

const TASK_STORAGE_KEY = 'lerobot_task_management';

export const useTaskManagement = (datasetId: string) => {
  const [availableTasks, setAvailableTasks] = useState<string[]>([]);
  const [episodeTasks, setEpisodeTasks] = useState<Record<number, string>>({});

  const storageKey = `${TASK_STORAGE_KEY}_${datasetId}`;

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const data: TaskData = JSON.parse(stored);
        setAvailableTasks(data.availableTasks || []);
        setEpisodeTasks(data.episodeTasks || {});
      } catch (error) {
        console.error('Failed to parse task data from localStorage:', error);
      }
    }
  }, [storageKey]);

  // Save to localStorage whenever data changes
  useEffect(() => {
    const data: TaskData = {
      availableTasks,
      episodeTasks,
    };
    localStorage.setItem(storageKey, JSON.stringify(data));
  }, [availableTasks, episodeTasks, storageKey]);

  const addTask = (task: string) => {
    if (task && !availableTasks.includes(task)) {
      setAvailableTasks((prev) => [...prev, task]);
    }
  };

  const removeTask = (task: string) => {
    setAvailableTasks((prev) => prev.filter((t) => t !== task));
    // Remove this task from any episodes that have it selected
    setEpisodeTasks((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((episodeId) => {
        if (updated[parseInt(episodeId)] === task) {
          delete updated[parseInt(episodeId)];
        }
      });
      return updated;
    });
  };

  const setEpisodeTask = (episodeId: number, task: string | undefined) => {
    if (task === undefined) {
      setEpisodeTasks((prev) => {
        const updated = { ...prev };
        delete updated[episodeId];
        return updated;
      });
    } else {
      setEpisodeTasks((prev) => ({
        ...prev,
        [episodeId]: task,
      }));
    }
  };

  const getEpisodeTask = (episodeId: number): string | undefined => {
    return episodeTasks[episodeId];
  };

  const getDefaultTask = (): string | undefined => {
    return availableTasks[0];
  };

  return {
    availableTasks,
    addTask,
    removeTask,
    setEpisodeTask,
    getEpisodeTask,
    getDefaultTask,
  };
};
