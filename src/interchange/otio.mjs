import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMediaAsset } from '../project/assets.mjs';
import { validateTimeline } from '../timeline/validate.mjs';

const bridgePath = fileURLToPath(new URL('./otio_bridge.py', import.meta.url));

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
  const usedTrackIds = new Set();
  const findExisting = (mediaPath) => assets.find((asset) => resolve(root, asset.path) === resolve(mediaPath));
  const usedIds = new Set(assets.map((asset) => asset.id));

  for (const sourceTrack of imported.tracks) {
    const engineTrack = original?.tracks.find((track) => track.id === sourceTrack.engineTrackId);
    const trackId = uniqueId(engineTrack?.id ?? safeId(sourceTrack.name, `${sourceTrack.kind}-track-${sourceTrack.order + 1}`), usedTrackIds);
    const usedClipIds = new Set();
    const clips = [];
    for (const sourceClip of sourceTrack.clips) {
      if (!existsSync(sourceClip.path)) throw new Error(`OTIO clip media is missing: ${sourceClip.path}`);
      const engineAsset = original?.assets.find((asset) => asset.id === sourceClip.engineAssetId);
      let asset = findExisting(sourceClip.path);
      if (!asset && engineAsset && existsSync(resolve(root, engineAsset.path)) && resolve(root, engineAsset.path) === resolve(sourceClip.path)) {
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
      const priorClip = engineTrack?.clips.find((clip) => clip.id === sourceClip.engineClipId) ?? {};
      clips.push({
        ...priorClip,
        id: uniqueId(priorClip.id ?? safeId(sourceClip.name, `${sourceTrack.kind}-clip-${clips.length + 1}`), usedClipIds),
        assetId: asset.id,
        sourceIn: sourceClip.sourceIn,
        sourceOut: sourceClip.sourceOut,
        timelineStart: sourceClip.timelineStart,
        durationSeconds: sourceClip.durationSeconds,
      });
    }
    tracks.push({
      ...(engineTrack ?? {}),
      id: trackId,
      kind: sourceTrack.kind,
      order: sourceTrack.order,
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
    ...tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.durationSeconds)),
    0.001,
  );
  const timeline = {
    ...(original ?? {}),
    schemaVersion: 1,
    project: { ...(original?.project ?? projectMeta), durationSeconds },
    assets,
    tracks,
  };
  validateTimeline(timeline);
  return timeline;
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
