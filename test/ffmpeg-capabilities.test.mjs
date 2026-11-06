import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFfmpegEncoder, parseFfmpegEncoders, parseFfmpegFilters } from '../src/media/ffmpeg-capabilities.mjs';

test('parses filter names without treating the FFmpeg table header as a capability', () => {
  const output = [
    'Filters:',
    '  T.. = Timeline support',
    ' .. atempo            A->A       Adjust audio tempo.',
    ' .. rubberband        A->A       Apply time-stretching and pitch-shifting.',
  ].join('\n');
  assert.deepEqual([...parseFfmpegFilters(output)], ['atempo', 'rubberband']);
  assert.throws(() => parseFfmpegFilters(null), /must be text/);
});

test('parses FFmpeg encoders and fails clearly when a requested encoder is missing', () => {
  const output = [
    'Encoders:',
    ' V....D libx264              libx264 H.264 / AVC',
    ' V....D libx265              libx265 H.265 / HEVC',
    ' V....D libvpx-vp9           libvpx VP9',
    ' VFS... prores_ks            Apple ProRes',
    ' A..... aac                  AAC (Advanced Audio Coding)',
  ].join('\n');
  const encoders = parseFfmpegEncoders(output);

  assert.deepEqual([...encoders], ['libx264', 'libx265', 'libvpx-vp9', 'prores_ks', 'aac']);
  assert.equal(assertFfmpegEncoder('libx264', encoders), 'libx264');
  assert.equal(assertFfmpegEncoder('libvpx-vp9', encoders), 'libvpx-vp9');
  assert.throws(() => assertFfmpegEncoder('libsvtav1', encoders), /unavailable in this build/);
  assert.throws(() => parseFfmpegEncoders(null), /must be text/);
  assert.throws(() => assertFfmpegEncoder('libx264', []), /must be a Set/);
});
