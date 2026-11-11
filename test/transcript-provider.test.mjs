import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVideoProject } from '../src/project/create.mjs';
import { transcribeWithProvider } from '../src/transcript/provider.mjs';

function createAudio(path) {
  const generated = spawnSync(
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
      'sine=frequency=440:duration=1',
      '-c:a',
      'pcm_s16le',
      path,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (generated.error?.code === 'ENOENT') return false;
  assert.equal(generated.status, 0, generated.stderr);
  return true;
}

test('transcribes through an injected provider and stores normalized output', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-provider-'));
  try {
    const project = createVideoProject(root, 'provider-project');
    const media = join(root, 'source.wav');
    if (!createAudio(media)) return t.skip('FFmpeg is not installed.');
    let request;
    const result = await transcribeWithProvider(
      project,
      media,
      {
        id: 'test-provider',
        async transcribe(input) {
          request = input;
          return { words: [{ word: 'hello', start: 0.1, end: 0.5 }] };
        },
      },
      { providerOptions: { model: 'small' } },
    );

    assert.equal(request.mediaPath, media);
    assert.ok(Math.abs(request.durationSeconds - 1) < 0.02);
    assert.deepEqual(request.options, { model: 'small' });
    assert.equal(result.providerId, 'test-provider');
    assert.equal(result.wordCount, 1);
    assert.equal(result.durationSeconds, request.durationSeconds);
    const saved = JSON.parse(readFileSync(result.transcriptPath, 'utf8'));
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.granularity, 'word');
    assert.equal(saved.words[0].text, 'hello');
    await assert.rejects(
      () =>
        transcribeWithProvider(project, media, {
          id: 'another-provider',
          transcribe: async () => ({ words: [{ text: 'replace', start: 0, end: 0.2 }] }),
        }),
      /already exists|EEXIST/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed provider contracts and transcript results without writing output', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-provider-invalid-'));
  try {
    const project = createVideoProject(root, 'provider-project');
    const media = join(root, 'source.wav');
    if (!createAudio(media)) return t.skip('FFmpeg is not installed.');
    await assert.rejects(
      () => transcribeWithProvider(project, media, { id: 'invalid id', transcribe() {} }),
      /Provider must define/,
    );
    await assert.rejects(
      () =>
        transcribeWithProvider(project, media, {
          id: 'bad-result',
          async transcribe() {
            return { words: [{ text: 'out of range', start: 4, end: 5 }] };
          },
        }),
      /ends after the source duration/,
    );
    assert.equal(existsSync(join(project, 'transcripts', 'transcript.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
