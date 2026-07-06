/**
 * End-to-end suite for LeRobot Data Studio.
 *
 * Orchestrates the whole stack itself (backend + vite + headless Chrome),
 * drives the real UI with puppeteer, validates results on the HuggingFace Hub
 * and on disk, and records every scenario as screenshots + a stitched video.
 *
 * Run from the repo root:   node e2e/run.mjs
 *
 * Environment:
 *   E2E_CHROME          Chrome binary            (default /usr/bin/google-chrome)
 *   E2E_KEEP_ARTIFACTS  "1" keeps created hub repos and local datasets
 *   HF_LEROBOT_HOME     LeRobot cache root       (default ~/.cache/huggingface/lerobot)
 *
 * Scenarios:
 *   A. Load jackvial/so101_pickplace_failrecv20_0 (HF hub id), select the ODD
 *      episodes, create a new dataset, verify it uploaded to the Hub, and
 *      validate its on-disk structure.
 *   B. Load a local dataset, select the EVEN episodes, create a new dataset,
 *      and validate the on-disk structure (episode mapping, no duplicates,
 *      contiguous indices, video slices).
 */

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import {
  AssertionFailure,
  FrameRecorder,
  Snapshotter,
  assert,
  bodyIncludes,
  clickButtonByText,
  dragSlider,
  frameDifference,
  getPlayheadX,
  getSelectedCountFromHeader,
  getTimeLabel,
  getVideoStates,
  launchChrome,
  log,
  runPython,
  sampleVideoFrame,
  sleep,
  spawnManaged,
  stitchVideo,
  toggleEpisodeCheckbox,
  waitForBodyText,
  waitForHttp,
  waitForVideosReady,
} from './lib.mjs';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(E2E_DIR, '..');
const FRONTEND_DIR = join(REPO_ROOT, 'src/lerobot_data_studio/frontend');

const BACKEND_PORT = 8300;
const VITE_PORT = 3100;
const CHROME_PORT = 9224;
const APP = `http://localhost:${VITE_PORT}`;
const API = `http://localhost:${BACKEND_PORT}`;

const CHROME_BINARY = process.env.E2E_CHROME || '/usr/bin/google-chrome';
const KEEP_ARTIFACTS = process.env.E2E_KEEP_ARTIFACTS === '1';
const LEROBOT_HOME =
  process.env.HF_LEROBOT_HOME || join(os.homedir(), '.cache/huggingface/lerobot');

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ARTIFACTS = join(E2E_DIR, 'artifacts', RUN_ID);
const SHOTS = join(ARTIFACTS, 'screenshots');
const VIDEOS = join(ARTIFACTS, 'videos');

const HUB_DATASET = 'jackvial/so101_pickplace_failrecv20_0'; // 20 episodes
const LOCAL_DATASET = 'jackvial/so101_cube_wristscene_motortest0'; // 5 episodes

const children = [];
const hubReposCreated = [];
const localDirsCreated = [];
const results = [];

const getHfUsername = async () => {
  const response = await fetch(`${API}/api/user/whoami`);
  const body = await response.json();
  if (!body.username) {
    throw new Error('Not logged in to HuggingFace (needed to push). Run `huggingface-cli login`.');
  }
  return body.username;
};

const datasetEpisodeCount = async (repoId) => {
  const [ns, name] = repoId.split('/');
  const response = await fetch(`${API}/api/datasets/${ns}/${name}/episodes`);
  if (!response.ok) throw new Error(`episodes list for ${repoId}: HTTP ${response.status}`);
  return (await response.json()).episodes.length;
};

/**
 * Drives the full create-dataset flow through the UI and waits for the
 * backend task to finish. Returns the backend task's final status.
 */
const createDatasetThroughUi = async (page, snap, { sourceRepoId, episodes, newRepoId }) => {
  const [ns, name] = sourceRepoId.split('/');

  log(`loading dataset ${sourceRepoId}`);
  await page.goto(`${APP}/${ns}/${name}`, { waitUntil: 'domcontentloaded' });
  // Auto-load can include a hub download; be patient.
  await waitForBodyText(page, 'Videos', 10 * 60 * 1000, `${sourceRepoId} viewer`);
  await waitForBodyText(page, 'Episode 0', 60 * 1000, 'sidebar episode list');
  await sleep(1500);
  await snap.snap('dataset-loaded');

  log(`selecting episodes: ${episodes.join(', ')}`);
  for (const episodeId of episodes) {
    await toggleEpisodeCheckbox(page, episodeId);
    await sleep(120);
  }
  await sleep(500);
  const selectedCount = await getSelectedCountFromHeader(page);
  assert(
    selectedCount === episodes.length,
    `header shows Create Dataset (${episodes.length} episodes)`
  );
  await snap.snap('episodes-selected');

  // Capture the create POST so we get the backend task id.
  let taskId = null;
  const onResponse = async (response) => {
    if (response.url().endsWith('/api/datasets/create') && response.request().method() === 'POST') {
      try {
        taskId = (await response.json()).task_id ?? null;
      } catch {
        /* non-JSON */
      }
    }
  };
  page.on('response', onResponse);

  await clickButtonByText(page, 'Create Dataset (');
  await waitForBodyText(page, 'New Dataset Repository ID', 15000, 'create modal');
  await page.type('#new_repo_id', newRepoId);
  await snap.snap('create-modal-filled');
  await page.evaluate(() => {
    const modal = document.querySelector('.ant-modal');
    const button = [...modal.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Create Dataset')
    );
    button.click();
  });

  // Wait for the task id, then poll the backend until the task settles while
  // the UI status modal stays on screen for the recording.
  const deadline = Date.now() + 30 * 60 * 1000;
  while (taskId === null && Date.now() < deadline) await sleep(250);
  page.off('response', onResponse);
  assert(Boolean(taskId), `backend returned a creation task id (${taskId})`);
  localDirsCreated.push(join(LEROBOT_HOME, newRepoId));
  hubReposCreated.push(newRepoId);

  let status = null;
  let lastLogged = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${API}/api/datasets/create/status/${taskId}`);
    status = await response.json();
    const line = `${status.status} ${Math.round((status.progress ?? 0) * 100)}% ${status.message ?? ''}`;
    if (line !== lastLogged) {
      log(`  task: ${line}`);
      lastLogged = line;
    }
    if (status.status === 'completed' || status.status === 'failed') break;
    await sleep(2000);
  }
  await sleep(2500); // let the UI's own 2s poll catch up so the modal shows the result
  await snap.snap('creation-result');

  assert(status?.status === 'completed', `creation task completed (${status?.message ?? 'no status'})`);
  assert(
    await bodyIncludes(page, 'Successfully created dataset'),
    'UI completion modal reports success'
  );
  return status;
};

const scenario = async (browser, name, fn, { frameIntervalMs = 500 } = {}) => {
  log(`\n===== Scenario ${name} =====`);
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.setDefaultTimeout(120000);

  const recorder = new FrameRecorder(page, join(ARTIFACTS, 'frames', name), frameIntervalMs);
  const snap = new Snapshotter(page, SHOTS, name);
  recorder.start();
  let failure = null;
  try {
    await fn(page, snap);
  } catch (error) {
    failure = error;
    try {
      await snap.snap('FAILURE');
    } catch {
      /* page may be gone */
    }
  }
  await recorder.stop();
  await page.close().catch(() => undefined);
  stitchVideo(join(ARTIFACTS, 'frames', name), join(VIDEOS, `${name}.mp4`));

  const unexpectedErrors = consoleErrors.filter((e) => !e.includes('antd v5 support React'));
  if (unexpectedErrors.length > 0) {
    log(`  ⚠ console errors during ${name}:`, JSON.stringify(unexpectedErrors.slice(0, 5)));
  }
  results.push({ name, ok: !failure, error: failure?.message });
  if (failure && !(failure instanceof AssertionFailure)) {
    log(`  scenario ${name} errored:`, failure.stack ?? failure.message);
  } else if (failure) {
    log(`  scenario ${name} FAILED:`, failure.message);
  } else {
    log(`  scenario ${name} PASSED`);
  }
};

const main = async () => {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(VIDEOS, { recursive: true });
  log(`artifacts: ${ARTIFACTS}`);

  log('starting backend, frontend, chrome...');
  const backend = spawnManaged(
    'backend',
    'uv',
    ['run', 'uvicorn', 'lerobot_data_studio.backend.main:app', '--port', String(BACKEND_PORT)],
    { cwd: REPO_ROOT },
    children
  );
  const vite = spawnManaged(
    'vite',
    'npm',
    ['run', 'dev', '--', '--port', String(VITE_PORT), '--strictPort'],
    { cwd: FRONTEND_DIR, env: { ...process.env, VITE_API_TARGET: API } },
    children
  );
  await waitForHttp(`${API}/api/datasets`, 60000, 'backend').catch((e) => {
    throw new Error(`${e.message}\nbackend log tail:\n${backend.tail()}`);
  });
  await waitForHttp(`${APP}/`, 60000, 'vite').catch((e) => {
    throw new Error(`${e.message}\nvite log tail:\n${vite.tail()}`);
  });
  const browser = await launchChrome(
    CHROME_BINARY,
    join(ARTIFACTS, 'chrome-profile'),
    CHROME_PORT,
    children
  );

  const username = await getHfUsername();
  log(`HF user: ${username}`);

  // ---- Scenario A: hub dataset, odd episodes, verify hub upload ----
  await scenario(browser, 'A-hub-odd-episodes', async (page, snap) => {
    await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
    await waitForBodyText(page, 'LeRobot Data Studio', 60000, 'home page');
    await snap.snap('home');

    const newRepoId = `${username}/e2e-odd-episodes-${RUN_ID.toLowerCase()}`;
    const total = 20; // so101_pickplace_failrecv20_0
    const oddEpisodes = Array.from({ length: total }, (_, i) => i).filter((i) => i % 2 === 1);

    await createDatasetThroughUi(page, snap, {
      sourceRepoId: HUB_DATASET,
      episodes: oddEpisodes,
      newRepoId,
    });

    log('verifying upload on the HuggingFace Hub...');
    const hubReport = runPython(REPO_ROOT, 'e2e/check_hub.py', [
      '--repo-id', newRepoId,
      '--expect-episodes', String(oddEpisodes.length),
    ]);
    console.log(hubReport);
    assert(hubReport.includes('RESULT: PASS'), 'hub upload verified (files + episode count)');

    log('validating the created dataset on disk...');
    const diskReport = runPython(REPO_ROOT, 'e2e/validate_dataset.py', [
      '--source-root', join(LEROBOT_HOME, HUB_DATASET),
      '--target-root', join(LEROBOT_HOME, newRepoId),
      '--selected', oddEpisodes.join(','),
    ]);
    console.log(diskReport);
    assert(diskReport.includes('RESULT: PASS'), 'on-disk structure of odd-episode dataset is valid');
  });

  // ---- Scenario B: local dataset, even episodes, verify disk structure ----
  await scenario(browser, 'B-local-even-episodes', async (page, snap) => {
    const newRepoId = `${username}/e2e-even-episodes-${RUN_ID.toLowerCase()}`;
    const total = await datasetEpisodeCount(LOCAL_DATASET).catch(() => null);
    // Dataset may not be loaded into the backend yet; the UI load will handle
    // that. Fall back to reading the sidebar after load if needed.
    const knownTotal = total ?? 5;
    const evenEpisodes = Array.from({ length: knownTotal }, (_, i) => i).filter(
      (i) => i % 2 === 0
    );

    await createDatasetThroughUi(page, snap, {
      sourceRepoId: LOCAL_DATASET,
      episodes: evenEpisodes,
      newRepoId,
    });

    log('validating the created dataset on disk...');
    const diskReport = runPython(REPO_ROOT, 'e2e/validate_dataset.py', [
      '--source-root', join(LEROBOT_HOME, LOCAL_DATASET),
      '--target-root', join(LEROBOT_HOME, newRepoId),
      '--selected', evenEpisodes.join(','),
    ]);
    console.log(diskReport);
    assert(
      diskReport.includes('RESULT: PASS'),
      'on-disk structure of even-episode dataset is valid'
    );
  });

  // ---- Scenario C: seeking + playback, proving the video frames change ----
  await scenario(
    browser,
    'C-seek-and-playback',
    async (page, snap) => {
      const [ns, name] = LOCAL_DATASET.split('/');
      await page.goto(`${APP}/${ns}/${name}/episode/0`, { waitUntil: 'domcontentloaded' });
      await waitForBodyText(page, 'Videos', 5 * 60 * 1000, 'episode viewer');
      const initialStates = await waitForVideosReady(page, 60000);
      const duration = initialStates[0].duration;
      assert(duration > 5, `videos decoded and report a duration (${duration.toFixed(2)}s)`);
      await sleep(1000);
      await snap.snap('loaded-t0');

      // Slow drag across the timeline — the recording shows the video frames
      // and the chart playhead tracking the scrubber.
      log('scrubbing across the full timeline...');
      const frameAt = { 0: await sampleVideoFrame(page) };
      await dragSlider(page, 0, 0.9, 18, 120);
      await sleep(600);
      const labelAfterDrag = await getTimeLabel(page);
      log(`  time label after drag: ${labelAfterDrag}`);
      assert(
        !labelAfterDrag.startsWith('0.00s'),
        `time label followed the drag (${labelAfterDrag})`
      );
      await snap.snap('after-full-scrub');

      // Discrete seeks: the displayed video frame must change at each stop.
      const seekStops = [0.25, 0.5, 0.75];
      const playheadXs = [];
      for (const fraction of seekStops) {
        await dragSlider(page, fraction, fraction, 1, 50);
        await sleep(800); // let the seek land and the frame paint
        const [state] = await getVideoStates(page);
        const target = fraction * duration;
        assert(
          Math.abs(state.currentTime - target) < 1.0,
          `seek to ${Math.round(fraction * 100)}% put video at ${state.currentTime.toFixed(
            2
          )}s (target ~${target.toFixed(2)}s)`
        );
        frameAt[fraction] = await sampleVideoFrame(page);
        playheadXs.push(await getPlayheadX(page));
        await snap.snap(`seek-${Math.round(fraction * 100)}pct`);
      }

      const pairs = [
        [0, 0.25],
        [0.25, 0.5],
        [0.5, 0.75],
      ];
      for (const [a, b] of pairs) {
        const difference = frameDifference(frameAt[a], frameAt[b]);
        assert(
          difference > 5,
          `video frame at ${b * 100}% differs from ${a * 100}% (mean pixel Δ ${difference.toFixed(1)})`
        );
      }
      assert(
        playheadXs.every((x) => x !== null) &&
          playheadXs[0] < playheadXs[1] &&
          playheadXs[1] < playheadXs[2],
        `chart playhead tracked the seeks (x: ${playheadXs.map((x) => x?.toFixed(0)).join(' → ')})`
      );

      // Playback: real mouse click on Play (trusted gesture), watch time advance.
      log('playing...');
      const playBox = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((b) =>
          (b.textContent || '').includes('Play')
        );
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await dragSlider(page, 0, 0, 1, 50); // back to the start
      await sleep(500);
      const frameBeforePlay = await sampleVideoFrame(page);
      await page.mouse.click(playBox.x, playBox.y);
      await sleep(2500);
      const [playingState] = await getVideoStates(page);
      assert(!playingState.paused, 'videos are playing after clicking Play');
      assert(
        playingState.currentTime > 1.5,
        `playback advanced to ${playingState.currentTime.toFixed(2)}s`
      );
      await snap.snap('playing');

      await page.mouse.click(playBox.x, playBox.y); // same button is now Pause
      await sleep(500);
      const [pausedState] = await getVideoStates(page);
      const framePaused = await sampleVideoFrame(page);
      assert(pausedState.paused, 'videos paused after clicking Pause');
      assert(
        frameDifference(frameBeforePlay, framePaused) > 5,
        'displayed frame changed over the course of playback'
      );
      const pausedLabel = await getTimeLabel(page);
      assert(
        pausedLabel.startsWith(pausedState.currentTime.toFixed(2).slice(0, 3)),
        `time label matches paused video time (${pausedLabel} vs ${pausedState.currentTime.toFixed(2)}s)`
      );
      await snap.snap('paused');

      // Stop resets to the beginning.
      await clickButtonByText(page, 'Stop');
      await sleep(600);
      const [stoppedState] = await getVideoStates(page);
      assert(stoppedState.currentTime < 0.2, 'Stop rewinds the videos to the start');
      const stoppedLabel = await getTimeLabel(page);
      assert(stoppedLabel.startsWith('0.00s'), `time label reset (${stoppedLabel})`);
      await snap.snap('stopped');
    },
    { frameIntervalMs: 250 } // denser recording so the seek video reads well
  );

  await browser.disconnect();
};

const cleanup = () => {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM'); // whole process group
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  if (KEEP_ARTIFACTS) {
    log('E2E_KEEP_ARTIFACTS=1 — keeping hub repos and local datasets');
    return;
  }
  for (const repoId of hubReposCreated) {
    try {
      runPython(REPO_ROOT, 'e2e/check_hub.py', ['--repo-id', repoId, '--delete']);
      log(`cleaned up hub repo ${repoId}`);
    } catch (error) {
      log(`could not delete hub repo ${repoId}: ${error.message}`);
    }
  }
  for (const dir of localDirsCreated) {
    // Only ever delete directories this run created, named with our prefix.
    if (dir.includes('/e2e-') && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      log(`cleaned up local dataset ${dir}`);
    }
  }
};

try {
  await main();
} catch (error) {
  log('suite error:', error.stack ?? error.message);
  results.push({ name: 'suite', ok: false, error: error.message });
} finally {
  cleanup();
}

log('\n===== Summary =====');
for (const result of results) {
  log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? ` — ${result.error}` : ''}`);
}
log(`screenshots: ${SHOTS}`);
log(`videos:      ${VIDEOS}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
