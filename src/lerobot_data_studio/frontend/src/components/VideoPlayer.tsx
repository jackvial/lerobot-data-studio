import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Card, Row, Col, Button, Space, Tooltip, Select } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { VideoInfo } from '@/types';
import {
  VideoTimeRange,
  clampToVideoRange,
  getVideoTimeRange,
} from '@/utils/episodeTiming';

export interface VideoTimeUpdateOptions {
  force?: boolean;
}

export interface VideoSeekOptions {
  preview?: boolean;
}

export interface VideoPlayerHandle {
  seekTo: (time: number, options?: VideoSeekOptions) => void;
  getCurrentTime: () => number;
}

interface VideoPlayerProps {
  videos: VideoInfo[];
  episodeId: number;
  onTimeUpdate?: (time: number, options?: VideoTimeUpdateOptions) => void;
}

const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1.0 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2.0 },
  { label: '2.5x', value: 2.5 },
  { label: '3x', value: 3.0 },
];

const PLAYHEAD_UPDATE_INTERVAL_MS = 16;
const PARENT_TIME_UPDATE_INTERVAL_MS = 16;
const SECONDARY_SYNC_INTERVAL_MS = 250;
const SECONDARY_SYNC_THRESHOLD_SECONDS = 0.08;

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ videos, episodeId, onTimeUpdate }, ref) => {
    const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
    const animationFrameRef = useRef<number | null>(null);
    const sliderSeekTimeoutRef = useRef<number | null>(null);
    const sliderSeekFrameRef = useRef<number | null>(null);
    const pendingSliderSeekRef = useRef<number | null>(null);
    const lastPlayheadPaintRef = useRef(0);
    const lastParentNotificationRef = useRef(0);
    const lastSecondarySyncRef = useRef(0);
    const currentTimeRef = useRef(0);
    const durationRef = useRef(0);
    const scrubberRef = useRef<HTMLInputElement | null>(null);
    const timeLabelRef = useRef<HTMLSpanElement | null>(null);
    const isSeekingBySliderRef = useRef(false);
    const isSliderPointerDownRef = useRef(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

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
    durationRef.current = duration;

    const paintLocalControls = useCallback((time: number) => {
      const scrubber = scrubberRef.current;
      if (scrubber) {
        scrubber.value = String(time);
      }

      const label = timeLabelRef.current;
      if (label) {
        label.textContent = `${time.toFixed(2)}s / ${durationRef.current.toFixed(2)}s`;
      }
    }, []);

    useEffect(() => {
      videoRefs.current = videoRefs.current.slice(0, videos.length);
    }, [videos.length]);

    const clearPlaybackLoop = useCallback(() => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }, []);

    const clearSliderSeekTimeout = useCallback(() => {
      if (sliderSeekTimeoutRef.current !== null) {
        window.clearTimeout(sliderSeekTimeoutRef.current);
        sliderSeekTimeoutRef.current = null;
      }
    }, []);

    const clearSliderSeekFrame = useCallback(() => {
      if (sliderSeekFrameRef.current !== null) {
        window.cancelAnimationFrame(sliderSeekFrameRef.current);
        sliderSeekFrameRef.current = null;
      }
      pendingSliderSeekRef.current = null;
    }, []);

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
        const mediaDuration = Number.isFinite(video.duration)
          ? video.duration
          : 0;
        const absoluteTarget = range.fromTimestamp + Math.max(relativeTime, 0);
        const clamped = clampToVideoRange(
          absoluteTarget,
          range,
          mediaDuration
        );
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

    const clampOffsetToDuration = useCallback((time: number): number => {
      const clipDuration = durationRef.current;
      return clipDuration > 0
        ? Math.min(Math.max(time, 0), clipDuration)
        : Math.max(time, 0);
    }, []);

    const updateDisplayedTime = useCallback(
      (
        time: number,
        options?: {
          forceLocalUpdate?: boolean;
          forceParentUpdate?: boolean;
        }
      ) => {
        const forceParentUpdate = options?.forceParentUpdate ?? false;
        const forceLocalUpdate =
          options?.forceLocalUpdate ?? forceParentUpdate;
        const now = performance.now();
        currentTimeRef.current = time;

        if (
          forceLocalUpdate ||
          now - lastPlayheadPaintRef.current >= PLAYHEAD_UPDATE_INTERVAL_MS
        ) {
          lastPlayheadPaintRef.current = now;
          paintLocalControls(time);
        }

        if (
          onTimeUpdate &&
          (forceParentUpdate ||
            now - lastParentNotificationRef.current >=
              PARENT_TIME_UPDATE_INTERVAL_MS)
        ) {
          lastParentNotificationRef.current = now;
          onTimeUpdate(time, { force: forceParentUpdate });
        }
      },
      [onTimeUpdate, paintLocalControls]
    );

    const syncSecondaryVideos = useCallback(
      (sourceOffset: number, force = false) => {
        const now = performance.now();
        if (
          !force &&
          now - lastSecondarySyncRef.current < SECONDARY_SYNC_INTERVAL_MS
        ) {
          return;
        }

        lastSecondarySyncRef.current = now;

        videoRefs.current.forEach((video, index) => {
          if (!video || index === 0) {
            return;
          }

          const range = videoRanges[index] ?? referenceRange;
          const mediaDuration = Number.isFinite(video.duration)
            ? video.duration
            : 0;
          const desiredTime = clampToVideoRange(
            range.fromTimestamp + Math.max(sourceOffset, 0),
            range,
            mediaDuration
          );

          if (
            Math.abs(video.currentTime - desiredTime) >
            SECONDARY_SYNC_THRESHOLD_SECONDS
          ) {
            video.currentTime = desiredTime;
          }
        });
      },
      [referenceRange, videoRanges]
    );

    const getCurrentOffset = useCallback((): number => {
      const primaryVideo = videoRefs.current[0];
      if (!primaryVideo) {
        return currentTimeRef.current;
      }

      const range = videoRanges[0] ?? referenceRange;
      const mediaDuration = Number.isFinite(primaryVideo.duration)
        ? primaryVideo.duration
        : 0;
      const clamped = clampToVideoRange(
        primaryVideo.currentTime,
        range,
        mediaDuration
      );
      return Math.max(clamped - range.fromTimestamp, 0);
    }, [referenceRange, videoRanges]);

    const seekToOffset = useCallback(
      (time: number) => {
        const clamped = clampOffsetToDuration(time);
        seekAllToOffset(clamped);
        updateDisplayedTime(clamped, {
          forceLocalUpdate: true,
          forceParentUpdate: true,
        });
        syncSecondaryVideos(clamped, true);
      },
      [
        clampOffsetToDuration,
        seekAllToOffset,
        syncSecondaryVideos,
        updateDisplayedTime,
      ]
    );

    const scheduleSliderSeek = useCallback(
      (relativeTime: number) => {
        pendingSliderSeekRef.current = relativeTime;
        if (sliderSeekFrameRef.current !== null) {
          return;
        }

        sliderSeekFrameRef.current = window.requestAnimationFrame(() => {
          sliderSeekFrameRef.current = null;
          const pendingSeek = pendingSliderSeekRef.current;
          if (pendingSeek === null) {
            return;
          }
          seekAllToOffset(pendingSeek);
        });
      },
      [seekAllToOffset]
    );

    const previewSeekToOffset = useCallback(
      (time: number) => {
        const clamped = clampOffsetToDuration(time);
        clearSliderSeekTimeout();
        isSeekingBySliderRef.current = true;
        updateDisplayedTime(clamped, {
          forceLocalUpdate: true,
          forceParentUpdate: false,
        });
        scheduleSliderSeek(clamped);
      },
      [
        clampOffsetToDuration,
        clearSliderSeekTimeout,
        scheduleSliderSeek,
        updateDisplayedTime,
      ]
    );

    const commitSeekToOffset = useCallback(
      (time: number) => {
        const clamped = clampOffsetToDuration(time);
        clearSliderSeekTimeout();
        clearSliderSeekFrame();
        isSeekingBySliderRef.current = false;
        seekToOffset(clamped);
      },
      [
        clampOffsetToDuration,
        clearSliderSeekFrame,
        clearSliderSeekTimeout,
        seekToOffset,
      ]
    );

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (time, options) => {
          if (options?.preview) {
            previewSeekToOffset(time);
            return;
          }
          commitSeekToOffset(time);
        },
        getCurrentTime: getCurrentOffset,
      }),
      [commitSeekToOffset, getCurrentOffset, previewSeekToOffset]
    );

    const syncFromPrimaryVideo = useCallback(
      (options?: {
        forceLocalUpdate?: boolean;
        forceParentUpdate?: boolean;
        ignoreSeeking?: boolean;
      }) => {
        const forceParentUpdate = options?.forceParentUpdate ?? false;
        const forceLocalUpdate =
          options?.forceLocalUpdate ?? forceParentUpdate;
        const ignoreSeeking = options?.ignoreSeeking ?? false;

        if (isSeekingBySliderRef.current && !ignoreSeeking) {
          return;
        }

        const primaryVideo = videoRefs.current[0];
        if (!primaryVideo) {
          return;
        }

        const range = videoRanges[0] ?? referenceRange;
        const upperBound = getVideoUpperBound(0, primaryVideo.duration);

        if (primaryVideo.currentTime < range.fromTimestamp) {
          primaryVideo.currentTime = range.fromTimestamp;
        }

        if (primaryVideo.currentTime >= upperBound) {
          const clipDuration = Math.max(
            upperBound - range.fromTimestamp,
            0
          );

          clearPlaybackLoop();
          videoRefs.current.forEach((video, index) => {
            if (!video) {
              return;
            }

            const otherUpperBound = getVideoUpperBound(index, video.duration);
            video.currentTime = otherUpperBound;
            video.pause();
          });
          setIsPlaying(false);
          updateDisplayedTime(clipDuration, {
            forceLocalUpdate: true,
            forceParentUpdate: true,
          });
          return;
        }

        const offset = Math.max(
          primaryVideo.currentTime - range.fromTimestamp,
          0
        );

        updateDisplayedTime(offset, {
          forceLocalUpdate,
          forceParentUpdate,
        });
        syncSecondaryVideos(offset, forceParentUpdate);
      },
      [
        clearPlaybackLoop,
        getVideoUpperBound,
        referenceRange,
        syncSecondaryVideos,
        updateDisplayedTime,
        videoRanges,
      ]
    );

    const pauseAllVideos = useCallback(() => {
      clearPlaybackLoop();
      videoRefs.current.forEach((video) => {
        if (video) {
          video.pause();
        }
      });
      setIsPlaying(false);
    }, [clearPlaybackLoop]);

    const startPlaybackLoop = useCallback(() => {
      clearPlaybackLoop();
      lastPlayheadPaintRef.current = 0;

      const tick = () => {
        syncFromPrimaryVideo();

        const primaryVideo = videoRefs.current[0];
        if (primaryVideo && !primaryVideo.paused && !primaryVideo.ended) {
          animationFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        animationFrameRef.current = null;
      };

      tick();
    }, [clearPlaybackLoop, syncFromPrimaryVideo]);

    useEffect(() => {
      clearPlaybackLoop();
      clearSliderSeekTimeout();
      clearSliderSeekFrame();
      lastPlayheadPaintRef.current = 0;
      lastParentNotificationRef.current = 0;
      lastSecondarySyncRef.current = 0;
      currentTimeRef.current = 0;
      isSeekingBySliderRef.current = false;
      isSliderPointerDownRef.current = false;
      setIsPlaying(false);
      durationRef.current = referenceRange.duration ?? 0;
      setDuration(durationRef.current);
      paintLocalControls(0);
      seekAllToOffset(0);
      if (onTimeUpdate) {
        onTimeUpdate(0, { force: true });
      }
      // Keep onTimeUpdate out of this dependency list so parent callback
      // identity changes do not reset playback mid-episode.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      episodeId,
      referenceRange.fromTimestamp,
      referenceRange.toTimestamp,
      referenceRange.duration,
      seekAllToOffset,
      clearPlaybackLoop,
      clearSliderSeekTimeout,
      clearSliderSeekFrame,
      paintLocalControls,
    ]);

    useEffect(() => {
      videoRefs.current.forEach((video) => {
        if (video) {
          video.playbackRate = playbackSpeed;
        }
      });
    }, [playbackSpeed]);

    useEffect(() => {
      return () => {
        clearPlaybackLoop();
        clearSliderSeekTimeout();
        clearSliderSeekFrame();
      };
    }, [clearPlaybackLoop, clearSliderSeekTimeout, clearSliderSeekFrame]);

    const togglePlayback = useCallback(() => {
      const allVideos = videoRefs.current.filter(
        (video): video is HTMLVideoElement => video !== null
      );
      const firstVideo = allVideos[0];
      if (!firstVideo) {
        return;
      }

      const isPrimaryPlaying = !firstVideo.paused && !firstVideo.ended;

      if (isPrimaryPlaying) {
        pauseAllVideos();
        syncFromPrimaryVideo({
          forceLocalUpdate: true,
          forceParentUpdate: true,
          ignoreSeeking: true,
        });
        return;
      }

      const upperBound = getVideoUpperBound(0, firstVideo.duration);
      const lowerBound = referenceRange.fromTimestamp;
      if (
        firstVideo.currentTime < lowerBound ||
        firstVideo.currentTime >= upperBound
      ) {
        seekToOffset(0);
      }

      setIsPlaying(true);
      allVideos.forEach((video) => {
        video.playbackRate = playbackSpeed;
        const playRequest = video.play();
        if (video === firstVideo) {
          void playRequest
            .then(() => {
              startPlaybackLoop();
            })
            .catch(() => {
              clearPlaybackLoop();
              setIsPlaying(false);
            });
        }
      });
    }, [
      clearPlaybackLoop,
      getVideoUpperBound,
      pauseAllVideos,
      playbackSpeed,
      referenceRange.fromTimestamp,
      seekToOffset,
      startPlaybackLoop,
      syncFromPrimaryVideo,
    ]);

    useEffect(() => {
      const handleKeyPress = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (
          e.repeat ||
          (target &&
            (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'SELECT' ||
              target.isContentEditable ||
              target.closest("button, a, [role='button'], .ant-select")))
        ) {
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
      if (isSeekingBySliderRef.current) {
        return;
      }
      const video = e.currentTarget;
      const range = videoRanges[index] ?? referenceRange;
      const upperBound = getVideoUpperBound(index, video.duration);

      if (video.currentTime < range.fromTimestamp) {
        video.currentTime = range.fromTimestamp;
      }

      if (video.currentTime >= upperBound) {
        if (index === 0) {
          syncFromPrimaryVideo({
            forceLocalUpdate: true,
            forceParentUpdate: true,
            ignoreSeeking: true,
          });
        } else {
          video.currentTime = upperBound;
          video.pause();
        }
        return;
      }

      if (index === 0 && video.paused) {
        const offset = Math.max(video.currentTime - range.fromTimestamp, 0);
        updateDisplayedTime(offset, {
          forceLocalUpdate: true,
          forceParentUpdate: true,
        });
        syncSecondaryVideos(offset, true);
      }
    };

    const finishSliderSeek = useCallback(() => {
      const pendingSeek = pendingSliderSeekRef.current ?? currentTimeRef.current;
      commitSeekToOffset(pendingSeek);
      syncFromPrimaryVideo({
        forceLocalUpdate: true,
        forceParentUpdate: true,
        ignoreSeeking: true,
      });
    }, [commitSeekToOffset, syncFromPrimaryVideo]);

    const handleSliderPointerDown = () => {
      isSliderPointerDownRef.current = true;
      clearSliderSeekTimeout();
    };

    const handleSliderPointerEnd = () => {
      isSliderPointerDownRef.current = false;
      finishSliderSeek();
    };

    const handleSliderChange = (event: React.FormEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value);
      previewSeekToOffset(value);
      if (!isSliderPointerDownRef.current) {
        sliderSeekTimeoutRef.current = window.setTimeout(
          finishSliderSeek,
          80
        );
      }
    };

    const handlePlayPause = () => {
      togglePlayback();
    };

    const handleStop = () => {
      pauseAllVideos();
      seekToOffset(0);
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
        durationRef.current = clipDuration;
        setDuration(clipDuration);
        updateDisplayedTime(0, {
          forceLocalUpdate: true,
          forceParentUpdate: true,
        });
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
            <span
              ref={timeLabelRef}
              style={{
                color: 'rgba(255, 255, 255, 0.65)',
                display: 'inline-block',
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'right',
                width: 120,
              }}
            >
              {`0.00s / ${duration.toFixed(2)}s`}
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
                  preload='auto'
                  playsInline
                  style={{ width: '100%', height: 'auto' }}
                  onTimeUpdate={(e) => handleTimeUpdate(index, e)}
                  onLoadedMetadata={(e) => handleLoadedMetadata(index, e)}
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
          <input
            ref={scrubberRef}
            type='range'
            min={0}
            max={duration}
            step={0.001}
            defaultValue={0}
            onInput={handleSliderChange}
            onPointerDown={handleSliderPointerDown}
            onPointerUp={handleSliderPointerEnd}
            onPointerCancel={handleSliderPointerEnd}
            onKeyUp={finishSliderSeek}
            onBlur={finishSliderSeek}
            disabled={duration <= 0}
            style={{
              width: '100%',
              cursor: duration > 0 ? 'pointer' : 'not-allowed',
            }}
          />
        </div>
      </Card>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
