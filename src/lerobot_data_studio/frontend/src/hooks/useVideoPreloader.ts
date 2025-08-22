import { useEffect, useRef } from 'react';

export const useVideoPreloader = (
  currentEpisodeId: number,
  totalEpisodes: number,
  getVideoUrl: (episodeId: number) => string | undefined,
  preloadCount: number = 2
) => {
  const preloadedVideos = useRef<Map<number, HTMLVideoElement>>(new Map());

  useEffect(() => {
    // Clear old preloaded videos
    const currentPreloaded = new Set<number>();

    // Preload previous episodes
    for (let i = 1; i <= preloadCount; i++) {
      const prevId = currentEpisodeId - i;
      if (prevId >= 0) {
        preloadVideo(prevId);
        currentPreloaded.add(prevId);
      }
    }

    // Preload next episodes
    for (let i = 1; i <= preloadCount; i++) {
      const nextId = currentEpisodeId + i;
      if (nextId < totalEpisodes) {
        preloadVideo(nextId);
        currentPreloaded.add(nextId);
      }
    }

    // Remove videos that are no longer needed
    preloadedVideos.current.forEach((video, episodeId) => {
      if (!currentPreloaded.has(episodeId) && episodeId !== currentEpisodeId) {
        video.src = '';
        video.load();
        preloadedVideos.current.delete(episodeId);
      }
    });
  }, [currentEpisodeId, totalEpisodes, getVideoUrl, preloadCount]);

  const preloadVideo = (episodeId: number) => {
    if (preloadedVideos.current.has(episodeId)) {
      return;
    }

    const videoUrl = getVideoUrl(episodeId);
    if (!videoUrl) return;

    const video = document.createElement('video');
    video.src = videoUrl;
    video.preload = 'auto';
    video.muted = true;

    // Start loading the video
    video.load();

    preloadedVideos.current.set(episodeId, video);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      preloadedVideos.current.forEach((video) => {
        video.src = '';
        video.load();
      });
      preloadedVideos.current.clear();
    };
  }, []);

  return {
    isPreloaded: (episodeId: number) => preloadedVideos.current.has(episodeId),
  };
};
