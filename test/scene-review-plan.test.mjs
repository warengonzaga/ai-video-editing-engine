import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planSceneReviewPlacements } from '../src/edits/plan-shot-placements.mjs';
import { createSceneReviewPackAsync } from '../src/media/scene-review.mjs';
import { registerMediaAsset } from '../src/project/assets.mjs';
import { createVideoProject } from '../src/project/create.mjs';
import { applyTimelineReviewPlan, undoTimelineFile } from '../src/timeline/history-store.mjs';
import { createProjectTimeline } from '../src/timeline/project.mjs';

test('binds reviewed shot plans to their source and rejects stale applications', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aive-scene-review-plan-'));
  try {
    const sourcePath = join(root, 'source.mp4');
    const generated = spawnSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:size=160x90:rate=24:duration=2',
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        sourcePath,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (generated.error?.code === 'ENOENT') return t.skip('FFmpeg is not installed.');
    assert.equal(generated.status, 0, generated.stderr);

    const projectPath = createVideoProject(root, 'scene-review-plan', {
      width: 160,
      height: 90,
      fps: 24,
      durationSeconds: 2,
    });
    const asset = registerMediaAsset(projectPath, sourcePath, { id: 'camera' });
    const timeline = createProjectTimeline(projectPath);
    const review = await createSceneReviewPackAsync(sourcePath, join(root, 'review'));
    const expectedSha256 = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');

    assert.equal(review.schemaVersion, 2);
    assert.equal(review.sourceSha256, expectedSha256);
    assert.equal(review.reviewRequired, true);
    assert.equal(asset.sha256, expectedSha256);

    const plan = planSceneReviewPlacements(timeline, review, 'camera', 'video-main', [
      {
        shotIndex: 1,
        timelineStartSeconds: 0,
        durationSeconds: 1,
        clipId: 'reviewed-shot',
      },
    ]);
    assert.equal(plan.sourceSha256, expectedSha256);
    assert.equal(plan.operations.length, 1);
    assert.throws(
      () =>
        planSceneReviewPlacements(timeline, { ...review, sourceSha256: '0'.repeat(64) }, 'camera', 'video-main', [
          { shotIndex: 1, timelineStartSeconds: 0, durationSeconds: 1 },
        ]),
      /does not match the source media/,
    );

    const timelinePath = join(projectPath, 'timeline.json');
    writeFileSync(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`);
    const applied = applyTimelineReviewPlan(timelinePath, plan);
    assert.equal(applied.canUndo, true);
    assert.equal(applied.appliedOperationCount, 1);
    assert.throws(() => applyTimelineReviewPlan(timelinePath, plan), /stale because the timeline changed/);
    const undone = undoTimelineFile(timelinePath);
    assert.equal(undone.canUndo, false);
    assert.equal(JSON.parse(readFileSync(timelinePath, 'utf8')).tracks[0].clips.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
