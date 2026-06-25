import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { Card, Row, Col, Button, Space, Tooltip, Select } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { VideoInfo } from '@/types';
import {
  VideoPlayerController,
  createInitialVideoPlayerViewState,
  type VideoPlayerHandle,
  type VideoPlayerViewState,
} from './controllers/VideoPlayerController';
import type {
  VideoSeekOptions,
  VideoTimeUpdateOptions,
} from './controllers/VideoPlayerController';

export type {
  VideoPlayerHandle,
  VideoSeekOptions,
  VideoTimeUpdateOptions,
} from './controllers/VideoPlayerController';

interface VideoPlayerProps {
  videos: VideoInfo[];
  episodeId: number;
  onTimeUpdate?: (time: number, options?: VideoTimeUpdateOptions) => void;
}

interface VideoTileProps {
  video: VideoInfo;
  index: number;
  controller: VideoPlayerController;
}

const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1.0 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2.0 },
  { label: '2.5x', value: 2.5 },
  { label: '3x', value: 3.0 },
];

const VideoTile = ({ video, index, controller }: VideoTileProps) => {
  const handleVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      controller.setVideoElement(index, element);
    },
    [controller, index]
  );

  const handleTimeUpdate = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      controller.handleVideoTimeUpdate(index, event.currentTarget);
    },
    [controller, index]
  );

  const handleLoadedMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      controller.handleLoadedMetadata(index, event.currentTarget);
    },
    [controller, index]
  );

  return (
    <Col span={8}>
      <div style={{ position: 'relative' }}>
        <video
          ref={handleVideoRef}
          src={video.url}
          controls={false}
          preload='auto'
          playsInline
          style={{ width: '100%', height: 'auto' }}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
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
  );
};

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ videos, episodeId, onTimeUpdate }, ref) => {
    const [viewState, setViewState] = useState<VideoPlayerViewState>(() =>
      createInitialVideoPlayerViewState(videos)
    );
    const controllerRef = useRef<VideoPlayerController | null>(null);

    if (controllerRef.current === null) {
      controllerRef.current = new VideoPlayerController({
        initialVideos: videos,
        onTimeUpdate,
        onViewStateChange: setViewState,
      });
    }

    const controller = controllerRef.current;

    useEffect(() => {
      controller.configure({ videos, episodeId, onTimeUpdate });
    }, [controller, episodeId, onTimeUpdate, videos]);

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        controller.handleGlobalKeyDown(event);
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [controller]);

    useEffect(() => () => controller.dispose(), [controller]);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (time: number, options?: VideoSeekOptions) => {
          controller.seekTo(time, options);
        },
        getCurrentTime: () => controller.getCurrentTime(),
      }),
      [controller]
    );

    const handleScrubberRef = useCallback(
      (element: HTMLInputElement | null) => {
        controller.setScrubberElement(element);
      },
      [controller]
    );

    const handleTimeLabelRef = useCallback(
      (element: HTMLSpanElement | null) => {
        controller.setTimeLabelElement(element);
      },
      [controller]
    );

    const handleSliderChange = useCallback(
      (event: SyntheticEvent<HTMLInputElement>) => {
        controller.handleSliderInput(Number(event.currentTarget.value));
      },
      [controller]
    );

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
                  viewState.isPlaying ? (
                    <PauseCircleOutlined />
                  ) : (
                    <PlayCircleOutlined />
                  )
                }
                onClick={() => controller.togglePlayback()}
              >
                {viewState.isPlaying ? 'Pause' : 'Play'}
              </Button>
            </Tooltip>
            <Button onClick={() => controller.stop()}>Stop</Button>
            <Select
              value={viewState.playbackSpeed}
              onChange={(speed) => controller.setPlaybackSpeed(speed)}
              options={SPEED_OPTIONS}
              style={{ width: 80 }}
              size='small'
            />
            <span
              ref={handleTimeLabelRef}
              style={{
                color: 'rgba(255, 255, 255, 0.65)',
                display: 'inline-block',
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'right',
                width: 120,
              }}
            >
              {`0.00s / ${viewState.duration.toFixed(2)}s`}
            </span>
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          {videos.map((video, index) => (
            <VideoTile
              key={`${video.url}-${index}`}
              video={video}
              index={index}
              controller={controller}
            />
          ))}
        </Row>

        <div style={{ marginTop: '16px', padding: '0 8px' }}>
          <input
            ref={handleScrubberRef}
            type='range'
            min={0}
            max={viewState.duration}
            step={0.001}
            defaultValue={0}
            onInput={handleSliderChange}
            onPointerDown={() => controller.beginSliderSeek()}
            onPointerUp={() => controller.endSliderSeek()}
            onPointerCancel={() => controller.endSliderSeek()}
            onKeyUp={() => controller.finishSliderSeek()}
            onBlur={() => controller.finishSliderSeek()}
            disabled={viewState.duration <= 0}
            style={{
              width: '100%',
              cursor: viewState.duration > 0 ? 'pointer' : 'not-allowed',
            }}
          />
        </div>
      </Card>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
