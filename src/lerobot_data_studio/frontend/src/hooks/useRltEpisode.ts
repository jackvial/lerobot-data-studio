import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rltBufferApi } from '@/services/rltBufferApi';
import { RltTransitionInfo } from '@/types';
import { transitionStepMs } from '@/utils/rltTimeline';

interface UseRltEpisodeOptions {
  fileToken: string | undefined;
  episodeId: number | undefined;
  defaultFps?: number;
}

export interface UseRltEpisodeResult {
  transitions: RltTransitionInfo[];
  hasInferenceTs: boolean;
  isLoading: boolean;
  error: unknown;
  selectedIndex: number;
  selectedTransition: RltTransitionInfo | undefined;
  setSelectedIndex: (idx: number) => void;
  goPrev: () => void;
  goNext: () => void;
  isPlaying: boolean;
  setPlaying: (playing: boolean) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
}

/** Loads transitions for an episode and exposes scrubber state.
 *
 * Playback advances by wall-clock based on `t_offset_s`, so irregular
 * inference cadence is honored. When the buffer lacks `inference_ts` we fall
 * back to a fixed FPS (`defaultFps`).
 */
export const useRltEpisode = ({
  fileToken,
  episodeId,
  defaultFps = 5,
}: UseRltEpisodeOptions): UseRltEpisodeResult => {
  const enabled = Boolean(fileToken) && episodeId !== undefined;
  const { data, isLoading, error } = useQuery({
    queryKey: ['rlt-buffer-transitions', fileToken, episodeId],
    queryFn: () => rltBufferApi.listTransitions(fileToken as string, episodeId as number),
    enabled,
  });

  const transitions = useMemo(() => data?.transitions ?? [], [data]);
  const hasInferenceTs = data?.has_inference_ts ?? false;

  const [selectedIndex, setSelectedIndexState] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  useEffect(() => {
    setSelectedIndexState(0);
    setPlaying(false);
  }, [fileToken, episodeId]);

  const setSelectedIndex = useCallback(
    (idx: number) => {
      if (transitions.length === 0) {
        setSelectedIndexState(0);
        return;
      }
      const clamped = Math.max(0, Math.min(transitions.length - 1, idx));
      setSelectedIndexState(clamped);
    },
    [transitions.length]
  );

  const goPrev = useCallback(() => {
    setSelectedIndexState((prev) => Math.max(0, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setSelectedIndexState((prev) => {
      if (transitions.length === 0) {
        return 0;
      }
      return Math.min(transitions.length - 1, prev + 1);
    });
  }, [transitions.length]);

  const timeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying || transitions.length === 0) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    if (selectedIndex >= transitions.length - 1) {
      setPlaying(false);
      return;
    }

    const current = transitions[selectedIndex];
    const next = transitions[selectedIndex + 1];
    const delay = transitionStepMs(current, next, playbackSpeed, hasInferenceTs, defaultFps);

    timeoutRef.current = window.setTimeout(() => {
      setSelectedIndexState((prev) => Math.min(transitions.length - 1, prev + 1));
    }, Math.max(delay, 16));

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isPlaying, selectedIndex, transitions, playbackSpeed, hasInferenceTs, defaultFps]);

  const selectedTransition = transitions[selectedIndex];

  return {
    transitions,
    hasInferenceTs,
    isLoading,
    error,
    selectedIndex,
    selectedTransition,
    setSelectedIndex,
    goPrev,
    goNext,
    isPlaying,
    setPlaying,
    playbackSpeed,
    setPlaybackSpeed,
  };
};
