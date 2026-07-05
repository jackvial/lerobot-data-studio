import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  datasetApi,
  getApiErrorDetail,
  getApiErrorStatus,
} from '../src/services/api';

const jsonResponse = (
  body: unknown,
  init: { status?: number; statusText?: string } = {}
): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers: { 'Content-Type': 'application/json' },
  });

const mockFetch = (response: Response): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('datasetApi', () => {
  it('GETs and parses JSON', async () => {
    const fetchMock = mockFetch(jsonResponse({ episodes: [0, 1] }));

    const result = await datasetApi.listEpisodes('ns', 'name');

    expect(result).toEqual({ episodes: [0, 1] });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/datasets/ns/name/episodes',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('serializes query params', async () => {
    const fetchMock = mockFetch(jsonResponse({ status: 'ready' }));

    await datasetApi.getDatasetStatus('ns', 'name', true);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/datasets/ns/name/status?auto_load=true',
      expect.anything()
    );
  });

  it('POSTs JSON bodies with the content-type header', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ success: true, new_repo_id: 'a/b', message: 'ok' })
    );

    await datasetApi.createDataset({
      original_repo_id: 'a/orig',
      new_repo_id: 'a/b',
      selected_episodes: [1, 2],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/datasets/create');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      original_repo_id: 'a/orig',
      new_repo_id: 'a/b',
      selected_episodes: [1, 2],
    });
  });

  it('throws ApiError carrying status and parsed body on failure', async () => {
    mockFetch(
      jsonResponse(
        { detail: 'Dataset is being loaded. Please check status.' },
        { status: 202, statusText: 'Accepted' }
      )
    );

    const error = await datasetApi.getEpisode('ns', 'name', 0).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(getApiErrorStatus(error)).toBe(202);
    expect(getApiErrorDetail(error)).toBe(
      'Dataset is being loaded. Please check status.'
    );
  });

  it('handles non-JSON error bodies', async () => {
    mockFetch(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const error = await datasetApi.listDatasets().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(getApiErrorStatus(error)).toBe(502);
    expect(getApiErrorDetail(error)).toBeUndefined();
    expect((error as ApiError).data).toBe('Bad Gateway');
  });

  it('error helpers return undefined for non-ApiError values', () => {
    expect(getApiErrorStatus(new Error('nope'))).toBeUndefined();
    expect(getApiErrorDetail({ response: { status: 500 } })).toBeUndefined();
  });
});
