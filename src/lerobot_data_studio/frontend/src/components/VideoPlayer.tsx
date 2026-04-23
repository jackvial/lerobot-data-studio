import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Card, Row, Col, Button, Space, Slider, Tooltip, Select } from "antd";
import { PlayCircleOutlined, PauseCircleOutlined } from "@ant-design/icons";
import { VideoInfo } from "@/types";
import {
    VideoTimeRange,
    clampToVideoRange,
    getVideoTimeRange,
} from "@/utils/episodeTiming";

interface VideoPlayerProps {
    videos: VideoInfo[];
    episodeId: number;
    onTimeUpdate?: (time: number) => void;
}

const SPEED_OPTIONS = [
    { label: "0.5x", value: 0.5 },
    { label: "1x", value: 1.0 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2.0 },
    { label: "2.5x", value: 2.5 },
    { label: "3x", value: 3.0 },
];

const PLAYHEAD_UPDATE_INTERVAL_MS = 33;
const PARENT_TIME_UPDATE_INTERVAL_MS = 100;
const SECONDARY_SYNC_INTERVAL_MS = 250;
const SECONDARY_SYNC_THRESHOLD_SECONDS = 0.08;

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    videos,
    episodeId,
    onTimeUpdate,
}) => {
    const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
    const animationFrameRef = useRef<number | null>(null);
    const sliderSeekTimeoutRef = useRef<number | null>(null);
    const lastPlayheadPaintRef = useRef(0);
    const lastParentNotificationRef = useRef(0);
    const lastSecondarySyncRef = useRef(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [isSeekingBySlider, setIsSeekingBySlider] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

    const videoRanges = useMemo(
        () => videos.map((video) => getVideoTimeRange(video)),
        [videos],
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
        [videoRanges],
    );

    const seekVideoToOffset = useCallback(
        (
            video: HTMLVideoElement,
            index: number,
            relativeTime: number,
        ): number => {
            const range = videoRanges[index] ?? referenceRange;
            const mediaDuration = Number.isFinite(video.duration)
                ? video.duration
                : 0;
            const absoluteTarget =
                range.fromTimestamp + Math.max(relativeTime, 0);
            const clamped = clampToVideoRange(
                absoluteTarget,
                range,
                mediaDuration,
            );
            video.currentTime = clamped;
            return clamped - range.fromTimestamp;
        },
        [referenceRange, videoRanges],
    );

    const seekAllToOffset = useCallback(
        (relativeTime: number) => {
            videoRefs.current.forEach((video, index) => {
                if (video) {
                    seekVideoToOffset(video, index, relativeTime);
                }
            });
        },
        [seekVideoToOffset],
    );

    const updateDisplayedTime = useCallback(
        (
            time: number,
            options?: {
                forceLocalUpdate?: boolean;
                forceParentUpdate?: boolean;
            },
        ) => {
            const forceParentUpdate = options?.forceParentUpdate ?? false;
            const forceLocalUpdate =
                options?.forceLocalUpdate ?? forceParentUpdate;
            const now = performance.now();

            if (
                forceLocalUpdate ||
                now - lastPlayheadPaintRef.current >=
                    PLAYHEAD_UPDATE_INTERVAL_MS
            ) {
                lastPlayheadPaintRef.current = now;
                setCurrentTime(time);
            }

            if (
                onTimeUpdate &&
                (forceParentUpdate ||
                    now - lastParentNotificationRef.current >=
                        PARENT_TIME_UPDATE_INTERVAL_MS)
            ) {
                lastParentNotificationRef.current = now;
                onTimeUpdate(time);
            }
        },
        [onTimeUpdate],
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
                    mediaDuration,
                );

                if (
                    Math.abs(video.currentTime - desiredTime) >
                    SECONDARY_SYNC_THRESHOLD_SECONDS
                ) {
                    video.currentTime = desiredTime;
                }
            });
        },
        [referenceRange, videoRanges],
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

            if (isSeekingBySlider && !ignoreSeeking) {
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
                    0,
                );

                clearPlaybackLoop();
                videoRefs.current.forEach((video, index) => {
                    if (!video) {
                        return;
                    }

                    const otherUpperBound = getVideoUpperBound(
                        index,
                        video.duration,
                    );
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
                0,
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
            isSeekingBySlider,
            referenceRange,
            syncSecondaryVideos,
            updateDisplayedTime,
            videoRanges,
        ],
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

    // When the episode (and therefore the slice window) changes, snap every
    // loaded video back to its slice start. This is essential because v3 LeRobot
    // datasets pack multiple episodes into the same mp4, so React keeps the
    // existing <video> element when the URL doesn't change between episodes.
    useEffect(() => {
        clearPlaybackLoop();
        clearSliderSeekTimeout();
        lastPlayheadPaintRef.current = 0;
        lastParentNotificationRef.current = 0;
        lastSecondarySyncRef.current = 0;
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
        clearPlaybackLoop,
        clearSliderSeekTimeout,
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
        };
    }, [clearPlaybackLoop, clearSliderSeekTimeout]);

    const togglePlayback = useCallback(() => {
        const allVideos = videoRefs.current.filter(
            (video): video is HTMLVideoElement => video !== null,
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
        startPlaybackLoop();
    }, [
        getVideoUpperBound,
        onTimeUpdate,
        pauseAllVideos,
        referenceRange.fromTimestamp,
        seekAllToOffset,
        startPlaybackLoop,
        syncFromPrimaryVideo,
    ]);

    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (
                e.repeat ||
                (target &&
                    (target.tagName === "INPUT" ||
                        target.tagName === "TEXTAREA" ||
                        target.tagName === "SELECT" ||
                        target.isContentEditable ||
                        target.closest(
                            "button, a, [role='button'], .ant-select",
                        )))
            ) {
                return;
            }
            if (e.code === "Space" || e.key === " ") {
                e.preventDefault();
                togglePlayback();
            }
        };

        window.addEventListener("keydown", handleKeyPress);
        return () => window.removeEventListener("keydown", handleKeyPress);
    }, [togglePlayback]);

    const handleTimeUpdate = (
        index: number,
        e: React.SyntheticEvent<HTMLVideoElement>,
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

    const handleSliderChange = (value: number) => {
        const clipDuration = duration;
        const clamped = Math.min(Math.max(value, 0), clipDuration);
        clearSliderSeekTimeout();
        setIsSeekingBySlider(true);
        seekAllToOffset(clamped);
        updateDisplayedTime(clamped, {
            forceLocalUpdate: true,
            forceParentUpdate: true,
        });
        syncSecondaryVideos(clamped, true);
        sliderSeekTimeoutRef.current = window.setTimeout(() => {
            setIsSeekingBySlider(false);
            syncFromPrimaryVideo({
                forceLocalUpdate: true,
                forceParentUpdate: true,
                ignoreSeeking: true,
            });
            sliderSeekTimeoutRef.current = null;
        }, 100);
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
        e: React.SyntheticEvent<HTMLVideoElement>,
    ) => {
        const video = e.currentTarget;
        video.playbackRate = playbackSpeed;
        seekVideoToOffset(video, index, 0);
        if (index === 0) {
            const range = videoRanges[index] ?? referenceRange;
            const upperBound = getVideoUpperBound(index, video.duration);
            const clipDuration = Math.max(upperBound - range.fromTimestamp, 0);
            setDuration(clipDuration);
            updateDisplayedTime(0, {
                forceLocalUpdate: true,
                forceParentUpdate: true,
            });
        }
    };

    const handlePrimaryPlay = useCallback(() => {
        setIsPlaying(true);
        startPlaybackLoop();
    }, [startPlaybackLoop]);

    const handlePrimaryPause = useCallback(() => {
        clearPlaybackLoop();
        setIsPlaying(false);
        syncFromPrimaryVideo({
            forceLocalUpdate: true,
            forceParentUpdate: true,
            ignoreSeeking: true,
        });
    }, [clearPlaybackLoop, syncFromPrimaryVideo]);

    const handleSpeedChange = (speed: number) => {
        setPlaybackSpeed(speed);
    };

    return (
        <Card
            title={
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <span>Episode {episodeId} Videos</span>
                </div>
            }
            extra={
                <Space>
                    <Tooltip title="Press spacebar to play/pause">
                        <Button
                            type="primary"
                            icon={
                                isPlaying ? (
                                    <PauseCircleOutlined />
                                ) : (
                                    <PlayCircleOutlined />
                                )
                            }
                            onClick={handlePlayPause}
                        >
                            {isPlaying ? "Pause" : "Play"}
                        </Button>
                    </Tooltip>
                    <Button onClick={handleStop}>Stop</Button>
                    <Select
                        value={playbackSpeed}
                        onChange={handleSpeedChange}
                        options={SPEED_OPTIONS}
                        style={{ width: 80 }}
                        size="small"
                    />
                    <span style={{ color: "rgba(255, 255, 255, 0.65)" }}>
                        {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                    </span>
                </Space>
            }
        >
            <Row gutter={[16, 16]}>
                {videos.map((video, index) => (
                    <Col key={`${video.url}-${index}`} span={8}>
                        <div style={{ position: "relative" }}>
                            <video
                                ref={(el) => {
                                    videoRefs.current[index] = el;
                                }}
                                src={video.url}
                                controls={false}
                                preload="auto"
                                playsInline
                                style={{ width: "100%", height: "auto" }}
                                onTimeUpdate={(e) => handleTimeUpdate(index, e)}
                                onLoadedMetadata={(e) =>
                                    handleLoadedMetadata(index, e)
                                }
                                onPlay={
                                    index === 0 ? handlePrimaryPlay : undefined
                                }
                                onPause={
                                    index === 0 ? handlePrimaryPause : undefined
                                }
                            />
                            <div
                                style={{
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: "rgba(0, 0, 0, 0.7)",
                                    padding: "4px 8px",
                                    fontSize: "12px",
                                    color: "white",
                                }}
                            >
                                {video.filename}
                            </div>
                        </div>
                    </Col>
                ))}
            </Row>

            <div style={{ marginTop: "16px", padding: "0 8px" }}>
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
