import {
  DatasetListResponse,
  EpisodeData,
  CreateDatasetRequest,
  CreateDatasetResponse,
  DatasetLoadingStatus,
  CreateTaskStatus,
} from '@/types';

const API_BASE_URL = '/api';
const REQUEST_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, statusText: string, data: unknown) {
    super(`Request failed with status ${status}${statusText ? ` (${statusText})` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export const getApiErrorStatus = (error: unknown): number | undefined =>
  error instanceof ApiError ? error.status : undefined;

export const getApiErrorDetail = (error: unknown): unknown =>
  error instanceof ApiError && typeof error.data === 'object' && error.data !== null
    ? (error.data as { detail?: unknown }).detail
    : undefined;

interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const buildUrl = (
  path: string,
  params?: RequestOptions['params']
): string => {
  const url = `${API_BASE_URL}${path}`;
  if (!params) {
    return url;
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }

  const queryString = query.toString();
  return queryString ? `${url}?${queryString}` : url;
};

const request = async <T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const response = await fetch(buildUrl(path, options.params), {
    method: options.method ?? 'GET',
    headers:
      options.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  const data: unknown = isJson ? await response.json() : await response.text();

  // The backend answers 202 (Accepted) when a dataset is still loading.
  // That is a success status for fetch, but callers must treat it as
  // "not ready yet", so surface it as an error alongside real failures.
  if (!response.ok || response.status === 202) {
    throw new ApiError(response.status, response.statusText, data);
  }

  return data as T;
};

export const datasetApi = {
  // Get list of available datasets
  listDatasets: (): Promise<DatasetListResponse> => request('/datasets'),

  // Get dataset loading status
  getDatasetStatus: (
    namespace: string,
    name: string,
    autoLoad: boolean = false
  ): Promise<DatasetLoadingStatus> =>
    request(`/datasets/${namespace}/${name}/status`, {
      params: { auto_load: autoLoad },
    }),

  // Get episode data
  getEpisode: (
    namespace: string,
    name: string,
    episodeId: number
  ): Promise<EpisodeData> =>
    request(`/datasets/${namespace}/${name}/episodes/${episodeId}`),

  // List all episode IDs for a dataset
  listEpisodes: (
    namespace: string,
    name: string
  ): Promise<{ episodes: number[] }> =>
    request(`/datasets/${namespace}/${name}/episodes`),

  // Create new dataset from selected episodes
  createDataset: (
    requestBody: CreateDatasetRequest
  ): Promise<CreateDatasetResponse> =>
    request('/datasets/create', { method: 'POST', body: requestBody }),

  // Search datasets by prefix
  searchDatasets: (prefix: string): Promise<{ repo_ids: string[] }> =>
    request('/datasets/search', { params: { prefix } }),

  // List datasets for a user
  listUserDatasets: (username: string): Promise<{ repo_ids: string[] }> =>
    request(`/datasets/user/${username}`),

  // Validate if a dataset exists
  validateDataset: (
    namespace: string,
    name: string
  ): Promise<{ exists: boolean; message?: string }> =>
    request(`/datasets/validate/${namespace}/${name}`),

  // Get dataset creation task status
  getCreateStatus: (taskId: string): Promise<CreateTaskStatus> =>
    request(`/datasets/create/status/${taskId}`),

  // Get current user info
  getCurrentUser: (): Promise<{
    username: string | null;
    fullname?: string;
    avatar_url?: string;
    error?: string;
  }> => request('/user/whoami'),
};
