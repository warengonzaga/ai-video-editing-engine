import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAssetProxy,
  createCaptionTrack,
  createVideoProject,
  editTimeline,
  probeMedia,
  registerMediaAsset,
  renderTimelineAsync,
  speedRampDuration,
  timelineForRender,
} from '../src/index.mjs';

async function renderSavedTimelineAsync(projectPath, timeline, outputPath, quality = 'draft', options = {}) {
  writeFileSync(join(projectPath, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  return renderTimelineAsync(projectPath, timeline, outputPath, quality, options);
}

const root = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'aive-render-smoke-'));
process.env.HYPERFRAMES_CACHE_DIR = join(root, '.hyperframes-cache');
if (!process.env.HYPERFRAMES_BROWSER_PATH) {
  const browserCandidates = [
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const localBrowser = browserCandidates.find(existsSync);
  if (localBrowser) process.env.HYPERFRAMES_BROWSER_PATH = localBrowser;
}
const projectRoot = root;
const projectPath = createVideoProject(projectRoot, 'render-smoke', {
  width: 320,
  height: 180,
  fps: 24,
  durationSeconds: 2,
});
const sourceVideoPath = join(root, 'source-video.mp4');
const offsetVideoPath = join(root, 'source-video-offset.mp4');
const sourceVideoWithAudioPath = join(root, 'source-video-with-audio.mp4');
const narrationPath = join(root, 'narration.wav');
const musicPath = join(root, 'music.wav');
const longSyncVideoPath = join(root, 'long-sync-video.mp4');
const longSyncAudioPath = join(root, 'long-sync-audio.wav');
const brollPath = join(root, 'broll.mp4');
const stillPath = join(root, 'still.png');
const outputPath = join(projectPath, 'renders', 'smoke.mp4');
const colorProfileOutputPath = join(projectPath, 'renders', 'smoke-rec2020.mp4');
const speedRamp = [
  { sourceOffset: 0, playbackRate: 1, ease: 'easeInOutCubic' },
  { sourceOffset: 2, playbackRate: 2 },
];
const clipDurationSeconds = speedRampDuration(speedRamp);
const audioCueTimelineSeconds = speedRampDuration(speedRamp, 0, 0.5);
const visualCueFrame = Math.round(audioCueTimelineSeconds * 24);

try {
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=black:size=320x180:rate=24:duration=2',
    '-vf',
    'drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable=between(t\\,0.5\\,0.7),select=not(eq(mod(n\\,5)\\,3))',
    '-fps_mode',
    'vfr',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    sourceVideoPath,
  ]);
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=red:size=320x180:rate=24:duration=2',
    '-vf',
    'setpts=PTS+1/TB',
    '-fps_mode',
    'vfr',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-copyts',
    offsetVideoPath,
  ]);
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(between(t\\,0.5\\,0.7)\\,0.8*sin(2*PI*1000*t)\\,0):s=48000:d=2',
    '-c:a',
    'pcm_s16le',
    narrationPath,
  ]);
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=48000:duration=2',
    '-af',
    'volume=2',
    '-c:a',
    'pcm_s16le',
    musicPath,
  ]);
  runFfmpeg([
    '-i',
    sourceVideoPath,
    '-i',
    narrationPath,
    '-i',
    musicPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-map',
    '2:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:a:1',
    'language=spa',
    '-shortest',
    sourceVideoWithAudioPath,
  ]);
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=black:size=320x180:rate=24:duration=12',
    '-vf',
    'drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable=between(t\\,0.5\\,0.7)+between(t\\,10.5\\,10.7)',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    longSyncVideoPath,
  ]);
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(between(t\\,0.5\\,0.7)+between(t\\,10.5\\,10.7)\\,0.8*sin(2*PI*1000*t)\\,0):s=48000:d=12',
    '-c:a',
    'pcm_s16le',
    longSyncAudioPath,
  ]);
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=yellow:size=320x180:rate=24:duration=1',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    brollPath,
  ]);
  runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:size=160x90:duration=1', '-frames:v', '1', '-update', '1', stillPath]);

  const video = registerMediaAsset(projectPath, sourceVideoPath, { id: 'smoke-video' });
  const audio = registerMediaAsset(projectPath, narrationPath, { id: 'smoke-narration' });
  const broll = registerMediaAsset(projectPath, brollPath, { id: 'smoke-broll' });
  const still = registerMediaAsset(projectPath, stillPath, { id: 'smoke-still' });
  mkdirSync(join(projectPath, 'compositions'), { recursive: true });
  writeFileSync(
    join(projectPath, 'compositions', 'smoke-card.html'),
    `<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>*{box-sizing:border-box}html,body,#smoke-card{margin:0;width:320px;height:180px;overflow:hidden;background:transparent}#smoke-card{position:relative}</style></head><body><div id="smoke-card" data-composition-id="smoke-card" data-start="0" data-duration="0.25" data-width="320" data-height="180"><div style="position:absolute;left:220px;top:120px;width:80px;height:50px;background:#ff00ff"></div></div><script>window.__timelines=window.__timelines||{};window.__timelines['smoke-card']=gsap.timeline({paused:true})</script></body></html>`,
  );
  const videoProxy = createAssetProxy(projectPath, video.id, { maxDimension: 320, crf: 20, frameRate: 24 });
  createAssetProxy(projectPath, broll.id, { maxDimension: 320, crf: 20, frameRate: 24 });
  const sourceVideo = probeMedia(join(projectPath, ...video.path.split('/')));
  const sourceFrameDeltas = getFrameDeltas(join(projectPath, ...video.path.split('/')));
  assert.ok(
    sourceVideo.frameRate < sourceVideo.nominalFrameRate,
    `Expected a VFR source, got ${sourceVideo.frameRate}/${sourceVideo.nominalFrameRate} fps.`,
  );
  assert.ok(
    new Set(sourceFrameDeltas.map((delta) => delta.toFixed(6))).size > 1,
    'Expected variable source frame durations.',
  );
  const project = JSON.parse(readFileSync(join(projectPath, 'meta.json'), 'utf8'));
  const timeline = {
    schemaVersion: 1,
    project,
    assets: [video, audio, broll, still],
    tracks: [
      {
        id: 'main-video',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'source-clip',
            assetId: video.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: clipDurationSeconds,
            speedRamp,
          },
        ],
      },
      {
        id: 'narration',
        kind: 'audio',
        order: 1,
        clips: [
          {
            id: 'narration-clip',
            assetId: audio.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: clipDurationSeconds,
            speedRamp,
          },
        ],
      },
      {
        id: 'smoke-broll-track',
        kind: 'video',
        order: 2,
        clips: [
          {
            id: 'smoke-broll-clip',
            assetId: broll.id,
            sourceIn: 0,
            sourceOut: 0.5,
            timelineStart: 0.7,
            durationSeconds: 0.5,
            x: 0.7,
            y: 0.2,
            width: 0.25,
            height: 0.5,
          },
        ],
      },
      {
        id: 'smoke-still-track',
        kind: 'video',
        order: 3,
        clips: [
          {
            id: 'smoke-still-clip',
            assetId: still.id,
            sourceIn: 0,
            sourceOut: 0.5,
            timelineStart: 1.25,
            durationSeconds: 0.5,
            x: 0.35,
            y: 0.3,
            width: 0.25,
            height: 0.4,
          },
        ],
      },
      {
        id: 'smoke-blend-track',
        kind: 'video',
        order: 4,
        clips: [
          {
            id: 'smoke-screen-clip',
            assetId: still.id,
            sourceIn: 0,
            sourceOut: 0.5,
            timelineStart: audioCueTimelineSeconds,
            durationSeconds: 0.5,
            x: 0.35,
            y: 0.3,
            width: 0.25,
            height: 0.4,
            blendMode: 'screen',
          },
        ],
      },
      {
        id: 'smoke-composition-track',
        kind: 'overlay',
        order: 5,
        clips: [
          {
            id: 'smoke-card-instance',
            composition: 'compositions/smoke-card.html',
            timelineStart: 1.65,
            durationSeconds: 0.25,
          },
        ],
      },
      {
        id: 'captions',
        kind: 'overlay',
        order: 6,
        clips: [
          {
            id: 'smoke-caption',
            timelineStart: 0.1,
            durationSeconds: clipDurationSeconds - 0.2,
            text: 'Engine render smoke',
            fontFamily: 'Arial, sans-serif',
            fontSize: 22,
            x: 0.05,
            y: 0.05,
            width: 0.9,
            height: 0.25,
          },
        ],
      },
    ],
  };

  const render = await renderSavedTimelineAsync(projectPath, timeline, outputPath, 'draft', {
    timeoutSeconds: 180,
    useProxies: true,
  });
  const media = probeMedia(render.output);
  assert.equal(media.width, 320);
  assert.equal(media.height, 180);
  assert.equal(media.hasAudio, true);
  assert.equal(media.frameRate, 24);
  assert.equal(media.videoCodec, 'h264');
  assert.equal(media.audioCodec, 'aac');
  assert.ok(Math.abs(media.durationSeconds - 2) <= 1 / 24, `Unexpected output duration: ${media.durationSeconds}`);
  const meanAudioVolumeDB = measureAudioVolume(render.output);
  assert.ok(meanAudioVolumeDB > -50, `Rendered audio is unexpectedly quiet: ${meanAudioVolumeDB} dB`);
  const beforeCue = readCenterPixel(render.output, Math.max(0, visualCueFrame - 2));
  const atCue = readCenterPixel(render.output, visualCueFrame);
  assert.ok(beforeCue < 80, `Visual cue appeared before its expected start: luma ${beforeCue}`);
  assert.ok(atCue > 180, `Visual cue was missing at its expected start: luma ${atCue}`);
  const blendedPixel = readPixelAt(render.output, visualCueFrame, 150, 90);
  assert.ok(
    blendedPixel.every((channel) => channel > 220),
    `Screen blend did not combine the blue still with the white video beneath it: ${blendedPixel}`,
  );
  const brollPixel = readPixelAt(render.output, Math.round(0.8 * 24), 250, 90);
  assert.ok(
    brollPixel[0] > 180 && brollPixel[1] > 180 && brollPixel[2] < 80,
    `B-roll did not appear above the main footage: ${brollPixel}`,
  );
  const stillPixel = readPixelAt(render.output, Math.round(1.4 * 24), 150, 70);
  assert.ok(
    stillPixel[2] > 180 && stillPixel[0] < 80 && stillPixel[1] < 80,
    `Still image did not appear above the main footage: ${stillPixel}`,
  );
  const compositionPixel = readPixelAt(render.output, Math.round(1.7 * 24), 250, 140);
  assert.ok(
    compositionPixel[0] > 180 && compositionPixel[2] > 180 && compositionPixel[1] < 80,
    `Nested composition did not appear above the media layers: ${compositionPixel}`,
  );

  const rippleProjectPath = createVideoProject(root, 'ripple-render', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const rippleAssets = [
    registerMediaAsset(rippleProjectPath, sourceVideoPath, { id: video.id }),
    registerMediaAsset(rippleProjectPath, narrationPath, { id: audio.id }),
    registerMediaAsset(rippleProjectPath, brollPath, { id: broll.id }),
    registerMediaAsset(rippleProjectPath, stillPath, { id: still.id }),
  ];
  mkdirSync(join(rippleProjectPath, 'compositions'), { recursive: true });
  copyFileSync(
    join(projectPath, 'compositions', 'smoke-card.html'),
    join(rippleProjectPath, 'compositions', 'smoke-card.html'),
  );
  const rippleProject = JSON.parse(readFileSync(join(rippleProjectPath, 'meta.json'), 'utf8'));
  const rippleBaseTimeline = { ...structuredClone(timeline), project: rippleProject, assets: rippleAssets };
  const rippleTimeline = editTimeline(rippleBaseTimeline, {
    type: 'ripple-delete',
    trackId: 'smoke-still-track',
    clipId: 'smoke-still-clip',
  });
  assert.equal(rippleTimeline.project.durationSeconds, 1.5);
  const rippleRender = await renderSavedTimelineAsync(
    rippleProjectPath,
    rippleTimeline,
    join(rippleProjectPath, 'renders', 'ripple-smoke.mp4'),
    'draft',
    { timeoutSeconds: 180 },
  );
  const rippleMedia = probeMedia(rippleRender.output);
  assert.equal(rippleMedia.width, 320);
  assert.equal(rippleMedia.height, 180);
  assert.equal(rippleMedia.hasAudio, true);
  assert.ok(
    Math.abs(rippleMedia.durationSeconds - 1.5) <= 1 / 24,
    `Ripple edit rendered ${rippleMedia.durationSeconds}s instead of 1.5s.`,
  );
  assert.equal(
    JSON.parse(readFileSync(join(rippleProjectPath, 'meta.json'), 'utf8')).durationSeconds,
    2,
    'Timeline rendering must restore the project metadata after a duration-changing edit.',
  );

  const gapProjectPath = createVideoProject(root, 'gap-render', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const gapAssets = [
    registerMediaAsset(gapProjectPath, sourceVideoPath, { id: video.id }),
    registerMediaAsset(gapProjectPath, narrationPath, { id: audio.id }),
    registerMediaAsset(gapProjectPath, brollPath, { id: broll.id }),
    registerMediaAsset(gapProjectPath, stillPath, { id: still.id }),
  ];
  mkdirSync(join(gapProjectPath, 'compositions'), { recursive: true });
  copyFileSync(
    join(projectPath, 'compositions', 'smoke-card.html'),
    join(gapProjectPath, 'compositions', 'smoke-card.html'),
  );
  const gapProject = JSON.parse(readFileSync(join(gapProjectPath, 'meta.json'), 'utf8'));
  const gapBaseTimeline = { ...structuredClone(timeline), project: gapProject, assets: gapAssets };
  const gapTimeline = editTimeline(gapBaseTimeline, { type: 'insert-gap', timelineStart: 0.5, durationSeconds: 0.5 });
  assert.equal(gapTimeline.project.durationSeconds, 2.5);
  const gapRender = await renderSavedTimelineAsync(
    gapProjectPath,
    gapTimeline,
    join(gapProjectPath, 'renders', 'gap-smoke.mp4'),
    'draft',
    { timeoutSeconds: 180 },
  );
  const gapMedia = probeMedia(gapRender.output);
  assert.ok(
    Math.abs(gapMedia.durationSeconds - 2.5) <= 1 / 24,
    `Gap edit rendered ${gapMedia.durationSeconds}s instead of 2.5s.`,
  );
  assert.equal(gapMedia.hasAudio, true);
  const gapLuma = readCenterPixel(gapRender.output, Math.round(0.75 * 24));
  assert.ok(gapLuma < 30, `Inserted timeline gap should render black, got luma ${gapLuma}.`);
  assert.equal(
    JSON.parse(readFileSync(join(gapProjectPath, 'meta.json'), 'utf8')).durationSeconds,
    2,
    'Timeline rendering must restore the project metadata after inserting a gap.',
  );

  const trackStateProjectPath = createVideoProject(root, 'track-state-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const trackStateOutputPath = join(trackStateProjectPath, 'renders', 'track-state.mp4');
  const trackStateVideo = registerMediaAsset(trackStateProjectPath, sourceVideoPath, { id: 'track-state-video' });
  const trackStateNarration = registerMediaAsset(trackStateProjectPath, narrationPath, { id: 'track-state-narration' });
  const trackStateMusic = registerMediaAsset(trackStateProjectPath, musicPath, { id: 'track-state-music' });
  const trackStateProject = JSON.parse(readFileSync(join(trackStateProjectPath, 'meta.json'), 'utf8'));
  const trackStateTimeline = {
    schemaVersion: 1,
    project: trackStateProject,
    assets: [trackStateVideo, trackStateNarration, trackStateMusic],
    audioMix: { sidechain: [{ sourceTrackId: 'track-state-voice', targetTrackId: 'track-state-music-bed' }] },
    tracks: [
      {
        id: 'track-state-picture',
        kind: 'video',
        order: 0,
        visible: false,
        clips: [
          {
            id: 'track-state-visual',
            assetId: trackStateVideo.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
      {
        id: 'track-state-voice',
        kind: 'audio',
        order: 1,
        muted: true,
        clips: [
          {
            id: 'track-state-voice-clip',
            assetId: trackStateNarration.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
      {
        id: 'track-state-music-bed',
        kind: 'audio',
        order: 2,
        muted: true,
        clips: [
          {
            id: 'track-state-music-clip',
            assetId: trackStateMusic.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
      {
        id: 'track-state-graphics',
        kind: 'overlay',
        order: 3,
        visible: false,
        clips: [{ id: 'track-state-title', text: 'Hidden overlay', timelineStart: 0, durationSeconds: 2 }],
      },
    ],
  };
  const trackStateRenderTimeline = timelineForRender(trackStateTimeline);
  assert.equal(trackStateRenderTimeline.audioMix.sidechain.length, 0);
  const trackStateRender = await renderSavedTimelineAsync(
    trackStateProjectPath,
    trackStateTimeline,
    trackStateOutputPath,
    'draft',
    { timeoutSeconds: 180 },
  );
  const trackStateMedia = probeMedia(trackStateRender.output);
  const hiddenLayerPixel = readPixelAt(trackStateRender.output, visualCueFrame, 160, 90);
  const expectedBackgroundPixel = parseHexRgb(trackStateProject.backgroundColor ?? '#000000');
  assert.equal(trackStateMedia.hasAudio, false, 'Muted audio tracks must not create an output audio stream.');
  assert.ok(
    hiddenLayerPixel.every((channel, index) => Math.abs(channel - expectedBackgroundPixel[index]) <= 5),
    `Hidden video and overlay tracks must leave the configured project background visible; expected ${expectedBackgroundPixel}, got ${hiddenLayerPixel}.`,
  );

  const captionProjectPath = createVideoProject(root, 'word-highlight-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const captionOutputPath = join(captionProjectPath, 'renders', 'word-highlight.mp4');
  const captionProject = JSON.parse(readFileSync(join(captionProjectPath, 'meta.json'), 'utf8'));
  const captionBackground = registerMediaAsset(captionProjectPath, sourceVideoPath, { id: 'caption-background' });
  const captionTrack = createCaptionTrack(
    {
      schemaVersion: 1,
      durationSeconds: 2,
      words: [
        { text: 'ONE', start: 0.2, end: 0.5 },
        { text: 'TWO', start: 0.5, end: 0.8 },
        { text: 'THREE', start: 1.2, end: 1.5 },
        { text: 'FOUR', start: 1.5, end: 1.8 },
      ],
    },
    {
      wordsPerCaption: 2,
      wordHighlightColor: '#ff0000',
      color: '#ffffff',
      backgroundColor: 'transparent',
      fontSize: 44,
      x: 0.3,
      y: 0.3,
      width: 0.4,
      height: 0.6,
      paddingPixels: 0,
      layoutPreset: 'socialPop',
    },
  );
  const captionTimeline = {
    schemaVersion: 1,
    project: captionProject,
    assets: [captionBackground],
    tracks: [
      {
        id: 'caption-background-track',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'caption-background-clip',
            assetId: captionBackground.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
      { ...captionTrack, order: 1 },
    ],
  };
  const captionRender = await renderSavedTimelineAsync(
    captionProjectPath,
    captionTimeline,
    captionOutputPath,
    'draft',
    { timeoutSeconds: 180 },
  );
  const captionMedia = probeMedia(captionRender.output);
  assert.equal(captionMedia.hasAudio, false);
  assert.equal(captionTrack.clips[0].wordWrap, true);
  const firstHighlightPixels = maxRedPixelsInRange(captionRender.output, Math.round(0.3 * 24), Math.round(0.7 * 24));
  const secondHighlightPixels = maxRedPixelsInRange(captionRender.output, Math.round(1.3 * 24), Math.round(1.7 * 24));
  assert.ok(
    firstHighlightPixels > 20,
    `The first word highlight was not visible during its timed interval (${firstHighlightPixels} red pixels).`,
  );
  assert.ok(
    secondHighlightPixels > 20,
    `The second word highlight was not visible during its timed interval (${secondHighlightPixels} red pixels).`,
  );
  const firstLineHighlight = redPixelBounds(captionRender.output, Math.round(0.3 * 24));
  const secondLineHighlight = redPixelBounds(captionRender.output, Math.round(0.6 * 24));
  assert.ok(
    firstLineHighlight.count > 20 && secondLineHighlight.count > 20,
    'Both wrapped caption words should render their active highlight.',
  );
  assert.ok(
    Math.abs(firstLineHighlight.top - secondLineHighlight.top) > 20,
    `Word-timed caption text did not wrap onto separate lines: first=${firstLineHighlight.top}, second=${secondLineHighlight.top}`,
  );
  assert.equal(
    countRedPixels(captionRender.output, Math.round(0.1 * 24)),
    0,
    'Word highlight appeared before its timed interval.',
  );
  assert.equal(
    countRedPixels(captionRender.output, Math.round(1.9 * 24)),
    0,
    'Word highlight remained after its timed interval.',
  );

  const audioCueStartSeconds = measureAudioCueStart(render.output);
  assert.ok(
    Math.abs(audioCueStartSeconds - audioCueTimelineSeconds) <= 1 / 24,
    `Audio cue starts at ${audioCueStartSeconds}s instead of ${audioCueTimelineSeconds}s`,
  );
  const colorProfileRender = await renderSavedTimelineAsync(projectPath, timeline, colorProfileOutputPath, 'draft', {
    timeoutSeconds: 180,
    useProxies: true,
    colorProfile: 'rec2020-sdr',
  });
  const colorProfileMedia = probeMedia(colorProfileRender.output);
  assert.equal(colorProfileRender.colorProfile, 'rec2020-sdr');
  assert.equal(colorProfileMedia.colorSpace, 'bt2020nc');
  assert.equal(colorProfileMedia.colorTransfer, 'bt709');
  assert.equal(colorProfileMedia.colorPrimaries, 'bt2020');
  assert.equal(colorProfileMedia.colorRange, 'tv');
  assert.equal(colorProfileMedia.hasAudio, true);
  const videoOnlyProjectPath = createVideoProject(root, 'video-only-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const videoOnlyOutputPath = join(videoOnlyProjectPath, 'renders', 'smoke-video-only.mp4');
  const videoOnlyAsset = registerMediaAsset(videoOnlyProjectPath, sourceVideoPath, { id: 'video-only-source' });
  const videoOnlyProject = JSON.parse(readFileSync(join(videoOnlyProjectPath, 'meta.json'), 'utf8'));
  const videoOnlyTimeline = {
    schemaVersion: 1,
    project: videoOnlyProject,
    assets: [videoOnlyAsset],
    tracks: [
      {
        id: 'video-only-track',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'video-only-clip',
            assetId: videoOnlyAsset.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
    ],
  };
  const videoOnlyRender = await renderSavedTimelineAsync(
    videoOnlyProjectPath,
    videoOnlyTimeline,
    videoOnlyOutputPath,
    'draft',
    {
      timeoutSeconds: 180,
    },
  );
  const videoOnlyMedia = probeMedia(videoOnlyRender.output);
  assert.equal(videoOnlyMedia.hasAudio, false, 'Video-only timeline should not gain an audio stream.');
  assert.equal(videoOnlyMedia.width, 320);
  assert.equal(videoOnlyMedia.height, 180);

  const offsetProjectPath = createVideoProject(root, 'video-offset-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const offsetOutputPath = join(offsetProjectPath, 'renders', 'smoke-video-offset.mp4');
  const offsetAsset = registerMediaAsset(offsetProjectPath, offsetVideoPath, { id: 'video-offset-source' });
  assert.ok(
    Math.abs(offsetAsset.streamTiming.videoStartSeconds - 1) <= 1 / 24,
    `Expected a 1-second video stream offset, got ${offsetAsset.streamTiming.videoStartSeconds}s.`,
  );
  const offsetProject = JSON.parse(readFileSync(join(offsetProjectPath, 'meta.json'), 'utf8'));
  const offsetTimeline = {
    schemaVersion: 1,
    project: offsetProject,
    assets: [offsetAsset],
    tracks: [
      {
        id: 'video-offset-track',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'video-offset-clip',
            assetId: offsetAsset.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
    ],
  };
  const offsetRender = await renderSavedTimelineAsync(offsetProjectPath, offsetTimeline, offsetOutputPath, 'draft', {
    timeoutSeconds: 180,
  });
  const offsetPixel = readPixelAt(offsetRender.output, 6, 160, 90);
  assert.ok(
    offsetPixel[0] > 150 && offsetPixel[1] < 100 && offsetPixel[2] < 100,
    `A 1-second source timestamp offset should not leave the beginning of the rendered clip blank; got ${offsetPixel}.`,
  );
  const webmOutputPath = join(videoOnlyProjectPath, 'renders', 'smoke-vp9.webm');
  const webmRender = await renderSavedTimelineAsync(videoOnlyProjectPath, videoOnlyTimeline, webmOutputPath, 'draft', {
    format: 'webm',
    encoder: { codec: 'vp9', crf: 40 },
    workers: 1,
    timeoutSeconds: 180,
  });
  const webmMedia = probeMedia(webmRender.output);
  assert.equal(webmMedia.videoCodec, 'vp9', 'WebM export should encode VP9.');
  assert.equal(webmMedia.width, 320);
  assert.equal(webmMedia.height, 180);
  assert.equal(webmMedia.hasAudio, false);

  const movOutputPath = join(videoOnlyProjectPath, 'renders', 'smoke-prores.mov');
  const movRender = await renderSavedTimelineAsync(videoOnlyProjectPath, videoOnlyTimeline, movOutputPath, 'draft', {
    format: 'mov',
    encoder: { codec: 'prores' },
    workers: 1,
    timeoutSeconds: 180,
  });
  const movMedia = probeMedia(movRender.output);
  assert.equal(movMedia.videoCodec, 'prores', 'MOV export should encode ProRes.');
  assert.equal(movMedia.width, 320);
  assert.equal(movMedia.height, 180);

  const gifOutputPath = join(videoOnlyProjectPath, 'renders', 'smoke.gif');
  const gifRender = await renderSavedTimelineAsync(videoOnlyProjectPath, videoOnlyTimeline, gifOutputPath, 'draft', {
    format: 'gif',
    workers: 1,
    timeoutSeconds: 180,
  });
  const gifMedia = probeMedia(gifRender.output);
  assert.equal(gifMedia.videoCodec, 'gif', 'GIF export should produce a GIF video stream.');
  assert.equal(gifMedia.width, 320);
  assert.equal(gifMedia.height, 180);
  assert.equal(gifMedia.hasAudio, false, 'GIF export should not contain audio.');

  const pngSequenceOutputPath = join(videoOnlyProjectPath, 'renders', 'smoke-png-sequence');
  const pngSequenceRender = await renderSavedTimelineAsync(
    videoOnlyProjectPath,
    videoOnlyTimeline,
    pngSequenceOutputPath,
    'draft',
    {
      format: 'png-sequence',
      workers: 1,
      timeoutSeconds: 180,
    },
  );
  const pngFrames = readdirSync(pngSequenceRender.output).filter((file) => file.toLowerCase().endsWith('.png'));
  assert.equal(pngFrames.length, 48, 'PNG image-sequence export should contain one frame per timeline frame.');

  const detachedAudioProjectPath = createVideoProject(root, 'detached-audio-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const detachedAudioOutputPath = join(detachedAudioProjectPath, 'renders', 'smoke-detached-audio.mp4');
  const detachableAsset = registerMediaAsset(detachedAudioProjectPath, sourceVideoWithAudioPath, {
    id: 'camera-with-audio',
  });
  const detachedAudioProject = JSON.parse(readFileSync(join(detachedAudioProjectPath, 'meta.json'), 'utf8'));
  const detachedBaseTimeline = {
    schemaVersion: 1,
    project: detachedAudioProject,
    assets: [detachableAsset],
    tracks: [
      {
        id: 'video-main',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'interview-shot',
            assetId: detachableAsset.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
    ],
  };
  const detachedAudioTimeline = editTimeline(detachedBaseTimeline, {
    type: 'detach-audio',
    trackId: 'video-main',
    clipId: 'interview-shot',
    audioTrackId: 'interview-audio',
    audioClipId: 'interview-shot-audio',
    audioStreamIndex: 1,
  });
  assert.equal(detachedAudioTimeline.tracks.find((track) => track.id === 'interview-audio').clips[0].timelineStart, 0);
  const detachedAudioRender = await renderSavedTimelineAsync(
    detachedAudioProjectPath,
    detachedAudioTimeline,
    detachedAudioOutputPath,
    'draft',
    { timeoutSeconds: 180 },
  );
  const detachedAudioMedia = probeMedia(detachedAudioRender.output);
  assert.equal(detachedAudioMedia.hasAudio, true, 'Detached video source audio should render as an audio track.');
  const detachedAudioSamples = decodeMono(detachedAudioRender.output);
  const detachedToneAmplitude = measureToneAmplitude(detachedAudioSamples, 220, 0.2, 0.4);
  const unselectedToneAmplitude = measureToneAmplitude(detachedAudioSamples, 1000, 0.55, 0.65);
  assert.ok(
    detachedToneAmplitude > 0.2,
    `Selected second source audio stream should preserve the 220 Hz tone; got ${detachedToneAmplitude}.`,
  );
  assert.ok(
    unselectedToneAmplitude < 0.05,
    `Unselected first source audio stream should not render; got ${unselectedToneAmplitude}.`,
  );
  const audioOnlyProjectPath = createVideoProject(root, 'audio-only-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 2,
  });
  const audioOnlyOutputPath = join(audioOnlyProjectPath, 'renders', 'smoke-audio-only.mp4');
  const audioOnlyAsset = registerMediaAsset(audioOnlyProjectPath, narrationPath, { id: 'audio-only-source' });
  const musicAsset = registerMediaAsset(audioOnlyProjectPath, musicPath, { id: 'music-only-source' });
  const audioOnlyProject = JSON.parse(readFileSync(join(audioOnlyProjectPath, 'meta.json'), 'utf8'));
  const audioOnlyTimeline = {
    schemaVersion: 1,
    project: audioOnlyProject,
    assets: [audioOnlyAsset, musicAsset],
    tracks: [
      {
        id: 'audio-only',
        kind: 'audio',
        order: 0,
        volume: 0.35,
        clips: [
          {
            id: 'audio-only-clip',
            assetId: audioOnlyAsset.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
      {
        id: 'music-bed',
        kind: 'audio',
        order: 1,
        clips: [
          {
            id: 'music-bed-clip',
            assetId: musicAsset.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            durationSeconds: 2,
          },
        ],
      },
    ],
    audioMix: {
      ducking: [],
      sidechain: [
        {
          sourceTrackId: 'audio-only',
          targetTrackId: 'music-bed',
          thresholdDb: -30,
          ratio: 10,
          attackSeconds: 0.01,
          releaseSeconds: 0.1,
        },
      ],
    },
  };
  const audioOnlyRender = await renderSavedTimelineAsync(
    audioOnlyProjectPath,
    audioOnlyTimeline,
    audioOnlyOutputPath,
    'draft',
    { timeoutSeconds: 180 },
  );
  const audioOnlyMedia = probeMedia(audioOnlyRender.output);
  assert.equal(audioOnlyMedia.hasAudio, true, 'Audio-only timeline should preserve its audio stream.');
  assert.equal(audioOnlyMedia.width, 320);
  assert.equal(audioOnlyMedia.height, 180);
  assert.ok(audioOnlyMedia.durationSeconds > 0);
  const voiceSourceSamples = decodeMono(narrationPath);
  const musicSourceSamples = decodeMono(musicPath);
  const mixedOutputSamples = decodeMono(audioOnlyRender.output);
  const sourceMusicAmplitude = measureToneAmplitude(musicSourceSamples, 220, 0.2, 0.4);
  const expectedMusicChannelAmplitude = sourceMusicAmplitude / Math.sqrt(2);
  const musicBeforeVoiceAmplitude = measureToneAmplitude(mixedOutputSamples, 220, 0.2, 0.4);
  const musicDuringVoiceAmplitude = measureToneAmplitude(mixedOutputSamples, 220, 0.55, 0.65);
  const musicAfterVoiceAmplitude = measureToneAmplitude(mixedOutputSamples, 220, 0.8, 0.85);
  const musicRecoveryAmplitudes = [0.8, 0.9, 1, 1.1].map((start) => ({
    startSeconds: start,
    amplitude: measureToneAmplitude(mixedOutputSamples, 220, start, start + 0.1),
  }));
  const expectedVoiceAmplitude = measureToneAmplitude(voiceSourceSamples, 1000, 0.55, 0.65) * 0.35;
  const renderedVoiceAmplitude = measureToneAmplitude(mixedOutputSamples, 1000, 0.55, 0.65);
  console.log(
    JSON.stringify({
      audioOnlyRecoveryDiagnostics: {
        audioDurationSeconds: audioOnlyMedia.streamTiming.audioDurationSeconds,
        musicBeforeVoiceAmplitude,
        musicDuringVoiceAmplitude,
        musicRecoveryAmplitudes,
      },
    }),
  );
  assert.ok(
    musicBeforeVoiceAmplitude > expectedMusicChannelAmplitude * 0.8 &&
      musicBeforeVoiceAmplitude < expectedMusicChannelAmplitude * 1.2,
    `Un-ducked music should retain its source level after mono-to-stereo center mapping: source=${sourceMusicAmplitude}, expected channel=${expectedMusicChannelAmplitude}, render=${musicBeforeVoiceAmplitude}`,
  );
  assert.ok(
    musicDuringVoiceAmplitude < musicBeforeVoiceAmplitude * 0.65,
    `Music should duck while voice is active: before=${musicBeforeVoiceAmplitude}, during=${musicDuringVoiceAmplitude}`,
  );
  assert.ok(
    musicAfterVoiceAmplitude > musicBeforeVoiceAmplitude * 0.75,
    `Music should recover after the voice cue: before=${musicBeforeVoiceAmplitude}, after=${musicAfterVoiceAmplitude}, windows=${JSON.stringify(musicRecoveryAmplitudes)}`,
  );
  assert.ok(
    renderedVoiceAmplitude > expectedVoiceAmplitude * 0.65 && renderedVoiceAmplitude < expectedVoiceAmplitude * 1.35,
    `Voice track should follow its source samples and 0.35 track gain: expected=${expectedVoiceAmplitude}, render=${renderedVoiceAmplitude}`,
  );
  const longSyncProjectPath = createVideoProject(root, 'long-sync-smoke', {
    width: 320,
    height: 180,
    fps: 24,
    durationSeconds: 12,
  });
  const longSyncOutputPath = join(longSyncProjectPath, 'renders', 'long-sync.mp4');
  const longSyncVideo = registerMediaAsset(longSyncProjectPath, longSyncVideoPath, { id: 'long-sync-video' });
  const longSyncAudio = registerMediaAsset(longSyncProjectPath, longSyncAudioPath, { id: 'long-sync-audio' });
  const longSyncProject = JSON.parse(readFileSync(join(longSyncProjectPath, 'meta.json'), 'utf8'));
  const longSyncTimeline = {
    schemaVersion: 1,
    project: longSyncProject,
    assets: [longSyncVideo, longSyncAudio],
    tracks: [
      {
        id: 'long-sync-picture',
        kind: 'video',
        order: 0,
        clips: [
          {
            id: 'long-sync-visual',
            assetId: longSyncVideo.id,
            sourceIn: 0,
            sourceOut: 12,
            timelineStart: 0,
            durationSeconds: 12,
          },
        ],
      },
      {
        id: 'long-sync-sound',
        kind: 'audio',
        order: 1,
        clips: [
          {
            id: 'long-sync-tone',
            assetId: longSyncAudio.id,
            sourceIn: 0,
            sourceOut: 12,
            timelineStart: 0,
            durationSeconds: 12,
          },
        ],
      },
    ],
  };
  const longSyncRender = await renderSavedTimelineAsync(
    longSyncProjectPath,
    longSyncTimeline,
    longSyncOutputPath,
    'draft',
    { timeoutSeconds: 180 },
  );
  const longSyncMedia = probeMedia(longSyncRender.output);
  assert.equal(longSyncMedia.hasAudio, true);
  assert.equal(longSyncMedia.frameRate, 24);
  assert.ok(Math.abs(longSyncMedia.durationSeconds - 12) <= 1 / 24);
  const longSyncVideoCueFrames = findBrightFrameRuns(longSyncRender.output, 24);
  assert.equal(longSyncVideoCueFrames.length, 2, `Expected two long-sync visual cues; got ${longSyncVideoCueFrames}`);
  const longSyncAudioCueStarts = measureAudioCueStarts(longSyncRender.output).filter(
    (start) => start < longSyncMedia.durationSeconds,
  );
  assert.equal(longSyncAudioCueStarts.length, 2, `Expected two long-sync audio cues; got ${longSyncAudioCueStarts}`);
  const longSyncCueOffsets = longSyncAudioCueStarts.map(
    (audioStart, index) => audioStart - longSyncVideoCueFrames[index] / 24,
  );
  assert.ok(
    longSyncCueOffsets.every((offset) => Math.abs(offset) <= 1 / 24),
    `Start/end A/V cues diverged: ${longSyncCueOffsets}`,
  );
  assert.ok(
    Math.abs(longSyncCueOffsets[1] - longSyncCueOffsets[0]) <= 1 / 24,
    `A/V drift exceeded one frame over 10 seconds: ${longSyncCueOffsets}`,
  );
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        output: render.output,
        rippleDelete: { durationSeconds: rippleMedia.durationSeconds, hasAudio: rippleMedia.hasAudio },
        insertGap: { durationSeconds: gapMedia.durationSeconds, hasAudio: gapMedia.hasAudio, gapLuma },
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        frameRate: media.frameRate,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        sourceAverageFrameRate: sourceVideo.frameRate,
        sourceNominalFrameRate: sourceVideo.nominalFrameRate,
        proxyFrameRate: videoProxy.frameRate,
        hasAudio: media.hasAudio,
        meanAudioVolumeDB,
        speedRampDurationSeconds: clipDurationSeconds,
        visualCueFrame,
        layeredCompositePixels: {
          broll: brollPixel,
          still: stillPixel,
          nestedComposition: compositionPixel,
        },
        trackStateRendering: {
          mutedAudioHasAudio: trackStateMedia.hasAudio,
          hiddenLayerCenterLuma: hiddenLayerPixel,
          sidechainRulesAfterMuting: trackStateRenderTimeline.audioMix.sidechain.length,
        },
        detachedAudio: {
          hasAudio: detachedAudioMedia.hasAudio,
          audioStreamIndex: 1,
          selectedToneAmplitude: detachedToneAmplitude,
          unselectedToneAmplitude,
        },
        audioCueStartSeconds,
        blendModePixel: blendedPixel,
        colorProfileRender: {
          colorProfile: colorProfileRender.colorProfile,
          colorSpace: colorProfileMedia.colorSpace,
          colorTransfer: colorProfileMedia.colorTransfer,
          colorPrimaries: colorProfileMedia.colorPrimaries,
          colorRange: colorProfileMedia.colorRange,
          hasAudio: colorProfileMedia.hasAudio,
        },
        mediaModeRenders: {
          videoOnlyHasAudio: videoOnlyMedia.hasAudio,
          audioOnlyHasAudio: audioOnlyMedia.hasAudio,
          audioOnlyDurationSeconds: audioOnlyMedia.durationSeconds,
          sourceMusicAmplitude: Number(sourceMusicAmplitude.toFixed(4)),
          expectedMusicChannelAmplitude: Number(expectedMusicChannelAmplitude.toFixed(4)),
          musicBeforeVoiceAmplitude: Number(musicBeforeVoiceAmplitude.toFixed(4)),
          musicDuringVoiceAmplitude: Number(musicDuringVoiceAmplitude.toFixed(4)),
          musicAfterVoiceAmplitude: Number(musicAfterVoiceAmplitude.toFixed(4)),
          expectedVoiceAmplitude: Number(expectedVoiceAmplitude.toFixed(4)),
          renderedVoiceAmplitude: Number(renderedVoiceAmplitude.toFixed(4)),
        },
        offsetVideoRender: {
          sourceStartSeconds: offsetAsset.streamTiming.videoStartSeconds,
          firstVisiblePixelAtSeconds: 6 / 24,
          firstVisiblePixel: offsetPixel,
        },
        longSyncValidation: {
          durationSeconds: longSyncMedia.durationSeconds,
          frameRate: longSyncMedia.frameRate,
          videoCueFrames: longSyncVideoCueFrames,
          audioCueStarts: longSyncAudioCueStarts,
          audioVideoOffsetsSeconds: longSyncCueOffsets,
          driftSeconds: longSyncCueOffsets[1] - longSyncCueOffsets[0],
        },
      },
      null,
      2,
    ),
  );
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch (error) {
  console.error(`Render smoke failed. Debug project retained at ${projectPath}`);
  throw error;
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !existsSync(args.at(-1))) {
    throw new Error(`FFmpeg smoke media generation failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

function measureAudioVolume(path) {
  const result = spawnSync(
    'ffmpeg',
    ['-nostdin', '-hide_banner', '-v', 'info', '-i', path, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Could not measure smoke render audio: ${result.error?.message ?? result.stderr.trim()}`);
  }
  const meanVolume = result.stderr.match(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i)?.[1];
  if (!meanVolume || meanVolume.toLowerCase() === 'inf' || meanVolume.toLowerCase() === '-inf') {
    throw new Error('FFmpeg did not report a finite rendered audio level.');
  }
  return Number(meanVolume);
}

function decodeMono(path) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-v',
      'error',
      '-i',
      path,
      '-af',
      'pan=mono|c0=c0',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      'pipe:1',
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0 || result.stdout.length < 4) {
    throw new Error(
      `Could not decode smoke audio samples: ${result.error?.message ?? result.stderr?.toString().trim()}`,
    );
  }
  return new Float32Array(result.stdout.buffer, result.stdout.byteOffset, Math.floor(result.stdout.byteLength / 4));
}

function measureToneAmplitude(samples, frequency, startSeconds, endSeconds) {
  const start = Math.floor(startSeconds * 48000);
  const end = Math.min(samples.length, Math.floor(endSeconds * 48000));
  if (start < 0 || end <= start) throw new Error('Tone measurement window is outside the decoded audio.');
  let inPhase = 0;
  let quadrature = 0;
  for (let index = start; index < end; index++) {
    const angle = (2 * Math.PI * frequency * index) / 48000;
    inPhase += samples[index] * Math.cos(angle);
    quadrature += samples[index] * Math.sin(angle);
  }
  return (2 * Math.hypot(inPhase, quadrature)) / (end - start);
}

function readCenterPixel(path, frameNumber) {
  const [red, green, blue] = readPixelAt(path, frameNumber, 160, 90);
  return Math.round((red + green + blue) / 3);
}

function parseHexRgb(color) {
  if (!/^#[\da-f]{6}$/i.test(color))
    throw new TypeError(`Smoke render expected an opaque six-digit RGB color, got ${color}.`);
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function readPixelAt(path, frameNumber, x, y) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `select=eq(n\\,${frameNumber}),format=rgb24`,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (result.error || result.status !== 0 || result.stdout.length !== 320 * 180 * 3) {
    throw new Error(
      `Could not sample rendered frame ${frameNumber}: ${result.error?.message ?? result.stderr?.toString().trim()}`,
    );
  }
  const pixel = (y * 320 + x) * 3;
  return [result.stdout[pixel], result.stdout[pixel + 1], result.stdout[pixel + 2]];
}

function countRedPixels(path, frameNumber) {
  return redPixelBounds(path, frameNumber).count;
}

function redPixelBounds(path, frameNumber) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `select=eq(n\\,${frameNumber}),format=rgb24`,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (result.error || result.status !== 0 || result.stdout.length !== 320 * 180 * 3) {
    throw new Error(
      `Could not sample caption frame ${frameNumber}: ${result.error?.message ?? result.stderr?.toString().trim()}`,
    );
  }
  let count = 0;
  let top = Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < 180; y++) {
    for (let x = 0; x < 320; x++) {
      const offset = (y * 320 + x) * 3;
      if (result.stdout[offset] > 160 && result.stdout[offset + 1] < 120 && result.stdout[offset + 2] < 120) {
        count++;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { count, top, bottom };
}

function maxRedPixelsInRange(path, firstFrame, lastFrame) {
  let maximum = 0;
  for (let frameNumber = firstFrame; frameNumber <= lastFrame; frameNumber++) {
    maximum = Math.max(maximum, countRedPixels(path, frameNumber));
  }
  return maximum;
}

function measureAudioCueStart(path) {
  return measureAudioCueStarts(path)[0];
}

function measureAudioCueStarts(path) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-v',
      'info',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      'silencedetect=noise=-20dB:d=0.02',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Could not detect rendered audio cue: ${result.error?.message ?? result.stderr.trim()}`);
  }
  const cueStarts = [...result.stderr.matchAll(/silence_end:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  if (cueStarts.length === 0) throw new Error('FFmpeg did not detect the rendered audio cue onset.');
  return cueStarts;
}

function findBrightFrameRuns(path, fps) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      'scale=1:1:flags=area,format=gray',
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0 || result.stdout.length < fps) {
    throw new Error(
      `Could not sample long-sync visual frames: ${result.error?.message ?? result.stderr?.toString().trim()}`,
    );
  }
  const runs = [];
  let start = -1;
  for (let frame = 0; frame <= result.stdout.length; frame++) {
    const bright = frame < result.stdout.length && result.stdout[frame] >= 160;
    if (bright && start < 0) start = frame;
    if (!bright && start >= 0) {
      if (frame - start >= 2) runs.push(start);
      start = -1;
    }
  }
  return runs;
}

function getFrameDeltas(path) {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=best_effort_timestamp_time',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Could not inspect source frame timestamps: ${result.error?.message ?? result.stderr.trim()}`);
  }
  const timestamps = result.stdout.split(/\r?\n/).map(Number).filter(Number.isFinite);
  if (timestamps.length < 3) throw new Error(`Expected several source frames, got ${timestamps.length}.`);
  return timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
}
