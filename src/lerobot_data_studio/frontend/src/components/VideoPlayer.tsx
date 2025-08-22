import React, { useRef, useEffect, useState } from 'react';
import {
  Card,
  Tag,
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
}

interface VideoPlayerProps {
  videos: VideoInfo[];
  episodeId: number;
  tasks?: string[];
  onTimeUpdate?: (time: number) => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videos,
  episodeId,
  tasks,
  onTimeUpdate,
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeekingBySlider, setIsSeekingBySlider] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(3.0); // Default to 3x speed

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
  }, [videos]);

  // Set duration when first video loads and apply initial speed
  useEffect(() => {
    const checkDuration = () => {
      const firstVideo = videoRefs.current[0];
      if (firstVideo && firstVideo.duration) {
        setDuration(firstVideo.duration);
        // Apply initial playback speed
        videoRefs.current.forEach((video) => {
          if (video) {
            video.playbackRate = playbackSpeed;
          }
        });
      }
    };

    const interval = setInterval(checkDuration, 100);
    return () => clearInterval(interval);
  }, [videos, playbackSpeed]);

  // Update playback speed when changed
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.playbackRate = playbackSpeed;
      }
    });
  }, [playbackSpeed]);

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

        // Inline play/pause logic to avoid dependency issues
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
  }, []); // Empty dependency array since we're not using external state

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!isSeekingBySlider) {
      const video = e.currentTarget;
      setCurrentTime(video.currentTime);
      if (video.duration && !isNaN(video.duration)) {
        setDuration(video.duration);
      }
      if (onTimeUpdate) {
        onTimeUpdate(video.currentTime);
      }
    }
  };

  const handleSliderChange = (value: number) => {
    setIsSeekingBySlider(true);
    setCurrentTime(value);

    // Update all videos
    videoRefs.current.forEach((video) => {
      if (video) {
        video.currentTime = value;
      }
    });

    if (onTimeUpdate) {
      onTimeUpdate(value);
    }

    // Reset seeking flag after a short delay
    setTimeout(() => setIsSeekingBySlider(false), 100);
  };

  const handlePlayPause = () => {
    const allVideos = videoRefs.current.filter((v) => v !== null);

    if (isPlaying) {
      allVideos.forEach((video) => video?.pause());
      setIsPlaying(false);
    } else {
      allVideos.forEach((video) => video?.play());
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    const allVideos = videoRefs.current.filter((v) => v !== null);
    allVideos.forEach((video) => {
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    });
    setIsPlaying(false);
    setCurrentTime(0);
    if (onTimeUpdate) {
      onTimeUpdate(0);
    }
  };

  const syncVideos = (index: number) => {
    if (!isSeekingBySlider) {
      const sourceVideo = videoRefs.current[index];
      if (sourceVideo) {
        videoRefs.current.forEach((video, i) => {
          if (
            video &&
            i !== index &&
            Math.abs(video.currentTime - sourceVideo.currentTime) > 0.1
          ) {
            video.currentTime = sourceVideo.currentTime;
          }
        });
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
          {tasks && tasks.length > 0 && (
            <Tag color='blue'>{tasks.join(', ')}</Tag>
          )}
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
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  if (video.duration && !isNaN(video.duration)) {
                    setDuration(video.duration);
                  }
                  // Apply current playback speed to newly loaded video
                  video.playbackRate = playbackSpeed;
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
          max={duration || 100}
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
