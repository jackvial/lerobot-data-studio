import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const log = (...args) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

export class AssertionFailure extends Error {}

export const assert = (condition, message) => {
  if (!condition) {
    throw new AssertionFailure(message);
  }
  log('  ✓', message);
};

/**
 * Spawn a managed child in its own process group so teardown can kill the
 * whole tree (npm run dev's actual vite child included).
 */
export const spawnManaged = (name, command, args, options, children) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    ...options,
  });
  const chunks = [];
  child.stdout.on('data', (d) => chunks.push(d));
  child.stderr.on('data', (d) => chunks.push(d));
  child.tail = () => Buffer.concat(chunks).toString().split('\n').slice(-25).join('\n');
  child.procName = name;
  children.push(child);
  return child;
};

export const waitForHttp = async (url, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
};

export const launchChrome = async (chromeBinary, profileDir, port, children) => {
  spawnManaged(
    'chrome',
    chromeBinary,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    {},
    children
  );
  await waitForHttp(`http://127.0.0.1:${port}/json/version`, 30000, 'chrome devtools');
  return puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: { width: 1600, height: 1000 },
  });
};

/**
 * Continuously captures page screenshots so the whole scenario can be
 * stitched into a reviewable video afterwards.
 */
export class FrameRecorder {
  constructor(page, framesDir, intervalMs = 500) {
    this.page = page;
    this.framesDir = framesDir;
    this.intervalMs = intervalMs;
    this.frameCount = 0;
    this.timer = null;
    this.busy = false;
    mkdirSync(framesDir, { recursive: true });
  }

  start() {
    this.timer = setInterval(() => void this.captureFrame(), this.intervalMs);
  }

  async captureFrame() {
    if (this.busy) return;
    this.busy = true;
    try {
      const name = `frame-${String(this.frameCount).padStart(6, '0')}.jpg`;
      await this.page.screenshot({
        path: join(this.framesDir, name),
        type: 'jpeg',
        quality: 60,
      });
      this.frameCount += 1;
    } catch {
      // navigation in flight — skip this frame
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // one last frame so the final state is always in the video
    await this.captureFrame();
  }
}

export const stitchVideo = (framesDir, outPath) => {
  if (!existsSync(framesDir) || readdirSync(framesDir).length === 0) {
    log(`no frames in ${framesDir}, skipping video`);
    return false;
  }
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-framerate', '4',
        '-i', join(framesDir, 'frame-%06d.jpg'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        outPath,
      ],
      { stdio: 'pipe' }
    );
    return true;
  } catch (error) {
    log(`ffmpeg failed for ${outPath}: ${error.message}. Frames kept at ${framesDir}`);
    return false;
  }
};

/** Milestone screenshots, numbered so they read in order. */
export class Snapshotter {
  constructor(page, dir, prefix) {
    this.page = page;
    this.dir = dir;
    this.prefix = prefix;
    this.counter = 0;
    mkdirSync(dir, { recursive: true });
  }

  async snap(name) {
    this.counter += 1;
    const file = join(
      this.dir,
      `${this.prefix}-${String(this.counter).padStart(2, '0')}-${name}.png`
    );
    await this.page.screenshot({ path: file });
    log(`  📸 ${file.split('/').pop()}`);
  }
}

// ---------- app-specific page helpers ----------

export const bodyIncludes = (page, text) =>
  page.evaluate((t) => document.body.innerText.includes(t), text);

export const waitForBodyText = async (page, text, timeoutMs, label = text) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await bodyIncludes(page, text)) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for "${label}" on the page`);
};

export const clickButtonByText = async (page, text) => {
  const clicked = await page.evaluate((t) => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes(t)
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button containing "${text}" not found`);
};

/** Toggle the sidebar checkbox for a specific episode number. */
export const toggleEpisodeCheckbox = async (page, episodeId) => {
  const done = await page.evaluate((id) => {
    const item = [...document.querySelectorAll('.ant-list-item')].find((li) => {
      const label = [...li.querySelectorAll('span')].map((s) => s.textContent?.trim());
      return label.includes(`Episode ${id}`);
    });
    const checkbox = item?.querySelector('.ant-checkbox-input');
    if (!checkbox) return false;
    checkbox.click();
    return true;
  }, episodeId);
  if (!done) throw new Error(`Sidebar checkbox for Episode ${episodeId} not found`);
};

export const getSelectedCountFromHeader = (page) =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('Create Dataset (')
    );
    const match = button?.textContent?.match(/Create Dataset \((\d+) episodes?\)/);
    return match ? Number(match[1]) : 0;
  });

// ---------- video/seek helpers ----------

/** Sparse pixel sample of the frame a <video> element is currently showing. */
export const sampleVideoFrame = (page, videoIndex = 0) =>
  page.evaluate((index) => {
    const video = document.querySelectorAll('video')[index];
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const sample = [];
    for (let i = 0; i < data.length; i += 61) sample.push(data[i]);
    return sample;
  }, videoIndex);

/** Mean absolute pixel difference between two frame samples (0-255 scale). */
export const frameDifference = (a, b) => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
};

export const getVideoStates = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('video')].map((v) => ({
      readyState: v.readyState,
      currentTime: v.currentTime,
      duration: v.duration,
      paused: v.paused,
      videoWidth: v.videoWidth,
      error: v.error?.message ?? null,
    }))
  );

export const waitForVideosReady = async (page, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await getVideoStates(page);
    if (states.length > 0 && states.every((s) => s.readyState >= 2 && s.videoWidth > 0)) {
      return states;
    }
    const broken = states.find((s) => s.error);
    if (broken) throw new Error(`video failed to decode: ${broken.error}`);
    await sleep(500);
  }
  throw new Error('Timed out waiting for videos to become playable');
};

export const getTimeLabel = (page) =>
  page.evaluate(() => {
    const spans = [...document.querySelectorAll('span')];
    const label = spans.find((s) => /\ds \/ .*s$/.test(s.textContent || ''));
    return label ? label.textContent : null;
  });

/** X position of the chart playhead marker, or null when hidden. */
export const getPlayheadX = (page) =>
  page.evaluate(() => {
    const marker = [...document.querySelectorAll('div')].find(
      (d) => d.style.backgroundColor === 'rgb(255, 107, 107)'
    );
    if (!marker || marker.style.display === 'none') return null;
    const match = marker.style.transform.match(/translateX\(([-\d.]+)px\)/);
    return match ? Number(match[1]) : null;
  });

/** Drag the seek scrubber from one fraction of its width to another. */
export const dragSlider = async (page, fromFraction, toFraction, steps = 10, stepDelayMs = 60) => {
  const slider = await page.$('input[type=range]');
  const box = await slider.boundingBox();
  const y = box.y + box.height / 2;
  const xAt = (f) => box.x + 4 + (box.width - 8) * f;
  await page.mouse.move(xAt(fromFraction), y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const f = fromFraction + ((toFraction - fromFraction) * i) / steps;
    await page.mouse.move(xAt(f), y);
    await sleep(stepDelayMs);
  }
  await page.mouse.up();
};

export const runPython = (repoRoot, script, args) => {
  const result = execFileSync('uv', ['run', 'python', script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result;
};
