import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Space,
  Slider,
  Tooltip,
  Select,
} from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { VideoInfo } from '@/types';

const CLIP_TOLERANCE_SECONDS = 0.25;

interface VideoPlayerProps {
  videos: VideoInfo[];
  episodeId: number;
  onTimeUpdate?: (time: number) => void;
  sliceStartTime?: number;
  sliceEndTime?: number;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videos,
  episodeId,
  onTimeUpdate,
  sliceStartTime = 0,
  sliceEndTime,
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeekingBySlider, setIsSeekingBySlider] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(3.0); // Default to 3x speed
  const clipStartTime = Math.max(sliceStartTime, 0);
  const expectedClipDuration =
    sliceEndTime !== undefined ? Math.max(sliceEndTime - clipStartTime, 0) : undefined;

  // Speed options from 0.5x to 3x in 0.5x increments
  const speedOptions = [
    { label: '0.5x', value: 0.5 },
    { label: '1x', value: 1.0 },
    { label: '1.5x', value: 1.5 },
    { label: '2x', value: 2.0 },
    { label: '2.5x', value: 2.5 },
    { label: '3x', value: 3.0 },
  ];

  useEffect(() => {
    // Reset refs when videos change
    videoRefs.current = videoRefs.current.slice(0, videos.length);
  }, [videos.length]);

  useEffect(() => {
    setIsPlaying(false);
    setIsSeekingBySlider(false);
    setCurrentTime(0);
    setDuration(
      sliceEndTime !== undefined ? Math.max(sliceEndTime - clipStartTime, 0) : 0
    );
  }, [episodeId, videos.length, clipStartTime, sliceEndTime]);

  // Update playback speed when changed
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.playbackRate = playbackSpeed;
      }
    });
  }, [playbackSpeed]);

  const getMediaSliceStartTime = useCallback(
    (video: HTMLVideoElement | null): number => {
      const hasFullVideoDuration =
        video !== null &&
        Number.isFinite(video.duration) &&
        video.duration > 0 &&
        sliceEndTime !== undefined &&
        video.duration >= sliceEndTime - CLIP_TOLERANCE_SECONDS;

      if (hasFullVideoDuration) {
        return clipStartTime;
      }

      return 0;
    },
    [clipStartTime, sliceEndTime]
  );

  const getVideoEndTime = useCallback(
    (video: HTMLVideoElement | null): number => {
      const hasLoadedDuration =
        video !== null && Number.isFinite(video.duration) && video.duration > 0;
      const mediaStart = getMediaSliceStartTime(video);

      if (!hasLoadedDuration) {
        if (expectedClipDuration !== undefined) {
          return mediaStart + expectedClipDuration;
        }

        return mediaStart;
      }

      if (sliceEndTime !== undefined) {
        if (mediaStart === 0) {
          return Math.min(expectedClipDuration ?? video.duration, video.duration);
        }

        return Math.max(Math.min(sliceEndTime, video.duration), mediaStart);
      }

      return video.duration;
    },
    [expectedClipDuration, getMediaSliceStartTime, sliceEndTime]
  );

  const getClipDuration = useCallback(
    (video: HTMLVideoElement | null): number => {
      return Math.max(getVideoEndTime(video) - getMediaSliceStartTime(video), 0);
    },
    [getMediaSliceStartTime, getVideoEndTime]
  );

  const getClampedAbsoluteTime = useCallback(
    (video: HTMLVideoElement | null, nextAbsoluteTime: number): number => {
      const mediaStart = getMediaSliceStartTime(video);
      const clampedStart = Math.max(nextAbsoluteTime, mediaStart);
      const clipEnd = getVideoEndTime(video);

      if (clipEnd <= mediaStart) {
        return mediaStart;
      }

      return Math.min(clampedStart, clipEnd);
    },
    [getMediaSliceStartTime, getVideoEndTime]
  );

  const updateDisplayedTime = useCallback(
    (
      video: HTMLVideoElement | null,
      nextAbsoluteTime: number,
      nextDuration?: number
    ) => {
      const nextCurrentTime = Math.max(
        nextAbsoluteTime - getMediaSliceStartTime(video),
        0
      );
      setCurrentTime(nextCurrentTime);

      if (nextDuration !== undefined) {
        setDuration(nextDuration);
      }

      if (onTimeUpdate) {
        onTimeUpdate(nextCurrentTime);
      }
    },
    [getMediaSliceStartTime, onTimeUpdate]
  );

  const pauseAllVideos = useCallback(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.pause();
      }
    });
    setIsPlaying(false);
  }, []);

  const seekAllVideos = useCallback(
    (nextAbsoluteTime: number) => {
      videoRefs.current.forEach((video) => {
        if (video) {
          video.currentTime = getClampedAbsoluteTime(video, nextAbsoluteTime);
        }
      });
    },
    [getClampedAbsoluteTime]
  );

  const togglePlayback = useCallback(() => {
    const allVideos = videoRefs.current.filter(
      (video): video is HTMLVideoElement => video !== null
    );
    const firstVideo = allVideos[0];

    if (!firstVideo) {
      return;
    }

    if (isPlaying) {
      pauseAllVideos();
      return;
    }

    const clipDuration = getClipDuration(firstVideo);
    if (clipDuration <= 0) {
      const mediaStart = getMediaSliceStartTime(firstVideo);
      seekAllVideos(mediaStart);
      updateDisplayedTime(firstVideo, mediaStart, clipDuration);
      return;
    }

    const mediaStart = getMediaSliceStartTime(firstVideo);
    const clipEnd = getVideoEndTime(firstVideo);
    const shouldRestartFromSliceStart =
      firstVideo.currentTime < mediaStart || firstVideo.currentTime >= clipEnd;

    if (shouldRestartFromSliceStart) {
      seekAllVideos(mediaStart);
      updateDisplayedTime(firstVideo, mediaStart, clipDuration);
    }

    allVideos.forEach((video) => {
      void video.play();
    });
    setIsPlaying(true);
  }, [
    getClipDuration,
    getMediaSliceStartTime,
    getVideoEndTime,
    isPlaying,
    pauseAllVideos,
    seekAllVideos,
    updateDisplayedTime,
  ]);

  // Add keyboard event handler for spacebar
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Check if the target is an input element to avoid conflicts
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Spacebar key
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault(); // Prevent page scroll
        togglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [togglePlayback]);

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (isSeekingBySlider) {
      return;
    }

    const video = e.currentTarget;
    const mediaStart = getMediaSliceStartTime(video);

    if (video.currentTime < mediaStart) {
      video.currentTime = mediaStart;
    }

    const clipEnd = getVideoEndTime(video);
    const clipDuration = getClipDuration(video);

    if (video.currentTime >= clipEnd) {
      videoRefs.current.forEach((currentVideo) => {
        if (currentVideo) {
          currentVideo.currentTime = getClampedAbsoluteTime(currentVideo, clipEnd);
          currentVideo.pause();
        }
      });
      setIsPlaying(false);
      updateDisplayedTime(video, clipEnd, clipDuration);
      return;
    }

    updateDisplayedTime(video, video.currentTime, clipDuration);
  };

  const handleSliderChange = (value: number) => {
    const referenceVideo = videoRefs.current[0];
    const clampedValue = Math.min(Math.max(value, 0), duration);
    const nextAbsoluteTime =
      getMediaSliceStartTime(referenceVideo) + clampedValue;

    setIsSeekingBySlider(true);
    setCurrentTime(clampedValue);

    seekAllVideos(nextAbsoluteTime);

    if (onTimeUpdate) {
      onTimeUpdate(clampedValue);
    }

    // Reset seeking flag after a short delay
    setTimeout(() => setIsSeekingBySlider(false), 100);
  };

  const handlePlayPause = () => {
    togglePlayback();
  };

  const handleStop = () => {
    const referenceVideo = videoRefs.current[0];
    const mediaStart = getMediaSliceStartTime(referenceVideo);

    pauseAllVideos();
    seekAllVideos(mediaStart);
    setCurrentTime(0);

    if (onTimeUpdate) {
      onTimeUpdate(0);
    }
  };

  const syncVideos = (index: number) => {
    if (isSeekingBySlider) {
      return;
    }

    const sourceVideo = videoRefs.current[index];
    if (sourceVideo) {
      const nextAbsoluteTime = getClampedAbsoluteTime(
        sourceVideo,
        sourceVideo.currentTime
      );

      videoRefs.current.forEach((video, i) => {
        if (
          video &&
          i !== index &&
          Math.abs(video.currentTime - nextAbsoluteTime) > 0.1
        ) {
          video.currentTime = getClampedAbsoluteTime(video, nextAbsoluteTime);
        }
      });
    }
  };

  const handleLoadedMetadata = (
    index: number,
    e: React.SyntheticEvent<HTMLVideoElement>
  ) => {
    const video = e.currentTarget;
    const clipDuration = getClipDuration(video);
    const initialAbsoluteTime = getMediaSliceStartTime(video);

    video.currentTime = initialAbsoluteTime;
    video.playbackRate = playbackSpeed;

    if (index === 0) {
      setDuration(clipDuration);
      setCurrentTime(0);
      if (onTimeUpdate) {
        onTimeUpdate(0);
      }
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  return (
    <Card
      title={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Episode {episodeId} Videos</span>
        </div>
      }
      extra={
        <Space>
          <Tooltip title='Press spacebar to play/pause'>
            <Button
              type='primary'
              icon={
                isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />
              }
              onClick={handlePlayPause}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </Button>
          </Tooltip>
          <Button onClick={handleStop}>Stop</Button>
          <Select
            value={playbackSpeed}
            onChange={handleSpeedChange}
            options={speedOptions}
            style={{ width: 80 }}
            size='small'
          />
          <span style={{ color: 'rgba(255, 255, 255, 0.65)' }}>
            {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
          </span>
        </Space>
      }
    >
      <Row gutter={[16, 16]}>
        {videos.map((video, index) => (
          <Col key={index} span={8}>
            <div style={{ position: 'relative' }}>
              <video
                ref={(el) => {
                  videoRefs.current[index] = el;
                }}
                src={video.url}
                controls={false}
                style={{ width: '100%', height: 'auto' }}
                onTimeUpdate={(e) => {
                  handleTimeUpdate(e);
                  syncVideos(index);
                }}
                onLoadedMetadata={(e) => handleLoadedMetadata(index, e)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'rgba(0, 0, 0, 0.7)',
                  padding: '4px 8px',
                  fontSize: '12px',
                  color: 'white',
                }}
              >
                {video.filename}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      <div style={{ marginTop: '16px', padding: '0 8px' }}>
        <Slider
          min={0}
          max={duration}
          value={currentTime}
          step={0.1}
          onChange={handleSliderChange}
          disabled={duration <= 0}
          tooltip={{
            formatter: (value) => `${(value || 0).toFixed(1)}s`,
          }}
        />
      </div>
    </Card>
  );
};

export default VideoPlayer;
