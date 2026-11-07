import { existsSync, linkSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { renderProject, renderProjectAsync } from '../render/hyperframes.mjs';
import { probeMedia, probeMediaAsync } from '../media/probe.mjs';
import { validateTimeline } from './validate.mjs';
import { extractTimelineRange } from './edit.mjs';
import { resolveSourceFit } from './source-fit.mjs';
import { buildAudioVolumeAutomation } from './audio-mix.mjs';
import { frameRateNumber } from '../media/frame-rate.mjs';
import { resolveColorProfile, resolveEncoderArgs, resolveProfileEncoder, resolveRenderControlArgs, resolveRenderFormat, resolveVideoEncoder } from '../render/formats.mjs';
import { hasFfmpegEncoder, hasFfmpegFilter, listFfmpegFilters } from '../media/ffmpeg-capabilities.mjs';
import { assignRenderTrackIndices } from './layers.mjs';
import { masterAudioFile, masterAudioFileAsync, validateAudioMastering } from './audio-mastering.mjs';
import { visualMaskClipPath } from './mask.mjs';
import { transitionClipPath } from './transition.mjs';
import { buildSpeedRampAudioAutomation, speedRampPtsExpression } from './speed-ramp.mjs';
import { applySidechainDuckingProxies, applySidechainDuckingProxiesAsync } from './sidechain-render.mjs';
import { applyAudioTrackEffectProxies, applyAudioTrackEffectProxiesAsync } from './audio-track-effects.mjs';
import { resolveAssetProxies, resolveAssetProxiesAsync } from '../project/assets.mjs';
import { blendModeStyle } from './blend-mode.mjs';
import { timelineForRender } from './track-state.mjs';
import { audioClipEffectRequirements, buildAudioClipEffectFilters } from './audio-effects.mjs';
import { createTimelineRenderControl } from '../render/timeline-control.mjs';
import { runProcess } from '../render/process.mjs';
import { emitRenderProgress } from '../render/progress.mjs';
import { rm } from 'node:fs/promises';

const escapeAttr = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const escapeCssString = (value) => String(value).replace(/[\\"\n\r\f]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
const RENDER_TIMELINE_RANGE = Symbol('renderTimelineRange');

export function renderTimeline(projectPath, timeline, outputPath, quality = 'draft', options = {}) {
  const { [RENDER_TIMELINE_RANGE]: isRangeRender = false, ...renderOptions } = options;
  if (renderOptions.signal !== undefined || renderOptions.timeoutSeconds !== undefined) {
    throw new TypeError('Cancellation and render timeouts require renderTimelineAsync.');
  }
  if (renderOptions.onProgress !== undefined) throw new TypeError('Render progress callbacks require renderTimelineAsync.');
  return renderTimelineWith(projectPath, timeline, outputPath, quality, renderOptions, renderProject, undefined, undefined, isRangeRender);
}

export async function renderTimelineAsync(projectPath, timeline, outputPath, quality = 'draft', options = {}) {
  const { timeoutSeconds, signal, onProgress, [RENDER_TIMELINE_RANGE]: isRangeRender = false, ...renderOptions } = options;
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Render onProgress must be a function.');
  const renderControl = createTimelineRenderControl(signal, timeoutSeconds);
  let prepared;
  try {
    if (!['draft', 'standard', 'high'].includes(quality)) throw new TypeError('Quality must be draft, standard, or high.');
    const { useProxies, ...formatOptions } = renderOptions;
    if (useProxies !== undefined && typeof useProxies !== 'boolean') throw new TypeError('useProxies must be a boolean.');
    resolveRenderControlArgs(formatOptions);
    const outputFormat = resolveRenderFormat(outputPath, formatOptions.format);
    validateTimeline(timeline);
    preflightOutputCapabilities(outputFormat, formatOptions);
    const renderTimeline = timelineForRender(timeline);
    const audioMastering = validateAudioMastering(renderTimeline);
    if (audioMastering && ['gif', 'png-sequence'].includes(outputFormat)) throw new TypeError(`Timeline audioMastering cannot be used with ${outputFormat} output.`);
    if (['gif', 'png-sequence'].includes(outputFormat) && renderTimeline.tracks.some((track) => track.kind === 'audio' && track.clips.length > 0)) throw new TypeError(`${outputFormat} output cannot include audio clips.`);
    emitRenderProgress(onProgress, 'preprocessing', 'started');
    prepared = await prepareTimelineRenderAsync(projectPath, timeline, renderOptions, renderControl, onProgress);
    emitRenderProgress(onProgress, 'preprocessing', 'completed');
    return await renderTimelineWith(projectPath, timeline, outputPath, quality, { ...renderOptions, ...(onProgress ? { onProgress } : {}), signal: renderControl.signal }, renderProjectAsync, renderControl, prepared, isRangeRender);
  } finally {
    if (prepared) await cleanupTemporaryAssetsAsync(prepared.temporaryAssets);
    renderControl.dispose();
  }
}

/** Render a selected project-time window without changing the source timeline. */
export function renderTimelineRange(projectPath, timeline, startSeconds, endSeconds, outputPath, quality = 'draft', options = {}) {
  return renderTimeline(projectPath, extractTimelineRange(timeline, startSeconds, endSeconds), outputPath, quality, { ...options, [RENDER_TIMELINE_RANGE]: true });
}

/** Async, cancellable counterpart to renderTimelineRange. */
export function renderTimelineRangeAsync(projectPath, timeline, startSeconds, endSeconds, outputPath, quality = 'draft', options = {}) {
  return renderTimelineAsync(projectPath, extractTimelineRange(timeline, startSeconds, endSeconds), outputPath, quality, { ...options, [RENDER_TIMELINE_RANGE]: true });
}

function renderTimelineWith(projectPath, timeline, outputPath, quality, options, renderProjectFunction, renderControl, prepared, isRangeRender = false) {
  const root = resolve(projectPath);
  if (options.useProxies !== undefined && typeof options.useProxies !== 'boolean') throw new TypeError('useProxies must be a boolean.');
  const { useProxies, onProgress, ...renderOptions } = options;
  validateTimeline(timeline);
  const renderTimeline = timelineForRender(timeline);
  const proxyRecords = prepared?.proxyRecords ?? (useProxies ? resolveAssetProxies(root, renderTimeline) : new Map());
  const metaPath = join(root, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`Not an Engine project: ${root}`);
  const originalMeta = readFileSync(metaPath);
  const meta = JSON.parse(originalMeta.toString('utf8'));
  for (const field of ['width', 'height']) if (Math.abs(meta[field] - timeline.project[field]) > 1e-6) throw new TypeError(`Timeline project ${field} must match the Engine project.`);
  if (Math.abs(frameRateNumber(meta.fps) - frameRateNumber(timeline.project.fps)) > 1e-9) throw new TypeError('Timeline project fps must match the Engine project.');
  const updateDuration = Math.abs(meta.durationSeconds - timeline.project.durationSeconds) > 1e-6;
  const temporaryMeta = updateDuration ? `${JSON.stringify({ ...meta, durationSeconds: timeline.project.durationSeconds }, null, 2)}\n` : undefined;
  const restoreProjectMeta = () => {
    if (temporaryMeta) writeFileAtomically(metaPath, originalMeta);
  };
  const format = resolveRenderFormat(outputPath, options.format);
  if (!prepared) preflightOutputCapabilities(format, renderOptions);
  const audioMastering = validateAudioMastering(renderTimeline);
  if (audioMastering && ['gif', 'png-sequence'].includes(format)) throw new TypeError(`Timeline audioMastering cannot be used with ${format} output.`);
  if (['gif', 'png-sequence'].includes(format) && renderTimeline.tracks.some((track) => track.kind === 'audio' && track.clips.length > 0)) throw new TypeError(`${format} output cannot include audio clips.`);
  const assetPath = (relative) => {
    const absolute = resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new TypeError(`Asset escapes project: ${relative}`);
    if (!existsSync(absolute)) throw new Error(`Timeline asset does not exist: ${relative}`);
    return relative.split(sep).join('/');
  };
  for (const asset of timeline.assets) assetPath(asset.path);
  const temporaryAssets = prepared?.temporaryAssets ?? [];
  let deferTemporaryCleanup = false;
  const cleanupTemporaryAssets = () => {
    for (const asset of temporaryAssets) rmSync(asset, { force: true });
  };
  try {
  renderControl?.assertActive();
  let renderSpec = prepared?.renderSpec;
  if (!renderSpec) {
    validateTimelineFfmpegRequirements(renderTimeline);
    const proxiedTimeline = applyPersistentVideoProxies(renderTimeline, proxyRecords);
    const playbackTimeline = applyPlaybackRateProxies(root, alignOffsetAudioAssets(root, proxiedTimeline, temporaryAssets), temporaryAssets);
    const effectedTimeline = applyAudioTrackEffectProxies(root, playbackTimeline, temporaryAssets);
    renderSpec = applySidechainDuckingProxies(root, effectedTimeline, temporaryAssets);
  }
  const renderTrackIndices = assignRenderTrackIndices(renderSpec);
  const clips = renderSpec.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))).sort((a, b) => a.track.order - b.track.order || a.clip.timelineStart - b.clip.timelineStart);
  const usedVideoAssetIds = new Set(renderSpec.tracks.flatMap((track) => track.kind === 'video' ? track.clips.map((clip) => clip.assetId) : []));
  const imagePreloads = renderSpec.assets
    .filter((asset) => asset.type === 'image' && usedVideoAssetIds.has(asset.id))
    .map((asset) => `<link rel="preload" as="image" href="${escapeAttr(assetPath(asset.path))}">`)
    .join('');
  const body = clips.map(({ track, clip }) => {
    const renderTrackIndex = renderTrackIndices.get(`${track.id}/${clip.id}`);
    const animatedMask = clip.keyframes?.some((frame) => frame.properties.maskProgress !== undefined) ?? false;
    const maskStyle = clip.mask ? `clip-path:${visualMaskClipPath(clip.mask, animatedMask)};` : '';
    const wipe = clip.transitionIn?.type === 'wipe' ? clip.transitionIn : clip.transitionOut?.type === 'wipe' ? clip.transitionOut : undefined;
    const transitionStyle = wipe ? `clip-path:${transitionClipPath(wipe.direction)};` : '';
    const blendStyle = blendModeStyle(clip);
    const transitionData = `${clip.transitionIn ? ` data-transition-in="${escapeAttr(JSON.stringify(clip.transitionIn))}"` : ''}${clip.transitionOut ? ` data-transition-out="${escapeAttr(JSON.stringify(clip.transitionOut))}"` : ''}`;
    const effects = clip.keyframes?.some((frame) => ['brightness', 'contrast', 'saturation', 'blurPixels', 'hueDegrees'].some((property) => frame.properties[property] !== undefined));
    const common = `id="${escapeAttr(clip.id)}" class="clip${track.kind === 'video' ? ' media-window' : ''}${effects ? ' visual-effects' : ''}" data-start="${clip.timelineStart}" data-duration="${clip.durationSeconds}" data-track-index="${renderTrackIndex}"${transitionData}${keyframeAttributes(clip)}`;
    if (track.kind === 'overlay') {
      if (clip.text !== undefined) {
        const x = (clip.x ?? 0.08) * 100, y = (clip.y ?? 0.76) * 100;
        const width = (clip.width ?? 0.84) * 100, height = (clip.height ?? 0.16) * 100;
        const fontSize = clip.fontSize ?? 54;
        const color = escapeAttr(clip.color ?? '#ffffff');
        const backgroundColor = escapeAttr(clip.backgroundColor ?? 'transparent');
        const textAlign = clip.textAlign ?? 'center';
        const verticalAlign = clip.verticalAlign ?? 'center';
        const alignContent = verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center';
        const alignItems = clip.wordWrap ? 'center' : alignContent;
        const fontFamily = escapeAttr(clip.fontFamily ?? 'system-ui, sans-serif');
        const fontWeight = clip.fontWeight ?? 400;
        const lineHeight = clip.lineHeight ?? 1.15;
        const whiteSpace = clip.wordWrap === false ? 'pre' : 'pre-wrap';
        const paddingPixels = clip.paddingPixels ?? 0;
        const outline = clip.textOutline ? `-webkit-text-stroke:${clip.textOutline.widthPixels}px ${escapeAttr(clip.textOutline.color)};` : '';
        const shadow = clip.textShadow ? `text-shadow:${clip.textShadow.offsetXPixels}px ${clip.textShadow.offsetYPixels}px ${clip.textShadow.blurPixels}px ${escapeAttr(clip.textShadow.color)};` : '';
        const words = clip.wordTimings ?? clip.text.trim().split(/\s+/).map((text) => ({ text }));
        const wordMarkup = (word) => clip.wordTimings
          ? `<span class="caption-word" data-word-start="${clip.timelineStart + word.start}" data-word-end="${clip.timelineStart + word.end}">${escapeAttr(word.text)}</span>`
          : escapeAttr(word.text);
        const lines = clip.wordsPerLine === undefined
          ? [words]
          : Array.from({ length: Math.ceil(words.length / clip.wordsPerLine) }, (_, index) => words.slice(index * clip.wordsPerLine, (index + 1) * clip.wordsPerLine));
        const textMarkup = clip.wordsPerLine === undefined
          ? (clip.wordTimings ? words.map(wordMarkup).join(' ') : escapeAttr(clip.text))
          : lines.map((line) => `<span class="caption-line" style="display:block;width:100%;text-align:${textAlign}">${line.map(wordMarkup).join(' ')}</span>`).join('');
        const highlightAttributes = clip.wordTimings
          ? ` data-word-base-color="${color}" data-word-highlight-color="${escapeAttr(clip.wordHighlightColor)}" data-word-highlight-animation="${escapeAttr(clip.wordHighlightAnimation ?? 'scale')}"`
          : '';
        const display = clip.wordsPerLine === undefined ? 'flex' : 'flex;flex-direction:column;row-gap:0.08em';
        const flexWrap = clip.wordsPerLine !== undefined ? 'nowrap' : clip.wordWrap ? 'wrap' : 'nowrap';
        const itemAlignment = clip.wordsPerLine !== undefined ? 'stretch' : alignItems;
        return `<div ${common}${fadeAttributes(clip)}${highlightAttributes} role="text" aria-label="${escapeAttr(clip.text)}" style="position:absolute;display:${display};flex-wrap:${flexWrap};align-items:${itemAlignment};align-content:${alignContent};column-gap:${clip.wordWrap ? '0.25em' : '0'};justify-content:${textAlign === 'left' ? 'flex-start' : textAlign === 'right' ? 'flex-end' : 'center'};left:${x}%;top:${y}%;width:${width}%;height:${height}%;padding:${paddingPixels}px;font-family:${fontFamily};font-size:${fontSize}px;font-weight:${fontWeight};line-height:${lineHeight};color:${color};background:${backgroundColor};text-align:${textAlign};white-space:${whiteSpace};${outline}${shadow}${maskStyle}${transitionStyle}${blendStyle}">${textMarkup}</div>`;
      }
      const comp = assetPath(clip.composition);
      return `<div ${common}${fadeAttributes(clip)} data-composition-id="${escapeAttr(clip.id)}" data-composition-src="${escapeAttr(comp)}" style="position:absolute;left:0;top:0;width:100%;height:100%;${maskStyle}${transitionStyle}${blendStyle}"></div>`;
    }
    const asset = renderSpec.assets.find((item) => item.id === clip.assetId);
    const assetRelativePath = assetPath(asset.path);
    const src = escapeAttr(assetRelativePath);
    if (track.kind === 'audio') {
      const automation = escapeAttr(JSON.stringify(buildAudioVolumeAutomation(renderTimeline, track, clip)));
      return `<audio ${common} src="${src}" data-media-start="${clip.sourceIn}" data-volume-automation="${automation}"></audio>`;
    }
    const fit = resolveSourceFit(timeline.project, clip, meta.sourceFit);
    const x = Number.isFinite(clip.x) ? clip.x * 100 : 0;
    const y = Number.isFinite(clip.y) ? clip.y * 100 : 0;
    const width = Number.isFinite(clip.width) ? clip.width * 100 : 100;
    const height = Number.isFinite(clip.height) ? clip.height * 100 : 100;
    const objectPosition = 'object-position:var(--engine-object-position-x,50%) var(--engine-object-position-y,50%)';
    const windowStyle = `position:absolute;left:${x}%;top:${y}%;width:${width}%;height:${height}%;overflow:hidden;${maskStyle}${transitionStyle}${blendStyle}`;
    if (asset.type === 'image') {
      const stillSource = escapeAttr(`url("${escapeCssString(assetRelativePath)}")`);
      const stillFit = fit === 'fill' ? '100% 100%' : fit;
      const stillCommon = common.replace('class="clip media-window', 'class="clip media-window still-window');
      return `<div ${stillCommon}${fadeAttributes(clip)} data-still-image="true" style="${windowStyle}--engine-still-source:${stillSource};--engine-still-fit:${stillFit};"></div>`;
    }
    const engineKeyframes = clip.keyframes === undefined ? '' : ` data-engine-keyframes="${escapeAttr(JSON.stringify(clip.keyframes))}"`;
    const engineFades = `${clip.fadeInSeconds !== undefined ? ` data-engine-fade-in-seconds="${clip.fadeInSeconds}"` : ''}${clip.fadeOutSeconds !== undefined ? ` data-engine-fade-out-seconds="${clip.fadeOutSeconds}"` : ''}`;
    const engineTransitions = `${clip.transitionIn ? ` data-engine-transition-in="${escapeAttr(JSON.stringify(clip.transitionIn))}"` : ''}${clip.transitionOut ? ` data-engine-transition-out="${escapeAttr(JSON.stringify(clip.transitionOut))}"` : ''}`;
    return `<div id="${escapeAttr(clip.id)}-window" class="engine-clip media-window${effects ? ' visual-effects' : ''}" data-engine-start="${clip.timelineStart}" data-engine-duration="${clip.durationSeconds}"${engineKeyframes}${engineFades}${engineTransitions} style="${windowStyle}"><video id="${escapeAttr(clip.id)}" src="${src}" muted playsinline data-start="${clip.timelineStart}" data-duration="${clip.durationSeconds}" data-track-index="${renderTrackIndex}" data-media-start="${clip.sourceIn}" data-has-audio="false" data-source-fit="${fit}" style="width:100%;height:100%;object-fit:${fit};${objectPosition}"></video></div>`;
  }).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${meta.width},height=${meta.height}"><title>${escapeAttr(timeline.project.id)}</title>${imagePreloads}<script src="assets/gsap.min.js"></script><style>*{box-sizing:border-box}html,body,#root{margin:0;width:${meta.width}px;height:${meta.height}px;overflow:hidden;background:#000}#root{position:relative;isolation:isolate}.engine-clip{visibility:hidden}.caption-word{display:inline-block;transform-origin:center}.media-window img,.media-window video{transform:scale(var(--engine-zoom,1));transform-origin:var(--engine-object-position-x,50%) var(--engine-object-position-y,50%)}.still-window:before{content:"";position:absolute;inset:0;background-image:var(--engine-still-source);background-repeat:no-repeat;background-size:var(--engine-still-fit);background-position:var(--engine-object-position-x,50%) var(--engine-object-position-y,50%);transform:scale(var(--engine-zoom,1));transform-origin:var(--engine-object-position-x,50%) var(--engine-object-position-y,50%)}.visual-effects{filter:brightness(var(--engine-brightness,1)) contrast(var(--engine-contrast,1)) saturate(var(--engine-saturation,1)) blur(var(--engine-blur,0px)) hue-rotate(var(--engine-hue,0deg))}</style></head><body><div id="root" data-composition-id="root" data-start="0" data-duration="${timeline.project.durationSeconds}" data-width="${meta.width}" data-height="${meta.height}">${body}</div><script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});function visualProps(properties){const result={};for(const [key,value] of Object.entries(properties)){if(key==='x')result.left=(value*100)+'%';else if(key==='y')result.top=(value*100)+'%';else if(key==='width'||key==='height')result[key]=(value*100)+'%';else if(key==='rotationDegrees')result.rotation=value;else if(key==='zoom')result['--engine-zoom']=value;else if(key==='maskProgress')result['--engine-mask-progress']=value;else if(key==='objectPositionX')result['--engine-object-position-x']=(value*100)+'%';else if(key==='objectPositionY')result['--engine-object-position-y']=(value*100)+'%';else if(key==='brightness')result['--engine-brightness']=value;else if(key==='contrast')result['--engine-contrast']=value;else if(key==='saturation')result['--engine-saturation']=value;else if(key==='blurPixels')result['--engine-blur']=value+'px';else if(key==='hueDegrees')result['--engine-hue']=value+'deg';else result[key]=value}return result}function easeValue(ease){if(typeof ease==='string')return ease;const base=gsap.parseEase(ease.name),from=base(ease.from),to=base(ease.to);return progress=>(base(ease.from+(ease.to-ease.from)*progress)-from)/(to-from)}function addTransition(el,spec,edge,start,duration){if(!spec)return;const entering=edge==='in',from=entering?0:1,to=entering?1:0,offset=entering?start:start+duration-spec.durationSeconds,property=spec.type==='fade'?'opacity':'--engine-transition-progress';timeline.set(el,{[property]:from},offset).to(el,{[property]:to,duration:spec.durationSeconds,ease:'none'},offset)}for(const el of document.querySelectorAll('.clip,.engine-clip')){const engineClip=el.classList.contains('engine-clip'),start=Number(engineClip?el.dataset.engineStart:el.dataset.start),duration=Number(engineClip?el.dataset.engineDuration:el.dataset.duration),fadeIn=Number(engineClip?el.dataset.engineFadeInSeconds||0:el.dataset.fadeInSeconds||0),fadeOut=Number(engineClip?el.dataset.engineFadeOutSeconds||0:el.dataset.fadeOutSeconds||0);if(el instanceof HTMLAudioElement){const automation=JSON.parse(el.dataset.volumeAutomation||'[]');if(automation.length){timeline.set(el,{volume:automation[0].volume},automation[0].time);for(let i=1;i<automation.length;i++){const previous=automation[i-1],next=automation[i],span=next.time-previous.time;if(span>0)timeline.to(el,{volume:next.volume,duration:span,ease:'none'},previous.time)}}continue}const keyframes=JSON.parse(engineClip?el.dataset.engineKeyframes||'[]':el.dataset.keyframes||'[]');if(engineClip)timeline.set(el,{visibility:'visible'},start).set(el,{visibility:'hidden'},start+duration);if(keyframes.length){timeline.set(el,visualProps(keyframes[0].properties),start);const propertyTimes=Object.fromEntries(Object.keys(keyframes[0].properties).map(property=>[property,0]));for(let i=1;i<keyframes.length;i++){const next=keyframes[i];for(const [property,value] of Object.entries(next.properties)){const previousTime=propertyTimes[property]??0,span=next.time-previousTime;if(span>0)timeline.to(el,{...visualProps({[property]:value}),duration:span,ease:easeValue(next.eases?.[property]||next.ease||'none')},start+previousTime);else timeline.set(el,visualProps({[property]:value}),start+next.time);propertyTimes[property]=next.time}}}if(fadeIn>0||fadeOut>0){timeline.set(el,{opacity:fadeIn>0?0:1},start);if(fadeIn>0)timeline.to(el,{opacity:1,duration:fadeIn,ease:'none'},start);if(fadeOut>0)timeline.to(el,{opacity:0,duration:fadeOut,ease:'none'},start+duration-fadeOut)}if(el.dataset.wordHighlightColor){const baseColor=el.dataset.wordBaseColor,animation=el.dataset.wordHighlightAnimation;for(const word of el.querySelectorAll('.caption-word')){const wordStart=Number(word.dataset.wordStart),wordEnd=Number(word.dataset.wordEnd);if(animation==='pop'){const popDuration=Math.min(.14,wordEnd-wordStart);timeline.set(word,{color:el.dataset.wordHighlightColor,scale:.92},wordStart).to(word,{scale:1.08,duration:popDuration,ease:'back.out(1.6)'},wordStart)}else timeline.set(word,{color:el.dataset.wordHighlightColor,scale:1.08},wordStart);timeline.set(word,{color:baseColor,scale:1},wordEnd)}}const transitionIn=JSON.parse(engineClip?el.dataset.engineTransitionIn||'null':el.dataset.transitionIn||'null'),transitionOut=JSON.parse(engineClip?el.dataset.engineTransitionOut||'null':el.dataset.transitionOut||'null');addTransition(el,transitionIn,'in',start,duration);addTransition(el,transitionOut,'out',start,duration)}window.__timelines.root=timeline;</script></body></html>`;
  const indexPath = join(root, 'index.html');
  const recordPath = join(root, 'timeline.json');
  const serializedTimeline = `${JSON.stringify(timeline, null, 2)}\n`;
  const recordExists = existsSync(recordPath);
  const indexExisted = existsSync(indexPath);
  const originalHtml = indexExisted ? readFileSync(indexPath) : undefined;
  const restoreProjectHtml = () => {
    if (originalHtml) writeFileAtomically(indexPath, originalHtml);
    else if (existsSync(indexPath)) unlinkSync(indexPath);
  };
  let renderedOutput;
  if (!isRangeRender) {
    if (recordExists) {
      if (readFileSync(recordPath, 'utf8') !== serializedTimeline) throw new Error('Project already has a different timeline.json; use a new project to preserve prior edits.');
    } else {
      writeNewFileAtomically(recordPath, serializedTimeline);
    }
  }
  try {
    if (temporaryMeta) writeFileAtomically(metaPath, temporaryMeta);
    writeFileAtomically(indexPath, html);
    const finishResultSync = (result) => {
      renderedOutput = result.output;
      const expectsAudio = format !== 'gif' && renderTimeline.tracks.some((track) => track.kind === 'audio' && track.clips.length > 0);
      if (format !== 'png-sequence') {
        const rendered = probeMedia(result.output);
        if (rendered.hasAudio !== expectsAudio) throw new Error(`Rendered audio stream ${rendered.hasAudio ? 'exists' : 'is missing'}, but the timeline ${expectsAudio ? 'contains' : 'has no'} audio clips.`);
      }
      if (audioMastering) {
        const mastered = masterAudioFile(result.output, format, audioMastering, timeline.project.fps);
        return { ...result, durationSeconds: mastered.durationSeconds, audioMastering: { ...audioMastering, mode: mastered.loudnessMode } };
      }
      return result;
    };
    const finishResultAsync = async (result) => {
      renderedOutput = result.output;
      renderControl.assertActive();
      const expectsAudio = format !== 'gif' && renderTimeline.tracks.some((track) => track.kind === 'audio' && track.clips.length > 0);
      if (format !== 'png-sequence') {
        emitRenderProgress(onProgress, 'timeline-validation', 'started', { target: 'audio-streams' });
        const rendered = await probeMediaAsync(result.output, { signal: renderControl.signal });
        renderControl.assertActive();
        if (rendered.hasAudio !== expectsAudio) throw new Error(`Rendered audio stream ${rendered.hasAudio ? 'exists' : 'is missing'}, but the timeline ${expectsAudio ? 'contains' : 'has no'} audio clips.`);
        emitRenderProgress(onProgress, 'timeline-validation', 'completed', { target: 'audio-streams' });
      } else {
        emitRenderProgress(onProgress, 'timeline-validation', 'skipped', { reason: 'png-sequence-has-no-audio-stream' });
      }
      if (audioMastering) {
        emitRenderProgress(onProgress, 'mastering', 'started', { target: 'audio' });
        const mastered = await masterAudioFileAsync(result.output, format, audioMastering, timeline.project.fps, renderControl.signal, onProgress);
        renderControl.assertActive();
        emitRenderProgress(onProgress, 'mastering', 'completed', { target: 'audio' });
        return { ...result, durationSeconds: mastered.durationSeconds, audioMastering: { ...audioMastering, mode: mastered.loudnessMode } };
      }
      emitRenderProgress(onProgress, 'mastering', 'skipped', { reason: 'audio-mastering-not-configured' });
      return result;
    };
    renderControl?.assertActive();
    const rendered = renderProjectFunction(root, outputPath, quality, { ...renderOptions, ...(onProgress ? { onProgress } : {}) });
    if (rendered && typeof rendered.then === 'function') {
      deferTemporaryCleanup = true;
      return rendered.then((result) => {
        return finishResultAsync(result).finally(() => {
          if (isRangeRender) restoreProjectHtml();
          restoreProjectMeta();
        });
      }).catch(async (error) => {
        if (renderedOutput && existsSync(renderedOutput)) await rm(renderedOutput, { recursive: true, force: true });
        if (!isRangeRender && !recordExists && existsSync(recordPath)) unlinkSync(recordPath);
        restoreProjectHtml();
        restoreProjectMeta();
        throw error;
      });
    }
    return finishResultSync(rendered);
  } catch (error) {
    if (renderedOutput && existsSync(renderedOutput)) rmSync(renderedOutput, { recursive: true, force: true });
    if (!isRangeRender && !recordExists && existsSync(recordPath)) unlinkSync(recordPath);
    restoreProjectHtml();
    restoreProjectMeta();
    throw error;
  }
  } finally {
    if (!deferTemporaryCleanup) {
      if (!renderControl) cleanupTemporaryAssets();
      if (isRangeRender) restoreProjectHtml();
      restoreProjectMeta();
    }
  }
}

async function prepareTimelineRenderAsync(projectPath, timeline, options, renderControl, onProgress) {
  const root = resolve(projectPath);
  if (options.useProxies !== undefined && typeof options.useProxies !== 'boolean') throw new TypeError('useProxies must be a boolean.');
  validateTimeline(timeline);
  const renderTimeline = timelineForRender(timeline);
  let proxyRecords;
  if (options.useProxies) {
    proxyRecords = await runProgressStage(onProgress, 'proxy-resolution', () => resolveAssetProxiesAsync(root, renderTimeline, { signal: renderControl.signal }));
  } else {
    emitRenderProgress(onProgress, 'proxy-resolution', 'skipped', { reason: 'proxies-disabled' });
    proxyRecords = new Map();
  }
  const temporaryAssets = [];
  try {
    renderControl.assertActive();
    validateTimelineFfmpegRequirements(renderTimeline);
    const proxiedTimeline = applyPersistentVideoProxies(renderTimeline, proxyRecords);
    const alignedTimeline = await runProgressStage(onProgress, 'audio-alignment', () => alignOffsetAudioAssetsAsync(root, proxiedTimeline, temporaryAssets, renderControl));
    const playbackTimeline = await runProgressStage(onProgress, 'playback-processing', () => applyPlaybackRateProxiesAsync(root, alignedTimeline, temporaryAssets, renderControl));
    const effectedTimeline = await runProgressStage(onProgress, 'audio-effects', () => applyAudioTrackEffectProxiesAsync(root, playbackTimeline, temporaryAssets, renderControl));
    const renderSpec = await runProgressStage(onProgress, 'sidechain-processing', () => applySidechainDuckingProxiesAsync(root, effectedTimeline, temporaryAssets, renderControl));
    renderControl.assertActive();
    return { renderSpec, temporaryAssets, proxyRecords };
  } catch (error) {
    await cleanupTemporaryAssetsAsync(temporaryAssets);
    throw error;
  }
}

async function runProgressStage(onProgress, stage, operation) {
  emitRenderProgress(onProgress, stage, 'started');
  const result = await operation();
  emitRenderProgress(onProgress, stage, 'completed');
  return result;
}

function cleanupTemporaryAssets(temporaryAssets) {
  for (const asset of temporaryAssets) rmSync(asset, { force: true });
}

async function cleanupTemporaryAssetsAsync(temporaryAssets) {
  await Promise.all(temporaryAssets.map((asset) => rm(asset, { force: true })));
}

function writeNewFileAtomically(path, content) {
  const temporaryPath = join(dirname(path), `.timeline-render-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    linkSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
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

async function alignOffsetAudioAssetsAsync(root, timeline, temporaryAssets, renderControl) {
  const next = structuredClone(timeline);
  const proxies = new Map();
  const startIndex = temporaryAssets.length;
  try {
    for (const track of next.tracks.filter((item) => item.kind === 'audio')) {
      for (const clip of track.clips) {
        const asset = next.assets.find((item) => item.id === clip.assetId);
        if (!['audio', 'video'].includes(asset?.type) || (asset.type === 'video' && !asset.hasAudio)) continue;
        const streamIndex = clip.audioStreamIndex ?? 0;
        const selectedStream = asset.audioStreams?.[streamIndex];
        const streamTiming = asset.streamTiming ?? {};
        const alignmentStart = asset.type === 'audio' ? 0 : (streamTiming.videoStartSeconds ?? 0);
        const audioStartSeconds = selectedStream?.startSeconds ?? (streamIndex === 0 ? streamTiming.audioStartSeconds : undefined) ?? 0;
        const videoDurationSeconds = streamTiming.videoDurationSeconds;
        const audioDurationSeconds = selectedStream?.durationSeconds ?? (streamIndex === 0 ? streamTiming.audioDurationSeconds : undefined);
        const startsMatch = Math.abs(alignmentStart - audioStartSeconds) <= 1e-6;
        const durationTolerance = Math.max(0.05, 1 / frameRateNumber(timeline.project.fps));
        const durationsMatch = asset.type === 'audio' || !Number.isFinite(videoDurationSeconds) || !Number.isFinite(audioDurationSeconds) || Math.abs(videoDurationSeconds - audioDurationSeconds) <= durationTolerance;
        if (streamIndex === 0 && startsMatch && durationsMatch) {
          delete clip.audioStreamIndex;
          continue;
        }
        const proxyKey = `${asset.id}/${streamIndex}`;
        let proxy = proxies.get(proxyKey);
        if (!proxy) {
          renderControl.assertActive();
          const id = streamIndex === 0 ? `${asset.id}-aligned-audio` : `${asset.id}-audio-stream-${streamIndex}-aligned`;
          if (next.assets.some((item) => item.id === id)) throw new TypeError(`Timeline already contains the reserved audio alignment asset id: ${id}`);
          const relativePath = `assets/.${id}-${randomUUID()}.wav`;
          const absolutePath = join(root, ...relativePath.split('/'));
          const duration = asset.durationSeconds;
          if (!Number.isFinite(duration) || duration <= 0) throw new TypeError(`Asset ${asset.id} needs a known duration to align its offset audio stream.`);
          const filter = `asetpts=PTS-${alignmentStart}/TB,aresample=async=1:first_pts=0,apad=whole_dur=${duration},atrim=duration=${duration}`;
          temporaryAssets.push(absolutePath);
          await runTimelineFfmpeg(root, [
            '-copyts', '-i', join(root, ...asset.path.split('/')), '-map', `0:a:${streamIndex}`,
            '-vn', '-af', filter, '-c:a', 'pcm_s16le', absolutePath,
          ], `Could not prepare audio stream ${streamIndex} for ${asset.id}`, renderControl);
          proxy = { id, path: relativePath, type: 'audio', hasAudio: true, durationSeconds: duration };
          proxies.set(proxyKey, proxy);
          next.assets.push(proxy);
        }
        clip.assetId = proxy.id;
        delete clip.audioStreamIndex;
      }
    }
    validateTimeline(next);
    return next;
  } catch (error) {
    for (const asset of temporaryAssets.splice(startIndex)) rmSync(asset, { force: true });
    throw error;
  }
}

export function alignOffsetAudioAssets(root, timeline, temporaryAssets, renderControl) {
  const next = structuredClone(timeline);
  const proxies = new Map();
  try {
    for (const track of next.tracks.filter((item) => item.kind === 'audio')) {
      for (const clip of track.clips) {
        const asset = next.assets.find((item) => item.id === clip.assetId);
        if (!['audio', 'video'].includes(asset?.type) || (asset.type === 'video' && !asset.hasAudio)) continue;
        const streamIndex = clip.audioStreamIndex ?? 0;
        const selectedStream = asset.audioStreams?.[streamIndex];
        const streamTiming = asset.streamTiming ?? {};
        const alignmentStart = asset.type === 'audio' ? 0 : (streamTiming.videoStartSeconds ?? 0);
        const audioStartSeconds = selectedStream?.startSeconds ?? (streamIndex === 0 ? streamTiming.audioStartSeconds : undefined) ?? 0;
        const videoDurationSeconds = streamTiming.videoDurationSeconds;
        const audioDurationSeconds = selectedStream?.durationSeconds ?? (streamIndex === 0 ? streamTiming.audioDurationSeconds : undefined);
        const startsMatch = Math.abs(alignmentStart - audioStartSeconds) <= 1e-6;
        const durationTolerance = Math.max(0.05, 1 / frameRateNumber(timeline.project.fps));
        const durationsMatch = asset.type === 'audio' || !Number.isFinite(videoDurationSeconds) || !Number.isFinite(audioDurationSeconds) || Math.abs(videoDurationSeconds - audioDurationSeconds) <= durationTolerance;
        if (streamIndex === 0 && startsMatch && durationsMatch) {
          delete clip.audioStreamIndex;
          continue;
        }
        const proxyKey = `${asset.id}/${streamIndex}`;
        let proxy = proxies.get(proxyKey);
        if (!proxy) {
          renderControl?.assertActive();
          const id = streamIndex === 0 ? `${asset.id}-aligned-audio` : `${asset.id}-audio-stream-${streamIndex}-aligned`;
          if (next.assets.some((item) => item.id === id)) throw new TypeError(`Timeline already contains the reserved audio alignment asset id: ${id}`);
          const relativePath = `assets/.${id}-${randomUUID()}.wav`;
          const absolutePath = join(root, ...relativePath.split('/'));
          const duration = asset.durationSeconds;
          if (!Number.isFinite(duration) || duration <= 0) throw new TypeError(`Asset ${asset.id} needs a known duration to align its offset audio stream.`);
          const filter = `asetpts=PTS-${alignmentStart}/TB,aresample=async=1:first_pts=0,apad=whole_dur=${duration},atrim=duration=${duration}`;
          temporaryAssets.push(absolutePath);
          const extraction = spawnSync('ffmpeg', [
            '-nostdin', '-hide_banner', '-v', 'error', '-y', '-copyts', '-i', join(root, ...asset.path.split('/')),
            '-map', `0:a:${streamIndex}`, '-vn', '-af', filter, '-c:a', 'pcm_s16le', absolutePath,
          ], { encoding: 'utf8', windowsHide: true, ...(renderControl ? { timeout: renderControl.timeoutMs() } : {}) });
          renderControl?.assertActive();
          if (extraction.error || extraction.status !== 0) {
            const error = renderControl?.processError(extraction.error);
            throw error ?? new Error(`Could not prepare audio stream ${streamIndex} for ${asset.id}: ${extraction.error?.message ?? extraction.stderr.trim()}`);
          }
          proxy = { id, path: relativePath, type: 'audio', hasAudio: true, durationSeconds: duration };
          proxies.set(proxyKey, proxy);
          next.assets.push(proxy);
        }
        clip.assetId = proxy.id;
        delete clip.audioStreamIndex;
      }
    }
    validateTimeline(next);
    return next;
  } catch (error) {
    for (const asset of temporaryAssets) rmSync(asset, { force: true });
    temporaryAssets.length = 0;
    throw error;
  }
}

function applyPersistentVideoProxies(timeline, proxyRecords) {
  if (proxyRecords.size === 0) return timeline;
  const next = structuredClone(timeline);
  const aliases = new Map();
  for (const track of next.tracks.filter((item) => item.kind === 'video')) {
    for (const clip of track.clips) {
      if (clip.videoStreamIndex !== undefined) continue;
      const proxy = proxyRecords.get(clip.assetId);
      if (!proxy) continue;
      let aliasId = aliases.get(clip.assetId);
      if (!aliasId) {
        const source = next.assets.find((asset) => asset.id === clip.assetId);
        const sourceMetadata = { ...source };
        delete sourceMetadata.proxies;
        aliasId = `proxy-${source.id}-${randomUUID().slice(0, 8)}`;
        aliases.set(clip.assetId, aliasId);
        next.assets.push({
          ...sourceMetadata,
          id: aliasId,
          path: proxy.path,
          width: proxy.width,
          height: proxy.height,
          frameRate: proxy.frameRate ?? source.frameRate,
          nominalFrameRate: proxy.nominalFrameRate ?? proxy.frameRate ?? source.nominalFrameRate,
          videoCodec: 'h264',
          hasAudio: false,
          audioCodec: null,
          sha256: proxy.sha256,
          sizeBytes: proxy.sizeBytes,
          streamTiming: {
            ...source.streamTiming,
            videoStartSeconds: proxy.streamTiming.videoStartSeconds,
            videoDurationSeconds: proxy.streamTiming.videoDurationSeconds,
            videoTimeBase: proxy.streamTiming.videoTimeBase,
            audioStartSeconds: null,
            audioDurationSeconds: null,
            audioTimeBase: null,
          },
        });
      }
      clip.assetId = aliasId;
    }
  }
  validateTimeline(next);
  return next;
}

function applyPlaybackRateProxies(root, timeline, temporaryAssets, renderControl) {
  const next = structuredClone(timeline);
  try {
    for (const track of next.tracks.filter((item) => item.kind === 'video' || item.kind === 'audio')) {
      for (const clip of track.clips) {
        const rate = clip.playbackRate ?? 1;
        const hasSpeedRamp = clip.speedRamp !== undefined;
        const reverse = clip.reverse === true;
        const isVideo = track.kind === 'video';
        const videoStreamIndex = isVideo ? clip.videoStreamIndex : undefined;
        const effectFilters = isVideo ? [] : buildAudioClipEffectFilters(clip.audioEffects);
        if (!hasSpeedRamp && rate === 1 && !reverse && effectFilters.length === 0 && videoStreamIndex === undefined) continue;
        renderControl?.assertActive();
        const source = next.assets.find((item) => item.id === clip.assetId);
        const operation = hasSpeedRamp ? 'ramp' : reverse ? 'reverse' : effectFilters.length ? 'effects' : videoStreamIndex !== undefined ? 'video-stream' : 'rate';
        const id = `${operation}-${track.id}-${clip.id}-${randomUUID().slice(0, 8)}`;
        if (next.assets.some((item) => item.id === id)) throw new TypeError(`Timeline already contains the reserved playback proxy asset id: ${id}`);
        const extension = isVideo ? '.mp4' : '.wav';
        const relativePath = `assets/.${id}-${randomUUID()}${extension}`;
        const absolutePath = join(root, ...relativePath.split('/'));
        const input = join(root, ...source.path.split('/'));
        let filters;
        if (hasSpeedRamp && isVideo) {
          filters = ['-vf', speedRampPtsExpression(clip.speedRamp), '-an', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p'];
        } else if (hasSpeedRamp) {
          const commandRelativePath = `assets/.${id}-${randomUUID()}.txt`;
          const commandAbsolutePath = join(root, ...commandRelativePath.split('/'));
          const automation = buildSpeedRampAudioAutomation(clip.speedRamp, commandRelativePath);
          writeFileSync(commandAbsolutePath, automation.commandContents, { flag: 'wx' });
          temporaryAssets.push(commandAbsolutePath);
          const audioFilter = `atrim=start=${clip.sourceIn}:end=${clip.sourceOut},asetpts=PTS-STARTPTS,${automation.filters},aresample=48000${effectFilters.length ? `,${effectFilters.join(',')}` : ''},apad=whole_dur=${clip.durationSeconds},atrim=duration=${clip.durationSeconds}`;
          filters = ['-af', audioFilter, '-vn', '-c:a', 'pcm_s16le'];
        } else {
          filters = isVideo
            ? ['-vf', `${reverse ? 'reverse,' : ''}setpts=(PTS-STARTPTS)/${rate}`, '-an', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p']
            : ['-af', `atrim=start=${clip.sourceIn}:end=${clip.sourceOut},asetpts=PTS-STARTPTS,${reverse ? 'areverse,' : ''}${atempoFilter(rate)},aresample=48000${effectFilters.length ? `,${effectFilters.join(',')}` : ''}`, '-vn', '-c:a', 'pcm_s16le'];
        }
        temporaryAssets.push(absolutePath);
        const extraction = spawnSync('ffmpeg', [
          '-nostdin', '-hide_banner', '-v', 'error', '-y',
          ...(isVideo ? ['-ss', String(clip.sourceIn)] : []), '-i', input,
          ...(isVideo ? ['-t', String(clip.sourceOut - clip.sourceIn), '-map', `0:v:${videoStreamIndex ?? 0}`] : ['-map', `0:a:${clip.audioStreamIndex ?? 0}`]),
          ...filters, absolutePath,
        ], { encoding: 'utf8', windowsHide: true, cwd: root, ...(renderControl ? { timeout: renderControl.timeoutMs() } : {}) });
        renderControl?.assertActive();
        if (extraction.error || extraction.status !== 0) {
          const error = renderControl?.processError(extraction.error);
          throw error ?? new Error(`Could not create playback proxy for clip ${clip.id}: ${extraction.error?.message ?? extraction.stderr.trim()}`);
        }
        next.assets.push({ id, path: relativePath, type: isVideo ? 'video' : 'audio', hasAudio: !isVideo, durationSeconds: clip.durationSeconds });
        clip.assetId = id;
        clip.sourceIn = 0;
        clip.sourceOut = clip.durationSeconds;
        delete clip.playbackRate;
        delete clip.speedRamp;
        delete clip.reverse;
        delete clip.videoStreamIndex;
        delete clip.audioEffects;
      }
    }
    validateTimeline(next);
    return next;
  } catch (error) {
    for (const asset of temporaryAssets) rmSync(asset, { force: true });
    temporaryAssets.length = 0;
    throw error;
  }
}

async function applyPlaybackRateProxiesAsync(root, timeline, temporaryAssets, renderControl) {
  const next = structuredClone(timeline);
  const startIndex = temporaryAssets.length;
  try {
    for (const track of next.tracks.filter((item) => item.kind === 'video' || item.kind === 'audio')) {
      for (const clip of track.clips) {
        const rate = clip.playbackRate ?? 1;
        const hasSpeedRamp = clip.speedRamp !== undefined;
        const reverse = clip.reverse === true;
        const isVideo = track.kind === 'video';
        const videoStreamIndex = isVideo ? clip.videoStreamIndex : undefined;
        const effectFilters = isVideo ? [] : buildAudioClipEffectFilters(clip.audioEffects);
        if (!hasSpeedRamp && rate === 1 && !reverse && effectFilters.length === 0 && videoStreamIndex === undefined) continue;
        renderControl.assertActive();
        const source = next.assets.find((item) => item.id === clip.assetId);
        const operation = hasSpeedRamp ? 'ramp' : reverse ? 'reverse' : effectFilters.length ? 'effects' : videoStreamIndex !== undefined ? 'video-stream' : 'rate';
        const id = `${operation}-${track.id}-${clip.id}-${randomUUID().slice(0, 8)}`;
        if (next.assets.some((item) => item.id === id)) throw new TypeError(`Timeline already contains the reserved playback proxy asset id: ${id}`);
        const extension = isVideo ? '.mp4' : '.wav';
        const relativePath = `assets/.${id}-${randomUUID()}${extension}`;
        const absolutePath = join(root, ...relativePath.split('/'));
        const input = join(root, ...source.path.split('/'));
        let filters;
        if (hasSpeedRamp && isVideo) {
          filters = ['-vf', speedRampPtsExpression(clip.speedRamp), '-an', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p'];
        } else if (hasSpeedRamp) {
          const commandRelativePath = `assets/.${id}-${randomUUID()}.txt`;
          const commandAbsolutePath = join(root, ...commandRelativePath.split('/'));
          const automation = buildSpeedRampAudioAutomation(clip.speedRamp, commandRelativePath);
          writeFileSync(commandAbsolutePath, automation.commandContents, { flag: 'wx' });
          temporaryAssets.push(commandAbsolutePath);
          const audioFilter = `atrim=start=${clip.sourceIn}:end=${clip.sourceOut},asetpts=PTS-STARTPTS,${automation.filters},aresample=48000${effectFilters.length ? `,${effectFilters.join(',')}` : ''},apad=whole_dur=${clip.durationSeconds},atrim=duration=${clip.durationSeconds}`;
          filters = ['-af', audioFilter, '-vn', '-c:a', 'pcm_s16le'];
        } else {
          filters = isVideo
            ? ['-vf', `${reverse ? 'reverse,' : ''}setpts=(PTS-STARTPTS)/${rate}`, '-an', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p']
            : ['-af', `atrim=start=${clip.sourceIn}:end=${clip.sourceOut},asetpts=PTS-STARTPTS,${reverse ? 'areverse,' : ''}${atempoFilter(rate)},aresample=48000${effectFilters.length ? `,${effectFilters.join(',')}` : ''}`, '-vn', '-c:a', 'pcm_s16le'];
        }
        const args = [
          ...(isVideo ? ['-ss', String(clip.sourceIn)] : []), '-i', input,
          ...(isVideo ? ['-t', String(clip.sourceOut - clip.sourceIn), '-map', `0:v:${videoStreamIndex ?? 0}`] : ['-map', `0:a:${clip.audioStreamIndex ?? 0}`]),
          ...filters, absolutePath,
        ];
        temporaryAssets.push(absolutePath);
        await runTimelineFfmpeg(root, args, `Could not create playback proxy for clip ${clip.id}`, renderControl);
        next.assets.push({ id, path: relativePath, type: isVideo ? 'video' : 'audio', hasAudio: !isVideo, durationSeconds: clip.durationSeconds });
        clip.assetId = id;
        clip.sourceIn = 0;
        clip.sourceOut = clip.durationSeconds;
        delete clip.playbackRate;
        delete clip.speedRamp;
        delete clip.reverse;
        delete clip.videoStreamIndex;
        delete clip.audioEffects;
      }
    }
    validateTimeline(next);
    return next;
  } catch (error) {
    for (const asset of temporaryAssets.splice(startIndex)) rmSync(asset, { force: true });
    throw error;
  }
}

async function runTimelineFfmpeg(root, args, message, renderControl) {
  try {
    renderControl.assertActive();
    await runProcess('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...args], {
      cwd: root,
      signal: renderControl.signal,
      stdio: 'capture',
    });
  } catch (error) {
    if (renderControl.signal.aborted) throw renderControl.signal.reason ?? error;
    throw new Error(`${message}: ${error.message}`, { cause: error });
  }
}

function validateTimelineFfmpegRequirements(timeline) {
  const requiredFilters = new Set();
  if (timeline.audioMix?.sidechain?.length) requiredFilters.add('sidechaincompress');
  if (timeline.audioMastering) {
    requiredFilters.add('loudnorm');
    if (timeline.audioMastering.equalizer?.length) requiredFilters.add('equalizer');
    if (timeline.audioMastering.limiter) requiredFilters.add('alimiter');
    if (timeline.audioMastering.channelLayout) requiredFilters.add('aresample');
  }
  for (const track of timeline.tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      if (clip.reverse === true) requiredFilters.add(track.kind === 'video' ? 'reverse' : 'areverse');
      if (track.kind === 'audio') {
        for (const filter of audioClipEffectRequirements([...(clip.audioEffects ?? []), ...(track.audioEffects ?? [])])) requiredFilters.add(filter);
        if (clip.speedRamp) requiredFilters.add('rubberband');
      }
    }
  }
  if (requiredFilters.size === 0) return;
  const availableFilters = listFfmpegFilters();
  for (const filter of requiredFilters) {
    if (!availableFilters.has(filter)) {
      const feature = ({
        rubberband: 'pitch-preserving audio speed ramps',
        afftdn: 'audio denoise',
        stereotools: 'audio stereo balance',
        equalizer: 'audio equalization',
        highpass: 'audio high-pass filtering',
        lowpass: 'audio low-pass filtering',
        acompressor: 'audio compression',
        sidechaincompress: 'signal-aware sidechain compression',
        loudnorm: 'audio loudness mastering',
        alimiter: 'audio peak limiting',
        aresample: 'audio output channel mapping',
        reverse: 'video reverse playback',
        areverse: 'audio reverse playback',
      })[filter] ?? 'the requested audio/video effect';
      throw new Error(`${feature} requires the FFmpeg ${filter} filter, but it is unavailable in the current build.`);
    }
  }
}

function preflightOutputCapabilities(format, options) {
  const encoderSettings = options.encoder ?? {};
  const videoEncoder = resolveVideoEncoder(format, encoderSettings);
  const colorProfile = resolveColorProfile(options.colorProfile, format);
  const finalEncoder = colorProfile ? resolveProfileEncoder(format, videoEncoder, colorProfile) : videoEncoder;
  if (finalEncoder.codec) hasFfmpegEncoder(finalEncoder.codec);
  if (colorProfile && !hasFfmpegFilter(colorProfile.requiredFilter)) {
    throw new Error(`The ${colorProfile.id} color profile requires an FFmpeg build with the ${colorProfile.requiredFilter} filter.`);
  }
  resolveEncoderArgs(format, encoderSettings);
}

function atempoFilter(playbackRate) {
  const filters = [];
  let remaining = playbackRate;
  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining}`);
  return filters.join(',');
}

function fadeAttributes(clip) {
  return `${clip.fadeInSeconds !== undefined ? ` data-fade-in-seconds="${clip.fadeInSeconds}"` : ''}${clip.fadeOutSeconds !== undefined ? ` data-fade-out-seconds="${clip.fadeOutSeconds}"` : ''}`;
}

function keyframeAttributes(clip) {
  return clip.keyframes === undefined ? '' : ` data-keyframes="${escapeAttr(JSON.stringify(clip.keyframes))}"`;
}
