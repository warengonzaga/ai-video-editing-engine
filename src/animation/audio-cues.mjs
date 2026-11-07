import { spawnSync } from 'node:child_process';

/** Create audio-level animation cues. This is not phoneme-based lip sync. */
export function audioLevelCues(inputPath, { rate = 15, ffmpeg = 'ffmpeg' } = {}) {
  if (typeof inputPath !== 'string' || !inputPath || !Number.isInteger(rate) || rate < 1 || rate > 120) throw new TypeError('A media path and a cue rate between 1 and 120 are required.');
  const decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', inputPath, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { encoding: null, maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (decoded.error || decoded.status !== 0) throw new Error(`Audio decode failed: ${decoded.error?.message ?? decoded.stderr.toString('utf8').trim()}`);
  const count = Math.floor(decoded.stdout.length / 2);
  if (!count) throw new Error('Audio contains no samples.');
  const durationSeconds = count / 16000;
  const levels = [];
  for (let i = 0; i < Math.ceil(durationSeconds * rate); i++) {
    const start = Math.floor(i * 16000 / rate), end = Math.min(count, Math.floor((i + 1) * 16000 / rate));
    let sum = 0;
    for (let j = start; j < end; j++) { const sample = decoded.stdout.readInt16LE(j * 2) / 32768; sum += sample * sample; }
    levels.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const scale = Math.max(sorted[Math.min(sorted.length - 1, Math.round(sorted.length * 0.95))], 0.008);
  const cues = levels.map((level, index) => {
    const value = level / scale;
    return { start: index / rate, end: Math.min(durationSeconds, (index + 1) / rate), state: value < .1 ? 'rest' : value < .22 ? 'closed' : value < .42 ? 'small' : value < .72 ? 'open' : 'wide' };
  });
  return { schemaVersion: 1, durationSeconds, cues };
}
