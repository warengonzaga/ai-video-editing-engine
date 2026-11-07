import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVideoProject } from '../src/project/create.mjs';
import { registerMediaAsset } from '../src/project/assets.mjs';
import { exportTimelineToOtio, importTimelineFromOtio } from '../src/interchange/otio.mjs';

const python = process.env.AIVE_OTIO_PYTHON || process.env.PYTHON || 'python';
const otioAvailable = spawnSync(python, ['-c', 'import opentimelineio'], { encoding: 'utf8', windowsHide: true }).status === 0;
const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

test('round-trips a simple Engine timeline through native OTIO', { skip: !otioAvailable && 'Install requirements-otio.txt to run OTIO interchange coverage.' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-otio-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source.mp4');
  const generated = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=2',
    '-c:v', 'mpeg4', '-q:v', '5', source,
  ], { encoding: 'utf8', windowsHide: true });
  if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
  assert.equal(generated.status, 0, generated.stderr);

  const projectPath = createVideoProject(root, 'otio-test', { durationSeconds: 3 });
  const asset = registerMediaAsset(projectPath, source, { id: 'source' });
  const timeline = {
    schemaVersion: 1,
    project: { id: 'otio-test', width: 1920, height: 1080, fps: 30, durationSeconds: 3, sourceFit: 'contain' },
    assets: [asset],
    tracks: [{
      id: 'video-main', kind: 'video', order: 0,
      clips: [
        { id: 'intro', assetId: 'source', sourceIn: 0, sourceOut: 0.8, timelineStart: 0, durationSeconds: 0.8 },
        { id: 'outro', assetId: 'source', sourceIn: 1, sourceOut: 2, timelineStart: 1.2, durationSeconds: 1 },
      ],
    }],
  };
  const otioPath = join(root, 'roundtrip.otio');
  writeFileSync(otioPath, exportTimelineToOtio(projectPath, timeline), { flag: 'wx' });
  const imported = importTimelineFromOtio(projectPath, otioPath);
  assert.deepEqual(imported, timeline);
  assert.match(readFileSync(otioPath, 'utf8'), /"OTIO_SCHEMA"/);

  const timelinePath = join(root, 'timeline.json');
  const cliOtioPath = join(root, 'cli-roundtrip.otio');
  const importedPath = join(root, 'imported-timeline.json');
  writeFileSync(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, { flag: 'wx' });
  execFileSync(process.execPath, [cliPath, 'timeline', 'export-otio', projectPath, timelinePath, cliOtioPath], { stdio: 'pipe' });
  execFileSync(process.execPath, [cliPath, 'timeline', 'import-otio', projectPath, cliOtioPath, importedPath], { stdio: 'pipe' });
  assert.deepEqual(JSON.parse(readFileSync(importedPath, 'utf8')), timeline);

  const externalPath = join(root, 'external.otio');
  const externalScript = [
    'import opentimelineio as otio, pathlib, sys',
    'timeline = otio.schema.Timeline(name="external-edit")',
    'track = otio.schema.Track(name="external-video", kind=otio.schema.TrackKind.Video)',
    'reference = otio.schema.ExternalReference(target_url=pathlib.Path(sys.argv[1]).resolve().as_uri(), available_range=otio.opentime.TimeRange(otio.opentime.RationalTime(0, 1), otio.opentime.RationalTime(2, 1)))',
    'track.append(otio.schema.Clip(name="outside-clip", media_reference=reference, source_range=otio.opentime.TimeRange(otio.opentime.RationalTime(0, 1), otio.opentime.RationalTime(2, 1))))',
    'timeline.tracks.append(track)',
    'otio.adapters.write_to_file(timeline, sys.argv[2])',
  ].join('\n');
  execFileSync(python, ['-c', externalScript, source, externalPath], { stdio: 'pipe' });
  const externalImport = importTimelineFromOtio(projectPath, externalPath);
  assert.equal(externalImport.tracks[0].id, 'external-video');
  assert.equal(externalImport.tracks[0].clips[0].assetId, 'outside-clip');
  assert.equal(externalImport.assets.length, 1);
  assert.equal(JSON.parse(readFileSync(join(projectPath, 'assets', 'manifest.json'), 'utf8')).assets.length, 2);
});

test('imports SMPTE dissolves as video fades and audio crossfades', { skip: !otioAvailable && 'Install requirements-otio.txt to run OTIO interchange coverage.' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-otio-transition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const videoPath = join(root, 'source.mp4');
  const video = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=4',
    '-c:v', 'mpeg4', '-q:v', '5', videoPath,
  ], { encoding: 'utf8', windowsHide: true });
  if (video.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
  assert.equal(video.status, 0, video.stderr);

  const audioPath = join(root, 'source.wav');
  const audio = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:a', 'pcm_s16le', audioPath,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(audio.status, 0, audio.stderr);

  const projectPath = createVideoProject(root, 'otio-transition-test', { durationSeconds: 6 });
  const otioPath = join(root, 'transitions.otio');
  const script = [
    'import opentimelineio as otio, pathlib, sys',
    'timeline = otio.schema.Timeline(name="transition-test")',
    'def add_track(name, kind, path):',
    '    track = otio.schema.Track(name=name, kind=kind)',
    '    media = otio.schema.ExternalReference(target_url=pathlib.Path(path).resolve().as_uri(), available_range=otio.opentime.TimeRange(otio.opentime.RationalTime(0, 1), otio.opentime.RationalTime(4, 1)))',
    '    outgoing_range = otio.opentime.TimeRange(otio.opentime.RationalTime(0, 1), otio.opentime.RationalTime(3, 1))',
    '    incoming_range = otio.opentime.TimeRange(otio.opentime.RationalTime(1, 1), otio.opentime.RationalTime(3, 1))',
    '    track.append(otio.schema.Clip(name="outgoing", media_reference=media, source_range=outgoing_range))',
    '    track.append(otio.schema.Transition(name="dissolve", transition_type="SMPTE_Dissolve", in_offset=otio.opentime.RationalTime(1, 1), out_offset=otio.opentime.RationalTime(1, 1)))',
    '    track.append(otio.schema.Clip(name="incoming", media_reference=media, source_range=incoming_range))',
    '    timeline.tracks.append(track)',
    'add_track("video-dissolve", otio.schema.TrackKind.Video, sys.argv[1])',
    'add_track("audio-dissolve", otio.schema.TrackKind.Audio, sys.argv[2])',
    'otio.adapters.write_to_file(timeline, sys.argv[3])',
  ].join('\n');
  execFileSync(python, ['-c', script, videoPath, audioPath, otioPath], { stdio: 'pipe' });

  const imported = importTimelineFromOtio(projectPath, otioPath);
  assert.equal(imported.project.durationSeconds, 6);
  const videoTrack = imported.tracks.find((track) => track.kind === 'video');
  assert.equal(videoTrack.allowOverlap, true);
  assert.deepEqual(videoTrack.clips.map(({ timelineStart, durationSeconds, sourceIn, sourceOut, fadeInSeconds }) => ({ timelineStart, durationSeconds, sourceIn, sourceOut, fadeInSeconds })), [
    { timelineStart: 0, durationSeconds: 2, sourceIn: 0, sourceOut: 2, fadeInSeconds: undefined },
    { timelineStart: 2, durationSeconds: 2, sourceIn: 2, sourceOut: 4, fadeInSeconds: undefined },
    { timelineStart: 2, durationSeconds: 2, sourceIn: 0, sourceOut: 2, fadeInSeconds: 2 },
    { timelineStart: 4, durationSeconds: 2, sourceIn: 2, sourceOut: 4, fadeInSeconds: undefined },
  ]);

  const audioTrack = imported.tracks.find((track) => track.kind === 'audio');
  assert.equal(audioTrack.allowOverlap, true);
  assert.equal(audioTrack.clips[1].fadeOutSeconds, 2);
  assert.equal(audioTrack.clips[2].fadeInSeconds, 2);
});

test('OTIO export rejects unsupported overlapping clips before writing interchange data', { skip: !otioAvailable && 'Install requirements-otio.txt to run OTIO interchange coverage.' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'aive-otio-invalid-'));
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'source.mp4'), 'synthetic');
    assert.throws(() => exportTimelineToOtio(root, {
      schemaVersion: 1,
      project: { id: 'test', width: 640, height: 360, fps: 30, durationSeconds: 2, sourceFit: 'contain' },
      assets: [{ id: 'source', path: 'assets/source.mp4', type: 'video', durationSeconds: 2 }],
      tracks: [{ id: 'video-main', kind: 'video', order: 0, allowOverlap: true, clips: [
        { id: 'one', assetId: 'source', sourceIn: 0, sourceOut: 1, timelineStart: 0, durationSeconds: 1 },
        { id: 'two', assetId: 'source', sourceIn: 0, sourceOut: 1, timelineStart: 0.5, durationSeconds: 1 },
      ] }],
    }), /overlapping clips/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
