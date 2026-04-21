import React, { useRef, useEffect, useState, useMemo } from 'react';
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

interface VideoInfo {
  url: string;
  filename: string;
  language_instruction?: string[];
  from_timestamp?: number;
  to_timestamp?: number | null;
}

interface VideoPlayerProps {
  videos: VideoInfo[];
  episodeId: number;
  onTimeUpdate?: (time: number) => void;
}

// In LeRobot v3 datasets, multiple episodes are concatenated into a single
// video file. Each VideoInfo therefore carries the [from_timestamp,
// to_timestamp] range within that file that corresponds to the current
// episode. The player exposes a "clip-relative" time line to the user
// (starting at 0) while seeking the underlying <video> elements at the
// appropriate absolute offsets.
const EPS = 0.02;

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videos,
  episodeId,
  onTimeUpdate,
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [clipDuration, setClipDuration] = useState(0);
  const [isSeekingBySlider, setIsSeekingBySlider] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(3.0);

  const speedOptions = [
    { label: '0.5x', value: 0.5 },
    { label: '1x', value: 1.0 },
    { label: '1.5x', value: 1.5 },
    { label: '2x', value: 2.0 },
    { label: '2.5x', value: 2.5 },
    { label: '3x', value: 3.0 },
  ];

  const fromTimestamps = useMemo(
    () => videos.map((v) => v.from_timestamp ?? 0),
    [videos]
  );
  const toTimestamps = useMemo(
    () =>
      videos.map((v) =>
        v.to_timestamp == null ? Number.POSITIVE_INFINITY : v.to_timestamp
      ),
    [videos]
  );

  // The first video's clip range drives the shared timeline shown to the
  // user. Other videos are kept in sync using their own offsets.
  const primaryFrom = fromTimestamps[0] ?? 0;
  const primaryTo = toTimestamps[0] ?? Number.POSITIVE_INFINITY;
  const primaryClipDuration = Number.isFinite(primaryTo)
    ? Math.max(0, primaryTo - primaryFrom)
    : 0;

  const clipToAbsolute = (clipTime: number, index: number) => {
    const from = fromTimestamps[index] ?? 0;
    const to = toTimestamps[index] ?? Number.POSITIVE_INFINITY;
    const absolute = from + clipTime;
    if (Number.isFinite(to)) {
      return Math.min(absolute, to);
    }
    return absolute;
  };

  const absoluteToClip = (absoluteTime: number, index: number) => {
    const from = fromTimestamps[index] ?? 0;
    return Math.max(0, absoluteTime - from);
  };

  useEffect(() => {
    videoRefs.current = videoRefs.current.slice(0, videos.length);
  }, [videos]);

  // Reset to the start of the new clip whenever the episode or video set
  // changes.
  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
    videoRefs.current.forEach((video, index) => {
      if (!video) {
        return;
      }
      try {
        video.pause();
      } catch {
        // ignore
      }
      const target = clipToAbsolute(0, index);
      if (Number.isFinite(target)) {
        video.currentTime = target;
      }
    });
    if (onTimeUpdate) {
      onTimeUpdate(0);
    }
    // We intentionally only react to the episode/video change here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, videos]);

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.playbackRate = playbackSpeed;
      }
    });
  }, [playbackSpeed]);

  // Update the displayed clip duration once metadata is known. We prefer
  // the explicit to_timestamp from the backend, but fall back to the
  // underlying video duration when the dataset doesn't provide one.
  useEffect(() => {
    if (primaryClipDuration > 0) {
      setClipDuration(primaryClipDuration);
    }
  }, [primaryClipDuration]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();

        const allVideos = videoRefs.current.filter((v) => v !== null);
        const firstVideo = allVideos[0];

        if (firstVideo && !firstVideo.paused) {
          allVideos.forEach((video) => video?.pause());
        } else {
          allVideos.forEach((video) => video?.play());
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const handleTimeUpdate = (
    e: React.SyntheticEvent<HTMLVideoElement>,
    index: number
  ) => {
    if (isSeekingBySlider) {
      return;
    }
    const video = e.currentTarget;
    const to = toTimestamps[index] ?? Number.POSITIVE_INFINITY;

    // Stop playback once we reach the end of the current episode's clip
    // segment so we don't bleed into the next episode's frames.
    if (Number.isFinite(to) && video.currentTime >= to - EPS) {
      videoRefs.current.forEach((v, i) => {
        if (!v) {
          return;
        }
        v.pause();
        const clampTarget = clipToAbsolute(
          Math.max(0, primaryClipDuration - EPS),
          i
        );
        if (Number.isFinite(clampTarget)) {
          v.currentTime = clampTarget;
        }
      });
      const clamped = primaryClipDuration;
      setCurrentTime(clamped);
      setIsPlaying(false);
      if (onTimeUpdate) {
        onTimeUpdate(clamped);
      }
      return;
    }

    if (index === 0) {
      const clipTime = absoluteToClip(video.currentTime, 0);
      setCurrentTime(clipTime);
      if (onTimeUpdate) {
        onTimeUpdate(clipTime);
      }
    }
  };

  const handleSliderChange = (value: number) => {
    setIsSeekingBySlider(true);
    setCurrentTime(value);

    videoRefs.current.forEach((video, index) => {
      if (video) {
        const target = clipToAbsolute(value, index);
        if (Number.isFinite(target)) {
          video.currentTime = target;
        }
      }
    });

    if (onTimeUpdate) {
      onTimeUpdate(value);
    }

    setTimeout(() => setIsSeekingBySlider(false), 100);
  };

  const handlePlayPause = () => {
    const allVideos = videoRefs.current.filter((v) => v !== null);

    if (isPlaying) {
      allVideos.forEach((video) => video?.pause());
      setIsPlaying(false);
    } else {
      // If the playhead is parked at (or past) the end of the clip, rewind
      // to the start before resuming playback.
      if (
        primaryClipDuration > 0 &&
        currentTime >= primaryClipDuration - EPS
      ) {
        videoRefs.current.forEach((video, index) => {
          if (video) {
            const target = clipToAbsolute(0, index);
            if (Number.isFinite(target)) {
              video.currentTime = target;
            }
          }
        });
        setCurrentTime(0);
        if (onTimeUpdate) {
          onTimeUpdate(0);
        }
      }
      allVideos.forEach((video) => video?.play());
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    videoRefs.current.forEach((video, index) => {
      if (video) {
        video.pause();
        const target = clipToAbsolute(0, index);
        if (Number.isFinite(target)) {
          video.currentTime = target;
        }
      }
    });
    setIsPlaying(false);
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
    if (!sourceVideo) {
      return;
    }
    const sourceClipTime = absoluteToClip(sourceVideo.currentTime, index);
    videoRefs.current.forEach((video, i) => {
      if (!video || i === index) {
        return;
      }
      const targetAbsolute = clipToAbsolute(sourceClipTime, i);
      if (
        Number.isFinite(targetAbsolute) &&
        Math.abs(video.currentTime - targetAbsolute) > 0.1
      ) {
        video.currentTime = targetAbsolute;
      }
    });
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
            {currentTime.toFixed(1)}s / {clipDuration.toFixed(1)}s
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
                  handleTimeUpdate(e, index);
                  syncVideos(index);
                }}
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  el.playbackRate = playbackSpeed;
                  // Seek to the start of this episode's segment.
                  const target = clipToAbsolute(0, index);
                  if (Number.isFinite(target)) {
                    el.currentTime = target;
                  }
                  // If the dataset didn't supply a to_timestamp, fall back
                  // to the underlying video duration for the timeline.
                  if (
                    index === 0 &&
                    primaryClipDuration === 0 &&
                    el.duration &&
                    !isNaN(el.duration)
                  ) {
                    setClipDuration(Math.max(0, el.duration - primaryFrom));
                  }
                }}
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
          max={clipDuration || 100}
          value={currentTime}
          step={0.1}
          onChange={handleSliderChange}
          tooltip={{
            formatter: (value) => `${(value || 0).toFixed(1)}s`,
          }}
        />
      </div>
    </Card>
  );
};

export default VideoPlayer;
