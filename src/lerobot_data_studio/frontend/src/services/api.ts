import axios from 'axios';
import {
  CriticalSectionLabelsResponse,
  CriticalSectionsResponse,
  CriticalSectionsSummaryResponse,
  DatasetListResponse,
  EpisodeData,
  CreateDatasetRequest,
  CreateDatasetResponse,
  DatasetLoadingStatus,
  CreateTaskStatus,
  IdleAnalysisResponse,
  SaveCriticalSectionsRequest,
  SaveSubtaskAnnotationsRequest,
  SubtaskAnnotationsResponse,
  SubtaskAnnotationsSummaryResponse,
  SubtaskTaskListResponse,
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

  // Get idle-time analysis for an episode
  getIdleAnalysis: async (
    namespace: string,
    name: string,
    episodeId: number,
    options?: { threshold?: number; minDuration?: number }
  ): Promise<IdleAnalysisResponse> => {
    const params: Record<string, number> = {};
    if (options?.threshold !== undefined) {
      params.threshold = options.threshold;
    }
    if (options?.minDuration !== undefined) {
      params.min_duration = options.minDuration;
    }
    const response = await api.get<IdleAnalysisResponse>(
      `/datasets/${namespace}/${name}/episodes/${episodeId}/idle`,
      { params }
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

  // Get dataset creation task status
  getCreateStatus: async (taskId: string): Promise<CreateTaskStatus> => {
    const response = await api.get<CreateTaskStatus>(
      `/datasets/create/status/${taskId}`
    );
    return response.data;
  },

  // Get the configured subtask task list
  getSubtaskTasks: async (): Promise<SubtaskTaskListResponse> => {
    const response = await api.get<SubtaskTaskListResponse>('/subtasks/tasks');
    return response.data;
  },

  // Get all subtask annotations for a dataset
  getSubtaskAnnotations: async (
    namespace: string,
    name: string
  ): Promise<SubtaskAnnotationsResponse> => {
    const response = await api.get<SubtaskAnnotationsResponse>(
      `/datasets/${namespace}/${name}/subtasks`
    );
    return response.data;
  },

  // Get per-episode annotation summary used by the sidebar badges
  getSubtaskAnnotationsSummary: async (
    namespace: string,
    name: string
  ): Promise<SubtaskAnnotationsSummaryResponse> => {
    const response = await api.get<SubtaskAnnotationsSummaryResponse>(
      `/datasets/${namespace}/${name}/subtasks/summary`
    );
    return response.data;
  },

  // Save subtask annotations for a single episode
  saveSubtaskAnnotations: async (
    namespace: string,
    name: string,
    episodeId: number,
    request: SaveSubtaskAnnotationsRequest
  ): Promise<SubtaskAnnotationsResponse> => {
    const response = await api.put<SubtaskAnnotationsResponse>(
      `/datasets/${namespace}/${name}/episodes/${episodeId}/subtasks`,
      request
    );
    return response.data;
  },

  // Get the configured critical-section label list
  getCriticalSectionLabels: async (): Promise<CriticalSectionLabelsResponse> => {
    const response = await api.get<CriticalSectionLabelsResponse>(
      '/critical-sections/labels'
    );
    return response.data;
  },

  // Get all critical-section annotations for a dataset
  getCriticalSections: async (
    namespace: string,
    name: string
  ): Promise<CriticalSectionsResponse> => {
    const response = await api.get<CriticalSectionsResponse>(
      `/datasets/${namespace}/${name}/critical-sections`
    );
    return response.data;
  },

  // Get per-episode critical-section summary used by the sidebar badges
  getCriticalSectionsSummary: async (
    namespace: string,
    name: string
  ): Promise<CriticalSectionsSummaryResponse> => {
    const response = await api.get<CriticalSectionsSummaryResponse>(
      `/datasets/${namespace}/${name}/critical-sections/summary`
    );
    return response.data;
  },

  // Save critical-section annotations for a single episode
  saveCriticalSections: async (
    namespace: string,
    name: string,
    episodeId: number,
    request: SaveCriticalSectionsRequest
  ): Promise<CriticalSectionsResponse> => {
    const response = await api.put<CriticalSectionsResponse>(
      `/datasets/${namespace}/${name}/episodes/${episodeId}/critical-sections`,
      request
    );
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
