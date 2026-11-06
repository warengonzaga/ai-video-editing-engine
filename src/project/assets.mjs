import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, unlinkSync, writeFileSync, constants as fsConstants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { probeMedia } from '../media/probe.mjs';
import { normalizeFrameRate } from '../media/frame-rate.mjs';
import { validateTimeline } from '../timeline/validate.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function registerMediaAsset(projectPath, sourcePath, options = {}) {
  const root = resolve(projectPath);
  const source = resolve(sourcePath);
  const metaPath = join(root, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`Not an Engine project: ${root}`);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Media file not found: ${source}`);

  const extension = extname(source).toLowerCase();
  const id = options.id ?? defaultAssetId(source);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError('Asset id must be a lowercase kebab-case identifier.');
  const manifestPath = join(root, 'assets', 'manifest.json');
  const manifest = readAssetManifest(root);
  if (manifest.assets.some((asset) => asset.id === id)) throw new Error(`Asset already registered: ${id}`);

  const image = IMAGE_EXTENSIONS.has(extension);
  const probe = image ? probeImage(source) : probeMedia(source, { requireVideo: false });
  const relativePath = `assets/${id}${extension}`;
  const destination = join(root, relativePath);
  if (existsSync(destination)) throw new Error(`Asset destination already exists: ${relativePath}`);
  copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
  const asset = {
    id,
    path: relativePath,
    type: image ? 'image' : probe.width === null ? 'audio' : 'video',
    sizeBytes: statSync(source).size,
    sha256: hashFile(destination),
    ...(image ? { width: probe.width, height: probe.height, codec: probe.codec } : {
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      frameRate: probe.frameRate,
      nominalFrameRate: probe.nominalFrameRate,
      hasAudio: probe.hasAudio,
      audioStreams: probe.audioStreams,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      streamTiming: probe.streamTiming,
    }),
  };

  const temporaryManifest = join(root, 'assets', `.manifest.${randomUUID()}.tmp`);
  try {
    const next = { ...manifest, assets: [...manifest.assets, asset] };
    writeFileSync(temporaryManifest, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(manifestPath, readFileSync(temporaryManifest), { flag: 'w' });
    unlinkSync(temporaryManifest);
  } catch (error) {
    unlinkSync(destination);
    if (existsSync(temporaryManifest)) unlinkSync(temporaryManifest);
    throw error;
  }
  return asset;
}

export function verifyProjectAssets(projectPath) {
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  return manifest.assets.flatMap((asset) => {
    const path = resolveProjectAsset(root, asset.path);
    const sourceStatus = (status, actualSha256) => ({
      id: asset.id,
      variant: 'source',
      path: asset.path,
      status,
      expectedSha256: asset.sha256,
      ...(actualSha256 ? { actualSha256 } : {}),
    });
    if (!existsSync(path) || !statSync(path).isFile()) {
      return [sourceStatus('missing')];
    }
    if (lstatSync(path).isSymbolicLink()) return [sourceStatus('modified')];
    const actualSha256 = hashFile(path);
    const source = sourceStatus(actualSha256 === asset.sha256 ? 'ok' : 'modified', actualSha256);
    const proxies = (asset.proxies ?? []).map((proxy) => {
      const proxyPath = resolveProjectProxy(root, proxy.path);
      if (!existsSync(proxyPath) || !statSync(proxyPath).isFile() || lstatSync(proxyPath).isSymbolicLink()) {
        return { id: asset.id, variant: 'proxy', path: proxy.path, status: 'missing', expectedSha256: proxy.sha256 };
      }
      const actualProxySha256 = hashFile(proxyPath);
      return {
        id: asset.id,
        variant: 'proxy',
        path: proxy.path,
        status: actualProxySha256 === proxy.sha256 && proxy.sourceSha256 === asset.sha256 ? 'ok' : 'modified',
        expectedSha256: proxy.sha256,
        actualSha256: actualProxySha256,
      };
    });
    return [source, ...proxies];
  });
}

export function relinkProjectAsset(projectPath, assetId, sourcePath) {
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  const index = manifest.assets.findIndex((asset) => asset.id === assetId);
  if (index < 0) throw new Error(`Asset is not registered: ${assetId}`);
  const source = resolve(sourcePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Replacement media file not found: ${source}`);

  const previous = manifest.assets[index];
  if (extname(source).toLowerCase() !== extname(previous.path).toLowerCase()) throw new TypeError(`Replacement media must keep the registered ${extname(previous.path)} file extension.`);
  const image = IMAGE_EXTENSIONS.has(extname(source).toLowerCase());
  if ((previous.type === 'image') !== image) throw new TypeError(`Replacement media must be a ${previous.type} asset.`);
  const probe = image ? probeImage(source) : probeMedia(source, { requireVideo: false });
  const type = image ? 'image' : probe.width === null ? 'audio' : 'video';
  if (type !== previous.type) throw new TypeError(`Replacement media must be a ${previous.type} asset.`);

  const destination = resolveProjectAsset(root, previous.path);
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new TypeError('Registered asset paths cannot be symbolic links.');
  const assetDirectory = dirname(destination);
  mkdirSync(assetDirectory, { recursive: true });
  const stagedPath = join(assetDirectory, `.${assetId}.${randomUUID()}.relink.tmp`);
  const backupPath = join(assetDirectory, `.${assetId}.${randomUUID()}.backup.tmp`);
  const manifestPath = join(root, 'assets', 'manifest.json');
  const oldAssetExists = existsSync(destination);
  const originalManifest = readFileSync(manifestPath);
  const timelinePath = join(root, 'timeline.json');
  const originalTimeline = existsSync(timelinePath) ? readFileSync(timelinePath) : undefined;

  const replacementSha256 = hashFile(source);
  const updated = {
    ...previous,
    ...(image ? { width: probe.width, height: probe.height, codec: probe.codec } : {
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      frameRate: probe.frameRate,
      nominalFrameRate: probe.nominalFrameRate,
      hasAudio: probe.hasAudio,
      audioStreams: probe.audioStreams,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      streamTiming: probe.streamTiming,
    }),
    sizeBytes: statSync(source).size,
    sha256: replacementSha256,
    proxies: (previous.proxies ?? []).filter((proxy) => proxy.sourceSha256 === replacementSha256),
  };
  const nextManifest = { ...manifest, assets: manifest.assets.map((asset, assetIndex) => assetIndex === index ? updated : asset) };
  let nextTimeline;
  if (originalTimeline) {
    nextTimeline = JSON.parse(originalTimeline.toString('utf8'));
    const timelineAssetIndex = nextTimeline.assets.findIndex((asset) => asset.id === assetId);
    if (timelineAssetIndex >= 0) {
      nextTimeline.assets[timelineAssetIndex] = { ...nextTimeline.assets[timelineAssetIndex], ...updated };
      if (nextTimeline.lineage?.assetId === assetId) nextTimeline.lineage.sourceSha256 = updated.sha256;
      validateTimeline(nextTimeline);
    }
  }
  let installedNewAsset = false;
  let manifestCommitted = false;
  try {
    copyFileSync(source, stagedPath, fsConstants.COPYFILE_EXCL);
    if (oldAssetExists) copyFileSync(destination, backupPath, fsConstants.COPYFILE_EXCL);
    installedNewAsset = true;
    copyFileSync(stagedPath, destination);
    writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    if (nextTimeline) writeFileSync(timelinePath, `${JSON.stringify(nextTimeline, null, 2)}\n`);
    manifestCommitted = true;
  } catch (error) {
    if (!manifestCommitted) {
      if (installedNewAsset) {
        if (existsSync(backupPath)) copyFileSync(backupPath, destination);
        else rmSync(destination, { force: true });
      }
      writeFileSync(manifestPath, originalManifest);
      if (originalTimeline) writeFileSync(timelinePath, originalTimeline);
    }
    throw new Error(`Could not relink asset ${assetId}: ${error.message}`);
  } finally {
    rmSync(stagedPath, { force: true });
    rmSync(backupPath, { force: true });
  }
  for (const proxy of previous.proxies ?? []) {
    if (proxy.sourceSha256 !== updated.sha256) rmSync(resolveProjectProxy(root, proxy.path), { force: true });
  }
  return updated;
}

export function createAssetProxy(projectPath, assetId, options = {}) {
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  const assetIndex = manifest.assets.findIndex((asset) => asset.id === assetId);
  if (assetIndex < 0) throw new Error(`Asset is not registered: ${assetId}`);
  const asset = manifest.assets[assetIndex];
  if (asset.type !== 'video') throw new TypeError('Persistent proxies are supported for video assets.');
  for (const field of Object.keys(options)) if (!['maxDimension', 'crf', 'frameRate'].includes(field)) throw new TypeError(`Unsupported proxy option: ${field}.`);
  const { maxDimension = 960, crf = 28 } = options;
  const targetFrameRate = options.frameRate === undefined ? undefined : String(normalizeFrameRate(options.frameRate));
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 160 || maxDimension > 3840) throw new TypeError('Proxy maxDimension must be an integer from 160 to 3840.');
  if (!Number.isSafeInteger(crf) || crf < 18 || crf > 40) throw new TypeError('Proxy CRF must be an integer from 18 to 40.');

  const sourcePath = resolveProjectAsset(root, asset.path);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile() || lstatSync(sourcePath).isSymbolicLink()) throw new Error(`Asset ${assetId} is missing or not a regular project file.`);
  const sourceHash = hashFile(sourcePath);
  if (sourceHash !== asset.sha256) throw new Error(`Asset ${assetId} failed integrity verification; relink it before generating a proxy.`);
  const frameRateSuffix = targetFrameRate === undefined ? '' : `-fps${targetFrameRate.replace('/', '-')}`;
  const fileName = `${assetId}-${maxDimension}-crf${crf}${frameRateSuffix}-${sourceHash.slice(0, 12)}.mp4`;
  const relativePath = `assets/proxies/${fileName}`;
  const destination = join(root, ...relativePath.split('/'));
  const existing = (asset.proxies ?? []).find((proxy) => proxy.maxDimension === maxDimension && proxy.crf === crf
    && proxy.targetFrameRate === targetFrameRate && proxy.sourceSha256 === sourceHash);
  const destinationExists = existsSync(destination);
  if (destinationExists && lstatSync(destination).isSymbolicLink()) throw new TypeError('Proxy files cannot be symbolic links.');
  if (existing && existing.path === relativePath && destinationExists && hashFile(destination) === existing.sha256) return existing;
  if (destinationExists && !existing) throw new Error(`Proxy file already exists and is not registered: ${relativePath}`);

  const proxyDirectory = dirname(destination);
  mkdirSync(proxyDirectory, { recursive: true });
  if (lstatSync(proxyDirectory).isSymbolicLink()) throw new TypeError('Proxy directory cannot be a symbolic link.');
  const stagedPath = join(proxyDirectory, `.${assetId}.${randomUUID()}.tmp.mp4`);
  const backupPath = join(proxyDirectory, `.${assetId}.${randomUUID()}.backup.mp4`);
  const filters = [
    ...(targetFrameRate !== undefined ? [`fps=${targetFrameRate}`] : []),
    `scale=${maxDimension}:${maxDimension}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
  ];
  const args = [
    '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', sourcePath,
    '-map', '0:v:0', '-vf', filters.join(','),
    ...(targetFrameRate !== undefined ? ['-fps_mode', 'cfr'] : []),
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', stagedPath,
  ];
  try {
    const result = spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Could not generate video proxy: ${result.error?.message ?? result.stderr.trim()}`);
    const probe = probeMedia(stagedPath);
    const expectedRatio = asset.width / asset.height;
    const actualRatio = probe.width / probe.height;
    if (probe.width > maxDimension || probe.height > maxDimension || Math.abs(expectedRatio - actualRatio) > 0.01) {
      throw new Error('Generated video proxy has invalid dimensions or aspect ratio.');
    }
    const frameDuration = 1 / (asset.frameRate ?? 30);
    if (Math.abs(probe.durationSeconds - asset.durationSeconds) > Math.max(0.15, frameDuration * 2)) {
      throw new Error(`Generated video proxy duration ${probe.durationSeconds.toFixed(3)}s does not match source duration ${asset.durationSeconds}s.`);
    }
    if (Math.abs((probe.streamTiming.videoStartSeconds ?? 0) - (asset.streamTiming?.videoStartSeconds ?? 0)) > Math.max(0.05, frameDuration)) {
      throw new Error('Generated video proxy does not preserve the source video start time.');
    }
    const proxy = {
      path: relativePath,
      maxDimension,
      crf,
      ...(targetFrameRate !== undefined ? { targetFrameRate } : {}),
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.durationSeconds,
      frameRate: probe.frameRate,
      nominalFrameRate: probe.nominalFrameRate,
      streamTiming: probe.streamTiming,
      sizeBytes: statSync(stagedPath).size,
      sha256: hashFile(stagedPath),
      sourceSha256: sourceHash,
    };
    if (destinationExists) copyFileSync(destination, backupPath, fsConstants.COPYFILE_EXCL);
    copyFileSync(stagedPath, destination, destinationExists ? 0 : fsConstants.COPYFILE_EXCL);
    const nextAsset = { ...asset, proxies: [...(asset.proxies ?? []).filter((entry) => !(entry.maxDimension === maxDimension
      && entry.crf === crf && entry.targetFrameRate === targetFrameRate)), proxy] };
    const nextManifest = { ...manifest, assets: manifest.assets.map((entry, index) => index === assetIndex ? nextAsset : entry) };
    writeAssetManifest(root, nextManifest);
    return proxy;
  } catch (error) {
    if (destinationExists && existsSync(backupPath)) copyFileSync(backupPath, destination);
    else if (!destinationExists) rmSync(destination, { force: true });
    throw error;
  } finally {
    rmSync(stagedPath, { force: true });
    rmSync(backupPath, { force: true });
  }
}

export function resolveAssetProxies(projectPath, timeline) {
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  const proxies = new Map();
  const videoIds = new Set(timeline.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips.map((clip) => clip.assetId)));
  for (const assetId of videoIds) {
    const asset = manifest.assets.find((entry) => entry.id === assetId);
    if (asset?.type !== 'video') continue;
    const sourcePath = resolveProjectAsset(root, asset.path);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile() || lstatSync(sourcePath).isSymbolicLink() || hashFile(sourcePath) !== asset.sha256) {
      throw new Error(`Video asset ${assetId} failed integrity verification; relink it before proxy rendering.`);
    }
    const targetFrameRate = String(normalizeFrameRate(timeline.project.fps));
    const proxy = asset?.proxies?.filter((entry) => entry.sourceSha256 === asset.sha256
      && (entry.targetFrameRate === undefined || entry.targetFrameRate === targetFrameRate))
      .sort((left, right) => Number(right.targetFrameRate === targetFrameRate) - Number(left.targetFrameRate === targetFrameRate)
        || left.maxDimension - right.maxDimension || right.crf - left.crf)[0];
    if (!proxy) throw new Error(`Video asset ${assetId} has no current proxy; create one with "asset proxy create" first.`);
    if (!/^[\da-f]{64}$/.test(proxy.sha256 ?? '') || !Number.isSafeInteger(proxy.maxDimension) || !Number.isSafeInteger(proxy.crf)) throw new TypeError(`Proxy metadata is invalid for asset ${assetId}.`);
    const parts = typeof proxy.path === 'string' ? proxy.path.split('/') : [];
    if (parts.length !== 3 || parts[0] !== 'assets' || parts[1] !== 'proxies' || parts.some((part) => !part || part === '.' || part === '..') || proxy.path.includes('\\')) {
      throw new TypeError(`Proxy path is invalid for asset ${assetId}.`);
    }
    const path = resolve(root, proxy.path);
    if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) throw new TypeError(`Proxy path escapes project: ${proxy.path}`);
    if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink() || hashFile(path) !== proxy.sha256) {
      throw new Error(`Proxy for asset ${assetId} is missing or modified; regenerate it before preview rendering.`);
    }
    proxies.set(assetId, proxy);
  }
  return proxies;
}

function readAssetManifest(root) {
  const assetsPath = join(root, 'assets');
  if (!existsSync(join(root, 'meta.json')) || !existsSync(assetsPath) || !statSync(assetsPath).isDirectory() || lstatSync(assetsPath).isSymbolicLink()) throw new Error(`Not an Engine project: ${root}`);
  const manifestPath = join(root, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) return { schemaVersion: 1, assets: [] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) throw new TypeError('Asset manifest must use schemaVersion 1 and an assets array.');
  const ids = new Set();
  for (const asset of manifest.assets) {
    if (!asset || !/^[a-z][a-z0-9-]*$/.test(asset.id ?? '') || ids.has(asset.id)
        || !['video', 'audio', 'image'].includes(asset.type) || !/^[\da-f]{64}$/.test(asset.sha256 ?? '')) {
      throw new TypeError('Asset manifest contains an invalid asset record.');
    }
    ids.add(asset.id);
    resolveProjectAsset(root, asset.path);
    if (asset.proxies !== undefined && !Array.isArray(asset.proxies)) throw new TypeError(`Asset ${asset.id} proxies must be an array.`);
    for (const proxy of asset.proxies ?? []) {
      if (!proxy || asset.type !== 'video' || !/^[\da-f]{64}$/.test(proxy.sha256 ?? '') || !/^[\da-f]{64}$/.test(proxy.sourceSha256 ?? '')
          || !Number.isSafeInteger(proxy.maxDimension) || proxy.maxDimension < 160 || proxy.maxDimension > 3840
          || !Number.isSafeInteger(proxy.crf) || proxy.crf < 18 || proxy.crf > 40
          || (proxy.targetFrameRate !== undefined && String(normalizeFrameRate(proxy.targetFrameRate)) !== proxy.targetFrameRate)) {
        throw new TypeError(`Asset ${asset.id} contains invalid proxy metadata.`);
      }
      resolveProjectProxy(root, proxy.path);
    }
  }
  return manifest;
}

function resolveProjectProxy(root, relativePath) {
  const parts = typeof relativePath === 'string' ? relativePath.split('/') : [];
  if (parts.length !== 3 || parts[0] !== 'assets' || parts[1] !== 'proxies' || relativePath.includes('\\') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Proxy paths must stay inside assets/proxies.');
  }
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${resolve(root)}\\`) && !path.startsWith(`${resolve(root)}/`)) throw new TypeError('Proxy path escapes the project.');
  const directory = dirname(path);
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new TypeError('Proxy directory cannot be a symbolic link.');
  return path;
}

function writeAssetManifest(root, manifest) {
  const manifestPath = join(root, 'assets', 'manifest.json');
  const temporaryManifest = join(root, 'assets', `.manifest.${randomUUID()}.tmp`);
  const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
  try {
    writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(manifestPath, readFileSync(temporaryManifest), { flag: 'w' });
  } catch (error) {
    if (originalManifest) writeFileSync(manifestPath, originalManifest);
    else rmSync(manifestPath, { force: true });
    throw error;
  } finally {
    rmSync(temporaryManifest, { force: true });
  }
}

function resolveProjectAsset(root, relativePath) {
  const parts = typeof relativePath === 'string' ? relativePath.split('/') : [];
  if (parts.length !== 2 || parts[0] !== 'assets' || relativePath.includes('\\') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Registered asset paths must remain project-relative.');
  }
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${resolve(root)}\\`) && !path.startsWith(`${resolve(root)}/`)) throw new TypeError('Registered asset path escapes the project.');
  return path;
}

function probeImage(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', path], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`ffprobe failed: ${result.error?.message ?? result.stderr.trim()}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!Number.isSafeInteger(stream?.width) || stream.width <= 0 || !Number.isSafeInteger(stream?.height) || stream.height <= 0) throw new TypeError('Image must have readable positive dimensions.');
  return { width: stream.width, height: stream.height, codec: stream.codec_name ?? null };
}

function hashFile(path) {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function defaultAssetId(path) {
  const id = basename(path, extname(path)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return /^[a-z]/.test(id) ? id : `asset-${id || 'media'}`;
}
