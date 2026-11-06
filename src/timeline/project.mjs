import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listProjectAssets } from '../project/assets.mjs';
import { validateTimeline } from './validate.mjs';

export function createProjectTimeline(projectPath, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Timeline creation options must be an object.');
  for (const key of Object.keys(options)) if (key !== 'durationSeconds') throw new TypeError(`Unsupported timeline creation option: ${key}.`);
  const root = resolve(projectPath);
  const metaPath = join(root, 'meta.json');
  if (!existsSync(metaPath) || lstatSync(metaPath).isSymbolicLink() || !lstatSync(metaPath).isFile()) {
    throw new Error(`Not an Engine project: ${root}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const durationSeconds = options.durationSeconds ?? meta.durationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new TypeError('Timeline durationSeconds must be positive.');
  const catalog = listProjectAssets(root);
  const timeline = {
    schemaVersion: 1,
    project: {
      id: meta.id,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      durationSeconds,
      ...(meta.sourceFit === undefined ? {} : { sourceFit: meta.sourceFit }),
    },
    assets: catalog.assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      type: asset.type,
      ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
      ...(asset.frameRate === undefined ? {} : { frameRate: asset.frameRate }),
      ...(asset.nominalFrameRate === undefined ? {} : { nominalFrameRate: asset.nominalFrameRate }),
      ...(asset.hasAudio === undefined ? {} : { hasAudio: asset.hasAudio }),
      ...(asset.videoStreams === undefined ? {} : { videoStreams: structuredClone(asset.videoStreams) }),
      ...(asset.audioStreams === undefined ? {} : { audioStreams: structuredClone(asset.audioStreams) }),
      ...(asset.streamTiming === undefined ? {} : { streamTiming: structuredClone(asset.streamTiming) }),
      sha256: asset.sha256,
    })),
    markers: [],
    tracks: [
      { id: 'video-main', kind: 'video', order: 0, clips: [] },
      { id: 'audio-main', kind: 'audio', order: 1, clips: [] },
      { id: 'overlay-main', kind: 'overlay', order: 2, clips: [] },
    ],
  };
  return validateTimeline(timeline);
}
