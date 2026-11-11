import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { getEngineCapabilities } from '../src/index.mjs';

test('reports versioned runtime, tools, encoder and filter capabilities', () => {
  const capabilities = getEngineCapabilities();

  assert.equal(capabilities.schemaVersion, 1);
  assert.equal(capabilities.node.supported, true);
  assert.equal(capabilities.tools.ffmpeg.available, true);
  assert.equal(capabilities.tools.ffprobe.available, true);
  assert.equal(typeof capabilities.render.videoEncoders.h264, 'boolean');
  assert.equal(typeof capabilities.render.videoEncoders.vp9, 'boolean');
  assert.equal(typeof capabilities.render.filters.colorspace, 'boolean');
  assert.equal(capabilities.requiredToolsReady, true);
  assert.equal(Object.hasOwn(capabilities, 'avatar'), false);
  assert.equal(Object.hasOwn(capabilities.tools, 'rhubarb'), false);
});

test('reports absent external tools without throwing', () => {
  const capabilities = getEngineCapabilities({
    ffmpeg: 'codex-engine-missing-ffmpeg',
    ffprobe: 'codex-engine-missing-ffprobe',
  });

  assert.equal(capabilities.tools.ffmpeg.available, false);
  assert.equal(capabilities.tools.ffprobe.available, false);
  assert.equal(capabilities.render.videoEncoders.h264, false);
  assert.equal(capabilities.requiredToolsReady, false);
});

test('rejects unsupported capability query options', () => {
  assert.throws(() => getEngineCapabilities({ providerKey: 'secret' }), /Unsupported capability option/);
  assert.throws(() => getEngineCapabilities({ ffmpeg: '' }), /non-empty command path/);
  assert.throws(() => getEngineCapabilities({ rhubarb: '' }), /Unsupported capability option/);
});

test('prints the same capability contract through the CLI', () => {
  const result = spawnSync(process.execPath, ['src/cli.mjs', 'capabilities'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const capabilities = JSON.parse(result.stdout);
  assert.equal(capabilities.schemaVersion, 1);
  assert.equal(Object.hasOwn(capabilities.tools, 'rhubarb'), false);
});
