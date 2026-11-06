import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintRenderProject, prepareRenderCheckpoint, pruneExpiredRenderCheckpoints, restoreRenderCheckpoint, saveRenderCheckpoint } from '../src/render/checkpoints.mjs';
import { resolveRenderControlArgs } from '../src/render/formats.mjs';
import { renderProject } from '../src/render/hyperframes.mjs';

test('fingerprints render inputs but excludes render outputs', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-checkpoint-fingerprint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'assets'));
  mkdirSync(join(root, 'renders'));
  writeFileSync(join(root, 'index.html'), '<div>scene</div>');
  writeFileSync(join(root, 'assets', 'source.bin'), 'source');
  writeFileSync(join(root, 'renders', 'old.mp4'), 'prior output');
  const profile = { quality: 'draft', format: 'mp4', fps: 30 };
  const before = await fingerprintRenderProject(root, profile);
  writeFileSync(join(root, 'renders', 'new.mp4'), 'another output');
  assert.equal(await fingerprintRenderProject(root, profile), before);
  writeFileSync(join(root, 'assets', 'source.bin'), 'changed source');
  assert.notEqual(await fingerprintRenderProject(root, profile), before);
});

test('stores, restores, rejects corrupted, and expires completed render checkpoints', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-checkpoint-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'renders', 'final.mp4');
  const capture = join(root, 'capture.mp4');
  mkdirSync(join(root, 'renders'));
  writeFileSync(capture, 'synthetic completed capture');
  const checkpoint = await prepareRenderCheckpoint(output, 'a'.repeat(64), { maxBytes: 1024 * 1024, maxAgeHours: 72 });
  assert.equal(await saveRenderCheckpoint(checkpoint, capture), checkpoint.artifact);
  assert.equal(await restoreRenderCheckpoint(checkpoint), checkpoint.artifact);

  writeFileSync(checkpoint.artifact, 'corrupted capture');
  assert.equal(await restoreRenderCheckpoint(checkpoint), undefined);
  assert.equal(await restoreRenderCheckpoint(checkpoint), undefined);

  assert.equal(await saveRenderCheckpoint(checkpoint, capture), checkpoint.artifact);
  const recordPath = checkpoint.manifest;
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.createdAt = Date.now() - 73 * 60 * 60 * 1000;
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`);
  await pruneExpiredRenderCheckpoints(checkpoint.root, 72);
  assert.equal(await restoreRenderCheckpoint(checkpoint), undefined);
});

test('validates checkpoint resource limits and async-only render control', () => {
  assert.deepEqual(resolveRenderControlArgs({ resumeCheckpoint: true, checkpointMaxBytes: 2 * 1024 * 1024, checkpointMaxAgeHours: 12 }), []);
  assert.throws(() => resolveRenderControlArgs({ resumeCheckpoint: 'yes' }), /resumeCheckpoint must be a boolean/);
  assert.throws(() => resolveRenderControlArgs({ checkpointMaxBytes: 1024 }), /checkpointMaxBytes/);
  assert.throws(() => resolveRenderControlArgs({ checkpointMaxAgeHours: 721 }), /checkpointMaxAgeHours/);
  assert.throws(() => renderProject('.', undefined, 'draft', { resumeCheckpoint: true }), /require renderProjectAsync/);
});
