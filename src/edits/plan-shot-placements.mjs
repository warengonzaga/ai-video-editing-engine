import { previewTimelineEdit } from '../timeline/edit.mjs';

const MAXIMUM_PLACEMENTS = 500;

/** Build a review-only clip insertion plan from explicit scene-review selections. */
export function planSceneReviewPlacements(timeline, sceneReview, assetId, trackId, placements) {
  if (!sceneReview || typeof sceneReview !== 'object' || Array.isArray(sceneReview)
      || sceneReview.schemaVersion !== 1 || sceneReview.reviewRequired !== true
      || !Array.isArray(sceneReview.shots) || !Number.isFinite(sceneReview.durationSeconds)
      || sceneReview.durationSeconds <= 0) {
    throw new TypeError('Scene review must be a schemaVersion 1 review-required pack with a positive duration and shots array.');
  }
  if (!Array.isArray(placements) || placements.length === 0 || placements.length > MAXIMUM_PLACEMENTS) {
    throw new TypeError(`placements must contain between 1 and ${MAXIMUM_PLACEMENTS} shot selections.`);
  }
  if (typeof assetId !== 'string' || !assetId.trim()) throw new TypeError('assetId must be a non-empty string.');
  if (typeof trackId !== 'string' || !trackId.trim()) throw new TypeError('trackId must be a non-empty string.');

  const asset = timeline?.assets?.find((candidate) => candidate.id === assetId);
  if (!asset || asset.type !== 'video' || !Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0) {
    throw new TypeError(`B-roll asset ${assetId} must be a registered video asset with a known duration.`);
  }
  const track = timeline?.tracks?.find((candidate) => candidate.id === trackId);
  if (!track || track.kind !== 'video') throw new TypeError(`B-roll destination ${trackId} must be an existing video track.`);
  if (track.locked === true) throw new TypeError(`B-roll destination track ${trackId} is locked.`);

  const shots = new Map();
  for (const shot of sceneReview.shots) {
    if (!shot || !Number.isSafeInteger(shot.index) || shot.index < 1
        || !Number.isFinite(shot.startSeconds) || !Number.isFinite(shot.endSeconds)
        || shot.startSeconds < 0 || shot.endSeconds <= shot.startSeconds
        || shot.endSeconds > sceneReview.durationSeconds + 1e-6
        || shots.has(shot.index)) {
      throw new TypeError('Scene review contains an invalid or duplicate shot range.');
    }
    shots.set(shot.index, shot);
  }

  const usedClipIds = new Set();
  const operations = placements.map((placement, index) => {
    if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
      throw new TypeError(`Placement ${index + 1} must be an object.`);
    }
    const allowedFields = new Set(['shotIndex', 'timelineStartSeconds', 'sourceOffsetSeconds', 'durationSeconds', 'clipId']);
    if (Object.keys(placement).some((field) => !allowedFields.has(field))) {
      throw new TypeError(`Placement ${index + 1} contains an unsupported field.`);
    }
    if (Object.values(placement).some((value) => value === undefined)) {
      throw new TypeError(`Placement ${index + 1} fields must not be undefined.`);
    }
    const shot = shots.get(placement.shotIndex);
    if (!shot) throw new TypeError(`Placement ${index + 1} references unknown shot ${placement.shotIndex}.`);
    const timelineStart = placement.timelineStartSeconds;
    const sourceOffset = placement.sourceOffsetSeconds ?? 0;
    if (!Number.isFinite(timelineStart) || timelineStart < 0) {
      throw new TypeError(`Placement ${index + 1} timelineStartSeconds must be non-negative.`);
    }
    if (!Number.isFinite(sourceOffset) || sourceOffset < 0 || sourceOffset >= shot.endSeconds - shot.startSeconds) {
      throw new TypeError(`Placement ${index + 1} sourceOffsetSeconds must fall within shot ${shot.index}.`);
    }
    const sourceIn = shot.startSeconds + sourceOffset;
    const durationSeconds = placement.durationSeconds ?? shot.endSeconds - sourceIn;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0
        || sourceIn + durationSeconds > shot.endSeconds + 1e-6) {
      throw new TypeError(`Placement ${index + 1} durationSeconds must fit within shot ${shot.index}.`);
    }
    if (sourceIn + durationSeconds > asset.durationSeconds + 1e-6) {
      throw new TypeError(`Placement ${index + 1} source range exceeds B-roll asset ${assetId}.`);
    }
    const clipId = placement.clipId ?? `broll-shot-${String(index + 1).padStart(4, '0')}`;
    if (!/^[a-z][a-z0-9-]*$/.test(clipId) || usedClipIds.has(clipId)) {
      throw new TypeError(`Placement ${index + 1} clipId must be a unique kebab-case id.`);
    }
    usedClipIds.add(clipId);
    return {
      type: 'add-clip',
      trackId,
      clip: {
        id: clipId,
        assetId,
        timelineStart,
        sourceIn,
        sourceOut: sourceIn + durationSeconds,
        durationSeconds,
      },
    };
  });

  return {
    schemaVersion: 1,
    type: 'scene-review-placement-plan',
    reviewRequired: true,
    assetId,
    trackId,
    operations,
    preview: previewTimelineEdit(timeline, operations),
  };
}
