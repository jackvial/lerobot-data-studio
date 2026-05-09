import axios from 'axios';
import {
  RltEpisodeLabel,
  RltEpisodeReviewResponse,
  RltBufferFilesResponse,
  RltEpisodesResponse,
  RltTransitionsResponse,
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const rltBufferApi = {
  listFiles: async (path?: string): Promise<RltBufferFilesResponse> => {
    const response = await api.get<RltBufferFilesResponse>('/rlt_buffer/files', {
      params: path ? { path } : undefined,
    });
    return response.data;
  },

  listEpisodes: async (fileToken: string): Promise<RltEpisodesResponse> => {
    const response = await api.get<RltEpisodesResponse>(
      `/rlt_buffer/${encodeURIComponent(fileToken)}/episodes`
    );
    return response.data;
  },

  listTransitions: async (
    fileToken: string,
    episodeId: number
  ): Promise<RltTransitionsResponse> => {
    const response = await api.get<RltTransitionsResponse>(
      `/rlt_buffer/${encodeURIComponent(fileToken)}/episodes/${episodeId}/transitions`
    );
    return response.data;
  },

  saveEpisodeReview: async (
    fileToken: string,
    episodeId: number,
    label: RltEpisodeLabel,
    deleted: boolean
  ): Promise<RltEpisodeReviewResponse> => {
    const response = await api.put<RltEpisodeReviewResponse>(
      `/rlt_buffer/${encodeURIComponent(fileToken)}/episodes/${episodeId}/review`,
      { label, deleted }
    );
    return response.data;
  },

  // The image endpoint is consumed via plain `<img src=...>` so the browser can
  // stream the JPEG directly. Centralize URL construction to keep the wire
  // format in one place.
  imageUrl: (fileToken: string, transitionIndex: number, cameraKey: string): string => {
    return `/api/rlt_buffer/${encodeURIComponent(fileToken)}/transitions/${transitionIndex}/image/${encodeURIComponent(cameraKey)}`;
  },
};
