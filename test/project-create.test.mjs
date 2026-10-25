import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVideoProject } from '../src/project/create.mjs';

test('creates an isolated HyperFrames-ready video project', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    const project = createVideoProject(root, 'sample-video');
    const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
    const html = readFileSync(join(project, 'index.html'), 'utf8');
    assert.equal(meta.id, 'sample-video');
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

test('rejects invalid project dimensions', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-'));
  try {
    assert.throws(() => createVideoProject(root, 'invalid-video', { width: -1 }), /positive integers/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
