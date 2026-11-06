import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFrameRate, frameRateNumber } from '../src/media/frame-rate.mjs';
import { resolveColorProfile, resolveEncoderArgs, resolveProfileEncoder, resolveRenderControlArgs, resolveRenderFormat, resolveVideoEncoder } from '../src/render/formats.mjs';
import { validateTimeline } from '../src/timeline/validate.mjs';

test('normalizes common and rational video frame rates', () => {
  assert.equal(normalizeFrameRate(29.97), '30000/1001');
  assert.equal(normalizeFrameRate('24000/1001'), '24000/1001');
  assert.equal(normalizeFrameRate('60000/2002'), '30000/1001');
  assert.equal(normalizeFrameRate('25.5'), '51/2');
  assert.equal(frameRateNumber('30000/1001'), 30000 / 1001);
  assert.throws(() => normalizeFrameRate('0/1'), /between 1 and 240/);
  assert.throws(() => normalizeFrameRate('241'), /between 1 and 240/);
});

test('resolves supported render formats from their output extension', () => {
  assert.equal(resolveRenderFormat('render.mp4'), 'mp4');
  assert.equal(resolveRenderFormat('render.webm'), 'webm');
  assert.equal(resolveRenderFormat('render.mov'), 'mov');
  assert.equal(resolveRenderFormat('render.gif'), 'gif');
  assert.equal(resolveRenderFormat(undefined), 'mp4');
  assert.throws(() => resolveRenderFormat('render.avi'), /Unsupported render output extension/);
  assert.throws(() => resolveRenderFormat('render.mp4', 'webm'), /does not match/);
  assert.equal(resolveRenderFormat('renders/frames', 'png-sequence'), 'png-sequence');
});

test('validates encoder quality and bitrate overrides', () => {
  assert.deepEqual(resolveEncoderArgs('mp4', { crf: 23 }), ['--crf', '23']);
  assert.deepEqual(resolveEncoderArgs('webm', { crf: 40 }), ['--crf', '40']);
  assert.deepEqual(resolveEncoderArgs('mov', { videoBitrate: '12M' }), ['--video-bitrate', '12M']);
  assert.deepEqual(resolveEncoderArgs('mp4', { videoBitrate: '800K' }), ['--video-bitrate', '800K']);
  assert.deepEqual(resolveEncoderArgs('mp4'), []);
  assert.throws(() => resolveEncoderArgs('mp4', { crf: 52 }), /0 to 51/);
  assert.throws(() => resolveEncoderArgs('webm', { crf: 64 }), /0 to 63/);
  assert.throws(() => resolveEncoderArgs('gif', { crf: 1 }), /not supported/);
  assert.throws(() => resolveEncoderArgs('png-sequence', { videoBitrate: '8M' }), /positive bitrate/);
  assert.throws(() => resolveEncoderArgs('mp4', { crf: 23, videoBitrate: '5M' }), /either crf or videoBitrate/);
  assert.throws(() => resolveEncoderArgs('mp4', { videoBitrate: '5; rm -rf' }), /positive bitrate/);
  assert.deepEqual(resolveVideoEncoder('mp4', { codec: 'h265', crf: 28 }), { codec: 'libx265', codecId: 'h265', crf: 28 });
  assert.deepEqual(resolveVideoEncoder('mov', { codec: 'prores' }), { codec: 'prores_ks', codecId: 'prores' });
  assert.deepEqual(resolveVideoEncoder('webm', { codec: 'vp9', videoBitrate: '4M' }), { codec: 'libvpx-vp9', codecId: 'vp9', videoBitrate: '4M' });
  assert.deepEqual(resolveEncoderArgs('mp4', { codec: 'h264', crf: 20 }), []);
  assert.throws(() => resolveVideoEncoder('mp4', { codec: 'vp9' }), /unsupported for mp4/);
  assert.throws(() => resolveVideoEncoder('mov', { codec: 'prores', crf: 20 }), /crf/);
});

test('resolves real SDR output color conversions and profile encoders', () => {
  assert.deepEqual(resolveColorProfile('rec709', 'mp4'), {
    id: 'rec709',
    filter: 'colorspace=iall=bt709:space=bt709:primaries=bt709:trc=bt709:range=tv',
    colorSpace: 'bt709',
    colorTransfer: 'bt709',
    colorPrimaries: 'bt709',
    colorRange: 'tv',
  });
  const rec2020 = resolveColorProfile('rec2020-sdr', 'mov');
  assert.equal(rec2020.colorSpace, 'bt2020nc');
  assert.equal(rec2020.colorPrimaries, 'bt2020');
  assert.equal(rec2020.colorTransfer, 'bt709');
  assert.deepEqual(resolveProfileEncoder('webm', resolveVideoEncoder('webm')), { codec: 'libvpx-vp9', codecId: 'vp9' });
  assert.throws(() => resolveColorProfile('rec2020-sdr', 'gif'), /supported for MP4, MOV, and WebM/);
  assert.throws(() => resolveColorProfile('hdr', 'mp4'), /choose rec709 or rec2020-sdr/);
});

test('validates render resource controls', () => {
  assert.deepEqual(resolveRenderControlArgs({ workers: 2, lowMemoryMode: true }), ['--workers', '2', '--low-memory-mode']);
  assert.deepEqual(resolveRenderControlArgs({ workers: 'auto', lowMemoryMode: false }), ['--workers', 'auto', '--no-low-memory-mode']);
  assert.deepEqual(resolveRenderControlArgs({}), []);
  assert.throws(() => resolveRenderControlArgs({ workers: 0 }), /workers must/);
  assert.throws(() => resolveRenderControlArgs({ workers: 65 }), /workers must/);
  assert.throws(() => resolveRenderControlArgs({ lowMemoryMode: 'yes' }), /lowMemoryMode must/);
  assert.deepEqual(resolveRenderControlArgs({ timeoutSeconds: 60 }), []);
  assert.throws(() => resolveRenderControlArgs({ timeoutSeconds: 0 }), /timeoutSeconds/);
  assert.throws(() => resolveRenderControlArgs({ timeoutSeconds: 86_401 }), /timeoutSeconds/);
  assert.throws(() => resolveRenderControlArgs({ unknown: true }), /Unsupported render option/);
});

test('validates a timeline using a rational frame rate', () => {
  const timeline = {
    schemaVersion: 1,
    project: { id: 'ntsc-demo', width: 1920, height: 1080, fps: '30000/1001', durationSeconds: 1 },
    assets: [{ id: 'camera', path: 'assets/camera.mp4' }],
    tracks: [{ id: 'video-main', kind: 'video', order: 0, clips: [{ id: 'first-clip', assetId: 'camera', sourceIn: 0, sourceOut: 1, timelineStart: 0, durationSeconds: 1 }] }],
  };
  assert.equal(validateTimeline(timeline), timeline);
  assert.throws(() => validateTimeline({ ...timeline, project: { ...timeline.project, fps: '0/1' } }), /between 1 and 240/);
});
