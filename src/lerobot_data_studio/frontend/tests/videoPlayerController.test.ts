import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VideoPlayerController,
  VideoPlayerViewState,
  createInitialVideoPlayerViewState,
} from '../src/components/controllers/VideoPlayerController';
import { VideoInfo } from '../src/types';

class FakeVideo {
  currentTime = 0;
  duration = 10;
  paused = true;
  ended = false;
  playbackRate = 1;
  playResult: Promise<void> = Promise.resolve();

  play = vi.fn(() => {
    this.paused = false;
    return this.playResult;
  });

  pause = vi.fn(() => {
    this.paused = true;
  });

  asElement(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

const slicedVideo = (from: number, to: number): VideoInfo => ({
  url: '/api/videos/ns/name/file.mp4',
  filename: 'cam (file.mp4)',
  from_timestamp: from,
  to_timestamp: to,
});

const wholeVideo = (): VideoInfo => ({
  url: '/api/videos/ns/name/file.mp4',
  filename: 'cam (file.mp4)',
});

describe('VideoPlayerController', () => {
  let rafQueue: FrameRequestCallback[];
  let viewStates: VideoPlayerViewState[];
  let onTimeUpdate: ReturnType<typeof vi.fn>;

  const flushRaf = (): void => {
    const queue = rafQueue;
    rafQueue = [];
    queue.forEach((callback) => callback(performance.now()));
  };

  const createController = (
    videos: VideoInfo[],
    episodeId = 0
  ): VideoPlayerController => {
    const controller = new VideoPlayerController({
      initialVideos: videos,
      onTimeUpdate,
      onViewStateChange: (state) => viewStates.push(state),
    });
    controller.configure({ videos, episodeId, onTimeUpdate });
    return controller;
  };

  beforeEach(() => {
    rafQueue = [];
    viewStates = [];
    onTimeUpdate = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('derives the initial duration from the episode slice', () => {
    expect(createInitialVideoPlayerViewState([slicedVideo(12.5, 18.75)])).toEqual({
      isPlaying: false,
      playbackSpeed: 1,
      duration: 6.25,
    });
  });

  it('notifies the parent with a forced reset when the source changes', () => {
    const controller = createController([wholeVideo()]);

    expect(onTimeUpdate).toHaveBeenCalledWith(0, { force: true });

    onTimeUpdate.mockClear();
    controller.configure({
      videos: [wholeVideo()],
      episodeId: 0,
      onTimeUpdate,
    });
    expect(onTimeUpdate).not.toHaveBeenCalled();

    controller.configure({
      videos: [wholeVideo()],
      episodeId: 1,
      onTimeUpdate,
    });
    expect(onTimeUpdate).toHaveBeenCalledWith(0, { force: true });
  });

  it('sets clip duration from metadata of a sliced video', () => {
    const controller = createController([slicedVideo(12.5, 18.75)]);
    const video = new FakeVideo();
    video.duration = 30;
    controller.setVideoElement(0, video.asElement());

    controller.handleLoadedMetadata(0, video.asElement());

    expect(video.currentTime).toBe(12.5);
    // The slice already determined the duration (6.25s), so metadata arriving
    // with the same value must not emit a redundant view-state update.
    expect(viewStates).toHaveLength(0);
  });

  it('derives duration from media metadata when the video has no slice', () => {
    const controller = createController([wholeVideo()]);
    const video = new FakeVideo();
    video.duration = 30;
    controller.setVideoElement(0, video.asElement());

    controller.handleLoadedMetadata(0, video.asElement());

    expect(viewStates.at(-1)?.duration).toBe(30);
  });

  it('commits seeks in episode-relative time against absolute video time', () => {
    const controller = createController([slicedVideo(12.5, 18.75)]);
    const video = new FakeVideo();
    video.duration = 30;
    controller.setVideoElement(0, video.asElement());
    controller.handleLoadedMetadata(0, video.asElement());
    onTimeUpdate.mockClear();

    controller.seekTo(3);

    expect(video.currentTime).toBe(15.5);
    expect(onTimeUpdate).toHaveBeenCalledWith(3, { force: true });
  });

  it('clamps commits beyond the clip to its duration', () => {
    const controller = createController([slicedVideo(12.5, 18.75)]);
    const video = new FakeVideo();
    video.duration = 30;
    controller.setVideoElement(0, video.asElement());
    controller.handleLoadedMetadata(0, video.asElement());

    controller.seekTo(100);

    expect(video.currentTime).toBe(18.75);
  });

  it('paints the scrubber and time label directly without React state', () => {
    const controller = createController([slicedVideo(0, 10)]);
    const scrubber = document.createElement('input');
    scrubber.type = 'range';
    const label = document.createElement('span');
    controller.setScrubberElement(scrubber);
    controller.setTimeLabelElement(label);

    controller.seekTo(4);

    expect(scrubber.value).toBe('4');
    expect(scrubber.max).toBe('10');
    expect(label.textContent).toBe('4.00s / 10.00s');
    expect(viewStates.every((state) => state.duration === 10)).toBe(true);
  });

  it('previews slider input without forcing parent updates, then commits on release', () => {
    const controller = createController([slicedVideo(0, 10)]);
    const video = new FakeVideo();
    controller.setVideoElement(0, video.asElement());
    controller.handleLoadedMetadata(0, video.asElement());
    onTimeUpdate.mockClear();

    controller.beginSliderSeek();
    controller.handleSliderInput(2);
    controller.handleSliderInput(6);
    expect(onTimeUpdate).not.toHaveBeenCalledWith(expect.anything(), {
      force: true,
    });

    // Preview seeks are coalesced into one rAF per frame.
    expect(video.currentTime).toBe(0);
    flushRaf();
    expect(video.currentTime).toBe(6);

    controller.endSliderSeek();
    expect(video.currentTime).toBe(6);
    expect(onTimeUpdate).toHaveBeenCalledWith(6, { force: true });
  });

  it('commits a keyboard slider nudge after the debounce delay', () => {
    vi.useFakeTimers();
    const controller = createController([slicedVideo(0, 10)]);
    const video = new FakeVideo();
    controller.setVideoElement(0, video.asElement());
    controller.handleLoadedMetadata(0, video.asElement());
    onTimeUpdate.mockClear();

    controller.handleSliderInput(3);
    vi.advanceTimersByTime(100);

    expect(onTimeUpdate).toHaveBeenCalledWith(3, { force: true });
    expect(video.currentTime).toBe(3);
  });

  it('toggles playback across all mounted videos', async () => {
    const controller = createController([
      slicedVideo(0, 10),
      slicedVideo(0, 10),
    ]);
    const primary = new FakeVideo();
    const secondary = new FakeVideo();
    controller.setVideoElement(0, primary.asElement());
    controller.setVideoElement(1, secondary.asElement());

    controller.togglePlayback();
    await Promise.resolve();

    expect(primary.play).toHaveBeenCalled();
    expect(secondary.play).toHaveBeenCalled();
    expect(viewStates.at(-1)?.isPlaying).toBe(true);

    controller.togglePlayback();
    expect(primary.pause).toHaveBeenCalled();
    expect(secondary.pause).toHaveBeenCalled();
    expect(viewStates.at(-1)?.isPlaying).toBe(false);
  });

  it('reverts to paused when primary playback fails to start', async () => {
    const controller = createController([slicedVideo(0, 10)]);
    const video = new FakeVideo();
    video.playResult = Promise.reject(new Error('blocked'));
    controller.setVideoElement(0, video.asElement());

    controller.togglePlayback();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(viewStates.at(-1)?.isPlaying).toBe(false);
  });

  it('applies playback speed to every mounted video', () => {
    const controller = createController([
      slicedVideo(0, 10),
      slicedVideo(0, 10),
    ]);
    const primary = new FakeVideo();
    const secondary = new FakeVideo();
    controller.setVideoElement(0, primary.asElement());
    controller.setVideoElement(1, secondary.asElement());

    controller.setPlaybackSpeed(2);

    expect(primary.playbackRate).toBe(2);
    expect(secondary.playbackRate).toBe(2);
    expect(viewStates.at(-1)?.playbackSpeed).toBe(2);
  });

  it('toggles playback on space but ignores keystrokes from form controls', () => {
    const controller = createController([slicedVideo(0, 10)]);
    const video = new FakeVideo();
    controller.setVideoElement(0, video.asElement());

    const spaceEvent = new KeyboardEvent('keydown', { code: 'Space' });
    const preventDefault = vi.spyOn(spaceEvent, 'preventDefault');
    controller.handleGlobalKeyDown(spaceEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(video.play).toHaveBeenCalled();

    video.play.mockClear();
    const input = document.createElement('input');
    document.body.appendChild(input);
    let captured: KeyboardEvent | null = null;
    input.addEventListener('keydown', (event) => {
      captured = event as KeyboardEvent;
    });
    input.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    );
    controller.handleGlobalKeyDown(captured!);
    expect(video.play).not.toHaveBeenCalled();
    input.remove();
  });

  it('keeps a secondary video clamped to its slice window', () => {
    const controller = createController([
      slicedVideo(0, 10),
      slicedVideo(5, 15),
    ]);
    const secondary = new FakeVideo();
    secondary.duration = 20;
    controller.setVideoElement(1, secondary.asElement());

    secondary.currentTime = 16;
    controller.handleVideoTimeUpdate(1, secondary.asElement());

    expect(secondary.currentTime).toBe(15);
    expect(secondary.pause).toHaveBeenCalled();
  });
});
