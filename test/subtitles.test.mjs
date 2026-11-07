import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createVideoProject } from '../src/project/create.mjs';
import { importProjectTranscript } from '../src/render/hyperframes.mjs';
import { formatSubtitleText, parseSubtitleText } from '../src/transcript/subtitles.mjs';

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.mjs');

function createAudio(path) {
  const result = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'pcm_s16le', path,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error?.code === 'ENOENT') return false;
  assert.equal(result.status, 0, result.stderr);
  return true;
}

test('parses SRT and WebVTT cues and exports normalized transcripts', () => {
  const srt = '1\n00:00:00,100 --> 00:00:00,500\n<i>Hello</i> &amp; welcome\n';
  assert.deepEqual(parseSubtitleText(srt, 'srt'), { words: [{ text: 'Hello & welcome', start: 0.1, end: 0.5 }] });
  const vtt = 'WEBVTT\n\nintro\n00:00.200 --> 00:00.900 align:start\nA cue\nwith two lines\n';
  assert.deepEqual(parseSubtitleText(vtt, 'vtt'), { words: [{ text: 'A cue with two lines', start: 0.2, end: 0.9 }] });
  const transcript = { schemaVersion: 1, granularity: 'cue', durationSeconds: 1, words: [{ text: 'Hello', start: 0.1, end: 0.5 }] };
  assert.equal(formatSubtitleText(transcript, 'srt'), '1\n00:00:00,100 --> 00:00:00,500\nHello\n');
  assert.equal(formatSubtitleText(transcript, 'vtt'), 'WEBVTT\n\n00:00:00.100 --> 00:00:00.500\nHello\n');
  assert.throws(() => parseSubtitleText('no cues', 'srt'), /No subtitle cues/);
  assert.throws(() => parseSubtitleText('00:61.000 --> 00:62.000\nBad', 'vtt'), /Invalid/);
});

test('imports SRT captions into an Engine project without invoking transcription', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-subtitles-'));
  try {
    const project = createVideoProject(root, 'subtitle-project');
    const media = join(root, 'source.wav');
    const subtitle = join(root, 'captions.srt');
    if (!createAudio(media)) return t.skip('FFmpeg is not installed.');
    writeFileSync(subtitle, '1\n00:00:00,100 --> 00:00:00,700\nSample cue\n');
    const result = importProjectTranscript(project, media, subtitle);
    assert.equal(result.wordCount, 1);
    const saved = JSON.parse(readFileSync(result.transcriptPath, 'utf8'));
    assert.equal(saved.granularity, 'cue');
    assert.equal(saved.words[0].text, 'Sample cue');
    assert.throws(() => importProjectTranscript(project, media, subtitle), /already has a transcript/);

    const vtt = join(root, 'captions.vtt');
    writeFileSync(vtt, 'WEBVTT\n\n00:00.100 --> 00:00.700\nA WebVTT cue\n');
    const vttProject = createVideoProject(root, 'vtt-project');
    assert.equal(JSON.parse(readFileSync(importProjectTranscript(vttProject, media, vtt).transcriptPath, 'utf8')).words[0].text, 'A WebVTT cue');

    const json = join(root, 'transcript.json');
    writeFileSync(json, JSON.stringify({ words: [{ text: 'JSON cue', start: 0.1, end: 0.7 }] }));
    const jsonProject = createVideoProject(root, 'json-project');
    assert.equal(JSON.parse(readFileSync(importProjectTranscript(jsonProject, media, json).transcriptPath, 'utf8')).words[0].text, 'JSON cue');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exports normalized captions through the CLI without overwriting files', () => {
  const root = mkdtempSync(join(dirname(cliPath), '..', '.tmp-subtitle-cli-'));
  try {
    const transcript = join(root, 'transcript.json');
    const output = join(root, 'captions.vtt');
    writeFileSync(transcript, JSON.stringify({
      schemaVersion: 1, durationSeconds: 1, words: [{ text: 'CLI export', start: 0.2, end: 0.8 }],
    }));
    execFileSync(process.execPath, [cliPath, 'transcript', 'export', transcript, 'vtt', output], { encoding: 'utf8' });
    assert.equal(readFileSync(output, 'utf8'), 'WEBVTT\n\n00:00:00.200 --> 00:00:00.800\nCLI export\n');
    assert.throws(() => execFileSync(process.execPath, [cliPath, 'transcript', 'export', transcript, 'vtt', output]), /Output already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
