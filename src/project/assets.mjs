import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, createReadStream, createWriteStream, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, constants as fsConstants } from 'node:fs';
import { copyFile, link, rename } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeVideoStreamMetadata, probeMedia, probeMediaAsync } from '../media/probe.mjs';
import { normalizeFrameRate } from '../media/frame-rate.mjs';
import { validateTimeline } from '../timeline/validate.mjs';
import { resetTimelineFileHistory } from '../timeline/history-store.mjs';
import { runProcess } from '../render/process.mjs';
import { createFfmpegProgressParser, emitRenderProgress } from '../render/progress.mjs';

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
  const manifest = readAssetManifest(root);
  if (manifest.assets.some((asset) => asset.id === id)) throw new Error(`Asset already registered: ${id}`);

  const image = IMAGE_EXTENSIONS.has(extension);
  const probe = image ? probeImage(source) : probeMedia(source, { requireVideo: false });
  const relativePath = `assets/${id}${extension}`;
  const destination = join(root, relativePath);
  if (existsSync(destination)) throw new Error(`Asset destination already exists: ${relativePath}`);
  const stagedPath = join(root, 'assets', `.${id}.${randomUUID()}.register.tmp`);
  const manifestPath = join(root, 'assets', 'manifest.json');
  const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
  let copied = false;
  let timelineUpdate;
  try {
    copyFileSync(source, stagedPath, fsConstants.COPYFILE_EXCL);
    const probe = image ? probeImage(stagedPath) : probeMedia(stagedPath, { requireVideo: false });
    linkSync(stagedPath, destination);
    copied = true;
    const asset = {
      id,
      path: relativePath,
      type: image ? 'image' : probe.width === null ? 'audio' : 'video',
      sizeBytes: statSync(stagedPath).size,
      sha256: hashFile(stagedPath),
      ...(image ? { width: probe.width, height: probe.height, codec: probe.codec } : {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        nominalFrameRate: probe.nominalFrameRate,
        hasAudio: probe.hasAudio,
        formatName: probe.formatName,
        videoStreams: probe.videoStreams,
        audioStreams: probe.audioStreams,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        streamTiming: probe.streamTiming,
      }),
    };
    timelineUpdate = prepareTimelineAssetUpdate(root, asset);
    const latestManifest = readAssetManifest(root);
    if (latestManifest.assets.some((entry) => entry.id === id)) throw new Error(`Asset already registered: ${id}`);
    writeAssetManifest(root, { ...latestManifest, assets: [...latestManifest.assets, asset] });
    if (timelineUpdate.next) writeFileAtomically(timelineUpdate.path, `${JSON.stringify(timelineUpdate.next, null, 2)}\n`);
    checkpointTimelineHistory(timelineUpdate);
  } catch (error) {
    if (copied) {
      if (timelineUpdate) rollbackAssetRegistration(destination, manifestPath, originalManifest, timelineUpdate, error);
      else rmSync(destination, { force: true });
    }
    throw error;
  } finally {
    rmSync(stagedPath, { force: true });
  }
  return readAssetManifest(root).assets.find((asset) => asset.id === id);
}

export async function registerMediaAssetAsync(projectPath, sourcePath, options = {}) {
  const { signal, onProgress, ...registerOptions } = options;
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Asset registration signal must be an AbortSignal.');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Asset registration onProgress must be a function.');
  for (const field of Object.keys(registerOptions)) if (field !== 'id') throw new TypeError(`Unsupported asset registration option: ${field}.`);
  if (signal?.aborted) throw signal.reason ?? new DOMException('Asset registration was aborted.', 'AbortError');
  const root = resolve(projectPath);
  const source = resolve(sourcePath);
  const metaPath = join(root, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`Not an Engine project: ${root}`);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Media file not found: ${source}`);
  const extension = extname(source).toLowerCase();
  const id = registerOptions.id ?? defaultAssetId(source);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError('Asset id must be a lowercase kebab-case identifier.');
  const manifest = readAssetManifest(root);
  if (manifest.assets.some((asset) => asset.id === id)) throw new Error(`Asset already registered: ${id}`);
  const image = IMAGE_EXTENSIONS.has(extension);
  const relativePath = `assets/${id}${extension}`;
  const destination = join(root, relativePath);
  if (existsSync(destination)) throw new Error(`Asset destination already exists: ${relativePath}`);
  const assetDirectory = join(root, 'assets');
  const stagedPath = join(assetDirectory, `.${id}.${randomUUID()}.register.tmp`);
  let destinationLinked = false;
  let registered = false;
  let activeStage = 'asset-copy';
  try {
    const sourceBytes = statSync(source).size;
    emitRenderProgress(onProgress, 'asset-copy', 'started', { assetId: id, total: sourceBytes });
    let copiedBytes = 0;
    const sha256 = await copyFileAndHash(source, stagedPath, signal, (completed) => {
      copiedBytes = completed;
      emitRenderProgress(onProgress, 'asset-copy', 'progress', {
        assetId: id,
        percent: sourceBytes > 0 ? Math.min(99, completed / sourceBytes * 100) : 0,
        completed,
        total: sourceBytes,
      });
    });
    emitRenderProgress(onProgress, 'asset-copy', 'completed', { assetId: id, completed: copiedBytes, total: sourceBytes });
    activeStage = 'asset-probe';
    emitRenderProgress(onProgress, activeStage, 'started', { assetId: id });
    const probe = image ? await probeImageAsync(stagedPath, signal) : await probeMediaAsync(stagedPath, { requireVideo: false, signal });
    signal?.throwIfAborted();
    emitRenderProgress(onProgress, activeStage, 'completed', { assetId: id });
    const asset = {
      id,
      path: relativePath,
      type: image ? 'image' : probe.width === null ? 'audio' : 'video',
      sizeBytes: statSync(stagedPath).size,
      sha256,
      ...(image ? { width: probe.width, height: probe.height, codec: probe.codec } : {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        nominalFrameRate: probe.nominalFrameRate,
        hasAudio: probe.hasAudio,
        formatName: probe.formatName,
        videoStreams: probe.videoStreams,
        audioStreams: probe.audioStreams,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        streamTiming: probe.streamTiming,
      }),
    };
    activeStage = 'asset-publish';
    emitRenderProgress(onProgress, activeStage, 'started', { assetId: id });
    await link(stagedPath, destination);
    destinationLinked = true;
    const latestManifest = readAssetManifest(root);
    if (latestManifest.assets.some((entry) => entry.id === id)) throw new Error(`Asset already registered: ${id}`);
    const manifestPath = join(root, 'assets', 'manifest.json');
    const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
    const timelineUpdate = prepareTimelineAssetUpdate(root, asset);
    try {
      writeAssetManifest(root, { ...latestManifest, assets: [...latestManifest.assets, asset] });
      if (timelineUpdate.next) writeFileAtomically(timelineUpdate.path, `${JSON.stringify(timelineUpdate.next, null, 2)}\n`);
      checkpointTimelineHistory(timelineUpdate);
    } catch (error) {
      rollbackAssetRegistration(destination, manifestPath, originalManifest, timelineUpdate, error);
      throw error;
    }
    registered = true;
    emitRenderProgress(onProgress, activeStage, 'completed', { assetId: id });
    return asset;
  } catch (error) {
    emitRenderProgress(onProgress, activeStage, 'failed', { assetId: id });
    if (destinationLinked && !registered && existsSync(destination)) rmSync(destination, { force: true });
    throw error;
  } finally {
    rmSync(stagedPath, { force: true });
  }
}

/** Read the registered project media catalog without touching its files. */
export function listProjectAssets(projectPath) {
  const root = resolve(projectPath);
  const manifest = structuredClone(readAssetManifest(root));
  return {
    ...manifest,
    assets: manifest.assets.map((asset) => ({
      ...asset,
      ...(asset.videoStreams === undefined ? {} : { videoStreams: normalizeVideoStreamMetadata(asset.videoStreams) }),
    })),
  };
}

/** Remove an unused asset from project catalogs without deleting its media files. */
export function unregisterProjectAsset(projectPath, assetId) {
  const root = resolve(projectPath);
  if (typeof assetId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(assetId)) throw new TypeError('Asset id must be a lowercase kebab-case identifier.');
  const manifest = readAssetManifest(root);
  const manifestPath = join(root, 'assets', 'manifest.json');
  const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
  const index = manifest.assets.findIndex((asset) => asset.id === assetId);
  if (index < 0) throw new Error(`Asset is not registered: ${assetId}`);

  const timelinePath = join(root, 'timeline.json');
  if (existsSync(timelinePath) && lstatSync(timelinePath).isSymbolicLink()) throw new TypeError('Project timeline cannot be a symbolic link.');
  const originalTimeline = existsSync(timelinePath) ? readFileSync(timelinePath) : undefined;
  const originalHistory = readTimelineHistorySnapshot(timelinePath);
  let nextTimeline;
  let timelineChanged = false;
  if (originalTimeline) {
    nextTimeline = JSON.parse(originalTimeline.toString('utf8'));
    validateTimeline(nextTimeline);
    const references = nextTimeline.tracks.flatMap((track) => (track.clips ?? [])
      .filter((clip) => clip.assetId === assetId)
      .map((clip) => `${track.id}/${clip.id}`));
    if (references.length > 0) throw new Error(`Asset ${assetId} is still used by timeline clips: ${references.join(', ')}.`);
    if (nextTimeline.lineage?.assetId === assetId) throw new Error(`Asset ${assetId} is retained as timeline source lineage and cannot be unregistered.`);
    const assets = nextTimeline.assets.filter((asset) => asset.id !== assetId);
    timelineChanged = assets.length !== nextTimeline.assets.length;
    if (timelineChanged) nextTimeline = validateTimeline({ ...nextTimeline, assets });
  }

  const updatedManifest = { ...manifest, assets: manifest.assets.filter((_, assetIndex) => assetIndex !== index) };
  try {
    writeAssetManifest(root, updatedManifest);
    if (timelineChanged) writeFileAtomically(timelinePath, `${JSON.stringify(nextTimeline, null, 2)}\n`);
    if (timelineChanged) checkpointTimelineHistory({ path: timelinePath, originalHistory });
  } catch (error) {
    const rollbackErrors = [];
    try { restoreFile(manifestPath, originalManifest); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (originalTimeline !== undefined) {
      try { writeFileAtomically(timelinePath, originalTimeline); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    try { restoreFile(getTimelineHistoryPath(timelinePath), originalHistory); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `Asset unregistration failed and rollback was incomplete. Preserve project files and inspect ${root}.`);
    }
    throw error;
  }
  return { asset: structuredClone(manifest.assets[index]), mediaFilesPreserved: true };
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

export async function verifyProjectAssetsAsync(projectPath, { signal } = {}) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Asset verification signal must be an AbortSignal.');
  }
  signal?.throwIfAborted();
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  const results = [];
  for (const asset of manifest.assets) {
    signal?.throwIfAborted();
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
      results.push(sourceStatus('missing'));
      continue;
    }
    if (lstatSync(path).isSymbolicLink()) {
      results.push(sourceStatus('modified'));
      continue;
    }
    const actualSha256 = await hashFileAsync(path, signal);
    results.push(sourceStatus(actualSha256 === asset.sha256 ? 'ok' : 'modified', actualSha256));
    for (const proxy of asset.proxies ?? []) {
      signal?.throwIfAborted();
      const proxyPath = resolveProjectProxy(root, proxy.path);
      if (!existsSync(proxyPath) || !statSync(proxyPath).isFile() || lstatSync(proxyPath).isSymbolicLink()) {
        results.push({ id: asset.id, variant: 'proxy', path: proxy.path, status: 'missing', expectedSha256: proxy.sha256 });
        continue;
      }
      const actualProxySha256 = await hashFileAsync(proxyPath, signal);
      results.push({
        id: asset.id,
        variant: 'proxy',
        path: proxy.path,
        status: actualProxySha256 === proxy.sha256 && proxy.sourceSha256 === asset.sha256 ? 'ok' : 'modified',
        expectedSha256: proxy.sha256,
        actualSha256: actualProxySha256,
      });
    }
  }
  return results;
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
  if (existsSync(timelinePath) && lstatSync(timelinePath).isSymbolicLink()) throw new TypeError('Project timeline cannot be a symbolic link.');
  const originalTimeline = existsSync(timelinePath) ? readFileSync(timelinePath) : undefined;
  const originalHistory = readTimelineHistorySnapshot(timelinePath);

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
      formatName: probe.formatName,
      videoStreams: probe.videoStreams,
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
  let timelineChanged = false;
  if (originalTimeline) {
    nextTimeline = JSON.parse(originalTimeline.toString('utf8'));
    const timelineAssetIndex = nextTimeline.assets.findIndex((asset) => asset.id === assetId);
    if (timelineAssetIndex >= 0) {
      nextTimeline.assets[timelineAssetIndex] = { ...nextTimeline.assets[timelineAssetIndex], ...updated };
      if (nextTimeline.lineage?.assetId === assetId) nextTimeline.lineage.sourceSha256 = updated.sha256;
      validateTimeline(nextTimeline);
      timelineChanged = true;
    }
  }
  let installedNewAsset = false;
  let manifestCommitted = false;
  try {
    copyFileSync(source, stagedPath, fsConstants.COPYFILE_EXCL);
    if (oldAssetExists) copyFileSync(destination, backupPath, fsConstants.COPYFILE_EXCL);
    installedNewAsset = true;
    copyFileSync(stagedPath, destination);
    writeAssetManifest(root, nextManifest);
    if (nextTimeline) writeFileAtomically(timelinePath, `${JSON.stringify(nextTimeline, null, 2)}\n`);
    if (timelineChanged) checkpointTimelineHistory({ path: timelinePath, originalHistory });
    manifestCommitted = true;
  } catch (error) {
    if (!manifestCommitted) {
      if (installedNewAsset) {
        if (existsSync(backupPath)) copyFileSync(backupPath, destination);
        else rmSync(destination, { force: true });
      }
      writeFileAtomically(manifestPath, originalManifest);
      if (originalTimeline) writeFileAtomically(timelinePath, originalTimeline);
      restoreFile(getTimelineHistoryPath(timelinePath), originalHistory);
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

export async function relinkProjectAssetAsync(projectPath, assetId, sourcePath, options = {}) {
  const { signal, onProgress } = options;
  if (Object.keys(options).some((field) => !['signal', 'onProgress'].includes(field))) throw new TypeError('Unsupported asset relink option.');
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Asset relink signal must be an AbortSignal.');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Asset relink onProgress must be a function.');
  if (signal?.aborted) throw signal.reason ?? new DOMException('Asset relinking was aborted.', 'AbortError');
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

  const destination = resolveProjectAsset(root, previous.path);
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new TypeError('Registered asset paths cannot be symbolic links.');
  const assetDirectory = dirname(destination);
  mkdirSync(assetDirectory, { recursive: true });
  const stagedPath = join(assetDirectory, `.${assetId}.${randomUUID()}.relink.tmp`);
  const backupPath = join(assetDirectory, `.${assetId}.${randomUUID()}.backup.tmp`);
  const manifestPath = join(root, 'assets', 'manifest.json');
  const timelinePath = join(root, 'timeline.json');
  const oldAssetExists = existsSync(destination);
  if (existsSync(timelinePath) && lstatSync(timelinePath).isSymbolicLink()) throw new TypeError('Project timeline cannot be a symbolic link.');
  const originalManifest = readFileSync(manifestPath);
  const originalTimeline = existsSync(timelinePath) ? readFileSync(timelinePath) : undefined;
  const originalHistory = readTimelineHistorySnapshot(timelinePath);
  let movedOldAsset = false;
  let installedNewAsset = false;
  let commitStarted = false;
  let committed = false;
  let activeStage = 'asset-relink-copy';
  try {
    const sourceBytes = statSync(source).size;
    emitRenderProgress(onProgress, activeStage, 'started', { assetId, total: sourceBytes });
    let copiedBytes = 0;
    const replacementSha256 = await copyFileAndHash(source, stagedPath, signal, (completed) => {
      copiedBytes = completed;
      emitRenderProgress(onProgress, activeStage, 'progress', {
        assetId,
        percent: sourceBytes > 0 ? Math.min(99, completed / sourceBytes * 100) : 0,
        completed,
        total: sourceBytes,
      });
    });
    emitRenderProgress(onProgress, activeStage, 'completed', { assetId, completed: copiedBytes, total: sourceBytes });
    activeStage = 'asset-relink-probe';
    emitRenderProgress(onProgress, activeStage, 'started', { assetId });
    const probe = image ? await probeImageAsync(stagedPath, signal) : await probeMediaAsync(stagedPath, { requireVideo: false, signal });
    emitRenderProgress(onProgress, activeStage, 'completed', { assetId });
    const type = image ? 'image' : probe.width === null ? 'audio' : 'video';
    if (type !== previous.type) throw new TypeError(`Replacement media must be a ${previous.type} asset.`);
    const updated = {
      ...previous,
      ...(image ? { width: probe.width, height: probe.height, codec: probe.codec } : {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        nominalFrameRate: probe.nominalFrameRate,
        hasAudio: probe.hasAudio,
        formatName: probe.formatName,
        videoStreams: probe.videoStreams,
        audioStreams: probe.audioStreams,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        streamTiming: probe.streamTiming,
      }),
      sizeBytes: statSync(stagedPath).size,
      sha256: replacementSha256,
      proxies: (previous.proxies ?? []).filter((proxy) => proxy.sourceSha256 === replacementSha256),
    };
    const nextManifest = { ...manifest, assets: manifest.assets.map((asset, assetIndex) => assetIndex === index ? updated : asset) };
    let nextTimeline;
    let timelineChanged = false;
    if (originalTimeline) {
      nextTimeline = JSON.parse(originalTimeline.toString('utf8'));
      const timelineAssetIndex = nextTimeline.assets.findIndex((asset) => asset.id === assetId);
      if (timelineAssetIndex >= 0) {
        nextTimeline.assets[timelineAssetIndex] = { ...nextTimeline.assets[timelineAssetIndex], ...updated };
        if (nextTimeline.lineage?.assetId === assetId) nextTimeline.lineage.sourceSha256 = updated.sha256;
        validateTimeline(nextTimeline);
        timelineChanged = true;
      }
    }
    signal?.throwIfAborted();
    activeStage = 'asset-relink-publish';
    emitRenderProgress(onProgress, activeStage, 'started', { assetId });
    commitStarted = true;
    if (oldAssetExists) {
      await rename(destination, backupPath);
      movedOldAsset = true;
    }
    await rename(stagedPath, destination);
    installedNewAsset = true;
    writeAssetManifest(root, nextManifest);
    if (nextTimeline) writeFileAtomically(timelinePath, `${JSON.stringify(nextTimeline, null, 2)}\n`);
    if (timelineChanged) checkpointTimelineHistory({ path: timelinePath, originalHistory });
    committed = true;
    emitRenderProgress(onProgress, activeStage, 'completed', { assetId });
    for (const proxy of previous.proxies ?? []) {
      if (proxy.sourceSha256 !== updated.sha256) rmSync(resolveProjectProxy(root, proxy.path), { force: true });
    }
    return updated;
  } catch (error) {
    emitRenderProgress(onProgress, activeStage, 'failed', { assetId });
    if (commitStarted && !committed) {
      if (installedNewAsset) await unlink(destination).catch(() => {});
      if (movedOldAsset && !existsSync(destination)) await rename(backupPath, destination).catch(() => {});
      writeFileAtomically(manifestPath, originalManifest);
      if (originalTimeline) writeFileAtomically(timelinePath, originalTimeline);
      restoreFile(getTimelineHistoryPath(timelinePath), originalHistory);
    }
    const retainedBackup = movedOldAsset && existsSync(backupPath) ? ` Previous media backup retained at ${backupPath}.` : '';
    throw new Error(`Could not relink asset ${assetId}: ${error.message}${retainedBackup}`, { cause: error });
  } finally {
    rmSync(stagedPath, { force: true });
    if (committed || !movedOldAsset) rmSync(backupPath, { force: true });
  }
}

export function createAssetProxy(projectPath, assetId, options = {}) {
  const context = prepareAssetProxy(projectPath, assetId, options);
  if (context.cached) return context.cached;
  try {
    const result = spawnSync('ffmpeg', context.args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Could not generate video proxy: ${result.error?.message ?? result.stderr.trim()}`);
    return storeAssetProxy(context, probeMedia(context.stagedPath));
  } catch (error) {
    rollbackAssetProxy(context);
    throw error;
  } finally {
    cleanupAssetProxy(context);
  }
}

export async function createAssetProxyAsync(projectPath, assetId, options = {}) {
  const { signal, onProgress, ...proxyOptions } = options;
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Proxy signal must be an AbortSignal.');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Proxy onProgress must be a function.');
  if (signal?.aborted) throw signal.reason ?? new DOMException('Proxy generation was aborted.', 'AbortError');
  emitRenderProgress(onProgress, 'proxy-preflight', 'started');
  let context;
  try {
    context = await prepareAssetProxyAsync(projectPath, assetId, proxyOptions, signal);
  } catch (error) {
    emitRenderProgress(onProgress, 'proxy-preflight', 'failed', { assetId });
    throw error;
  }
  emitRenderProgress(onProgress, 'proxy-preflight', 'completed');
  if (context.cached) {
    signal?.throwIfAborted();
    emitRenderProgress(onProgress, 'proxy-generation', 'skipped', { reason: 'valid-proxy-cache' });
    return context.cached;
  }
  let activeStage = 'proxy-generation';
  try {
    emitRenderProgress(onProgress, 'proxy-generation', 'started', { assetId });
    const progressParser = onProgress
      ? createFfmpegProgressParser(onProgress, 'proxy-generation', context.asset.durationSeconds, { assetId })
      : undefined;
    const args = onProgress ? [...context.args.slice(0, -1), '-progress', 'pipe:1', '-nostats', context.args.at(-1)] : context.args;
    await runProcess('ffmpeg', args, {
      signal,
      ...(progressParser ? {
        stdio: 'capture',
        onStdout: progressParser.push,
        onStderr: (chunk) => process.stderr.write(chunk),
      } : {}),
    });
    progressParser?.flush();
    emitRenderProgress(onProgress, 'proxy-generation', 'completed', { assetId });
    activeStage = 'proxy-validation';
    emitRenderProgress(onProgress, 'proxy-validation', 'started', { assetId });
    const probe = await probeMediaAsync(context.stagedPath, { signal });
    signal?.throwIfAborted();
    const sha256 = await hashFileAsync(context.stagedPath, signal);
    signal?.throwIfAborted();
    emitRenderProgress(onProgress, 'proxy-validation', 'completed', { assetId });
    activeStage = 'proxy-publish';
    emitRenderProgress(onProgress, 'proxy-publish', 'started', { assetId });
    const result = await storeAssetProxyAsync(context, probe, sha256, signal);
    emitRenderProgress(onProgress, 'proxy-publish', 'completed', { assetId });
    return result;
  } catch (error) {
    emitRenderProgress(onProgress, activeStage, 'failed', { assetId });
    rollbackAssetProxy(context);
    throw error;
  } finally {
    cleanupAssetProxy(context);
  }
}

function prepareAssetProxy(projectPath, assetId, options) {
  const details = inspectAssetProxyInputs(projectPath, assetId, options);
  const sourceHash = hashFile(details.sourcePath);
  const output = assetProxyOutput(details, sourceHash);
  const existing = findAssetProxy(details.asset, details.maxDimension, details.crf, details.targetFrameRate, sourceHash);
  const cachedProxyHash = existing && existing.path === output.relativePath && output.destinationExists
    ? hashFile(output.destination)
    : undefined;
  return finalizeAssetProxyPreparation(details, output, sourceHash, existing, cachedProxyHash);
}

async function prepareAssetProxyAsync(projectPath, assetId, options, signal) {
  const details = inspectAssetProxyInputs(projectPath, assetId, options);
  const sourceHash = await hashFileAsync(details.sourcePath, signal);
  signal?.throwIfAborted();
  const output = assetProxyOutput(details, sourceHash);
  const existing = findAssetProxy(details.asset, details.maxDimension, details.crf, details.targetFrameRate, sourceHash);
  const cachedProxyHash = existing && existing.path === output.relativePath && output.destinationExists
    ? await hashFileAsync(output.destination, signal)
    : undefined;
  signal?.throwIfAborted();
  return finalizeAssetProxyPreparation(details, output, sourceHash, existing, cachedProxyHash);
}

function inspectAssetProxyInputs(projectPath, assetId, options) {
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
  return { root, manifest, assetIndex, asset, sourcePath, maxDimension, crf, targetFrameRate };
}

function findAssetProxy(asset, maxDimension, crf, targetFrameRate, sourceHash) {
  return (asset.proxies ?? []).find((proxy) => proxy.maxDimension === maxDimension && proxy.crf === crf
    && proxy.targetFrameRate === targetFrameRate && proxy.sourceSha256 === sourceHash);
}

function assetProxyOutput(details, sourceHash) {
  const { root, asset, maxDimension, crf, targetFrameRate } = details;
  const frameRateSuffix = targetFrameRate === undefined ? '' : `-fps${targetFrameRate.replace('/', '-')}`;
  const fileName = `${asset.id}-${maxDimension}-crf${crf}${frameRateSuffix}-${sourceHash.slice(0, 12)}.mp4`;
  const relativePath = `assets/proxies/${fileName}`;
  const destination = join(root, ...relativePath.split('/'));
  const destinationExists = existsSync(destination);
  if (destinationExists && lstatSync(destination).isSymbolicLink()) throw new TypeError('Proxy files cannot be symbolic links.');
  return { relativePath, destination, destinationExists };
}

function finalizeAssetProxyPreparation(details, output, sourceHash, existing, cachedProxyHash) {
  const { root, manifest, assetIndex, asset, sourcePath, maxDimension, crf, targetFrameRate } = details;
  const assetId = asset.id;
  const { relativePath, destination, destinationExists } = output;
  if (sourceHash !== asset.sha256) throw new Error(`Asset ${asset.id} failed integrity verification; relink it before generating a proxy.`);
  if (existing && existing.path === relativePath && destinationExists && cachedProxyHash === existing.sha256) return { cached: existing };
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
  return { root, manifest, assetIndex, asset, sourceHash, relativePath, destination, destinationExists, stagedPath, backupPath, maxDimension, crf, targetFrameRate, args };
}

function storeAssetProxy(context, probe, sha256 = hashFile(context.stagedPath)) {
  const { proxy, nextManifest } = buildAssetProxyRecord(context, probe, sha256);
  const { root, stagedPath, destination, destinationExists, backupPath } = context;
  if (destinationExists) copyFileSync(destination, backupPath, fsConstants.COPYFILE_EXCL);
  copyFileSync(stagedPath, destination, destinationExists ? 0 : fsConstants.COPYFILE_EXCL);
  writeAssetManifest(root, nextManifest);
  return proxy;
}

async function storeAssetProxyAsync(context, probe, sha256, signal) {
  const { proxy, nextManifest } = buildAssetProxyRecord(context, probe, sha256);
  const { destination, destinationExists, backupPath, stagedPath, root } = context;
  if (destinationExists) await rename(destination, backupPath);
  try {
    signal?.throwIfAborted();
    await copyFile(stagedPath, destination, fsConstants.COPYFILE_EXCL);
    signal?.throwIfAborted();
    writeAssetManifest(root, nextManifest);
    return proxy;
  } catch (error) {
    if (destinationExists && !existsSync(destination) && existsSync(backupPath)) await rename(backupPath, destination).catch(() => {});
    throw error;
  }
}

function buildAssetProxyRecord(context, probe, sha256) {
  const { asset, assetIndex, root, manifest, stagedPath, destination, destinationExists,
    sourceHash, relativePath, maxDimension, crf, targetFrameRate } = context;
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
    sha256,
    sourceSha256: sourceHash,
  };
  const nextAsset = { ...asset, proxies: [...(asset.proxies ?? []).filter((entry) => !(entry.maxDimension === maxDimension
    && entry.crf === crf && entry.targetFrameRate === targetFrameRate)), proxy] };
  const nextManifest = { ...manifest, assets: manifest.assets.map((entry, index) => index === assetIndex ? nextAsset : entry) };
  return { proxy, nextManifest };
}

function rollbackAssetProxy(context) {
  if (context.destinationExists && existsSync(context.backupPath)) copyFileSync(context.backupPath, context.destination);
  else if (!context.destinationExists) rmSync(context.destination, { force: true });
}

function cleanupAssetProxy(context) {
  rmSync(context.stagedPath, { force: true });
  rmSync(context.backupPath, { force: true });
}

export function resolveAssetProxies(projectPath, timeline) {
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  const proxies = new Map();
  const videoIds = new Set(timeline.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips.map((clip) => clip.assetId)));
  for (const assetId of videoIds) {
    const entry = inspectAssetProxyForTimeline(root, manifest, timeline, assetId);
    if (!entry) continue;
    if (!isSafeRegularFile(entry.sourcePath) || hashFile(entry.sourcePath) !== entry.asset.sha256) {
      throw new Error(`Video asset ${assetId} failed integrity verification; relink it before proxy rendering.`);
    }
    if (!entry.proxy) throw new Error(`Video asset ${assetId} has no current proxy; create one with "asset proxy create" first.`);
    if (!isSafeRegularFile(entry.path) || hashFile(entry.path) !== entry.proxy.sha256) {
      throw new Error(`Proxy for asset ${assetId} is missing or modified; regenerate it before preview rendering.`);
    }
    proxies.set(assetId, entry.proxy);
  }
  return proxies;
}

export async function resolveAssetProxiesAsync(projectPath, timeline, { signal } = {}) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Proxy signal must be an AbortSignal.');
  }
  signal?.throwIfAborted();
  const root = resolve(projectPath);
  const manifest = readAssetManifest(root);
  const proxies = new Map();
  const videoIds = new Set(timeline.tracks.filter((track) => track.kind === 'video').flatMap((clipTrack) => clipTrack.clips.map((clip) => clip.assetId)));
  for (const assetId of videoIds) {
    signal?.throwIfAborted();
    const entry = inspectAssetProxyForTimeline(root, manifest, timeline, assetId);
    if (!entry) continue;
    if (!isSafeRegularFile(entry.sourcePath) || await hashFileAsync(entry.sourcePath, signal) !== entry.asset.sha256) {
      throw new Error(`Video asset ${assetId} failed integrity verification; relink it before proxy rendering.`);
    }
    if (!entry.proxy) throw new Error(`Video asset ${assetId} has no current proxy; create one with "asset proxy create" first.`);
    if (!isSafeRegularFile(entry.path) || await hashFileAsync(entry.path, signal) !== entry.proxy.sha256) {
      throw new Error(`Proxy for asset ${assetId} is missing or modified; regenerate it before preview rendering.`);
    }
    proxies.set(assetId, entry.proxy);
  }
  return proxies;
}

function inspectAssetProxyForTimeline(root, manifest, timeline, assetId) {
  const asset = manifest.assets.find((entry) => entry.id === assetId);
  if (asset?.type !== 'video') return undefined;
  const sourcePath = resolveProjectAsset(root, asset.path);
  const targetFrameRate = String(normalizeFrameRate(timeline.project.fps));
  const proxy = asset.proxies?.filter((entry) => entry.sourceSha256 === asset.sha256
    && (entry.targetFrameRate === undefined || entry.targetFrameRate === targetFrameRate))
    .sort((left, right) => Number(right.targetFrameRate === targetFrameRate) - Number(left.targetFrameRate === targetFrameRate)
      || left.maxDimension - right.maxDimension || right.crf - left.crf)[0];
  if (!proxy) return { asset, sourcePath };
  if (!/^[\da-f]{64}$/.test(proxy.sha256 ?? '') || !Number.isSafeInteger(proxy.maxDimension) || !Number.isSafeInteger(proxy.crf)) throw new TypeError(`Proxy metadata is invalid for asset ${assetId}.`);
  const parts = typeof proxy.path === 'string' ? proxy.path.split('/') : [];
  if (parts.length !== 3 || parts[0] !== 'assets' || parts[1] !== 'proxies' || parts.some((part) => !part || part === '.' || part === '..') || proxy.path.includes('\\')) {
    throw new TypeError(`Proxy path is invalid for asset ${assetId}.`);
  }
  const path = resolve(root, proxy.path);
  if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) throw new TypeError(`Proxy path escapes project: ${proxy.path}`);
  return { asset, sourcePath, proxy, path };
}

function isSafeRegularFile(path) {
  return existsSync(path) && statSync(path).isFile() && !lstatSync(path).isSymbolicLink();
}

function readAssetManifest(root) {
  const assetsPath = join(root, 'assets');
  if (!existsSync(join(root, 'meta.json')) || !existsSync(assetsPath) || !statSync(assetsPath).isDirectory() || lstatSync(assetsPath).isSymbolicLink()) throw new Error(`Not an Engine project: ${root}`);
  const manifestPath = join(root, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) return { schemaVersion: 1, assets: [] };
  if (lstatSync(manifestPath).isSymbolicLink()) throw new TypeError('Project asset manifest cannot be a symbolic link.');
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
  writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function prepareTimelineAssetUpdate(root, asset) {
  const path = join(root, 'timeline.json');
  if (!existsSync(path)) return { path };
  if (lstatSync(path).isSymbolicLink()) throw new TypeError('Project timeline cannot be a symbolic link.');
  const original = readFileSync(path);
  const timeline = JSON.parse(original.toString('utf8'));
  const index = timeline.assets.findIndex((entry) => entry.id === asset.id);
  const assets = [...timeline.assets];
  if (index < 0) assets.push(asset);
  else assets[index] = asset;
  const next = validateTimeline({ ...timeline, assets });
  return { path, original, originalHistory: readTimelineHistorySnapshot(path), next };
}

function rollbackAssetRegistration(destination, manifestPath, originalManifest, timelineUpdate, cause) {
  const rollbackErrors = [];
  try { rmSync(destination, { force: true }); } catch (error) { rollbackErrors.push(error); }
  try { restoreFile(manifestPath, originalManifest); } catch (error) { rollbackErrors.push(error); }
  try { restoreFile(timelineUpdate.path, timelineUpdate.original); } catch (error) { rollbackErrors.push(error); }
  try { restoreFile(getTimelineHistoryPath(timelineUpdate.path), timelineUpdate.originalHistory); } catch (error) { rollbackErrors.push(error); }
  if (rollbackErrors.length > 0) {
    throw new AggregateError([cause, ...rollbackErrors], `Asset registration failed and rollback was incomplete. Preserve project files and inspect ${destination}.`);
  }
}

function checkpointTimelineHistory(timelineUpdate) {
  if (timelineUpdate.originalHistory === undefined) return;
  const history = JSON.parse(timelineUpdate.originalHistory.toString('utf8'));
  resetTimelineFileHistory(timelineUpdate.path, { limit: history.limit });
}

function readTimelineHistorySnapshot(timelinePath) {
  const historyPath = getTimelineHistoryPath(timelinePath);
  if (!existsSync(historyPath)) return undefined;
  if (lstatSync(historyPath).isSymbolicLink()) throw new TypeError('Timeline history file cannot be a symbolic link.');
  return readFileSync(historyPath);
}

function getTimelineHistoryPath(timelinePath) {
  return join(dirname(timelinePath), `.${basename(timelinePath)}.history.json`);
}

function restoreFile(path, original) {
  if (original === undefined) rmSync(path, { force: true });
  else writeFileAtomically(path, original);
}

function writeFileAtomically(path, content) {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
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

async function probeImageAsync(path, signal) {
  const result = await runProcess('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', path,
  ], { signal, stdio: 'capture' });
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!Number.isSafeInteger(stream?.width) || stream.width <= 0 || !Number.isSafeInteger(stream?.height) || stream.height <= 0) throw new TypeError('Image must have readable positive dimensions.');
  return { width: stream.width, height: stream.height, codec: stream.codec_name ?? null };
}

async function copyFileAndHash(source, destination, signal, onProgress) {
  const hash = createHash('sha256');
  const totalBytes = statSync(source).size;
  let copiedBytes = 0;
  let lastPercent = -1;
  const hasher = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      copiedBytes += chunk.length;
      const percent = totalBytes > 0 ? Math.floor(copiedBytes / totalBytes * 100) : 100;
      if (onProgress && (percent > lastPercent || copiedBytes >= totalBytes)) {
        lastPercent = percent;
        onProgress(copiedBytes);
      }
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(source), hasher, createWriteStream(destination, { flags: 'wx' }), { signal });
  return hash.digest('hex');
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

async function hashFileAsync(path, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  signal?.throwIfAborted();
  return hash.digest('hex');
}

function defaultAssetId(path) {
  const id = basename(path, extname(path)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return /^[a-z]/.test(id) ? id : `asset-${id || 'media'}`;
}
