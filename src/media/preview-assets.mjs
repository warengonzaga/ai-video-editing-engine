import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { probeMediaAsync } from './probe.mjs';
import { runProcess } from '../render/process.mjs';

const WAVEFORM_SAMPLE_RATE = 4000;
const MAX_THUMBNAILS = 20000;

export async function generateAssetPreview(projectPath, assetId, options = {}) {
  const { signal, onProgress, ...previewOptions } = options;
  validateAbortSignal(signal);
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Preview onProgress must be a function.');
  const report = (event) => {
    try { onProgress?.({ assetId, ...event }); } catch { /* Progress observers must not interrupt media processing. */ }
  };
  report({ stage: 'preview-preflight', phase: 'started' });
  report({ stage: 'preview', phase: 'started' });
  const root = resolve(projectPath);
  if (!existsSync(join(root, 'meta.json'))) throw new Error(`Not an Engine project: ${root}`);
  if (!/^[a-z][a-z0-9-]*$/.test(assetId ?? '')) throw new TypeError('Asset id must be a lowercase kebab-case identifier.');
  const thumbnailIntervalSeconds = previewOptions.thumbnailIntervalSeconds ?? 2;
  const thumbnailMaxDimension = previewOptions.thumbnailMaxDimension ?? 320;
  const waveformPoints = previewOptions.waveformPoints ?? 2000;
  if (!Number.isFinite(thumbnailIntervalSeconds) || thumbnailIntervalSeconds < 0.25 || thumbnailIntervalSeconds > 60) {
    throw new TypeError('thumbnailIntervalSeconds must be from 0.25 to 60.');
  }
  if (!Number.isSafeInteger(thumbnailMaxDimension) || thumbnailMaxDimension < 80 || thumbnailMaxDimension > 1280) {
    throw new TypeError('thumbnailMaxDimension must be an integer from 80 to 1280.');
  }
  if (!Number.isSafeInteger(waveformPoints) || waveformPoints < 32 || waveformPoints > 20000) {
    throw new TypeError('waveformPoints must be an integer from 32 to 20000.');
  }

  const manifestPath = join(root, 'assets', 'manifest.json');
  const assetsDirectory = join(root, 'assets');
  if (!existsSync(assetsDirectory) || !statSync(assetsDirectory).isDirectory() || lstatSync(assetsDirectory).isSymbolicLink()) throw new Error('Project assets directory is missing or unsafe.');
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) throw new Error('Project asset manifest is missing or unsafe.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) throw new TypeError('Asset manifest must use schemaVersion 1 and an assets array.');
  const asset = manifest.assets.find((entry) => entry?.id === assetId);
  if (!asset) throw new Error(`Asset is not registered: ${assetId}`);
  if (!['video', 'audio', 'image'].includes(asset.type) || !/^[\da-f]{64}$/.test(asset.sha256 ?? '')) throw new TypeError(`Asset manifest entry is invalid: ${assetId}`);
  const assetParts = typeof asset.path === 'string' ? asset.path.split('/') : [];
  if (assetParts.length !== 2 || assetParts[0] !== 'assets' || asset.path.includes('\\') || assetParts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`Asset path is invalid: ${assetId}`);
  }
  const source = resolve(root, asset.path);
  const sourceRelative = relative(root, source);
  if (!sourceRelative || sourceRelative.startsWith('..') || sourceRelative.includes(':') || asset.path.includes('\\')) throw new TypeError(`Asset path is invalid: ${assetId}`);
  if (!existsSync(source) || !statSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw new Error(`Asset ${assetId} is missing or unsafe.`);
  const sourceSize = statSync(source).size;
  let hashedBytes = 0;
  report({ stage: 'preview-integrity', phase: 'started', totalBytes: sourceSize });
  const sourceSha256 = await hashFileAsync(source, signal, (bytes) => {
    hashedBytes += bytes;
    report({ stage: 'preview-integrity', phase: 'progress', currentBytes: hashedBytes, totalBytes: sourceSize, percent: sourceSize ? Math.min(100, hashedBytes / sourceSize * 100) : 100 });
  });
  report({ stage: 'preview-integrity', phase: 'completed', currentBytes: sourceSize, totalBytes: sourceSize, percent: 100 });
  if (sourceSha256 !== asset.sha256) throw new Error(`Asset ${assetId} failed integrity verification; relink it before preview generation.`);
  signal?.throwIfAborted();

  const isImage = asset.type === 'image';
  report({ stage: 'preview-probe', phase: isImage ? 'skipped' : 'started', ...(isImage ? { reason: 'image asset' } : {}) });
  const media = isImage ? undefined : await probeMediaAsync(source, { requireVideo: false, signal });
  if (!isImage) report({ stage: 'preview-probe', phase: 'completed' });
  const hasVideo = isImage || Number.isFinite(media?.width);
  const hasAudio = !isImage && media?.hasAudio === true;
  const durationSeconds = isImage ? 0 : media.durationSeconds;
  if (hasVideo && !isImage && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) throw new Error(`Video asset ${assetId} has no usable duration.`);
  const settings = { thumbnailIntervalSeconds, thumbnailMaxDimension, waveformPoints };
  const key = createHash('sha256').update(JSON.stringify({ sourceSha256, settings })).digest('hex').slice(0, 20);
  const previewRoot = join(root, 'assets', 'previews');
  if (existsSync(previewRoot) && (!statSync(previewRoot).isDirectory() || lstatSync(previewRoot).isSymbolicLink())) throw new Error('Preview cache directory is unsafe.');
  mkdirSync(previewRoot, { recursive: true });
  const destination = join(previewRoot, `${assetId}-${key}`);
  const expected = { assetId, sourceSha256, settings, durationSeconds, isImage, hasVideo, hasAudio };
  report({ stage: 'preview-preflight', phase: 'completed' });
  if (existsSync(destination)) {
    report({ stage: 'preview-cache', phase: 'started' });
    const cached = await readCachedPreview(destination, expected, signal);
    report({ stage: 'preview-cache', phase: 'completed', result: 'hit' });
    report({ stage: 'preview-generation', phase: 'skipped', reason: 'cache hit' });
    report({ stage: 'preview', phase: 'completed', result: 'cached' });
    return cached;
  }

  const staging = join(previewRoot, `.preview-${randomUUID()}.tmp`);
  mkdirSync(staging, { recursive: false });
  try {
    const thumbnails = [];
    if (hasVideo) {
      const count = isImage ? 1 : Math.max(1, Math.ceil(durationSeconds / thumbnailIntervalSeconds - 1e-9));
      if (count > MAX_THUMBNAILS) throw new RangeError(`Preview would create ${count} thumbnails; increase thumbnailIntervalSeconds to stay within ${MAX_THUMBNAILS}.`);
      const pattern = join(staging, 'thumbnail-%05d.jpg');
      report({ stage: 'preview-thumbnails', phase: 'started', total: count });
      if (isImage) {
        await runFfmpeg(['-i', source, '-frames:v', '1', '-vf', `scale=${thumbnailMaxDimension}:${thumbnailMaxDimension}:force_original_aspect_ratio=decrease`, '-q:v', '3', join(staging, 'thumbnail-00001.jpg')], signal, { onProgress: report, durationSeconds: 0 });
      } else {
        await runFfmpeg(['-i', source, '-map', '0:v:0', '-vf', `fps=1/${thumbnailIntervalSeconds},scale=${thumbnailMaxDimension}:${thumbnailMaxDimension}:force_original_aspect_ratio=decrease`, '-frames:v', String(count), '-q:v', '3', pattern], signal, { onProgress: report, durationSeconds });
      }
      for (let index = 1; index <= count; index++) {
        const file = `thumbnail-${String(index).padStart(5, '0')}.jpg`;
        const path = join(staging, file);
        if (!existsSync(path) || statSync(path).size === 0) throw new Error(`FFmpeg did not create expected preview frame ${index} for ${assetId}.`);
        thumbnails.push({ timeSeconds: isImage ? 0 : Number(((index - 1) * thumbnailIntervalSeconds).toFixed(6)), file, sha256: await hashFileAsync(path, signal) });
        report({ stage: 'preview-thumbnails', phase: 'progress', current: index, total: count, percent: index / count * 100 });
      }
      report({ stage: 'preview-thumbnails', phase: 'completed', current: count, total: count, percent: 100 });
    }

    let waveform;
    if (hasAudio) {
      report({ stage: 'preview-waveform', phase: 'started', totalSamples: Math.ceil(durationSeconds * WAVEFORM_SAMPLE_RATE) });
      waveform = await createWaveform(source, durationSeconds, waveformPoints, signal, report);
      writeFileSync(join(staging, 'waveform.json'), `${JSON.stringify({ sampleRate: waveform.sampleRate, points: waveform.points })}\n`, { flag: 'wx' });
      report({ stage: 'preview-waveform', phase: 'completed', currentSamples: waveform.sampleCount, percent: 100 });
    }
    const result = {
      schemaVersion: 1,
      assetId,
      sourceSha256,
      durationSeconds,
      settings,
      thumbnails: thumbnails.map(({ timeSeconds, file }) => ({ timeSeconds, path: `assets/previews/${assetId}-${key}/${file}` })),
      ...(waveform ? { waveform: { path: `assets/previews/${assetId}-${key}/waveform.json`, sampleRate: waveform.sampleRate, points: waveform.points } } : {}),
    };
    writeFileSync(join(staging, 'preview.json'), `${JSON.stringify({ ...result, files: [
      ...thumbnails.map(({ file, sha256 }) => ({ file, sha256 })),
      ...(waveform ? [{ file: 'waveform.json', sha256: await hashFileAsync(join(staging, 'waveform.json'), signal) }] : []),
    ] }, null, 2)}\n`, { flag: 'wx' });
    signal?.throwIfAborted();
    report({ stage: 'preview-publish', phase: 'started' });
    try {
      await rename(staging, destination);
    } catch (error) {
      if (existsSync(destination)) {
        await rm(staging, { recursive: true, force: true });
        const cached = await readCachedPreview(destination, expected, signal);
        report({ stage: 'preview-publish', phase: 'skipped', reason: 'another process published matching preview' });
        report({ stage: 'preview', phase: 'completed', result: 'cached' });
        return cached;
      }
      if (!['EPERM', 'EXDEV'].includes(error.code)) throw error;
      mkdirSync(destination, { recursive: false });
      try {
        for (const file of readdirSync(staging)) {
          signal?.throwIfAborted();
          await copyFile(join(staging, file), join(destination, file));
        }
        await rm(staging, { recursive: true, force: true });
      } catch (copyError) {
        await rm(destination, { recursive: true, force: true });
        throw copyError;
      }
    }
    report({ stage: 'preview-publish', phase: 'completed' });
    report({ stage: 'preview', phase: 'completed', result: 'generated' });
    return result;
  } catch (error) {
    report({ stage: 'preview', phase: 'failed', message: error.message });
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function createWaveform(source, durationSeconds, pointCount, signal, onProgress) {
  signal?.throwIfAborted();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('ffmpeg', [
      '-nostdin', '-hide_banner', '-v', 'error', '-i', source, '-map', '0:a:0', '-vn',
      '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const points = Array.from({ length: pointCount }, () => ({ min: 1, max: -1 }));
    let sampleIndex = 0;
    let remainder = Buffer.alloc(0);
    let stderr = '';
    let reportedPercent = -1;
    let settled = false;
    const timer = setTimeout(() => child.kill(), 300000);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      rejectPromise(error);
    };
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      const usableBytes = data.length - (data.length % 4);
      for (let offset = 0; offset < usableBytes; offset += 4) {
        const sample = Math.max(-1, Math.min(1, data.readFloatLE(offset)));
        const time = sampleIndex / WAVEFORM_SAMPLE_RATE;
        const bucket = Math.min(pointCount - 1, Math.floor(time / durationSeconds * pointCount));
        points[bucket].min = Math.min(points[bucket].min, sample);
        points[bucket].max = Math.max(points[bucket].max, sample);
        sampleIndex++;
      }
      remainder = data.subarray(usableBytes);
      const percent = Math.min(99, Math.floor(sampleIndex / (durationSeconds * WAVEFORM_SAMPLE_RATE) * 100));
      if (percent > reportedPercent) {
        reportedPercent = percent;
        onProgress({ stage: 'preview-waveform', phase: 'progress', currentSamples: sampleIndex, totalSamples: Math.ceil(durationSeconds * WAVEFORM_SAMPLE_RATE), percent });
      }
    });
    child.stderr.on('data', (chunk) => { if (stderr.length < 32768) stderr += chunk.toString(); });
    child.on('error', (error) => fail(new Error(`Could not start FFmpeg waveform preview: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return fail(signal.reason ?? new DOMException('Asset preview was aborted.', 'AbortError'));
      if (code !== 0) return fail(new Error(`FFmpeg waveform preview failed: ${stderr.trim() || `exit code ${code}`}`));
      if (sampleIndex === 0) return fail(new Error('FFmpeg returned no audio samples for waveform preview.'));
      resolvePromise({ sampleRate: WAVEFORM_SAMPLE_RATE, sampleCount: sampleIndex, points: points.map((point) => ({
        min: point.min === 1 ? 0 : Number(point.min.toFixed(5)),
        max: point.max === -1 ? 0 : Number(point.max.toFixed(5)),
      })) });
    });
  });
}

async function readCachedPreview(directory, expected, signal) {
  if (!statSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Preview cache entry is unsafe.');
  const recordPath = join(directory, 'preview.json');
  if (!existsSync(recordPath) || lstatSync(recordPath).isSymbolicLink()) throw new Error('Preview cache record is missing or unsafe.');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (record.schemaVersion !== 1 || record.assetId !== expected.assetId || record.sourceSha256 !== expected.sourceSha256
      || JSON.stringify(record.settings) !== JSON.stringify(expected.settings) || record.durationSeconds !== expected.durationSeconds
      || !Array.isArray(record.files)) {
    throw new Error('Preview cache record does not match its source or settings.');
  }
  const fileNames = new Set();
  for (const file of record.files) {
    signal?.throwIfAborted();
    if (!file || basename(file.file) !== file.file || !/^[\da-f]{64}$/.test(file.sha256 ?? '')) throw new Error('Preview cache file record is invalid.');
    if (fileNames.has(file.file)) throw new Error('Preview cache file records contain duplicates.');
    fileNames.add(file.file);
    const path = join(directory, file.file);
    if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink() || await hashFileAsync(path, signal) !== file.sha256) {
      throw new Error(`Preview cache file is missing or modified: ${file.file}`);
    }
  }
  const previewDirectory = `assets/previews/${basename(directory)}`;
  const expectedThumbnailCount = expected.hasVideo
    ? (expected.isImage ? 1 : Math.max(1, Math.ceil(expected.durationSeconds / expected.settings.thumbnailIntervalSeconds - 1e-9)))
    : 0;
  if (expectedThumbnailCount > MAX_THUMBNAILS || record.thumbnails?.length !== expectedThumbnailCount) throw new Error('Preview cache thumbnail count is invalid.');
  if (!Array.isArray(record.thumbnails) || record.thumbnails.some((thumbnail) => !thumbnail
      || !Number.isFinite(thumbnail.timeSeconds) || !/^thumbnail-\d{5}\.jpg$/.test(basename(thumbnail.path ?? ''))
      || thumbnail.path !== `${previewDirectory}/${basename(thumbnail.path)}`
      || !fileNames.has(basename(thumbnail.path)))) throw new Error('Preview cache thumbnail records are invalid.');
  for (const [index, thumbnail] of record.thumbnails.entries()) {
    const expectedTime = expected.isImage ? 0 : Number((index * expected.settings.thumbnailIntervalSeconds).toFixed(6));
    if (thumbnail.timeSeconds !== expectedTime || basename(thumbnail.path) !== `thumbnail-${String(index + 1).padStart(5, '0')}.jpg`) {
      throw new Error('Preview cache thumbnail timing is invalid.');
    }
  }
  if (Boolean(record.waveform) !== expected.hasAudio) throw new Error('Preview cache waveform presence is invalid.');
  let waveformData;
  if (record.waveform) {
    if (record.waveform.path !== `${previewDirectory}/waveform.json` || !fileNames.has('waveform.json')
        || record.waveform.sampleRate !== WAVEFORM_SAMPLE_RATE) throw new Error('Preview cache waveform record is invalid.');
    waveformData = JSON.parse(readFileSync(join(directory, 'waveform.json'), 'utf8'));
    if (!Array.isArray(waveformData.points) || waveformData.points.length !== expected.settings.waveformPoints
        || JSON.stringify(waveformData.points) !== JSON.stringify(record.waveform.points)
        || waveformData.points.some((point) => !point || !Number.isFinite(point.min) || !Number.isFinite(point.max)
          || point.min < -1 || point.max > 1 || point.min > point.max)) throw new Error('Preview cache waveform samples are invalid.');
  }
  return {
    schemaVersion: record.schemaVersion,
    assetId: record.assetId,
    sourceSha256: record.sourceSha256,
    durationSeconds: record.durationSeconds,
    settings: record.settings,
    thumbnails: record.thumbnails,
    ...(record.waveform ? { waveform: { ...record.waveform, points: waveformData.points } } : {}),
  };
}

function validateAbortSignal(signal) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Preview signal must be an AbortSignal.');
  }
}

async function runFfmpeg(args, signal, { onProgress, durationSeconds } = {}) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error('FFmpeg thumbnail generation exceeded 120 seconds.');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, 120000);
  try {
    let outputBuffer = '';
    await runProcess('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], {
      signal: controller.signal,
      stdio: 'capture',
      onStdout(chunk) {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split(/\r?\n/);
        outputBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const [key, value] = line.split('=', 2);
          if (key !== 'out_time' || !durationSeconds) continue;
          const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
          if (!match) continue;
          const elapsed = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] ?? 0}`);
          onProgress({ stage: 'preview-thumbnails', phase: 'progress', percent: Math.min(99, elapsed / durationSeconds * 100) });
        }
      },
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'TimeoutError') throw error;
    throw new Error(`FFmpeg thumbnail generation failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function hashFileAsync(path, signal, onBytes) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) {
    hash.update(chunk);
    onBytes?.(chunk.length);
  }
  signal?.throwIfAborted();
  return hash.digest('hex');
}
