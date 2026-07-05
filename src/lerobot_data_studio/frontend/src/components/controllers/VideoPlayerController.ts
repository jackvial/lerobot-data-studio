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

export interface VideoPlayerViewState {
  isPlaying: boolean;
  playbackSpeed: number;
  duration: number;
}

interface VideoPlayerControllerOptions {
  initialVideos: VideoInfo[];
  onTimeUpdate?: (
    time: number,
    options?: VideoTimeUpdateOptions
  ) => void;
  onViewStateChange: (state: VideoPlayerViewState) => void;
}

interface VideoPlayerSourceConfig {
  videos: VideoInfo[];
  episodeId: number;
  onTimeUpdate?: (
    time: number,
    options?: VideoTimeUpdateOptions
  ) => void;
}

const PLAYHEAD_UPDATE_INTERVAL_MS = 16;
const PARENT_TIME_UPDATE_INTERVAL_MS = 16;
const SECONDARY_SYNC_INTERVAL_MS = 250;
const SECONDARY_SYNC_THRESHOLD_SECONDS = 0.08;
const SLIDER_COMMIT_DELAY_MS = 80;

const DEFAULT_REFERENCE_RANGE: VideoTimeRange = {
  fromTimestamp: 0,
  toTimestamp: null,
  duration: null,
};

const normalizeTime = (time: number): number =>
  Number.isFinite(time) ? Math.max(time, 0) : 0;

const normalizeDuration = (duration: number): number =>
  Number.isFinite(duration) ? Math.max(duration, 0) : 0;

const createSourceSignature = (
  videos: VideoInfo[],
  episodeId: number
): string =>
  JSON.stringify([
    episodeId,
    videos.map((video) => [
      video.url,
      video.from_timestamp ?? null,
      video.to_timestamp ?? null,
    ]),
  ]);

class VideoTimeline {
  private readonly ranges: VideoTimeRange[];

  readonly referenceRange: VideoTimeRange;

  constructor(videos: VideoInfo[]) {
    this.ranges = videos.map((video) => getVideoTimeRange(video));
    this.referenceRange = this.ranges[0] ?? DEFAULT_REFERENCE_RANGE;
  }

  get initialDuration(): number {
    return this.referenceRange.duration ?? 0;
  }

  getRange(index: number): VideoTimeRange {
    return this.ranges[index] ?? this.referenceRange;
  }

  getVideoUpperBound(index: number, mediaDuration: number): number {
    const range = this.getRange(index);
    const duration = normalizeDuration(mediaDuration);

    if (range.toTimestamp != null) {
      return duration > 0 ? Math.min(range.toTimestamp, duration) : range.toTimestamp;
    }

    return duration || range.fromTimestamp;
  }

  clampOffsetToDuration(time: number, duration: number): number {
    const offset = normalizeTime(time);
    const clipDuration = normalizeDuration(duration);
    return clipDuration > 0 ? Math.min(offset, clipDuration) : offset;
  }

  seekVideoToOffset(
    video: HTMLVideoElement,
    index: number,
    relativeTime: number
  ): number {
    const range = this.getRange(index);
    const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
    const absoluteTarget = range.fromTimestamp + normalizeTime(relativeTime);
    const clamped = clampToVideoRange(absoluteTarget, range, mediaDuration);
    video.currentTime = clamped;
    return clamped - range.fromTimestamp;
  }

  getCurrentOffset(video: HTMLVideoElement | null, fallbackTime: number): number {
    if (!video) {
      return fallbackTime;
    }

    const range = this.getRange(0);
    const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
    const clamped = clampToVideoRange(video.currentTime, range, mediaDuration);
    return Math.max(clamped - range.fromTimestamp, 0);
  }
}

class VideoControlPainter {
  private scrubber: HTMLInputElement | null = null;
  private timeLabel: HTMLSpanElement | null = null;
  private duration = 0;

  setScrubberElement(element: HTMLInputElement | null): void {
    this.scrubber = element;
    this.updateScrubberBounds();
  }

  setTimeLabelElement(element: HTMLSpanElement | null): void {
    this.timeLabel = element;
  }

  setDuration(duration: number): void {
    this.duration = normalizeDuration(duration);
    this.updateScrubberBounds();
  }

  paint(time: number): void {
    const currentTime = normalizeTime(time);

    if (this.scrubber) {
      this.scrubber.value = String(currentTime);
    }

    if (this.timeLabel) {
      this.timeLabel.textContent = `${currentTime.toFixed(
        2
      )}s / ${this.duration.toFixed(2)}s`;
    }
  }

  private updateScrubberBounds(): void {
    if (!this.scrubber) {
      return;
    }

    this.scrubber.max = String(this.duration);
    this.scrubber.disabled = this.duration <= 0;
  }
}

export const createInitialVideoPlayerViewState = (
  videos: VideoInfo[]
): VideoPlayerViewState => {
  const timeline = new VideoTimeline(videos);
  return {
    isPlaying: false,
    playbackSpeed: 1.0,
    duration: timeline.initialDuration,
  };
};

export class VideoPlayerController {
  private sourceSignature: string | null = null;
  private timeline: VideoTimeline;
  private readonly videosByIndex: Array<HTMLVideoElement | null> = [];
  private readonly controls = new VideoControlPainter();
  private readonly onViewStateChange: (state: VideoPlayerViewState) => void;
  private onTimeUpdate?: (
    time: number,
    options?: VideoTimeUpdateOptions
  ) => void;
  private viewState: VideoPlayerViewState;
  private animationFrame: number | null = null;
  private sliderSeekTimeout: number | null = null;
  private sliderSeekFrame: number | null = null;
  private pendingSliderSeek: number | null = null;
  private lastPlayheadPaint = 0;
  private lastParentNotification = 0;
  private lastSecondarySync = 0;
  private currentTime = 0;
  private isSeekingBySlider = false;
  private isSliderPointerDown = false;

  constructor({
    initialVideos,
    onTimeUpdate,
    onViewStateChange,
  }: VideoPlayerControllerOptions) {
    this.timeline = new VideoTimeline(initialVideos);
    this.onTimeUpdate = onTimeUpdate;
    this.onViewStateChange = onViewStateChange;
    this.viewState = createInitialVideoPlayerViewState(initialVideos);
    this.controls.setDuration(this.viewState.duration);
  }

  configure({ videos, episodeId, onTimeUpdate }: VideoPlayerSourceConfig): void {
    this.onTimeUpdate = onTimeUpdate;

    const nextSignature = createSourceSignature(videos, episodeId);
    if (nextSignature === this.sourceSignature) {
      return;
    }

    this.sourceSignature = nextSignature;
    this.timeline = new VideoTimeline(videos);
    this.videosByIndex.length = videos.length;
    this.resetForSource();
  }

  dispose(): void {
    this.clearPlaybackLoop();
    this.clearSliderSeekTimeout();
    this.clearSliderSeekFrame();
  }

  setVideoElement(index: number, element: HTMLVideoElement | null): void {
    this.videosByIndex[index] = element;

    if (element) {
      element.playbackRate = this.viewState.playbackSpeed;
    }
  }

  setScrubberElement(element: HTMLInputElement | null): void {
    this.controls.setScrubberElement(element);
    this.controls.setDuration(this.viewState.duration);
    this.controls.paint(this.currentTime);
  }

  setTimeLabelElement(element: HTMLSpanElement | null): void {
    this.controls.setTimeLabelElement(element);
    this.controls.paint(this.currentTime);
  }

  seekTo(time: number, options?: VideoSeekOptions): void {
    if (options?.preview) {
      this.previewSeekToOffset(time);
      return;
    }

    this.commitSeekToOffset(time);
  }

  getCurrentTime(): number {
    return this.timeline.getCurrentOffset(this.videosByIndex[0] ?? null, this.currentTime);
  }

  togglePlayback(): void {
    const allVideos = this.getMountedVideos();
    const firstVideo = allVideos[0];
    if (!firstVideo) {
      return;
    }

    const isPrimaryPlaying = !firstVideo.paused && !firstVideo.ended;
    if (isPrimaryPlaying) {
      this.pauseAllVideos();
      this.syncFromPrimaryVideo({
        forceLocalUpdate: true,
        forceParentUpdate: true,
        ignoreSeeking: true,
      });
      return;
    }

    const upperBound = this.timeline.getVideoUpperBound(0, firstVideo.duration);
    const lowerBound = this.timeline.referenceRange.fromTimestamp;
    if (
      firstVideo.currentTime < lowerBound ||
      firstVideo.currentTime >= upperBound
    ) {
      this.seekToOffset(0);
    }

    this.setPlaying(true);
    allVideos.forEach((video) => {
      video.playbackRate = this.viewState.playbackSpeed;
      const playRequest = video.play();

      if (video === firstVideo) {
        void playRequest
          .then(() => {
            this.startPlaybackLoop();
          })
          .catch(() => {
            this.clearPlaybackLoop();
            this.setPlaying(false);
          });
      } else {
        // Secondary cameras failing to autoplay must not surface as
        // unhandled promise rejections; the sync loop re-seeks them anyway.
        playRequest?.catch(() => undefined);
      }
    });
  }

  stop(): void {
    this.pauseAllVideos();
    this.seekToOffset(0);
  }

  setPlaybackSpeed(speed: number): void {
    this.setViewState({ playbackSpeed: speed });
    this.getMountedVideos().forEach((video) => {
      video.playbackRate = speed;
    });
  }

  handleGlobalKeyDown(event: KeyboardEvent): void {
    if (this.shouldIgnoreKeyboardEvent(event)) {
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      this.togglePlayback();
    }
  }

  handleVideoTimeUpdate(index: number, video: HTMLVideoElement): void {
    if (this.isSeekingBySlider) {
      return;
    }

    const range = this.timeline.getRange(index);
    const upperBound = this.timeline.getVideoUpperBound(index, video.duration);

    if (video.currentTime < range.fromTimestamp) {
      video.currentTime = range.fromTimestamp;
    }

    if (video.currentTime >= upperBound) {
      if (index === 0) {
        this.syncFromPrimaryVideo({
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
      this.updateDisplayedTime(offset, {
        forceLocalUpdate: true,
        forceParentUpdate: true,
      });
      this.syncSecondaryVideos(offset, true);
    }
  }

  handleLoadedMetadata(index: number, video: HTMLVideoElement): void {
    video.playbackRate = this.viewState.playbackSpeed;
    this.timeline.seekVideoToOffset(video, index, 0);

    if (index !== 0) {
      return;
    }

    const range = this.timeline.getRange(index);
    const upperBound = this.timeline.getVideoUpperBound(index, video.duration);
    const clipDuration = Math.max(upperBound - range.fromTimestamp, 0);

    this.setDuration(clipDuration);
    this.updateDisplayedTime(0, {
      forceLocalUpdate: true,
      forceParentUpdate: true,
    });
  }

  beginSliderSeek(): void {
    this.isSliderPointerDown = true;
    this.clearSliderSeekTimeout();
  }

  endSliderSeek(): void {
    this.isSliderPointerDown = false;
    this.finishSliderSeek();
  }

  handleSliderInput(value: number): void {
    this.previewSeekToOffset(value);

    if (!this.isSliderPointerDown) {
      this.sliderSeekTimeout = window.setTimeout(
        () => this.finishSliderSeek(),
        SLIDER_COMMIT_DELAY_MS
      );
    }
  }

  finishSliderSeek(): void {
    const pendingSeek = this.pendingSliderSeek ?? this.currentTime;
    this.commitSeekToOffset(pendingSeek);
    this.syncFromPrimaryVideo({
      forceLocalUpdate: true,
      forceParentUpdate: true,
      ignoreSeeking: true,
    });
  }

  private resetForSource(): void {
    this.clearPlaybackLoop();
    this.clearSliderSeekTimeout();
    this.clearSliderSeekFrame();
    this.lastPlayheadPaint = 0;
    this.lastParentNotification = 0;
    this.lastSecondarySync = 0;
    this.currentTime = 0;
    this.isSeekingBySlider = false;
    this.isSliderPointerDown = false;
    this.setPlaying(false);
    this.setDuration(this.timeline.initialDuration);
    this.controls.paint(0);
    this.seekAllToOffset(0);
    this.onTimeUpdate?.(0, { force: true });
  }

  private setDuration(duration: number): void {
    const normalizedDuration = normalizeDuration(duration);
    this.controls.setDuration(normalizedDuration);
    this.setViewState({ duration: normalizedDuration });
  }

  private setPlaying(isPlaying: boolean): void {
    this.setViewState({ isPlaying });
  }

  private setViewState(partialState: Partial<VideoPlayerViewState>): void {
    const nextState = {
      ...this.viewState,
      ...partialState,
    };

    if (
      nextState.isPlaying === this.viewState.isPlaying &&
      nextState.playbackSpeed === this.viewState.playbackSpeed &&
      nextState.duration === this.viewState.duration
    ) {
      return;
    }

    this.viewState = nextState;
    this.onViewStateChange(nextState);
  }

  private getMountedVideos(): HTMLVideoElement[] {
    return this.videosByIndex.filter(
      (video): video is HTMLVideoElement => video !== null
    );
  }

  private clearPlaybackLoop(): void {
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private clearSliderSeekTimeout(): void {
    if (this.sliderSeekTimeout !== null) {
      window.clearTimeout(this.sliderSeekTimeout);
      this.sliderSeekTimeout = null;
    }
  }

  private clearSliderSeekFrame(): void {
    if (this.sliderSeekFrame !== null) {
      window.cancelAnimationFrame(this.sliderSeekFrame);
      this.sliderSeekFrame = null;
    }
    this.pendingSliderSeek = null;
  }

  private seekAllToOffset(relativeTime: number): void {
    this.videosByIndex.forEach((video, index) => {
      if (video) {
        this.timeline.seekVideoToOffset(video, index, relativeTime);
      }
    });
  }

  private seekToOffset(time: number): void {
    const clamped = this.timeline.clampOffsetToDuration(
      time,
      this.viewState.duration
    );
    this.seekAllToOffset(clamped);
    this.updateDisplayedTime(clamped, {
      forceLocalUpdate: true,
      forceParentUpdate: true,
    });
    this.syncSecondaryVideos(clamped, true);
  }

  private previewSeekToOffset(time: number): void {
    const clamped = this.timeline.clampOffsetToDuration(
      time,
      this.viewState.duration
    );
    this.clearSliderSeekTimeout();
    this.isSeekingBySlider = true;
    this.updateDisplayedTime(clamped, {
      forceLocalUpdate: true,
      forceParentUpdate: false,
    });
    this.scheduleSliderSeek(clamped);
  }

  private commitSeekToOffset(time: number): void {
    const clamped = this.timeline.clampOffsetToDuration(
      time,
      this.viewState.duration
    );
    this.clearSliderSeekTimeout();
    this.clearSliderSeekFrame();
    this.isSeekingBySlider = false;
    this.seekToOffset(clamped);
  }

  private scheduleSliderSeek(relativeTime: number): void {
    this.pendingSliderSeek = relativeTime;

    if (this.sliderSeekFrame !== null) {
      return;
    }

    this.sliderSeekFrame = window.requestAnimationFrame(() => {
      this.sliderSeekFrame = null;
      const pendingSeek = this.pendingSliderSeek;
      if (pendingSeek === null) {
        return;
      }
      this.seekAllToOffset(pendingSeek);
    });
  }

  private updateDisplayedTime(
    time: number,
    options?: {
      forceLocalUpdate?: boolean;
      forceParentUpdate?: boolean;
    }
  ): void {
    const forceParentUpdate = options?.forceParentUpdate ?? false;
    const forceLocalUpdate = options?.forceLocalUpdate ?? forceParentUpdate;
    const now = performance.now();
    this.currentTime = time;

    if (
      forceLocalUpdate ||
      now - this.lastPlayheadPaint >= PLAYHEAD_UPDATE_INTERVAL_MS
    ) {
      this.lastPlayheadPaint = now;
      this.controls.paint(time);
    }

    if (
      this.onTimeUpdate &&
      (forceParentUpdate ||
        now - this.lastParentNotification >= PARENT_TIME_UPDATE_INTERVAL_MS)
    ) {
      this.lastParentNotification = now;
      this.onTimeUpdate(time, { force: forceParentUpdate });
    }
  }

  private syncSecondaryVideos(sourceOffset: number, force = false): void {
    const now = performance.now();
    if (!force && now - this.lastSecondarySync < SECONDARY_SYNC_INTERVAL_MS) {
      return;
    }

    this.lastSecondarySync = now;

    this.videosByIndex.forEach((video, index) => {
      if (!video || index === 0) {
        return;
      }

      const range = this.timeline.getRange(index);
      const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
      const desiredTime = clampToVideoRange(
        range.fromTimestamp + normalizeTime(sourceOffset),
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
  }

  private syncFromPrimaryVideo(
    options?: {
      forceLocalUpdate?: boolean;
      forceParentUpdate?: boolean;
      ignoreSeeking?: boolean;
    }
  ): void {
    const forceParentUpdate = options?.forceParentUpdate ?? false;
    const forceLocalUpdate = options?.forceLocalUpdate ?? forceParentUpdate;
    const ignoreSeeking = options?.ignoreSeeking ?? false;

    if (this.isSeekingBySlider && !ignoreSeeking) {
      return;
    }

    const primaryVideo = this.videosByIndex[0];
    if (!primaryVideo) {
      return;
    }

    const range = this.timeline.getRange(0);
    const upperBound = this.timeline.getVideoUpperBound(0, primaryVideo.duration);

    if (primaryVideo.currentTime < range.fromTimestamp) {
      primaryVideo.currentTime = range.fromTimestamp;
    }

    if (primaryVideo.currentTime >= upperBound) {
      const clipDuration = Math.max(upperBound - range.fromTimestamp, 0);

      this.clearPlaybackLoop();
      this.videosByIndex.forEach((video, index) => {
        if (!video) {
          return;
        }

        const otherUpperBound = this.timeline.getVideoUpperBound(
          index,
          video.duration
        );
        video.currentTime = otherUpperBound;
        video.pause();
      });
      this.setPlaying(false);
      this.updateDisplayedTime(clipDuration, {
        forceLocalUpdate: true,
        forceParentUpdate: true,
      });
      return;
    }

    const offset = Math.max(primaryVideo.currentTime - range.fromTimestamp, 0);
    this.updateDisplayedTime(offset, {
      forceLocalUpdate,
      forceParentUpdate,
    });
    this.syncSecondaryVideos(offset, forceParentUpdate);
  }

  private pauseAllVideos(): void {
    this.clearPlaybackLoop();
    this.videosByIndex.forEach((video) => {
      video?.pause();
    });
    this.setPlaying(false);
  }

  private startPlaybackLoop(): void {
    this.clearPlaybackLoop();
    this.lastPlayheadPaint = 0;

    const tick = () => {
      this.syncFromPrimaryVideo();

      const primaryVideo = this.videosByIndex[0];
      if (primaryVideo && !primaryVideo.paused && !primaryVideo.ended) {
        this.animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      this.animationFrame = null;
    };

    tick();
  }

  private shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
    if (event.repeat) {
      return true;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable ||
      Boolean(target.closest("button, a, [role='button'], .ant-select"))
    );
  }
}
