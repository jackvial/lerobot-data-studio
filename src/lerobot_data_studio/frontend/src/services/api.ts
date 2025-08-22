import axios from 'axios';
import {
  DatasetListResponse,
  EpisodeData,
  CreateDatasetRequest,
  CreateDatasetResponse,
  DatasetLoadingStatus,
  CreateTaskStatus,
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for error handling
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export const datasetApi = {
  // Get list of available datasets
  listDatasets: async (): Promise<DatasetListResponse> => {
    const response = await api.get<DatasetListResponse>('/datasets');
    return response.data;
  },

  // Get dataset loading status
  getDatasetStatus: async (
    namespace: string,
    name: string,
    autoLoad: boolean = false
  ): Promise<DatasetLoadingStatus> => {
    const response = await api.get<DatasetLoadingStatus>(
      `/datasets/${namespace}/${name}/status`,
      {
        params: { auto_load: autoLoad },
      }
    );
    return response.data;
  },

  // Get episode data
  getEpisode: async (
    namespace: string,
    name: string,
    episodeId: number
  ): Promise<EpisodeData> => {
    const response = await api.get<EpisodeData>(
      `/datasets/${namespace}/${name}/episodes/${episodeId}`
    );
    return response.data;
  },

  // List all episode IDs for a dataset
  listEpisodes: async (
    namespace: string,
    name: string
  ): Promise<{ episodes: number[] }> => {
    const response = await api.get<{ episodes: number[] }>(
      `/datasets/${namespace}/${name}/episodes`
    );
    return response.data;
  },

  // Create new dataset from selected episodes
  createDataset: async (
    request: CreateDatasetRequest
  ): Promise<CreateDatasetResponse> => {
    const response = await api.post<CreateDatasetResponse>(
      '/datasets/create',
      request
    );
    return response.data;
  },

  // Search datasets by prefix
  searchDatasets: async (prefix: string): Promise<{ repo_ids: string[] }> => {
    const response = await api.get<{ repo_ids: string[] }>('/datasets/search', {
      params: { prefix },
    });
    return response.data;
  },

  // List datasets for a user
  listUserDatasets: async (
    username: string
  ): Promise<{ repo_ids: string[] }> => {
    const response = await api.get<{ repo_ids: string[] }>(
      `/datasets/user/${username}`
    );
    return response.data;
  },

  // Validate if a dataset exists
  validateDataset: async (
    namespace: string,
    name: string
  ): Promise<{ exists: boolean; message?: string }> => {
    const response = await api.get<{ exists: boolean; message?: string }>(
      `/datasets/validate/${namespace}/${name}`
    );
    return response.data;
  },

  // Merge multiple datasets
  mergeDatasets: async (request: {
    dataset_ids: string[];
    new_repo_id: string;
    tolerance_s?: number;
  }): Promise<{
    success: boolean;
    new_repo_id: string;
    message: string;
    task_id?: string;
  }> => {
    const response = await api.post('/datasets/merge', request);
    return response.data;
  },

  // Get dataset creation task status
  getCreateStatus: async (taskId: string): Promise<CreateTaskStatus> => {
    const response = await api.get<CreateTaskStatus>(
      `/datasets/create/status/${taskId}`
    );
    return response.data;
  },

  // Get merge task status
  getMergeStatus: async (
    taskId: string
  ): Promise<{
    task_id: string;
    status: string;
    progress?: number;
    message?: string;
    new_repo_id?: string;
  }> => {
    const response = await api.get(`/datasets/merge/status/${taskId}`);
    return response.data;
  },

  // Get current user info
  getCurrentUser: async (): Promise<{
    username: string | null;
    fullname?: string;
    avatar_url?: string;
    error?: string;
  }> => {
    const response = await api.get('/user/whoami');
    return response.data;
  },

  // Poll dataset status until ready
  waitForDataset: async (
    namespace: string,
    name: string,
    onProgress?: (status: DatasetLoadingStatus) => void
  ): Promise<void> => {
    const pollInterval = 1000; // 1 second
    const maxRetries = 300; // 5 minutes max
    let retries = 0;

    while (retries < maxRetries) {
      const status = await datasetApi.getDatasetStatus(namespace, name, false);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'ready') {
        return;
      }

      if (status.status === 'error') {
        throw new Error(status.message || 'Dataset loading failed');
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      retries++;
    }

    throw new Error('Dataset loading timeout');
  },
};
