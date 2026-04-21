import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  VideoTimeRange,
  clampToVideoRange,
  getVideoTimeRange,
} from '@/utils/episodeTiming';

interface VideoPlayerProps {
  videos: VideoInfo[];
  episodeId: number;
  onTimeUpdate?: (time: number) => void;
}

const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1.0 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2.0 },
  { label: '2.5x', value: 2.5 },
  { label: '3x', value: 3.0 },
];

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videos,
  episodeId,
  onTimeUpdate,
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeekingBySlider, setIsSeekingBySlider] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(3.0);

  const videoRanges = useMemo(
    () => videos.map((video) => getVideoTimeRange(video)),
    [videos]
  );

  const referenceRange: VideoTimeRange = videoRanges[0] ?? {
    fromTimestamp: 0,
    toTimestamp: null,
    duration: null,
  };

  const [duration, setDuration] = useState(referenceRange.duration ?? 0);

  useEffect(() => {
    videoRefs.current = videoRefs.current.slice(0, videos.length);
  }, [videos.length]);

  const getVideoUpperBound = useCallback(
    (index: number, mediaDuration: number): number => {
      const range = videoRanges[index];
      if (!range) {
        return mediaDuration || 0;
      }
      if (range.toTimestamp != null) {
        return mediaDuration > 0
          ? Math.min(range.toTimestamp, mediaDuration)
          : range.toTimestamp;
      }
      return mediaDuration || range.fromTimestamp;
    },
    [videoRanges]
  );

  const seekVideoToOffset = useCallback(
    (
      video: HTMLVideoElement,
      index: number,
      relativeTime: number
    ): number => {
      const range = videoRanges[index] ?? referenceRange;
      const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
      const absoluteTarget = range.fromTimestamp + Math.max(relativeTime, 0);
      const clamped = clampToVideoRange(absoluteTarget, range, mediaDuration);
      video.currentTime = clamped;
      return clamped - range.fromTimestamp;
    },
    [referenceRange, videoRanges]
  );

  const seekAllToOffset = useCallback(
    (relativeTime: number) => {
      videoRefs.current.forEach((video, index) => {
        if (video) {
          seekVideoToOffset(video, index, relativeTime);
        }
      });
    },
    [seekVideoToOffset]
  );

  const pauseAllVideos = useCallback(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.pause();
      }
    });
    setIsPlaying(false);
  }, []);

  // When the episode (and therefore the slice window) changes, snap every
  // loaded video back to its slice start. This is essential because v3 LeRobot
  // datasets pack multiple episodes into the same mp4, so React keeps the
  // existing <video> element when the URL doesn't change between episodes.
  useEffect(() => {
    setIsPlaying(false);
    setIsSeekingBySlider(false);
    setCurrentTime(0);
    setDuration(referenceRange.duration ?? 0);
    seekAllToOffset(0);
    if (onTimeUpdate) {
      onTimeUpdate(0);
    }
    // We intentionally exclude onTimeUpdate from the dependency array so that
    // a parent re-rendering with a fresh callback identity does not keep
    // resetting the player while the episode is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    episodeId,
    referenceRange.fromTimestamp,
    referenceRange.toTimestamp,
    referenceRange.duration,
    seekAllToOffset,
  ]);

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.playbackRate = playbackSpeed;
      }
    });
  }, [playbackSpeed]);

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

    const upperBound = getVideoUpperBound(0, firstVideo.duration);
    const lowerBound = referenceRange.fromTimestamp;
    if (
      firstVideo.currentTime < lowerBound ||
      firstVideo.currentTime >= upperBound
    ) {
      seekAllToOffset(0);
      setCurrentTime(0);
      if (onTimeUpdate) {
        onTimeUpdate(0);
      }
    }

    allVideos.forEach((video) => {
      void video.play();
    });
    setIsPlaying(true);
  }, [
    getVideoUpperBound,
    isPlaying,
    onTimeUpdate,
    pauseAllVideos,
    referenceRange.fromTimestamp,
    seekAllToOffset,
  ]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [togglePlayback]);

  const handleTimeUpdate = (
    index: number,
    e: React.SyntheticEvent<HTMLVideoElement>
  ) => {
    if (isSeekingBySlider) {
      return;
    }
    const video = e.currentTarget;
    const range = videoRanges[index] ?? referenceRange;
    const upperBound = getVideoUpperBound(index, video.duration);

    if (video.currentTime < range.fromTimestamp) {
      video.currentTime = range.fromTimestamp;
    }

    if (video.currentTime >= upperBound) {
      videoRefs.current.forEach((otherVideo, otherIndex) => {
        if (otherVideo) {
          const otherUpper = getVideoUpperBound(otherIndex, otherVideo.duration);
          otherVideo.currentTime = otherUpper;
          otherVideo.pause();
        }
      });
      setIsPlaying(false);
      const clipDuration = upperBound - range.fromTimestamp;
      setCurrentTime(clipDuration);
      if (onTimeUpdate) {
        onTimeUpdate(clipDuration);
      }
      return;
    }

    if (index === 0) {
      const offset = video.currentTime - range.fromTimestamp;
      setCurrentTime(offset);
      if (onTimeUpdate) {
        onTimeUpdate(offset);
      }
    }
  };

  const syncVideos = (sourceIndex: number) => {
    if (isSeekingBySlider) {
      return;
    }
    const sourceVideo = videoRefs.current[sourceIndex];
    if (!sourceVideo) {
      return;
    }
    const sourceRange = videoRanges[sourceIndex] ?? referenceRange;
    const sourceOffset = sourceVideo.currentTime - sourceRange.fromTimestamp;
    videoRefs.current.forEach((video, index) => {
      if (video && index !== sourceIndex) {
        const range = videoRanges[index] ?? referenceRange;
        const desired = range.fromTimestamp + sourceOffset;
        if (Math.abs(video.currentTime - desired) > 0.1) {
          seekVideoToOffset(video, index, sourceOffset);
        }
      }
    });
  };

  const handleSliderChange = (value: number) => {
    const clipDuration = duration;
    const clamped = Math.min(Math.max(value, 0), clipDuration);
    setIsSeekingBySlider(true);
    setCurrentTime(clamped);
    seekAllToOffset(clamped);
    if (onTimeUpdate) {
      onTimeUpdate(clamped);
    }
    setTimeout(() => setIsSeekingBySlider(false), 100);
  };

  const handlePlayPause = () => {
    togglePlayback();
  };

  const handleStop = () => {
    pauseAllVideos();
    seekAllToOffset(0);
    setCurrentTime(0);
    if (onTimeUpdate) {
      onTimeUpdate(0);
    }
  };

  const handleLoadedMetadata = (
    index: number,
    e: React.SyntheticEvent<HTMLVideoElement>
  ) => {
    const video = e.currentTarget;
    video.playbackRate = playbackSpeed;
    seekVideoToOffset(video, index, 0);
    if (index === 0) {
      const range = videoRanges[index] ?? referenceRange;
      const upperBound = getVideoUpperBound(index, video.duration);
      const clipDuration = Math.max(upperBound - range.fromTimestamp, 0);
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
            options={SPEED_OPTIONS}
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
          <Col key={`${video.url}-${index}`} span={8}>
            <div style={{ position: 'relative' }}>
              <video
                ref={(el) => {
                  videoRefs.current[index] = el;
                }}
                src={video.url}
                controls={false}
                style={{ width: '100%', height: 'auto' }}
                onTimeUpdate={(e) => {
                  handleTimeUpdate(index, e);
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
