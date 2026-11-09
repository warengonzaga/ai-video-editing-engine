import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createVideoProject } from '../src/project/create.mjs';
import { listCanvasPresets, resolveCanvasPreset } from '../src/index.mjs';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

test('creates an isolated HyperFrames-ready video project', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    const project = createVideoProject(root, 'sample-video');
    const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
    const html = readFileSync(join(project, 'index.html'), 'utf8');
    assert.equal(meta.id, 'sample-video');
    assert.equal(meta.sourceFit, 'contain');
    assert.match(html, /data-composition-id="root"/);
    assert.equal(existsSync(join(project, 'assets', 'gsap.min.js')), true);
    assert.throws(() => createVideoProject(root, 'sample-video'), /already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects path-like project names', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    assert.throws(() => createVideoProject(root, '../outside'), /kebab-case slug/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates projects at a caller-selected aspect ratio and timeline', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    const project = createVideoProject(root, 'vertical-video', {
      width: 1080, height: 1920, fps: 60, durationSeconds: 15,
    });
    const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
    assert.deepEqual(
      { width: meta.width, height: meta.height, fps: meta.fps, durationSeconds: meta.durationSeconds },
      { width: 1080, height: 1920, fps: 60, durationSeconds: 15 }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exposes the four documented canvas presets as immutable engine data', () => {
  assert.deepEqual(listCanvasPresets().map(({ id, aspectRatio, width, height }) => ({ id, aspectRatio, width, height })), [
    { id: 'vertical', aspectRatio: '9:16', width: 1080, height: 1920 },
    { id: 'portrait-feed', aspectRatio: '4:5', width: 1080, height: 1350 },
    { id: 'square', aspectRatio: '1:1', width: 1080, height: 1080 },
    { id: 'landscape', aspectRatio: '16:9', width: 1920, height: 1080 },
  ]);
  assert.equal(Object.isFrozen(resolveCanvasPreset('vertical')), true);
  assert.throws(() => resolveCanvasPreset('invalid'), /Unknown canvas preset/);
});

test('creates a project from a preset and records its identifier in metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    const project = createVideoProject(root, 'portrait-feed', { preset: 'portrait-feed', sourceFit: 'cover' });
    const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
    assert.deepEqual(
      { width: meta.width, height: meta.height, canvasPreset: meta.canvasPreset, sourceFit: meta.sourceFit },
      { width: 1080, height: 1350, canvasPreset: 'portrait-feed', sourceFit: 'cover' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts rational frame rates through the CLI and stores their canonical value', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    execFileSync(process.execPath, [cliPath, 'project', 'create', 'ntsc-video', '--preset', 'landscape', '30000/1001', '10'], { cwd: root });
    const meta = JSON.parse(readFileSync(join(root, 'video-projects', 'ntsc-video', 'meta.json'), 'utf8'));
    assert.equal(meta.fps, '30000/1001');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects ambiguous preset and custom dimensions', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    assert.throws(
      () => createVideoProject(root, 'ambiguous-video', { preset: 'square', width: 1280 }),
      /Choose a canvas preset or custom width and height/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI lists presets and creates a project using a named preset', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    const listed = execFileSync(process.execPath, [cliPath, 'presets', 'list'], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(listed).map(({ id }) => id), ['vertical', 'portrait-feed', 'square', 'landscape']);

    execFileSync(process.execPath, [cliPath, 'project', 'create', 'social-video', '--preset', 'vertical', '--fit', 'fill'], { cwd: root });
    const meta = JSON.parse(readFileSync(join(root, 'video-projects', 'social-video', 'meta.json'), 'utf8'));
    assert.deepEqual(
      { width: meta.width, height: meta.height, canvasPreset: meta.canvasPreset, sourceFit: meta.sourceFit },
      { width: 1080, height: 1920, canvasPreset: 'vertical', sourceFit: 'fill' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid project dimensions', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    assert.throws(() => createVideoProject(root, 'invalid-video', { width: -1 }), /positive integers/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
