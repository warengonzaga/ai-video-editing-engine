import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { analyzeMediaWithProvider, normalizeMediaFindings } from '../src/media/analysis-provider.mjs';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

function createAudio(path) {
  const result = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'pcm_s16le', path,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error?.code === 'ENOENT') return false;
  assert.equal(result.status, 0, result.stderr);
  return true;
}

test('runs injected media analysis and normalizes time-coded findings', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-analysis-'));
  try {
    const mediaPath = join(root, 'source.wav');
    if (!createAudio(mediaPath)) return t.skip('FFmpeg is not installed.');
    let request;
    const result = await analyzeMediaWithProvider(mediaPath, {
      id: 'scene-detector',
      async analyze(input) {
        request = input;
        return { findings: [
          { type: 'scene-change', startSeconds: 0.7, confidence: 0.8 },
          { type: 'silence', startSeconds: 0.1, endSeconds: 0.3, description: 'short pause' },
        ] };
      },
    }, { providerOptions: { threshold: 0.6 } });

    assert.equal(request.mediaPath, mediaPath);
    assert.ok(Math.abs(request.durationSeconds - 1) < 0.02);
    assert.equal(request.media.hasAudio, true);
    assert.deepEqual(request.options, { threshold: 0.6 });
    assert.equal(result.providerId, 'scene-detector');
    assert.deepEqual(result.analysis.findings.map((item) => item.type), ['silence', 'scene-change']);
    assert.equal(result.analysis.findings[0].id, 'finding-002');
    assert.equal(result.analysis.findings[1].confidence, 0.8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed findings and times outside the source duration', () => {
  assert.throws(() => normalizeMediaFindings({}, 1), /findings array/);
  assert.throws(() => normalizeMediaFindings({ findings: [{ type: 'Scene Change', startSeconds: 0.2 }] }, 1), /kebab-case type/);
  assert.throws(() => normalizeMediaFindings({ findings: [{ type: 'scene', startSeconds: 1 }] }, 1), /inside the media duration/);
  assert.throws(() => normalizeMediaFindings({ findings: [{ type: 'scene', startSeconds: 0.2, endSeconds: 2 }] }, 1), /within the media duration/);
  assert.throws(() => normalizeMediaFindings({ findings: [{ type: 'scene', startSeconds: 0.2, confidence: 1.1 }] }, 1), /confidence/);
});

test('runs an injected analysis provider from the CLI and preserves reviewable output', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-analysis-cli-'));
  try {
    const mediaPath = join(root, 'source.wav');
    if (!createAudio(mediaPath)) return t.skip('FFmpeg is not installed.');
    const providerPath = join(root, 'provider.mjs');
    const optionsPath = join(root, 'options.json');
    const outputPath = join(root, 'analysis.json');
    writeFileSync(providerPath, `export default { id: 'cli-detector', async analyze({ durationSeconds, options }) { const startSeconds = Math.min(options.startSeconds ?? 0.25, durationSeconds - 0.2); return { findings: [{ type: 'dead-air', startSeconds, confidence: 0.9, suggestion: { type: 'remove-range', sourceStart: startSeconds, sourceEnd: startSeconds + 0.1, reason: 'remove reviewed silence' } }] }; } };\n`);
    writeFileSync(optionsPath, JSON.stringify({ startSeconds: 0.25 }));

    const result = execFileSync(process.execPath, [cliPath, 'analyze', mediaPath, providerPath, outputPath, optionsPath], { encoding: 'utf8' });
    const analysis = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.match(result, /Wrote .*analysis\.json/);
    assert.equal(analysis.providerId, 'cli-detector');
    assert.equal(analysis.analysis.findings[0].startSeconds, 0.25);
    const candidatePath = join(root, 'candidate-edl.json');
    execFileSync(process.execPath, [cliPath, 'analysis-to-edl', outputPath, candidatePath], { encoding: 'utf8' });
    const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
    assert.equal(candidate.reviewStatus, 'needs-review');
    assert.equal(candidate.cuts[0].reason, 'finding-001: remove reviewed silence');
    const approvedPath = join(root, 'approved-edl.json');
    execFileSync(process.execPath, [cliPath, 'approve-edl', candidatePath, approvedPath], { encoding: 'utf8' });
    assert.equal(JSON.parse(readFileSync(approvedPath, 'utf8')).reviewStatus, 'approved');
    assert.throws(() => execFileSync(process.execPath, [cliPath, 'analyze', mediaPath, providerPath, outputPath], { encoding: 'utf8' }), /Output already exists/);
    assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).providerId, 'cli-detector');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
