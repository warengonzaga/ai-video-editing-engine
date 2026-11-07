import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMediaAsset } from '../project/assets.mjs';
import { validateTimeline } from '../timeline/validate.mjs';

const bridgePath = fileURLToPath(new URL('./otio_bridge.py', import.meta.url));
const ENGINE_CLIP_SETTINGS = new Set([
  'audioEffects', 'volumeKeyframes', 'reverse', 'speedRamp',
  'transitionIn', 'transitionOut', 'fadeInSeconds', 'fadeOutSeconds',
  'keyframes', 'fit', 'x', 'y', 'width', 'height',
  'objectPositionX', 'objectPositionY', 'zoom', 'mask', 'blendMode',
  'brightness', 'contrast', 'saturation', 'blurPixels', 'hueDegrees',
  'audioStreamIndex', 'videoStreamIndex', 'opacity', 'volume',
]);
const ENGINE_TRACK_SETTINGS = new Set(['audioEffects', 'volumeKeyframes', 'volume']);

function runBridge(request) {
  const python = process.env.AIVE_OTIO_PYTHON || process.env.PYTHON || 'python';
  const result = spawnSync(python, [bridgePath], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Could not start the OpenTimelineIO bridge with ${python}: ${result.error.message}. Install the optional dependency with "python -m pip install -r requirements-otio.txt" or set AIVE_OTIO_PYTHON.`);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    if (/No module named ['"]?opentimelineio/.test(details)) {
      throw new Error('OpenTimelineIO is not installed. Install the optional dependency with "python -m pip install -r requirements-otio.txt" or set AIVE_OTIO_PYTHON.');
    }
    throw new Error(`OpenTimelineIO interchange failed: ${details || `Python exited with status ${result.status}`}`);
  }
  try {
    return JSON.parse(result.stdout).result;
  } catch (error) {
    throw new Error(`OpenTimelineIO bridge returned invalid JSON: ${error.message}`);
  }
}

export function exportTimelineToOtio(projectPath, timeline) {
  validateTimeline(timeline);
  return runBridge({ operation: 'export', projectRoot: resolve(projectPath), timeline });
}

export function importTimelineFromOtio(projectPath, otioPath) {
  const root = resolve(projectPath);
  const input = resolve(otioPath);
  const metadataPath = join(root, 'meta.json');
  if (!existsSync(metadataPath)) throw new Error(`Not an Engine project: ${root}`);
  const imported = runBridge({ operation: 'import', otioPath: input, otioText: readFileSync(input, 'utf8') });
  const projectMeta = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const original = imported.engineTimeline;
  const assets = original ? structuredClone(original.assets) : [];
  const tracks = [];
  const registered = new Map();
  const referenceMatches = new Map();
  const usedTrackIds = new Set();
  const findExisting = (mediaPath) => assets.find((asset) => resolve(root, asset.path) === resolve(mediaPath));
  const usedIds = new Set(assets.map((asset) => asset.id));

  for (const sourceTrack of imported.tracks) {
    const engineTrack = original?.tracks.find((track) => track.id === sourceTrack.engineTrackId);
    const trackId = uniqueId(engineTrack?.id ?? safeId(sourceTrack.name, `${sourceTrack.kind}-track-${sourceTrack.order + 1}`), usedTrackIds);
    const usedClipIds = new Set();
    const clips = [];
    const hasCrossfades = sourceTrack.clips.some((clip) => clip.crossfade);
    const trackState = sourceTrack.kind === 'audio'
      ? {
        ...(sourceTrack.muted !== undefined
          ? { muted: sourceTrack.muted }
          : sourceTrack.enabled === false && sourceTrack.solo !== true ? { muted: true } : engineTrack?.muted === true ? { muted: false } : {}),
        ...(sourceTrack.solo === undefined ? {} : { solo: sourceTrack.solo }),
        ...(sourceTrack.locked === undefined ? {} : { locked: sourceTrack.locked }),
      }
      : {
        ...(sourceTrack.enabled === false ? { visible: false } : engineTrack?.visible === false ? { visible: true } : {}),
        ...(sourceTrack.locked === undefined ? {} : { locked: sourceTrack.locked }),
      };
    for (const sourceClip of sourceTrack.clips) {
      if (!existsSync(sourceClip.path)) throw new Error(`OTIO clip media is missing: ${sourceClip.path}`);
      const engineAsset = original?.assets.find((asset) => asset.id === sourceClip.engineAssetId);
      let asset = findExisting(sourceClip.path);
      if (!asset && engineAsset && assetMatchesReference(root, engineAsset, sourceClip.path, referenceMatches)) {
        asset = assets.find((item) => item.id === engineAsset.id);
      }
      if (!asset) {
        const preferredId = engineAsset?.id ?? safeId(sourceClip.name, `media-${clips.length + 1}`);
        const id = uniqueId(preferredId, usedIds);
        asset = registered.get(resolve(sourceClip.path));
        if (!asset) {
          asset = registerMediaAsset(root, sourceClip.path, { id });
          registered.set(resolve(sourceClip.path), asset);
          assets.push(asset);
          usedIds.add(asset.id);
        }
      }
      const priorClip = sourceClip.crossfade ? {} : { ...(engineTrack?.clips.find((clip) => clip.id === sourceClip.engineClipId) ?? {}) };
      delete priorClip.playbackRate;
      delete priorClip.speedRamp;
      delete priorClip.reverse;
      for (const [key, value] of Object.entries(sourceClip.engineSettings ?? {})) {
        if (ENGINE_CLIP_SETTINGS.has(key)) priorClip[key] = value;
      }
      const clip = {
        ...priorClip,
        id: uniqueId(priorClip.id ?? safeId(sourceClip.name, `${sourceTrack.kind}-clip-${clips.length + 1}`), usedClipIds),
        assetId: asset.id,
        sourceIn: sourceClip.sourceIn,
        sourceOut: sourceClip.sourceOut,
        timelineStart: sourceClip.timelineStart,
        durationSeconds: sourceClip.durationSeconds,
        ...(sourceClip.enabled === false || Object.hasOwn(priorClip, 'enabled') ? { enabled: sourceClip.enabled } : {}),
        ...(sourceClip.playbackRate !== undefined ? { playbackRate: sourceClip.playbackRate } : {}),
        ...(sourceClip.crossfade?.role === 'incoming' ? { fadeInSeconds: sourceClip.crossfade.durationSeconds } : {}),
        ...(sourceClip.crossfade?.role === 'outgoing' && sourceTrack.kind === 'audio' ? { fadeOutSeconds: sourceClip.crossfade.durationSeconds } : {}),
      };
      clips.push(clip);
    }
    const importedTrackSettings = Object.fromEntries(Object.entries(sourceTrack.engineSettings ?? {}).filter(([key]) => ENGINE_TRACK_SETTINGS.has(key)));
    tracks.push({
      ...(engineTrack ?? {}),
      ...importedTrackSettings,
      id: trackId,
      kind: sourceTrack.kind,
      order: sourceTrack.order,
      ...(hasCrossfades ? { allowOverlap: true } : {}),
      ...trackState,
      clips,
    });
  }

  for (const track of original?.tracks ?? []) {
    if (track.kind !== 'overlay') continue;
    tracks.push({ ...track, order: tracks.length, id: uniqueId(track.id, usedTrackIds) });
  }
  tracks.forEach((track, order) => { track.order = order; });
  const durationSeconds = Math.max(
    original?.project.durationSeconds ?? projectMeta.durationSeconds,
    imported.durationSeconds ?? 0,
    ...tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.durationSeconds)),
    0.001,
  );
  const timeline = {
    ...(original ?? {}),
    schemaVersion: 1,
    project: { ...(original?.project ?? projectMeta), durationSeconds },
    assets,
    tracks,
    ...(imported.markers.length || Object.hasOwn(original ?? {}, 'markers') ? { markers: imported.markers } : {}),
  };
  validateTimeline(timeline);
  return timeline;
}

function assetMatchesReference(root, asset, sourcePath, cache) {
  const key = `${asset.id}\0${resolve(sourcePath)}`;
  if (cache.has(key)) return cache.get(key);
  const registeredPath = resolve(root, asset.path);
  if (!existsSync(registeredPath) || !existsSync(sourcePath)
      || !statSync(registeredPath).isFile() || !statSync(sourcePath).isFile()
      || lstatSync(registeredPath).isSymbolicLink()) {
    cache.set(key, false);
    return false;
  }
  const matches = hashFile(registeredPath) === asset.sha256 && hashFile(sourcePath) === asset.sha256;
  cache.set(key, matches);
  return matches;
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

function safeId(value, fallback) {
  const id = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return /^[a-z]/.test(id) ? id : fallback;
}

function uniqueId(requested, used) {
  const base = safeId(requested, 'media');
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

export function isOtioPath(path) {
  return extname(path).toLowerCase() === '.otio';
}
