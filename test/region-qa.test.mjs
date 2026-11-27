import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getEngineCapabilities } from '../src/capabilities.mjs';
import { resolveFrameRect } from '../src/qa/frame-rect.mjs';
import { findRegionFlickerEvents, inspectRegionFlicker } from '../src/qa/region-flicker.mjs';
import { inspectRegionSafeZone, listSafeZonePresets } from '../src/qa/region-safe-zone.mjs';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

function timeline({ width = 1000, height = 1000, fps = 30, durationSeconds = 2, assets = [], tracks }) {
  return {
    schemaVersion: 1,
    project: { id: 'qa-sample', width, height, fps, durationSeconds },
    assets,
    tracks,
  };
}

function textClip(fields) {
  return {
    id: 'caption',
    text: 'Hello',
    timelineStart: 0,
    durationSeconds: 1,
    x: 0.2,
    y: 0.4,
    width: 0.2,
    height: 0.16,
    ...fields,
  };
}

function captionTrack(clip, fields = {}) {
  return { id: 'captions', kind: 'overlay', order: 0, clips: [clip], ...fields };
}

test('resolves fraction, percent, pixel, edge, and margin rectangles', () => {
  assert.deepEqual(resolveFrameRect({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 }, 200, 100), {
    x: 20,
    y: 20,
    width: 100,
    height: 25,
  });
  assert.deepEqual(resolveFrameRect({ unit: 'percent', x: 10, y: 20, width: 30, height: 40 }, 200, 100), {
    x: 20,
    y: 20,
    width: 60,
    height: 40,
  });
  assert.deepEqual(resolveFrameRect({ unit: 'pixel', x0: 10, y0: 0, x1: 40, y1: 20 }, 100, 100), {
    x: 10,
    y: 0,
    width: 30,
    height: 20,
  });
  assert.deepEqual(resolveFrameRect({ unit: 'fraction', left: 0.1, right: 0.1, top: 0.2, bottom: 0.3 }, 100, 200), {
    x: 10,
    y: 40,
    width: 80,
    height: 100,
  });
  assert.throws(() => resolveFrameRect({ x: 0, y: 0, width: 1, height: 1, left: 0 }, 10, 10), /x\/y\/width\/height/);
  assert.deepEqual(
    listSafeZonePresets().map((preset) => preset.id),
    ['full', 'action-safe', 'title-safe', 'vertical-social'],
  );
});

test('flags caption bounds outside title-safe and accepts action-safe defaults', () => {
  const report = inspectRegionSafeZone(timeline({ tracks: [captionTrack(textClip())] }));
  assert.equal(report.passed, true);
  assert.equal(report.safeZone.preset, 'title-safe');
  assert.deepEqual(report.safeZone.pixels, { x: 100, y: 100, width: 800, height: 800 });

  const outside = inspectRegionSafeZone(
    timeline({
      tracks: [captionTrack(textClip({ x: undefined, y: undefined, width: undefined, height: undefined }))],
    }),
    { tolerancePixels: 0 },
  );
  assert.equal(outside.passed, false);
  assert.equal(outside.violations[0].kind, 'text');
  assert.deepEqual(outside.violations[0].ranges[0].edges, ['left', 'right', 'bottom']);
  assert.equal(outside.violations[0].ranges[0].startSeconds, 0);
  assert.equal(outside.violations[0].ranges[0].endSeconds, 1);

  const actionSafe = inspectRegionSafeZone(
    timeline({
      tracks: [captionTrack(textClip({ x: undefined, y: undefined, width: undefined, height: undefined }))],
    }),
    { preset: 'action-safe', tolerancePixels: 0 },
  );
  assert.equal(actionSafe.passed, true);
});

test('reports the frames where a moving caption leaves the safe zone', () => {
  const report = inspectRegionSafeZone(
    timeline({
      durationSeconds: 1,
      tracks: [
        captionTrack(
          textClip({
            x: 0.2,
            y: 0.7,
            width: 0.6,
            height: 0.16,
            durationSeconds: 1,
            keyframes: [
              { time: 0, properties: { y: 0.7 } },
              { time: 1, properties: { y: 0 } },
            ],
          }),
        ),
      ],
    }),
    { tolerancePixels: 0 },
  );
  assert.equal(report.passed, false);
  const range = report.violations[0].ranges[0];
  assert.equal(range.startFrame, 26);
  assert.equal(range.endFrame, 30);
  assert.deepEqual(range.edges, ['top']);
  assert.ok(range.endBox.y < range.box.y);
});

test('uses rotated bounds, opacity, visibility, and caller boxes', () => {
  const rotated = inspectRegionSafeZone(
    timeline({
      tracks: [
        captionTrack(
          textClip({
            x: 0.12,
            y: 0.4,
            width: 0.2,
            height: 0.2,
            keyframes: [{ time: 0, properties: { rotationDegrees: 45 } }],
          }),
        ),
      ],
    }),
    { tolerancePixels: 0 },
  );
  assert.deepEqual(rotated.violations[0].ranges[0].edges, ['left']);
  assert.ok(rotated.violations[0].ranges[0].box.x < 100);

  const flat = inspectRegionSafeZone(
    timeline({ tracks: [captionTrack(textClip({ x: 0.12, y: 0.4, width: 0.2, height: 0.2 }))] }),
    { tolerancePixels: 0 },
  );
  assert.equal(flat.passed, true);

  const hidden = inspectRegionSafeZone(
    timeline({
      tracks: [
        captionTrack(
          textClip({
            x: 0,
            y: 0,
            width: 0.2,
            height: 0.2,
            keyframes: [{ time: 0, properties: { opacity: 0 } }],
          }),
        ),
      ],
    }),
  );
  assert.equal(hidden.passed, true);
  assert.equal(
    inspectRegionSafeZone(timeline({ tracks: [captionTrack(textClip({ x: 0, enabled: false }))] })).passed,
    true,
  );
  assert.equal(
    inspectRegionSafeZone(
      timeline({
        tracks: [captionTrack(textClip({ x: 0, y: 0, width: 0.2, height: 0.2 }), { visible: false })],
      }),
    ).passed,
    true,
  );

  const boxes = inspectRegionSafeZone(
    {
      width: 100,
      height: 100,
      fps: 10,
      boxes: [
        {
          id: 'label',
          unit: 'pixel',
          x: 0,
          y: 40,
          width: 20,
          height: 10,
          timeSeconds: 0.5,
          durationSeconds: 0.4,
        },
      ],
    },
    { preset: 'title-safe', tolerancePixels: 0 },
  );
  assert.equal(boxes.passed, false);
  assert.equal(boxes.violations[0].source, 'box');
  assert.deepEqual(boxes.violations[0].ranges[0].edges, ['left']);
  assert.equal(boxes.violations[0].ranges[0].startFrame, 5);
  assert.equal(boxes.violations[0].ranges[0].endFrame, 9);

  const overridden = inspectRegionSafeZone(
    { width: 100, height: 100, boxes: [{ id: 'label', unit: 'pixel', x: 0, y: 0, width: 10, height: 10 }] },
    { preset: 'title-safe', safeZone: { left: 0, right: 0, top: 0, bottom: 0 } },
  );
  assert.equal(overridden.passed, true);
  assert.equal(overridden.safeZone.preset, null);
});

test('ignores full-frame layers unless requested and warns on a wide vertical-social frame', () => {
  const video = timeline({
    assets: [{ id: 'camera', path: 'assets/camera.mp4' }],
    tracks: [
      {
        id: 'video-main',
        kind: 'video',
        order: 0,
        clips: [{ id: 'shot', assetId: 'camera', sourceIn: 0, sourceOut: 2, timelineStart: 0, durationSeconds: 2 }],
      },
    ],
  });
  assert.equal(inspectRegionSafeZone(video, { subjects: 'all' }).passed, true);
  assert.deepEqual(
    inspectRegionSafeZone(video, { subjects: 'all', ignoreFullFrame: false }).violations[0].ranges[0].edges,
    ['left', 'top', 'right', 'bottom'],
  );

  const pip = timeline({
    assets: [{ id: 'camera', path: 'assets/camera.mp4' }],
    tracks: [
      {
        id: 'video-main',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'inset',
            assetId: 'camera',
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
            x: 0,
            y: 0,
            width: 0.2,
            height: 0.2,
          },
        ],
      },
    ],
  });
  assert.deepEqual(inspectRegionSafeZone(pip, { subjects: 'all', tolerancePixels: 0 }).violations[0].ranges[0].edges, [
    'left',
    'top',
  ]);

  const wide = inspectRegionSafeZone(timeline({ width: 1920, height: 1080, tracks: [captionTrack(textClip())] }), {
    preset: 'vertical-social',
  });
  assert.match(wide.warnings[0], /9:16/);
  const tall = inspectRegionSafeZone(timeline({ width: 1080, height: 1920, tracks: [captionTrack(textClip())] }), {
    preset: 'vertical-social',
  });
  assert.deepEqual(tall.warnings, []);
  assert.throws(
    () => inspectRegionSafeZone(timeline({ tracks: [captionTrack(textClip())] }), { clipIds: ['missing'] }),
    /Unknown clip/,
  );
});

test('flags luminance spikes and pixel toggles without flagging a sustained step', () => {
  const flicker = findRegionFlickerEvents(
    {
      fps: 10,
      luminance: [0, 0, 20, 0, 0],
      consecutiveDiffs: [null, 0, 20, 20, 0],
      spanDiffs: [null, null, 20, 0, 20],
    },
    { luminanceSpike: 8, toggleThreshold: 12, toggleNeighborRatio: 0.5 },
  );
  assert.deepEqual(flicker.spikes, [{ frame: 2, timeSeconds: 0.2, delta: 20 }]);
  assert.deepEqual(flicker.toggles, [{ frame: 2, timeSeconds: 0.2, delta: 20, neighborDelta: 0 }]);

  const step = findRegionFlickerEvents({
    fps: 10,
    luminance: [0, 0, 20, 20, 20],
    consecutiveDiffs: [null, 0, 20, 0, 0],
    spanDiffs: [null, null, 20, 20, 0],
  });
  assert.deepEqual(step.spikes, []);
  assert.deepEqual(step.toggles, []);
  assert.equal(step.maxPixelDelta, 20);
  assert.equal(step.maxPixelDeltaFrame, 2);

  const luminanceOnly = findRegionFlickerEvents(
    {
      fps: 10,
      luminance: [0, 0, 20, 0, 0],
      consecutiveDiffs: [null, 0, 20, 20, 0],
      spanDiffs: [null, null, 20, 0, 20],
    },
    { metric: 'luminance' },
  );
  assert.equal(luminanceOnly.toggles.length, 0);
  assert.equal(luminanceOnly.spikes.length, 1);
  assert.throws(() => findRegionFlickerEvents({ fps: 0, luminance: [] }), /fps/);
});

test('inspects synthetic region flicker and leaves steady regions clean', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-region-qa-'));
  try {
    const flash = join(root, 'flash.mp4');
    const step = join(root, 'step.mp4');
    const made = spawnSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:r=10:d=0.5',
        '-vf',
        'drawbox=x=0:y=0:w=16:h=16:color=white:t=fill:enable=eq(n\\,3)',
        '-frames:v',
        '5',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv444p',
        '-crf',
        '0',
        flash,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (made.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(made.status, 0, made.stderr);
    const stepped = spawnSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=32x32:r=10:d=0.3',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=32x32:r=10:d=0.3',
        '-filter_complex',
        '[0:v][1:v]concat=n=2:v=1:a=0',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv444p',
        '-crf',
        '0',
        step,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(stepped.status, 0, stepped.stderr);

    const report = await inspectRegionFlicker(flash, {
      luminanceSpike: 8,
      toggleThreshold: 12,
      regions: [
        { id: 'corner', unit: 'pixel', x: 0, y: 0, width: 16, height: 16 },
        { id: 'corner-percent', unit: 'percent', x: 0, y: 0, width: 25, height: 25 },
        { id: 'far', unit: 'pixel', x: 40, y: 40, width: 24, height: 24 },
      ],
    });
    assert.equal(report.kind, 'region-flicker');
    assert.equal(report.frameCount, 5);
    const corner = report.regions.find((region) => region.id === 'corner');
    const percent = report.regions.find((region) => region.id === 'corner-percent');
    const far = report.regions.find((region) => region.id === 'far');
    assert.equal(corner.spikes.length, 1);
    assert.equal(corner.spikes[0].frame, 3);
    assert.equal(corner.toggles[0].frame, 3);
    assert.equal(percent.spikes[0].frame, 3);
    assert.deepEqual(far.spikes, []);
    assert.deepEqual(far.toggles, []);
    assert.equal(report.passed, false);

    const steady = await inspectRegionFlicker(step, { luminanceSpike: 8, toggleThreshold: 12 });
    assert.equal(steady.passed, true);
    assert.ok(steady.regions[0].maxPixelDelta > 20);
    await assert.rejects(
      () => inspectRegionFlicker(flash, { regions: [{ id: 'outside', x: 0.5, y: 0, width: 0.6, height: 0.2 }] }),
      /inside the frame/,
    );

    const cli = spawnSync(process.execPath, [cliPath, 'qa', 'flicker', flash], { encoding: 'utf8' });
    assert.equal(cli.status, 1);
    assert.equal(JSON.parse(cli.stdout).passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('region QA commands print JSON and use a failing status', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-region-qa-cli-'));
  try {
    const input = join(root, 'boxes.json');
    const options = join(root, 'options.json');
    writeFileSync(
      input,
      JSON.stringify({
        width: 100,
        height: 100,
        boxes: [{ id: 'label', unit: 'pixel', x: 0, y: 0, width: 10, height: 10 }],
      }),
    );
    writeFileSync(options, JSON.stringify({ preset: 'full' }));
    const passed = spawnSync(process.execPath, [cliPath, 'qa', 'safe-zone', input, options], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(JSON.parse(passed.stdout).passed, true);

    writeFileSync(options, JSON.stringify({ preset: 'title-safe', tolerancePixels: 0 }));
    const failed = spawnSync(process.execPath, [cliPath, 'qa', 'safe-zone', input, options], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).passed, false);
    const usage = spawnSync(process.execPath, [cliPath], { encoding: 'utf8' });
    assert.match(usage.stderr, /qa flicker/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publishes region QA capabilities without removing existing capability fields', () => {
  const capabilities = getEngineCapabilities();
  assert.equal(capabilities.schemaVersion, 1);
  assert.equal(capabilities.media.regionQuality.safeZone.defaultPreset, 'title-safe');
  assert.ok(capabilities.media.regionQuality.safeZone.presets.includes('vertical-social'));
  assert.equal(typeof capabilities.media.regionQuality.flicker.available, 'boolean');
  assert.equal(capabilities.media.sceneDetection.defaultThreshold, 0.35);
  assert.throws(
    () => inspectRegionSafeZone(timeline({ tracks: [captionTrack(textClip())] }), { nope: true }),
    /unsupported option/,
  );
});
