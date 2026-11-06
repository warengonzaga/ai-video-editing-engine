import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTimeline } from '../src/timeline/validate.mjs';
import { timelineFromEdl } from '../src/timeline/from-edl.mjs';
import { resolveSourceFit } from '../src/timeline/source-fit.mjs';
import { addTimelineClip, addTimelineTrack, crossfadeTimelineClips, detachAudioFromTimelineClip, duplicateTimelineClip, editTimeline, editTimelineBatch, insertTimelineGap, moveTimelineClip, moveTimelineClipToTrack, previewTimelineEdit, removeTimelineClip, removeTimelineTrack, reorderTimelineTrack, rippleDeleteTimelineClip, setTimelineTransition, slipTimelineClip, splitTimelineClip, trimTimelineClip } from '../src/timeline/edit.mjs';
import { createTimelineHistory } from '../src/timeline/history.mjs';
import { transitionClipPath } from '../src/timeline/transition.mjs';
import { createCaptionTrack } from '../src/timeline/captions.mjs';
import { buildAudioVolumeAutomation } from '../src/timeline/audio-mix.mjs';
import { assignRenderTrackIndices } from '../src/timeline/layers.mjs';
import { timelineForRender } from '../src/timeline/track-state.mjs';
import { validateAudioMastering } from '../src/timeline/audio-mastering.mjs';
import { speedRampDuration } from '../src/timeline/speed-ramp.mjs';

const valid = { schemaVersion: 1, project: { id: 'sample-edit', width: 1920, height: 1080, fps: 30, durationSeconds: 8 }, assets: [{ id: 'camera', path: 'assets/camera.mp4' }], tracks: [{ id: 'video-main', kind: 'video', order: 0, clips: [{ id: 'clip-one', assetId: 'camera', sourceIn: 0, sourceOut: 3, timelineStart: 0, durationSeconds: 3 }, { id: 'clip-two', assetId: 'camera', sourceIn: 5, sourceOut: 10, timelineStart: 3, durationSeconds: 5 }] }, { id: 'music', kind: 'audio', order: 1, clips: [{ id: 'music-bed', assetId: 'camera', sourceIn: 0, sourceOut: 8, timelineStart: 0, durationSeconds: 8 }] }, { id: 'graphics', kind: 'overlay', order: 2, clips: [{ id: 'title', composition: 'compositions/title.html', timelineStart: 0, durationSeconds: 2 }] }] };

test('timeline history supports bounded undo, redo, reset, and safe snapshots', () => {
  const history = createTimelineHistory(valid, { limit: 2 });
  const original = structuredClone(valid);
  history.apply({ type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 3.5 });
  history.apply({ type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 4 });
  history.apply({ type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 4.5 });
  assert.equal(history.undoDepth, 2);
  assert.equal(history.current.tracks[0].clips[1].timelineStart, 4.5);
  assert.equal(history.undo().tracks[0].clips[1].timelineStart, 4);
  assert.equal(history.undo().tracks[0].clips[1].timelineStart, 3.5);
  assert.equal(history.canUndo, false);
  assert.equal(history.redo().tracks[0].clips[1].timelineStart, 4);
  history.apply({ type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 5 });
  assert.equal(history.canRedo, false);

  const externalSnapshot = history.current;
  externalSnapshot.project.id = 'mutated-outside';
  assert.equal(history.current.project.id, 'sample-edit');
  assert.deepEqual(valid, original);
  assert.throws(() => createTimelineHistory(valid, { limit: 0 }), /history limit/);
  history.reset(valid);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.current.tracks[0].clips[1].timelineStart, 3);
});

test('timeline edit batches apply atomically and occupy one history entry', () => {
  const original = structuredClone(valid);
  const operations = [
    { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 3.5 },
    { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 4 },
  ];
  const result = editTimelineBatch(valid, operations);
  assert.equal(result.tracks[0].clips[1].timelineStart, 4);
  assert.deepEqual(valid, original);
  assert.throws(() => editTimelineBatch(valid, [operations[0], { type: 'move', trackId: 'video-main', clipId: 'missing', timelineStart: 5 }]), /Unknown clip/);
  assert.throws(() => editTimelineBatch(valid, []), /non-empty array/);
  assert.throws(() => editTimelineBatch(valid, new Array(1)), /operation must be an object/);

  const history = createTimelineHistory(valid);
  history.applyBatch(operations);
  assert.equal(history.undoDepth, 1);
  assert.equal(history.undo().tracks[0].clips[1].timelineStart, 3);
  assert.equal(history.redo().tracks[0].clips[1].timelineStart, 4);
  assert.throws(() => history.applyBatch([operations[0], { type: 'move', trackId: 'video-main', clipId: 'missing', timelineStart: 5 }]), /Unknown clip/);
  assert.equal(history.undoDepth, 1);
  assert.equal(history.current.tracks[0].clips[1].timelineStart, 4);
});

test('timeline edit preview reports exact clip and duration changes without mutation', () => {
  const original = structuredClone(valid);
  const preview = previewTimelineEdit(valid, [
    { type: 'insert-gap', timelineStart: 1.5, durationSeconds: 2 },
    { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 7 },
  ]);

  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.operationCount, 2);
  assert.equal(preview.durationBeforeSeconds, 8);
  assert.equal(preview.durationAfterSeconds, 12);
  assert.equal(preview.durationDeltaSeconds, 4);
  assert.ok(preview.changes.some((change) => change.entity === 'clip' && change.change === 'added'));
  assert.ok(preview.changes.some((change) => change.entity === 'clip' && change.clipId === 'clip-two' && change.after.timelineStart === 7));
  assert.deepEqual(valid, original);
  assert.throws(() => previewTimelineEdit(valid, [
    { type: 'move', trackId: 'video-main', clipId: 'clip-two', timelineStart: 7 },
    { type: 'move', trackId: 'video-main', clipId: 'missing', timelineStart: 9 },
  ]), /Unknown clip/);
  assert.deepEqual(valid, original);
});

test('validates a generic timeline with clips, audio, and composition overlays', () => assert.equal(validateTimeline(valid), valid));

test('requires explicit track overlap policy to be boolean', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].allowOverlap = 'false';
  assert.throws(() => validateTimeline(timeline), /allowOverlap must be a boolean/);
});

test('validates track mute and visibility controls for compatible track kinds', () => {
  const invalidMute = structuredClone(valid);
  invalidMute.tracks[0].muted = true;
  assert.throws(() => validateTimeline(invalidMute), /muted must be a boolean on an audio track/);

  const invalidVisibility = structuredClone(valid);
  invalidVisibility.tracks[1].visible = false;
  assert.throws(() => validateTimeline(invalidVisibility), /visible must be a boolean on a video or overlay track/);

  const invalidMuteValue = structuredClone(valid);
  invalidMuteValue.tracks[1].muted = 'true';
  assert.throws(() => validateTimeline(invalidMuteValue), /muted must be a boolean/);

  const invalidVisibilityValue = structuredClone(valid);
  invalidVisibilityValue.tracks[0].visible = 0;
  assert.throws(() => validateTimeline(invalidVisibilityValue), /visible must be a boolean/);
});

test('filters muted and hidden tracks from render state without mutating the edit', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].visible = false;
  timeline.tracks[1].muted = true;
  timeline.audioMix = {
    ducking: [{ sourceTrackId: 'music', targetTrackId: 'music' }],
    sidechain: [{ sourceTrackId: 'music', targetTrackId: 'missing-track' }],
  };

  const renderState = timelineForRender(timeline);
  assert.deepEqual(renderState.tracks.map((track) => track.id), ['graphics']);
  assert.deepEqual(renderState.audioMix, { ducking: [], sidechain: [] });
  assert.equal(timeline.tracks[0].visible, false);
  assert.equal(timeline.tracks[1].muted, true);
  assert.equal(timeline.tracks.length, 3);
});

test('validates allowlisted blend modes on visual clips only', () => {
  const screen = structuredClone(valid);
  screen.tracks[0].clips[0].blendMode = 'screen';
  assert.equal(validateTimeline(screen), screen);

  const invalidVisual = structuredClone(valid);
  invalidVisual.tracks[0].clips[0].blendMode = 'url(javascript:alert(1))';
  assert.throws(() => validateTimeline(invalidVisual), /blendMode must be one of/);

  const audio = structuredClone(valid);
  audio.tracks[1].clips[0].blendMode = 'multiply';
  assert.throws(() => validateTimeline(audio), /only on video and overlay tracks/);
});

test('adds and removes timeline tracks and clips as immutable edits', () => {
  const track = { id: 'music-two', kind: 'audio', order: 3, clips: [] };
  const withTrack = addTimelineTrack(valid, track);
  assert.equal(withTrack.tracks.length, 4);
  assert.equal(valid.tracks.length, 3);
  const withClip = addTimelineClip(withTrack, 'music-two', {
    id: 'music-two-clip', assetId: 'camera', sourceIn: 0, sourceOut: 2,
    timelineStart: 7, durationSeconds: 2,
  });
  assert.equal(withClip.project.durationSeconds, 9);
  assert.equal(withClip.tracks[3].clips.length, 1);
  assert.equal(removeTimelineClip(withClip, 'music-two', 'music-two-clip').tracks[3].clips.length, 0);
  assert.equal(removeTimelineTrack(withClip, 'music-two').tracks.length, 3);
  assert.throws(() => addTimelineTrack(withTrack, track), /already exists/);
  assert.throws(() => addTimelineClip(valid, 'missing-track', {}), /Unknown timeline track/);
  assert.throws(() => removeTimelineClip(valid, 'music', 'missing-clip'), /Unknown clip/);
  assert.equal(editTimeline(valid, { type: 'add-track', track }).tracks.length, 4);
  assert.equal(editTimeline(withTrack, { type: 'remove-track', trackId: 'music-two' }).tracks.length, 3);
});

test('moves clips between compatible tracks while preserving their edit data', () => {
  const withTarget = addTimelineTrack(valid, { id: 'video-broll', kind: 'video', order: 3, clips: [] });
  const source = withTarget.tracks[0].clips[0];
  source.keyframes = [{ time: 0, properties: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }];
  const originalClip = structuredClone(source);
  const moved = moveTimelineClipToTrack(withTarget, 'video-main', 'clip-one', 'video-broll', 4);
  assert.equal(moved.tracks.find((track) => track.id === 'video-main').clips.some((clip) => clip.id === 'clip-one'), false);
  const clip = moved.tracks.find((track) => track.id === 'video-broll').clips[0];
  assert.equal(clip.timelineStart, 4);
  assert.deepEqual(clip.keyframes, source.keyframes);
  assert.deepEqual(withTarget.tracks[0].clips[0], originalClip);
  assert.equal(editTimeline(withTarget, { type: 'move-track', trackId: 'video-main', clipId: 'clip-one', targetTrackId: 'video-broll' }).tracks.find((track) => track.id === 'video-broll').clips[0].timelineStart, 0);
  const occupiedTarget = addTimelineTrack(valid, {
    id: 'video-occupied', kind: 'video', order: 3,
    clips: [{ id: 'target-clip', assetId: 'camera', sourceIn: 0, sourceOut: 2, timelineStart: 1, durationSeconds: 2 }],
  });
  assert.throws(() => moveTimelineClipToTrack(occupiedTarget, 'video-main', 'clip-one', 'video-occupied', 1), /overlapping clips/);
  assert.throws(() => moveTimelineClipToTrack(withTarget, 'video-main', 'clip-one', 'music'), /Cannot move a video clip to a track of kind audio/);
  assert.throws(() => moveTimelineClipToTrack(withTarget, 'video-main', 'missing', 'video-broll'), /Unknown clip/);
  assert.throws(() => moveTimelineClipToTrack(withTarget, 'video-main', 'clip-one', 'missing'), /Unknown timeline track/);
});

test('reorders visual and audio tracks without changing clips', () => {
  const reordered = reorderTimelineTrack(valid, 'graphics', 0);
  assert.deepEqual(reordered.tracks.map(({ id, order }) => ({ id, order })), [
    { id: 'graphics', order: 0 },
    { id: 'video-main', order: 1 },
    { id: 'music', order: 2 },
  ]);
  assert.deepEqual(reordered.tracks[0].clips, valid.tracks[2].clips);
  assert.equal(valid.tracks[2].order, 2);
  assert.deepEqual(editTimeline(valid, { type: 'reorder-track', trackId: 'music', order: 0 }).tracks[0].id, 'music');
  assert.throws(() => reorderTimelineTrack(valid, 'missing', 0), /Unknown timeline track/);
  assert.throws(() => reorderTimelineTrack(valid, 'graphics', valid.tracks.length), /Track order/);
});

test('duplicates a clip with its complete edit metadata and a new position', () => {
  const source = structuredClone(valid);
  source.tracks[0].clips[0].keyframes = [{ time: 0, properties: { x: 0.1, width: 0.8 } }];
  source.tracks[0].clips[0].transitionOut = { schemaVersion: 1, type: 'fade', durationSeconds: 0.5 };
  const originalClip = structuredClone(source.tracks[0].clips[0]);
  const duplicated = duplicateTimelineClip(source, 'video-main', 'clip-one', 'clip-one-copy', 8);
  const copy = duplicated.tracks[0].clips.find((clip) => clip.id === 'clip-one-copy');
  assert.equal(copy.timelineStart, 8);
  assert.equal(copy.sourceIn, originalClip.sourceIn);
  assert.equal(copy.sourceOut, originalClip.sourceOut);
  assert.deepEqual(copy.keyframes, originalClip.keyframes);
  assert.deepEqual(copy.transitionOut, originalClip.transitionOut);
  assert.equal(duplicated.project.durationSeconds, 11);
  assert.deepEqual(source.tracks[0].clips[0], originalClip);
  assert.equal(editTimeline(source, { type: 'duplicate-clip', trackId: 'video-main', clipId: 'clip-one', newClipId: 'copy-two', timelineStart: 8 }).tracks[0].clips.find((clip) => clip.id === 'copy-two').timelineStart, 8);
  assert.throws(() => duplicateTimelineClip(source, 'video-main', 'clip-one', 'copy-two', 2), /overlapping clips/);
  assert.throws(() => duplicateTimelineClip(source, 'video-main', 'clip-one', 'invalid ID', 7), /kebab-case/);
  assert.throws(() => duplicateTimelineClip(source, 'video-main', 'clip-one', 'copy', -1), /non-negative/);
});

test('detaches a video clip audio range to a synchronized audio track', () => {
  const timeline = structuredClone(valid);
  timeline.assets[0].type = 'video';
  timeline.assets[0].hasAudio = true;
  timeline.assets[0].durationSeconds = 10;
  timeline.assets[0].audioStreams = [
    { index: 0, streamIndex: 1, codec: 'aac', channels: 2, channelLayout: 'stereo', sampleRate: 48000, startSeconds: 0, durationSeconds: 10, timeBase: '1/48000', language: 'eng', title: 'Narration' },
    { index: 1, streamIndex: 2, codec: 'aac', channels: 1, channelLayout: 'mono', sampleRate: 44100, startSeconds: 0, durationSeconds: 10, timeBase: '1/44100', language: 'spa', title: 'Spanish' },
  ];
  timeline.tracks[0].clips[0].timelineStart = 1;
  timeline.tracks[0].clips[1].timelineStart = 4;
  timeline.project.durationSeconds = 9;
  timeline.tracks[0].clips[0].speedRamp = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 3, playbackRate: 1 },
  ];
  const original = structuredClone(timeline);
  const detached = detachAudioFromTimelineClip(timeline, 'video-main', 'clip-one', 'audio-camera', 'clip-one-audio', 1);
  const audioTrack = detached.tracks.find((track) => track.id === 'audio-camera');
  const audioClip = audioTrack.clips[0];
  assert.equal(audioTrack.kind, 'audio');
  assert.equal(audioTrack.order, 3);
  assert.deepEqual(
    { assetId: audioClip.assetId, sourceIn: audioClip.sourceIn, sourceOut: audioClip.sourceOut, timelineStart: audioClip.timelineStart, durationSeconds: audioClip.durationSeconds, playbackRate: audioClip.playbackRate },
    { assetId: 'camera', sourceIn: 0, sourceOut: 3, timelineStart: 1, durationSeconds: 3, playbackRate: undefined },
  );
  assert.deepEqual(audioClip.speedRamp, timeline.tracks[0].clips[0].speedRamp);
  assert.equal(audioClip.audioStreamIndex, 1);
  assert.deepEqual(timeline, original);
  assert.deepEqual(editTimeline(timeline, { type: 'detach-audio', trackId: 'video-main', clipId: 'clip-one', audioTrackId: 'audio-camera', audioClipId: 'clip-one-audio', audioStreamIndex: 1 }), detached);
  assert.throws(() => detachAudioFromTimelineClip(timeline, 'video-main', 'clip-one', 'graphics', 'clip-one-audio'), /not an audio track/);
  assert.throws(() => detachAudioFromTimelineClip(timeline, 'missing', 'clip-one', 'audio-camera', 'clip-one-audio'), /Unknown video track/);
  assert.throws(() => detachAudioFromTimelineClip(timeline, 'video-main', 'missing', 'audio-camera', 'clip-one-audio'), /Unknown clip/);
  assert.throws(() => detachAudioFromTimelineClip(timeline, 'video-main', 'clip-one', 'audio-camera', 'clip-one-audio', 2), /exceeds the audio streams/);

  const constantRateTimeline = structuredClone(original);
  constantRateTimeline.tracks[0].clips[0].timelineStart = 1;
  constantRateTimeline.tracks[0].clips[0].durationSeconds = 2;
  delete constantRateTimeline.tracks[0].clips[0].speedRamp;
  constantRateTimeline.tracks[0].clips[0].playbackRate = 1.5;
  const constantRateAudio = detachAudioFromTimelineClip(constantRateTimeline, 'video-main', 'clip-one', 'audio-camera', 'clip-one-audio').tracks[3].clips[0];
  assert.equal(constantRateAudio.playbackRate, 1.5);
  assert.equal(constantRateAudio.durationSeconds, 2);
  assert.equal(constantRateAudio.sourceOut, 3);

  const silent = structuredClone(timeline);
  silent.assets[0].hasAudio = false;
  assert.throws(() => detachAudioFromTimelineClip(silent, 'video-main', 'clip-one', 'audio-camera', 'clip-one-audio'), /without an audio stream/);
});

test('ripple-deletes one clip range across tracks and retimes linked media', () => {
  const timeline = structuredClone(valid);
  const ripple = rippleDeleteTimelineClip(timeline, 'video-main', 'clip-one');
  assert.equal(ripple.project.durationSeconds, 5);
  assert.equal(ripple.tracks[0].clips[0].id, 'clip-two');
  assert.equal(ripple.tracks[0].clips[0].timelineStart, 0);
  assert.equal(ripple.tracks[1].clips[0].sourceIn, 3);
  assert.equal(ripple.tracks[1].clips[0].sourceOut, 8);
  assert.equal(ripple.tracks[1].clips[0].durationSeconds, 5);
  assert.equal(ripple.tracks[2].clips.length, 0);
  assert.equal(timeline.project.durationSeconds, 8);
  assert.equal(timeline.tracks[1].clips[0].sourceIn, 0);
  assert.equal(validateTimeline(ripple), ripple);
  assert.deepEqual(editTimeline(timeline, { type: 'ripple-delete', trackId: 'video-main', clipId: 'clip-one' }), ripple);
});

test('ripple deletion splits straddling clips and clips word-timed overlays at the removed range', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].allowOverlap = true;
  timeline.tracks[0].clips[1].timelineStart = 2.5;
  timeline.tracks[0].clips[0].speedRamp = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 3, playbackRate: 1 },
  ];
  timeline.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { x: 0 } },
    { time: 3, properties: { x: 0.6 } },
  ];
  timeline.tracks[0].clips[0].width = 0.2;
  timeline.tracks[2].clips.push({
    id: 'timed-title', text: 'Before middle after', timelineStart: 2, durationSeconds: 4,
    wordTimings: [{ text: 'Before', start: 0.1, end: 0.4 }, { text: 'middle', start: 1, end: 1.5 }, { text: 'after', start: 2, end: 3 }],
    wordHighlightColor: '#ff0000',
  });
  const ripple = rippleDeleteTimelineClip(timeline, 'video-main', 'clip-two');
  const musicClips = ripple.tracks[1].clips;
  assert.equal(ripple.project.durationSeconds, 3);
  assert.equal(ripple.tracks[0].clips[0].durationSeconds, 2.5);
  assert.equal(ripple.tracks[0].clips[0].speedRamp.at(-1).sourceOffset, 2.5);
  assert.equal(ripple.tracks[0].clips[0].keyframes.at(-1).time, 2.5);
  assert.equal(ripple.tracks[0].clips[0].keyframes.at(-1).properties.x, 0.5);
  assert.equal(musicClips.length, 2);
  assert.equal(musicClips[0].sourceOut, 2.5);
  assert.equal(musicClips[1].sourceIn, 7.5);
  assert.equal(musicClips[1].timelineStart, 2.5);
  assert.match(musicClips[1].id, /^music-bed-ripple-right/);
  assert.equal(ripple.tracks[2].clips[1].text, 'Before');
  assert.deepEqual(ripple.tracks[2].clips[1].wordTimings, [{ text: 'Before', start: 0.1, end: 0.4 }]);
  assert.equal(validateTimeline(ripple), ripple);
  assert.throws(() => rippleDeleteTimelineClip(valid, 'video-main', 'missing-clip'), /Unknown clip/);
});

test('inserts a synchronized gap across tracks while preserving clip source timing', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[2].allowOverlap = true;
  timeline.tracks[0].clips[0].speedRamp = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 3, playbackRate: 1 },
  ];
  timeline.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { x: 0, y: 0, width: 0.2, height: 1 } },
    { time: 3, properties: { x: 0.2, y: 0, width: 0.2, height: 1 } },
  ];
  timeline.tracks[2].clips.push({
    id: 'timed-title', text: 'Before after', timelineStart: 1, durationSeconds: 4,
    wordTimings: [{ text: 'Before', start: 0.1, end: 0.4 }, { text: 'after', start: 2, end: 3 }],
    wordHighlightColor: '#ff0000',
  });

  const inserted = insertTimelineGap(timeline, 1.5, 2);
  const video = inserted.tracks[0].clips;
  assert.equal(inserted.project.durationSeconds, 10);
  assert.equal(video[0].durationSeconds, 1.5);
  assert.equal(video[0].sourceOut, 1.5);
  assert.equal(video[0].speedRamp.at(-1).sourceOffset, 1.5);
  assert.equal(video[1].sourceIn, 1.5);
  assert.equal(video[1].sourceOut, 3);
  assert.equal(video[1].timelineStart, 3.5);
  assert.equal(video[1].speedRamp[0].sourceOffset, 0);
  assert.equal(video[1].speedRamp.at(-1).sourceOffset, 1.5);
  assert.match(video[1].id, /^clip-one-gap-right/);
  assert.equal(video[1].keyframes[0].time, 0);
  assert.equal(video[1].keyframes[0].properties.x, 0.1);
  assert.equal(video[2].timelineStart, 5);

  const music = inserted.tracks[1].clips;
  assert.equal(music.length, 2);
  assert.equal(music[0].sourceOut, 1.5);
  assert.equal(music[1].sourceIn, 1.5);
  assert.equal(music[1].timelineStart, 3.5);
  const title = inserted.tracks[2].clips.find((clip) => clip.id === 'timed-title');
  assert.deepEqual(title.wordTimings, [{ text: 'Before', start: 0.1, end: 0.4 }]);
  const titleRight = inserted.tracks[2].clips.find((clip) => clip.text === 'after');
  assert.equal(titleRight.timelineStart, 3.5);
  assert.deepEqual(titleRight.wordTimings, [{ text: 'after', start: 1.5, end: 2.5 }]);
  assert.equal(timeline.project.durationSeconds, 8);
  assert.equal(timeline.tracks[0].clips.length, 2);
  assert.equal(validateTimeline(inserted), inserted);
  assert.deepEqual(editTimeline(timeline, { type: 'insert-gap', timelineStart: 1.5, durationSeconds: 2 }), inserted);
  assert.throws(() => insertTimelineGap(valid, 9, 1), /within the project duration/);
  assert.throws(() => insertTimelineGap(valid, 1, 0), /positive number/);
});

test('slips a media clip source range without moving or resizing it', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].clips[0].speedRamp = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 3, playbackRate: 1 },
  ];
  timeline.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { x: 0, y: 0, width: 0.2, height: 1 } },
    { time: 3, properties: { x: 0.2, y: 0, width: 0.2, height: 1 } },
  ];
  const slipped = slipTimelineClip(timeline, 'video-main', 'clip-one', 1.25);
  const clip = slipped.tracks[0].clips[0];
  assert.equal(clip.sourceIn, 1.25);
  assert.equal(clip.sourceOut, 4.25);
  assert.equal(clip.timelineStart, 0);
  assert.equal(clip.durationSeconds, 3);
  assert.deepEqual(clip.speedRamp, timeline.tracks[0].clips[0].speedRamp);
  assert.deepEqual(clip.keyframes, timeline.tracks[0].clips[0].keyframes);
  assert.equal(slipped.project.durationSeconds, 8);
  assert.equal(timeline.tracks[0].clips[0].sourceIn, 0);
  assert.deepEqual(editTimeline(timeline, { type: 'slip', trackId: 'video-main', clipId: 'clip-one', sourceDelta: 1.25 }), slipped);
  assert.throws(() => slipTimelineClip(valid, 'graphics', 'title', 1), /cannot be source-slipped/);
  assert.throws(() => slipTimelineClip(valid, 'video-main', 'clip-one', -0.1), /source range/);

  const bounded = structuredClone(valid);
  bounded.assets[0].durationSeconds = 10;
  assert.throws(() => slipTimelineClip(bounded, 'video-main', 'clip-two', 0.1), /exceeds asset camera duration/);
  assert.throws(() => slipTimelineClip(valid, 'video-main', 'missing-clip', 1), /Unknown clip/);
});

test('rejects path traversal, missing assets, overlaps, and out-of-range clips', () => {
  assert.throws(() => validateTimeline({ ...valid, assets: [{ id: 'camera', path: '../private.mp4' }] }), /project-relative/);
  assert.throws(() => validateTimeline({ ...valid, tracks: [{ ...valid.tracks[0], clips: [{ ...valid.tracks[0].clips[0], assetId: 'missing' }] }] }), /missing its asset/);
  assert.throws(() => validateTimeline({ ...valid, tracks: [{ ...valid.tracks[0], clips: [valid.tracks[0].clips[0], { ...valid.tracks[0].clips[1], timelineStart: 2 }] }] }), /overlapping clips/);
  assert.throws(() => validateTimeline({ ...valid, tracks: [{ ...valid.tracks[0], clips: [{ ...valid.tracks[0].clips[0], timelineStart: 7 }] }] }), /timeline bounds/);
});

test('enforces exact clip source duration and registered asset boundaries', () => {
  const bounded = { ...valid, assets: [{ id: 'camera', path: 'assets/camera.mp4', durationSeconds: 10 }] };
  assert.equal(validateTimeline(bounded), bounded);
  assert.throws(() => validateTimeline({
    ...bounded,
    tracks: [{ ...bounded.tracks[0], clips: [{ ...bounded.tracks[0].clips[0], sourceOut: 3.04 }] }],
  }), /source range must match/);
  assert.throws(() => validateTimeline({
    ...bounded,
    project: { ...bounded.project, durationSeconds: 9 },
    tracks: [{ ...bounded.tracks[0], clips: [{ ...bounded.tracks[0].clips[1], sourceOut: 10.01, durationSeconds: 5.01 }] }],
  }), /exceeds asset camera duration/);
  assert.throws(() => validateTimeline({
    ...valid,
    assets: [{ id: 'camera', path: 'assets/camera.mp4', streamTiming: { videoStartSeconds: Number.NaN } }],
  }), /streamTiming.videoStartSeconds must be finite/);
});

test('supports bounded constant playback rates with source-time validation', () => {
  const spedUp = structuredClone(valid);
  spedUp.tracks[0].clips[0] = { ...spedUp.tracks[0].clips[0], sourceOut: 3, durationSeconds: 1.5, playbackRate: 2 };
  spedUp.tracks[0].clips[1].timelineStart = 1.5;
  assert.equal(validateTimeline(spedUp), spedUp);
  assert.throws(() => validateTimeline({
    ...spedUp,
    tracks: [{ ...spedUp.tracks[0], clips: [{ ...spedUp.tracks[0].clips[0], playbackRate: 0.05 }, spedUp.tracks[0].clips[1]] }, ...spedUp.tracks.slice(1)],
  }), /playbackRate must be from 0.1 to 5/);
  assert.throws(() => validateTimeline({
    ...spedUp,
    tracks: [{ ...spedUp.tracks[0], clips: [{ ...spedUp.tracks[0].clips[0], sourceOut: 2.9 }, spedUp.tracks[0].clips[1]] }, ...spedUp.tracks.slice(1)],
  }), /multiplied by playbackRate/);
});

test('validates source-based smooth speed ramps and their integrated duration', () => {
  const timeline = structuredClone(valid);
  const clip = timeline.tracks[0].clips[0];
  clip.sourceOut = 2;
  clip.durationSeconds = 2 * Math.log(2);
  clip.speedRamp = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 2, playbackRate: 2 },
  ];
  assert.equal(validateTimeline(timeline), timeline);
  assert.ok(Math.abs(speedRampDuration(clip.speedRamp) - clip.durationSeconds) < 1e-9);

  const invalid = structuredClone(timeline);
  invalid.tracks[0].clips[0].speedRamp[1].playbackRate = 5.1;
  assert.throws(() => validateTimeline(invalid), /speedRamp point/);
  const mismatched = structuredClone(timeline);
  mismatched.tracks[0].clips[0].durationSeconds += 0.01;
  assert.throws(() => validateTimeline(mismatched), /integrated speedRamp duration/);
  const conflicting = structuredClone(timeline);
  conflicting.tracks[0].clips[0].playbackRate = 1.5;
  assert.throws(() => validateTimeline(conflicting), /cannot combine speedRamp/);
});

test('validates clip-local visual transform keyframes', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { x: 0, y: 0.1, width: 0.5, height: 0.5, opacity: 0, rotationDegrees: -5, objectPositionX: 0, objectPositionY: 0.5, zoom: 1, brightness: 1, contrast: 1 } },
    { time: 2, properties: { x: 0.5, opacity: 1, rotationDegrees: 5, objectPositionX: 1, objectPositionY: 0.4, zoom: 2, saturation: 1.2, blurPixels: 0, hueDegrees: 15 }, ease: 'power2.out' },
  ];
  assert.equal(validateTimeline(timeline), timeline);
  const compositionTimeline = structuredClone(valid);
  compositionTimeline.tracks[2].clips[0].keyframes = [
    { time: 0, properties: { x: 0, y: 0, width: 1, height: 1, opacity: 0 } },
    { time: 1, properties: { opacity: 1 }, ease: 'sine.out' },
  ];
  assert.equal(validateTimeline(compositionTimeline), compositionTimeline);

  const invalidCases = [
    [{ time: 0.1, properties: { x: 0 } }],
    [{ time: 0, properties: { x: 0 } }, { time: 0, properties: { x: 0.1 } }],
    [{ time: 0, properties: { x: 0 } }, { time: 3.1, properties: { x: 0.1 } }],
    [{ time: 0, properties: { x: 0.9 } }],
    [{ time: 0, properties: { opacity: 1.1 } }],
    [{ time: 0, properties: { brightness: 5.1 } }],
    [{ time: 0, properties: { blurPixels: 101 } }],
    [{ time: 0, properties: { objectPositionX: 1.1 } }],
    [{ time: 0, properties: { zoom: 0.9 } }],
    [{ time: 0, properties: { zoom: 4.1 } }],
    [{ time: 0, properties: { hueDegrees: -361 } }],
    [{ time: 0, properties: { color: '#fff' } }],
    [{ time: 0, properties: { x: 0 }, ease: 'javascript:alert(1)' }],
    [{ time: 0, properties: { x: 0 }, eases: { y: 'power2.out' } }],
    [{ time: 0, properties: { x: 0 }, ease: { type: 'range', name: 'power2.out', from: 0.8, to: 0.2 } }],
  ];
  for (const keyframes of invalidCases) {
    assert.throws(() => validateTimeline({
      ...valid,
      tracks: [{ ...valid.tracks[0], clips: [{ ...valid.tracks[0].clips[0], keyframes }] }, ...valid.tracks.slice(1)],
    }), /keyframe/);
  }
  const overlayCrop = structuredClone(valid);
  overlayCrop.tracks[2].clips[0].keyframes = [{ time: 0, properties: { objectPositionX: 0.5 } }];
  assert.throws(() => validateTimeline(overlayCrop), /video track/);
  const overlayZoom = structuredClone(valid);
  overlayZoom.tracks[2].clips[0].keyframes = [{ time: 0, properties: { zoom: 2 } }];
  assert.throws(() => validateTimeline(overlayZoom), /zoom must be between 1 and 4 on a video track/);
  assert.throws(() => validateTimeline({
    ...valid,
    tracks: [
      valid.tracks[0],
      { ...valid.tracks[1], clips: [{ ...valid.tracks[1].clips[0], keyframes: [{ time: 0, properties: { opacity: 1 } }] }] },
      ...valid.tracks.slice(2),
    ],
  }), /video and overlay/);
});

test('supports project and per-clip source-fit policies with explicit precedence', () => {
  const projectPolicy = { ...valid, project: { ...valid.project, sourceFit: 'cover' } };
  assert.equal(validateTimeline(projectPolicy), projectPolicy);
  assert.equal(resolveSourceFit(projectPolicy.project, valid.tracks[0].clips[0]), 'cover');
  assert.equal(resolveSourceFit(projectPolicy.project, { fit: 'fill' }), 'fill');
  assert.equal(resolveSourceFit({}, {}), 'contain');

  const clipPolicy = {
    ...valid,
    project: { ...valid.project, sourceFit: 'contain' },
    tracks: [{ ...valid.tracks[0], clips: [{ ...valid.tracks[0].clips[0], fit: 'cover' }] }],
  };
  assert.equal(validateTimeline(clipPolicy), clipPolicy);
  assert.throws(() => validateTimeline({ ...valid, project: { ...valid.project, sourceFit: 'crop' } }), /sourceFit must be one of/);
  assert.throws(() => validateTimeline({
    ...valid,
    tracks: [{ ...valid.tracks[0], clips: [{ ...valid.tracks[0].clips[0], fit: 'crop' }] }],
  }), /fit must be one of/);
  assert.throws(() => validateTimeline({
    ...valid,
    tracks: [{ ...valid.tracks[1], clips: [{ ...valid.tracks[1].clips[0], fit: 'cover' }] }],
  }), /fit only on a video track/);
});

test('validates reusable visual masks on video and overlay clips', () => {
  for (const mask of [
    { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.45 },
    { type: 'ellipse', centerX: 0.5, centerY: 0.5, radiusX: 0.4, radiusY: 0.3 },
    { type: 'rect', x: 0.1, y: 0.15, width: 0.8, height: 0.7 },
  ]) {
    const timeline = structuredClone(valid);
    timeline.tracks[0].clips[0].mask = mask;
    timeline.tracks[2].clips[0].mask = mask;
    timeline.tracks[0].clips[0].keyframes = [
      { time: 0, properties: { maskProgress: 0 } },
      { time: 2, properties: { maskProgress: 1 } },
    ];
    timeline.tracks[2].clips[0].keyframes = structuredClone(timeline.tracks[0].clips[0].keyframes);
    assert.equal(validateTimeline(timeline), timeline);
  }

  for (const mask of [
    'circle(50%)',
    { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0 },
    { type: 'ellipse', centerX: 0.5, centerY: 0.5, radiusX: 0.4, radiusY: -0.1 },
    { type: 'rect', x: 0.2, y: 0.1, width: 0.9, height: 0.5 },
    { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.3, css: 'url(javascript:alert(1))' },
  ]) {
    const timeline = structuredClone(valid);
    timeline.tracks[0].clips[0].mask = mask;
    assert.throws(() => validateTimeline(timeline), /mask/);
  }

  const audioMask = structuredClone(valid);
  audioMask.tracks[1].clips[0].mask = { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.4 };
  assert.throws(() => validateTimeline(audioMask), /video and overlay tracks/);

  const animated = structuredClone(valid);
  animated.tracks[0].clips[0].mask = { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.45 };
  animated.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { maskProgress: 0 } },
    { time: 2, properties: { maskProgress: 1 } },
  ];
  assert.equal(validateTimeline(animated), animated);
  const missingMask = structuredClone(animated);
  delete missingMask.tracks[0].clips[0].mask;
  assert.throws(() => validateTimeline(missingMask), /require a static mask/);
  const missingInitialProgress = structuredClone(animated);
  missingInitialProgress.tracks[0].clips[0].keyframes[0].properties = { opacity: 1 };
  assert.throws(() => validateTimeline(missingInitialProgress), /value at time 0/);
  for (const progress of [-0.01, 1.01]) {
    const outOfRange = structuredClone(animated);
    outOfRange.tracks[0].clips[0].keyframes[1].properties.maskProgress = progress;
    assert.throws(() => validateTimeline(outOfRange), /maskProgress must be between 0 and 1/);
  }
});

test('validates versioned fade and directional wipe transitions', () => {
  for (const transition of [
    { schemaVersion: 1, type: 'fade', durationSeconds: 0.5 },
    { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 0.5 },
  ]) {
    const timeline = structuredClone(valid);
    timeline.tracks[0].clips[0].transitionIn = transition;
    timeline.tracks[2].clips[0].transitionOut = transition;
    assert.equal(validateTimeline(timeline), timeline);
  }

  const invalid = [
    { schemaVersion: 2, type: 'fade', durationSeconds: 0.5 },
    { schemaVersion: 1, type: 'slide', durationSeconds: 0.5 },
    { schemaVersion: 1, type: 'wipe', direction: 'diagonal', durationSeconds: 0.5 },
    { schemaVersion: 1, type: 'fade', durationSeconds: 0, direction: 'left' },
    { schemaVersion: 1, type: 'wipe', direction: 'up', durationSeconds: 3.1 },
    { schemaVersion: 1, type: 'fade', durationSeconds: 0.5, css: 'url(javascript:alert(1))' },
  ];
  for (const transition of invalid) {
    const timeline = structuredClone(valid);
    timeline.tracks[0].clips[0].transitionIn = transition;
    assert.throws(() => validateTimeline(timeline), /transition/i);
  }

  const masked = structuredClone(valid);
  masked.tracks[0].clips[0].mask = { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.4 };
  masked.tracks[0].clips[0].transitionIn = { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 0.5 };
  assert.throws(() => validateTimeline(masked), /static mask/);
  const opacityConflict = structuredClone(valid);
  opacityConflict.tracks[0].clips[0].transitionIn = { schemaVersion: 1, type: 'fade', durationSeconds: 0.5 };
  opacityConflict.tracks[0].clips[0].keyframes = [{ time: 0, properties: { opacity: 1 } }];
  assert.throws(() => validateTimeline(opacityConflict), /opacity keyframes/);
  const overlap = structuredClone(valid);
  overlap.tracks[0].clips[0].transitionIn = { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 2 };
  overlap.tracks[0].clips[0].transitionOut = { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 2 };
  assert.throws(() => validateTimeline(overlap), /cannot overlap/);
  const directions = structuredClone(valid);
  directions.tracks[0].clips[0].transitionIn = { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 0.5 };
  directions.tracks[0].clips[0].transitionOut = { schemaVersion: 1, type: 'wipe', direction: 'right', durationSeconds: 0.5 };
  assert.throws(() => validateTimeline(directions), /same direction/);
  const audio = structuredClone(valid);
  audio.tracks[1].clips[0].transitionIn = { schemaVersion: 1, type: 'fade', durationSeconds: 0.5 };
  assert.throws(() => validateTimeline(audio), /video and overlay/);
});

test('adds and removes transitions through immutable timeline edits', () => {
  const transition = { schemaVersion: 1, type: 'wipe', direction: 'up', durationSeconds: 0.4 };
  const changed = editTimeline(valid, { type: 'transition', trackId: 'video-main', clipId: 'clip-one', edge: 'in', transition });
  assert.deepEqual(changed.tracks[0].clips[0].transitionIn, transition);
  assert.equal(valid.tracks[0].clips[0].transitionIn, undefined);
  const cleared = setTimelineTransition(changed, 'video-main', 'clip-one', 'in', null);
  assert.equal(cleared.tracks[0].clips[0].transitionIn, undefined);
  assert.match(transitionClipPath('left'), /--engine-transition-progress/);
  assert.match(transitionClipPath('right'), /100%/);
  assert.match(transitionClipPath('up'), /100%/);
  assert.match(transitionClipPath('down'), /100%/);
  assert.throws(() => setTimelineTransition(valid, 'video-main', 'clip-one', 'side', transition), /edge/);
  assert.throws(() => setTimelineTransition(valid, 'music', 'music-bed', 'in', transition), /video and overlay/);
});

test('keeps clip-edge transitions on the outer edges when splitting a clip', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].clips[0].transitionIn = { schemaVersion: 1, type: 'fade', durationSeconds: 0.4 };
  timeline.tracks[0].clips[0].transitionOut = { schemaVersion: 1, type: 'wipe', direction: 'left', durationSeconds: 0.4 };
  const split = splitTimelineClip(timeline, 'video-main', 'clip-one', 1.25);
  assert.deepEqual(split.tracks[0].clips[0].transitionIn, timeline.tracks[0].clips[0].transitionIn);
  assert.equal(split.tracks[0].clips[0].transitionOut, undefined);
  assert.equal(split.tracks[0].clips[1].transitionIn, undefined);
  assert.deepEqual(split.tracks[0].clips[1].transitionOut, timeline.tracks[0].clips[0].transitionOut);
});

test('compiles an approved EDL into sequential timeline clips', () => {
  const timeline = timelineFromEdl({ schemaVersion: 1, sourceDurationSeconds: 10, cuts: [{ sourceStart: 2, sourceEnd: 4, reason: 'remove pause' }] }, 'camera');
  assert.equal(timeline.project.durationSeconds, 8);
  assert.deepEqual(timeline.tracks[0].clips.map(({ sourceIn, sourceOut, timelineStart }) => ({ sourceIn, sourceOut, timelineStart })), [
    { sourceIn: 0, sourceOut: 2, timelineStart: 0 },
    { sourceIn: 4, sourceOut: 10, timelineStart: 2 },
  ]);
});

test('preserves the source-fit policy when compiling an EDL', () => {
  const timeline = timelineFromEdl(
    { schemaVersion: 1, sourceDurationSeconds: 10, cuts: [] },
    'camera',
    { sourceFit: 'cover' },
  );
  assert.equal(timeline.project.sourceFit, 'cover');
});

test('moves, trims, and splits clips as immutable timeline edits', () => {
  const moved = moveTimelineClip(valid, 'video-main', 'clip-two', 3.5);
  assert.equal(moved.tracks[0].clips[1].timelineStart, 3.5);
  assert.equal(valid.tracks[0].clips[1].timelineStart, 3);
  assert.throws(() => moveTimelineClip(valid, 'video-main', 'clip-two', 2), /overlapping clips/);

  const trimmed = trimTimelineClip(valid, 'video-main', 'clip-one', 0.5, 2.5);
  assert.deepEqual(
    { sourceIn: trimmed.tracks[0].clips[0].sourceIn, sourceOut: trimmed.tracks[0].clips[0].sourceOut, timelineStart: trimmed.tracks[0].clips[0].timelineStart, duration: trimmed.tracks[0].clips[0].durationSeconds },
    { sourceIn: 0.5, sourceOut: 2.5, timelineStart: 0.5, duration: 2 },
  );

  const split = splitTimelineClip(valid, 'video-main', 'clip-one', 1.25);
  assert.deepEqual(split.tracks[0].clips.slice(0, 2).map(({ id, sourceIn, sourceOut, timelineStart, durationSeconds }) => ({ id, sourceIn, sourceOut, timelineStart, durationSeconds })), [
    { id: 'clip-one', sourceIn: 0, sourceOut: 1.25, timelineStart: 0, durationSeconds: 1.25 },
    { id: 'clip-one-right', sourceIn: 1.25, sourceOut: 3, timelineStart: 1.25, durationSeconds: 1.75 },
  ]);
  assert.throws(() => splitTimelineClip(valid, 'video-main', 'clip-one', 3), /strictly inside/);
});

test('trims and splits speed ramps without changing the source-time curve', () => {
  const timeline = structuredClone(valid);
  const clip = timeline.tracks[0].clips[0];
  clip.sourceOut = 2;
  clip.durationSeconds = 2 * Math.log(2);
  clip.speedRamp = [
    { sourceOffset: 0, playbackRate: 1 },
    { sourceOffset: 2, playbackRate: 2 },
  ];

  const trimmed = trimTimelineClip(timeline, 'video-main', 'clip-one', 0.5, 1.5);
  const trimmedClip = trimmed.tracks[0].clips[0];
  assert.ok(Math.abs(trimmedClip.timelineStart - 2 * Math.log(1.25)) < 1e-9);
  assert.ok(Math.abs(trimmedClip.durationSeconds - 2 * Math.log(1.75 / 1.25)) < 1e-9);
  assert.deepEqual(trimmedClip.speedRamp, [
    { sourceOffset: 0, playbackRate: 1.25 },
    { sourceOffset: 1, playbackRate: 1.75 },
  ]);

  const splitAt = 2 * Math.log(1.3);
  const split = splitTimelineClip(timeline, 'video-main', 'clip-one', splitAt, 'clip-right');
  const left = split.tracks[0].clips[0];
  const right = split.tracks[0].clips[1];
  assert.ok(Math.abs(left.sourceOut - 0.6) < 1e-9);
  assert.ok(Math.abs(left.durationSeconds + right.durationSeconds - clip.durationSeconds) < 1e-9);
  assert.ok(Math.abs(right.speedRamp[0].playbackRate - 1.3) < 1e-9);
});

test('preserves playback rate when trimming and splitting media clips', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].clips[0] = { ...timeline.tracks[0].clips[0], durationSeconds: 1.5, playbackRate: 2 };
  const trimmed = trimTimelineClip(timeline, 'video-main', 'clip-one', 0.5, 2.5);
  assert.deepEqual(
    { timelineStart: trimmed.tracks[0].clips[0].timelineStart, durationSeconds: trimmed.tracks[0].clips[0].durationSeconds, sourceIn: trimmed.tracks[0].clips[0].sourceIn, sourceOut: trimmed.tracks[0].clips[0].sourceOut },
    { timelineStart: 0.25, durationSeconds: 1, sourceIn: 0.5, sourceOut: 2.5 },
  );
  const split = splitTimelineClip(timeline, 'video-main', 'clip-one', 1);
  assert.deepEqual(
    split.tracks[0].clips.slice(0, 2).map(({ sourceIn, sourceOut, timelineStart, durationSeconds }) => ({ sourceIn, sourceOut, timelineStart, durationSeconds })),
    [
      { sourceIn: 0, sourceOut: 2, timelineStart: 0, durationSeconds: 1 },
      { sourceIn: 2, sourceOut: 3, timelineStart: 1, durationSeconds: 0.5 },
    ],
  );
});

test('rebases eased keyframes when clips are trimmed and split', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].clips[0].mask = { type: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.45 };
  timeline.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { x: 0, width: 0.5, opacity: 0, zoom: 1, maskProgress: 0 } },
    { time: 2, properties: { x: 0.5, opacity: 1, zoom: 2, maskProgress: 1 }, ease: 'power2.out' },
    { time: 3, properties: { x: 0.25, opacity: 0.4, zoom: 1.5, maskProgress: 0.5 }, ease: 'sine.in' },
  ];
  const split = splitTimelineClip(timeline, 'video-main', 'clip-one', 1);
  assert.equal(split.tracks[0].clips[0].keyframes[1].time, 1);
  assert.deepEqual(split.tracks[0].clips[0].keyframes[1].eases.x, { type: 'range', name: 'power2.out', from: 0, to: 0.5 });
  assert.deepEqual(split.tracks[0].clips[1].keyframes[0].properties, { x: 0.4375, width: 0.5, opacity: 0.875, zoom: 1.875, maskProgress: 0.875 });
  assert.deepEqual(split.tracks[0].clips[1].keyframes[1].eases.opacity, { type: 'range', name: 'power2.out', from: 0.5, to: 1 });

  const trimmed = trimTimelineClip(timeline, 'video-main', 'clip-one', 0.5, 2.5);
  assert.equal(trimmed.tracks[0].clips[0].keyframes[0].properties.x, 0.2890625);
  assert.equal(trimmed.tracks[0].clips[0].keyframes[0].properties.zoom, 1.578125);
  assert.equal(trimmed.tracks[0].clips[0].keyframes[0].properties.maskProgress, 0.578125);
  assert.deepEqual(trimmed.tracks[0].clips[0].keyframes.at(-1).eases.x, { type: 'range', name: 'sine.in', from: 0, to: 0.5 });
});

test('keeps sparse property animations on their own interpolation clocks', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].clips[0].keyframes = [
    { time: 0, properties: { x: 0, width: 0.5 } },
    { time: 1, properties: { opacity: 0.25 } },
    { time: 2, properties: { x: 0.4, opacity: 1 } },
  ];
  const split = splitTimelineClip(timeline, 'video-main', 'clip-one', 1.5);
  assert.ok(Math.abs(split.tracks[0].clips[1].keyframes[0].properties.x - 0.3) < 1e-9);
  assert.equal(split.tracks[0].clips[1].keyframes[0].properties.opacity, 0.625);
});

test('creates validated timed captions from word or cue transcripts', () => {
  const transcript = {
    schemaVersion: 1,
    durationSeconds: 4,
    words: [
      { text: 'Hello', start: 0.2, end: 0.7 },
      { text: 'there.', start: 0.75, end: 1.2 },
      { text: 'Welcome', start: 2, end: 2.5 },
      { text: 'back.', start: 2.55, end: 3 },
    ],
  };
  const track = createCaptionTrack(transcript);
  assert.equal(track.clips.length, 2);
  assert.equal(track.clips[0].text, 'Hello there.');
  assert.equal(track.clips[1].timelineStart, 2);
  assert.equal(track.clips[0].backgroundColor, '#000000b8');
  assert.equal(track.clips[0].wordTimings, undefined);
  const highlighted = createCaptionTrack(transcript, { wordHighlight: true, wordHighlightColor: '#ff0000' });
  assert.deepEqual(highlighted.clips[0].wordTimings.map(({ text, start }) => ({ text, start })), [
    { text: 'Hello', start: 0 },
    { text: 'there.', start: 0.55 },
  ]);
  assert.ok(Math.abs(highlighted.clips[0].wordTimings[0].end - 0.5) < 1e-9);
  assert.equal(highlighted.clips[0].wordTimings[1].end, 1);
  assert.equal(highlighted.clips[0].wordHighlightColor, '#ff0000');
  assert.equal(highlighted.clips[0].wordHighlightAnimation, 'scale');
  const highlightedTimeline = structuredClone(valid);
  highlightedTimeline.tracks.push({ ...highlighted, order: 3 });
  assert.equal(validateTimeline(highlightedTimeline), highlightedTimeline);
  const cueTranscript = { schemaVersion: 1, durationSeconds: 2, granularity: 'cue', words: [{ start: 0, end: 1, text: 'Hello there.' }] };
  assert.throws(() => createCaptionTrack(cueTranscript, { wordHighlight: true }), /word-level transcript timing/);
  assert.throws(() => createCaptionTrack(transcript, { wordHighlightColor: '#ff0000' }), /requires wordHighlight/);
  assert.throws(() => createCaptionTrack(transcript, { wordHighlightColor: 'red', wordHighlight: true }), /hex color/);
  assert.throws(() => createCaptionTrack(transcript, { wordHighlightAnimation: 'pop' }), /requires wordHighlight/);
  assert.throws(() => createCaptionTrack(transcript, { wordHighlight: true, wordHighlightAnimation: 'spin' }), /must be scale or pop/);
  for (const invalidHighlight of [
    { ...highlighted.clips[0], wordTimings: [{ text: 'Different', start: 0, end: 0.5 }, ...highlighted.clips[0].wordTimings.slice(1)] },
    { ...highlighted.clips[0], wordTimings: [{ text: 'Hello', start: -0.1, end: 0.5 }, ...highlighted.clips[0].wordTimings.slice(1)] },
    { ...highlighted.clips[0], wordHighlightColor: 'red' },
    { ...highlighted.clips[0], wordHighlightAnimation: 'spin' },
  ]) {
    const invalidTimeline = structuredClone(valid);
    invalidTimeline.tracks.push({ ...highlighted, order: 3, clips: [invalidHighlight] });
    assert.throws(() => validateTimeline(invalidTimeline), /wordTimings|wordHighlightColor|wordHighlightAnimation/);
  }
  const invalidWrapTimeline = structuredClone(valid);
  invalidWrapTimeline.tracks.push({ ...highlighted, order: 3, clips: [{ ...highlighted.clips[0], wordWrap: 'yes' }] });
  assert.throws(() => validateTimeline(invalidWrapTimeline), /wordWrap must be a boolean/);
  const styled = createCaptionTrack(transcript, {
    fontFamily: 'Arial, sans-serif', fontWeight: 700, lineHeight: 1.2,
    verticalAlign: 'bottom', paddingPixels: 12,
    textOutline: { color: '#000000', widthPixels: 2 },
    textShadow: { color: '#000000aa', blurPixels: 4, offsetXPixels: 1, offsetYPixels: 2 },
  });
  const styledTimeline = structuredClone(valid);
  styledTimeline.tracks.push({ ...styled, order: 3 });
  assert.equal(validateTimeline(styledTimeline), styledTimeline);
  for (const [layoutPreset, expectedAlign] of [['subtitle', 'center'], ['social', 'center'], ['socialPop', 'center'], ['lowerThird', 'left']]) {
    const presetTrack = createCaptionTrack(transcript, { layoutPreset });
    assert.equal(presetTrack.clips[0].textAlign, expectedAlign);
    assert.equal(presetTrack.clips[0].wordWrap, true);
    const presetTimeline = structuredClone(valid);
    presetTimeline.tracks.push({ ...presetTrack, order: 3 });
    assert.equal(validateTimeline(presetTimeline), presetTimeline);
  }
  const socialPop = createCaptionTrack(transcript, { layoutPreset: 'socialPop' });
  assert.equal(socialPop.clips[0].wordHighlightAnimation, 'pop');
  assert.equal(socialPop.clips[0].wordHighlightColor, '#ffe45c');
  const overridden = createCaptionTrack(transcript, { layoutPreset: 'social', fontSize: 42, textAlign: 'left' });
  assert.equal(overridden.clips[0].fontSize, 42);
  assert.equal(overridden.clips[0].textAlign, 'left');
  assert.equal(createCaptionTrack(transcript, { layoutPreset: 'socialPop', wordWrap: false }).clips[0].wordWrap, false);
  assert.throws(() => createCaptionTrack(transcript, { wordWrap: 'yes' }), /wordWrap must be a boolean/);
  assert.throws(() => createCaptionTrack(transcript, { layoutPreset: 'unknown' }), /Unknown caption layout preset/);
  for (const style of [
    { fontFamily: 'Arial; color:red' },
    { fontWeight: 950 },
    { lineHeight: 3 },
    { verticalAlign: 'baseline' },
    { paddingPixels: 129 },
    { textOutline: { color: 'red', widthPixels: 2 } },
    { textShadow: { color: '#000', blurPixels: 40, offsetXPixels: 0, offsetYPixels: 0 } },
  ]) {
    const styledTrack = createCaptionTrack(transcript, style);
    const invalidTimeline = structuredClone(valid);
    invalidTimeline.tracks.push({ ...styledTrack, order: 3 });
    assert.throws(() => validateTimeline(invalidTimeline), /Text overlay/);
  }
});

test('applies visual or audio crossfades to adjacent clips', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].allowOverlap = true;
  timeline.tracks[0].clips[1].timelineStart = 2.5;
  const transitioned = crossfadeTimelineClips(timeline, 'video-main', 'clip-one', 'clip-two', 0.5);
  assert.equal(transitioned.tracks[0].clips[0].fadeOutSeconds, undefined);
  assert.equal(transitioned.tracks[0].clips[1].timelineStart, 2.5);
  assert.equal(transitioned.tracks[0].clips[1].fadeInSeconds, 0.5);
  assert.equal(timeline.tracks[0].clips[0].fadeOutSeconds, undefined);
  assert.throws(() => crossfadeTimelineClips(valid, 'video-main', 'clip-one', 'clip-two', 0.5), /already overlap/);
  assert.throws(() => crossfadeTimelineClips({
    ...timeline,
    tracks: [{ ...timeline.tracks[0], clips: timeline.tracks[0].clips.map((clip) => clip.id === 'clip-two' ? { ...clip, timelineStart: 2.51 } : clip) }],
  }, 'video-main', 'clip-one', 'clip-two', 0.5), /already overlap/);
  assert.throws(() => crossfadeTimelineClips(timeline, 'video-main', 'clip-two', 'clip-one', 0.5), /already overlap|ordered/);
  assert.throws(() => crossfadeTimelineClips(timeline, 'video-main', 'clip-one', 'clip-two', 6), /already overlap|cannot exceed/);
});

test('crossfades audio with outgoing volume fade and incoming volume fade', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[1].allowOverlap = true;
  timeline.tracks[1].clips[0].durationSeconds = 3;
  timeline.tracks[1].clips[0].sourceOut = 3;
  timeline.tracks[1].clips.push({ id: 'music-next', assetId: 'camera', sourceIn: 3, sourceOut: 8, timelineStart: 2.5, durationSeconds: 5 });
  const transitioned = crossfadeTimelineClips(timeline, 'music', 'music-bed', 'music-next', 0.5);
  assert.equal(transitioned.tracks[1].clips[0].fadeOutSeconds, 0.5);
  assert.equal(transitioned.tracks[1].clips[1].fadeInSeconds, 0.5);
});

test('assigns separate render lanes to overlaps while preserving track stacking', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[0].allowOverlap = true;
  timeline.tracks[0].clips[1].timelineStart = 2;
  timeline.tracks[0].clips[1].durationSeconds = 5;
  timeline.tracks[0].clips[1].sourceOut = 10;
  const indices = assignRenderTrackIndices(timeline);
  assert.equal(indices.get('video-main/clip-one'), 0);
  assert.equal(indices.get('video-main/clip-two'), 1);
  assert.equal(indices.get('music/music-bed'), 2);
  assert.equal(indices.get('graphics/title'), 3);
});

test('builds one combined audio envelope for track gain, fades, and voice ducking', () => {
  const timeline = structuredClone(valid);
  timeline.tracks[1].volume = 0.5;
  timeline.tracks[1].clips[0].volume = 0.8;
  timeline.tracks[1].clips[0].fadeInSeconds = 0.5;
  timeline.tracks[1].clips[0].fadeOutSeconds = 0.5;
  timeline.tracks.push({ id: 'narration', kind: 'audio', order: 3, clips: [
    { id: 'speech', assetId: 'camera', sourceIn: 0, sourceOut: 2, timelineStart: 1, durationSeconds: 2 },
  ] });
  timeline.audioMix = { ducking: [{ sourceTrackId: 'narration', targetTrackId: 'music', attenuation: 0.25, attackSeconds: 0.1, releaseSeconds: 0.3 }] };
  const envelope = buildAudioVolumeAutomation(timeline, timeline.tracks[1], timeline.tracks[1].clips[0]);
  assert.deepEqual(envelope, [
    { time: 0, volume: 0 },
    { time: 0.5, volume: 0.4 },
    { time: 0.9, volume: 0.4 },
    { time: 1, volume: 0.1 },
    { time: 3, volume: 0.1 },
    { time: 3.3, volume: 0.4 },
    { time: 7.5, volume: 0.4 },
    { time: 8, volume: 0 },
  ]);
  assert.throws(() => validateTimeline({ ...timeline, audioMix: { ducking: [{ sourceTrackId: 'music', targetTrackId: 'missing', attenuation: 0.2 }] } }), /two different audio tracks/);
  assert.throws(() => validateTimeline({ ...timeline, tracks: [{ ...timeline.tracks[0], volume: 0.5 }] }), /audio track/);
});

test('validates signal-aware audio sidechain rules and default settings', () => {
  const timeline = structuredClone(valid);
  timeline.tracks.push({ id: 'narration', kind: 'audio', order: 3, clips: [
    { id: 'speech', assetId: 'camera', sourceIn: 0, sourceOut: 2, timelineStart: 1, durationSeconds: 2 },
  ] });
  timeline.audioMix = { sidechain: [{ sourceTrackId: 'narration', targetTrackId: 'music' }] };
  assert.equal(validateTimeline(timeline), timeline);
  assert.throws(() => validateTimeline({ ...timeline, audioMix: { ducking: [], sidechain: [{ sourceTrackId: 'narration', targetTrackId: 'music', thresholdDb: 1 }] } }), /thresholdDb/);
  assert.throws(() => validateTimeline({ ...timeline, audioMix: { ducking: [], sidechain: [{ sourceTrackId: 'narration', targetTrackId: 'music', ratio: 21 }] } }), /ratio/);
  assert.throws(() => validateTimeline({ ...timeline, audioMix: { ducking: [], sidechain: [{ sourceTrackId: 'narration', targetTrackId: 'music', extra: true }] } }), /unsupported field/);
  assert.throws(() => validateTimeline({ ...timeline, audioMix: { ducking: [], sidechain: [{ sourceTrackId: 'missing', targetTrackId: 'music' }] } }), /two different non-empty audio tracks/);
});

test('validates optional integrated loudness mastering targets', () => {
  assert.deepEqual(validateAudioMastering({ ...valid, audioMastering: {} }), {
    integratedLoudnessLUFS: -16, truePeakDBTP: -1.5, loudnessRangeLU: 11,
  });
  assert.deepEqual(validateAudioMastering({ ...valid, audioMastering: { integratedLoudnessLUFS: -14, truePeakDBTP: -1, loudnessRangeLU: 8 } }), {
    integratedLoudnessLUFS: -14, truePeakDBTP: -1, loudnessRangeLU: 8,
  });
  assert.throws(() => validateAudioMastering({ ...valid, audioMastering: { truePeakDBTP: 1 } }), /truePeakDBTP/);
  assert.deepEqual(validateAudioMastering({ ...valid, audioMastering: {
    equalizer: [{ frequencyHz: 120, gainDB: 3, q: 1.2 }],
    limiter: { limitDBFS: -1, attackMs: 5, releaseMs: 80 },
    channelLayout: 'mono',
  } }), {
    integratedLoudnessLUFS: -16,
    truePeakDBTP: -1.5,
    loudnessRangeLU: 11,
    equalizer: [{ frequencyHz: 120, gainDB: 3, q: 1.2 }],
    limiter: { limitDBFS: -1, attackMs: 5, releaseMs: 80 },
    channelLayout: 'mono',
  });
  for (const equalizer of [
    [{ frequencyHz: 10, gainDB: 1 }],
    [{ frequencyHz: 1000, gainDB: 19 }],
    [{ frequencyHz: 1000, gainDB: 1, q: 0 }],
    [{ frequencyHz: 1000, gainDB: 1, css: '1' }],
  ]) assert.throws(() => validateAudioMastering({ ...valid, audioMastering: { equalizer } }), /equalizer/);
  for (const limiter of [
    { limitDBFS: -21, attackMs: 5, releaseMs: 50 },
    { limitDBFS: -1, attackMs: 0, releaseMs: 50 },
    { limitDBFS: -1, attackMs: 5, releaseMs: 1001 },
    { limitDBFS: -1, attackMs: 5, releaseMs: 50, gain: 3 },
  ]) assert.throws(() => validateAudioMastering({ ...valid, audioMastering: { limiter } }), /limiter/);
  assert.throws(() => validateAudioMastering({ ...valid, audioMastering: { extra: true } }), /unsupported setting/);
  assert.throws(() => validateAudioMastering({ ...valid, audioMastering: { channelLayout: '5.1' } }), /channelLayout/);
  assert.throws(() => validateAudioMastering({ ...valid, tracks: valid.tracks.filter((track) => track.kind !== 'audio'), audioMastering: {} }), /requires at least one audio clip/);
});
