import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');
const timeline = {
  schemaVersion: 1,
  project: { id: 'cli-edit', width: 1920, height: 1080, fps: 30, durationSeconds: 8 },
  assets: [{ id: 'camera', path: 'assets/camera.mp4', type: 'video', hasAudio: true, audioStreams: [
    { index: 0, streamIndex: 1, codec: 'aac', channels: 2, channelLayout: 'stereo', sampleRate: 48000, startSeconds: 0, durationSeconds: 10, timeBase: '1/48000', language: 'eng', title: 'Narration' },
    { index: 1, streamIndex: 2, codec: 'aac', channels: 1, channelLayout: 'mono', sampleRate: 44100, startSeconds: 0, durationSeconds: 10, timeBase: '1/44100', language: 'spa', title: 'Spanish' },
  ] }],
  tracks: [{
    id: 'video-main',
    kind: 'video',
    order: 0,
    clips: [
      { id: 'clip-one', assetId: 'camera', sourceIn: 0, sourceOut: 3, timelineStart: 0, durationSeconds: 3 },
      { id: 'clip-two', assetId: 'camera', sourceIn: 5, sourceOut: 10, timelineStart: 3, durationSeconds: 5 },
    ],
  }],
};

function runTimelineEdit(root, operation, name) {
  const inputPath = join(root, `${name}-input.json`);
  const operationPath = join(root, `${name}-operation.json`);
  const outputPath = join(root, `${name}-output.json`);
  writeFileSync(inputPath, JSON.stringify(timeline));
  writeFileSync(operationPath, JSON.stringify(operation));
  execFileSync(process.execPath, [cliPath, 'timeline', 'edit', inputPath, operationPath, outputPath], { encoding: 'utf8' });
  return JSON.parse(readFileSync(outputPath, 'utf8'));
}

test('timeline CLI inserts a synchronized gap and writes the edited timeline', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-timeline-cli-'));
  try {
    const result = runTimelineEdit(root, { type: 'insert-gap', timelineStart: 1.5, durationSeconds: 2 }, 'gap');
    assert.equal(result.project.durationSeconds, 10);
    assert.equal(result.tracks[0].clips[1].id, 'clip-one-gap-right-ripple-right');
    assert.equal(result.tracks[0].clips[2].timelineStart, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('timeline CLI slips source media without changing timeline placement', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-timeline-cli-'));
  try {
    const result = runTimelineEdit(root, { type: 'slip', trackId: 'video-main', clipId: 'clip-one', sourceDelta: 1.25 }, 'slip');
    const clip = result.tracks[0].clips[0];
    assert.equal(clip.sourceIn, 1.25);
    assert.equal(clip.sourceOut, 4.25);
    assert.equal(clip.timelineStart, 0);
    assert.equal(clip.durationSeconds, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('timeline CLI previews an edit plan without writing or changing the timeline', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-timeline-cli-'));
  try {
    const inputPath = join(root, 'timeline.json');
    const operationPath = join(root, 'operation.json');
    const outputPath = join(root, 'preview.json');
    const originalText = JSON.stringify(timeline, null, 2);
    writeFileSync(inputPath, originalText);
    writeFileSync(operationPath, JSON.stringify({ type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 4 }));

    const stdout = execFileSync(process.execPath, [cliPath, 'timeline', 'preview-edit', inputPath, operationPath], { encoding: 'utf8' });
    const preview = JSON.parse(stdout);
    assert.equal(preview.durationBeforeSeconds, 8);
    assert.equal(preview.durationAfterSeconds, 9);
    assert.ok(preview.changes.some((change) => change.clipId === 'clip-two' && change.after.timelineStart === 4));
    assert.equal(readFileSync(inputPath, 'utf8'), originalText);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('timeline CLI applies an edit plan as one atomic batch', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-timeline-cli-'));
  try {
    const result = runTimelineEdit(root, [
      { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 3.5 },
      { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 4 },
    ], 'batch');
    assert.equal(result.tracks[0].clips[1].timelineStart, 4);

    const inputPath = join(root, 'invalid-input.json');
    const operationPath = join(root, 'invalid-operation.json');
    const outputPath = join(root, 'invalid-output.json');
    writeFileSync(inputPath, JSON.stringify(timeline));
    writeFileSync(operationPath, JSON.stringify([
      { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 3.5 },
      { type: 'move', trackId: 'video-main', clipId: 'missing', timelineStart: 5 },
    ]));
    assert.throws(() => execFileSync(process.execPath, [cliPath, 'timeline', 'edit', inputPath, operationPath, outputPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('timeline CLI detaches a video clip audio range to a new track', () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-timeline-cli-'));
  try {
    const result = runTimelineEdit(root, {
      type: 'detach-audio',
      trackId: 'video-main',
      clipId: 'clip-one',
      audioTrackId: 'camera-audio',
      audioClipId: 'clip-one-audio',
      audioStreamIndex: 1,
    }, 'detach-audio');
    const track = result.tracks.find((candidate) => candidate.id === 'camera-audio');
    assert.equal(track.kind, 'audio');
    assert.equal(track.clips[0].audioStreamIndex, 1);
    assert.deepEqual(
      { assetId: track.clips[0].assetId, sourceIn: track.clips[0].sourceIn, sourceOut: track.clips[0].sourceOut, timelineStart: track.clips[0].timelineStart, durationSeconds: track.clips[0].durationSeconds },
      { assetId: 'camera', sourceIn: 0, sourceOut: 3, timelineStart: 0, durationSeconds: 3 },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
