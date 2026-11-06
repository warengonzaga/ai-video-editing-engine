#!/usr/bin/env node
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { approveEdl, retimeTranscript } from './edits/retime-transcript.mjs';
import { mediaAnalysisToEdl } from './edits/analysis-to-edl.mjs';
import { detectAcousticSilence } from './edits/detect-silence.mjs';
import { createVideoProject } from './project/create.mjs';
import { listCanvasPresets } from './project/presets.mjs';
import { createAssetProxyAsync, listProjectAssets, registerMediaAssetAsync, relinkProjectAssetAsync, unregisterProjectAsset, verifyProjectAssets } from './project/assets.mjs';
import { probeMediaAsync } from './media/probe.mjs';
import { generateAssetPreview } from './media/preview-assets.mjs';
import { analyzeMediaWithProvider } from './media/analysis-provider.mjs';
import { renderCuts } from './media/render-cuts.mjs';
import { planSilenceCuts } from './edits/plan-silence-cuts.mjs';
import { findMistakeCandidates } from './edits/find-mistake-candidates.mjs';
import { audioLevelCues } from './animation/audio-cues.mjs';
import { rhubarbLipSyncCues, validateRhubarbSpriteStates } from './animation/rhubarb.mjs';
import { createAvatarComposition } from './animation/avatar.mjs';
import { validateTimeline } from './timeline/validate.mjs';
import { inspectTimeline } from './timeline/inspect.mjs';
import { timelineFromEdl } from './timeline/from-edl.mjs';
import { renderTimelineAsync } from './timeline/render.mjs';
import { editTimeline, editTimelineBatch, previewTimelineEdit } from './timeline/edit.mjs';
import { editTimelineFile, getTimelineFileHistory, redoTimelineFile, resetTimelineFileHistory, undoTimelineFile } from './timeline/history-store.mjs';
import { createProjectTimeline } from './timeline/project.mjs';
import { createCaptionTrack } from './timeline/captions.mjs';
import { applyTranscriptCorrections } from './transcript/corrections.mjs';
import { formatSubtitleText } from './transcript/subtitles.mjs';
import { renderEditedProjectAsync } from './timeline/assemble.mjs';
import { importProjectTranscript, lintProject, previewProject, renderProjectAsync, transcribeProject } from './render/hyperframes.mjs';
import { normalizeFrameRate } from './media/frame-rate.mjs';
import { exportTimelineToOtio, importTimelineFromOtio } from './interchange/otio.mjs';
import { getEngineCapabilities } from './capabilities.mjs';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON file ${path}: ${error.message}`);
  }
}

function writeNewFile(path, data) {
  writeExclusiveFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

function writeNewTextFile(path, data) {
  writeExclusiveFile(path, data);
}

function writeExclusiveFile(path, data) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx');
    writeFileSync(descriptor, data);
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
      try { unlinkSync(path); } catch {}
    }
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${path}`);
    throw new Error(`Could not write output ${path}: ${error.message}`);
  }
}

async function runWithInterrupt(run, operation = 'Render') {
  const controller = new AbortController();
  const onInterrupt = () => {
    const error = new Error(`${operation} cancelled by Ctrl+C.`);
    error.name = 'AbortError';
    controller.abort(error);
  };
  process.once('SIGINT', onInterrupt);
  try {
    return await run(controller.signal);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
}

function parseProjectOptions(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--preset' || token === '--fit') {
      if (flags[token]) throw new Error(`${token} can only be specified once.`);
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
      flags[token] = value;
    } else if (token.startsWith('--')) {
      throw new Error(`Unknown project option: ${token}`);
    } else {
      positional.push(token);
    }
  }

  if (flags['--preset']) {
    if (positional.length > 2 || (positional[0] && !/^\d+(?:\.\d+|\/\d+)?$/.test(positional[0]))) {
      throw new Error('Usage: project create <slug> --preset <name> [fps] [durationSeconds] [--fit <contain|cover|fill>]');
    }
    return {
      preset: flags['--preset'],
      fps: normalizeFrameRate(positional[0] ?? '30'),
      durationSeconds: Number(positional[1] ?? 10),
      ...(flags['--fit'] ? { sourceFit: flags['--fit'] } : {}),
    };
  }

  if (positional.length > 3) {
    throw new Error('Usage: project create <slug> [WIDTHxHEIGHT] [fps] [durationSeconds] [--fit <contain|cover|fill>]');
  }
  const [size = '1920x1080', fps = '30', durationSeconds = '10'] = positional;
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) throw new Error('Canvas size must use WIDTHxHEIGHT, such as 1080x1920.');
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    fps: normalizeFrameRate(fps),
    durationSeconds: Number(durationSeconds),
    ...(flags['--fit'] ? { sourceFit: flags['--fit'] } : {}),
  };
}

async function main(args) {
  const [command, ...commandArgs] = args;
  if (command === 'capabilities' && commandArgs.length === 0) {
    console.log(JSON.stringify(getEngineCapabilities(), null, 2));
    return;
  }
  if (command === 'presets' && commandArgs.length === 1 && commandArgs[0] === 'list') {
    console.log(JSON.stringify(listCanvasPresets(), null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'validate' && commandArgs.length === 2) {
    validateTimeline(readJson(resolve(commandArgs[1])));
    console.log('Timeline valid.');
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'create' && commandArgs.length >= 2 && commandArgs.length <= 4) {
    const [, projectPath, secondArgument, thirdArgument] = commandArgs;
    const secondIsDuration = thirdArgument === undefined && secondArgument !== undefined && /^\d+(?:\.\d+)?$/.test(secondArgument);
    const outputPath = secondIsDuration ? undefined : secondArgument;
    const requestedDuration = secondIsDuration ? secondArgument : thirdArgument;
    const options = requestedDuration === undefined ? {} : { durationSeconds: Number(requestedDuration) };
    const timeline = createProjectTimeline(resolve(projectPath), options);
    const destination = resolve(outputPath ?? join(resolve(projectPath), 'timeline.json'));
    writeNewFile(destination, timeline);
    console.log(`Wrote ${destination}`);
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'inspect' && commandArgs.length === 2) {
    console.log(JSON.stringify(inspectTimeline(readJson(resolve(commandArgs[1]))), null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'export-otio' && commandArgs.length === 4) {
    const [, project, timelinePath, outputPath] = commandArgs;
    writeNewTextFile(resolve(outputPath), exportTimelineToOtio(resolve(project), readJson(resolve(timelinePath))));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'import-otio' && commandArgs.length === 4) {
    const [, project, inputPath, outputPath] = commandArgs;
    if (existsSync(resolve(outputPath))) throw new Error(`Output already exists: ${resolve(outputPath)}`);
    writeNewFile(resolve(outputPath), importTimelineFromOtio(resolve(project), resolve(inputPath)));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'edit' && commandArgs.length === 4) {
    const [, inputPath, operationPath, outputPath] = commandArgs;
    const timeline = readJson(resolve(inputPath));
    const operation = readJson(resolve(operationPath));
    const edited = Array.isArray(operation)
      ? editTimelineBatch(timeline, operation)
      : editTimeline(timeline, operation);
    writeNewFile(resolve(outputPath), edited);
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'preview-edit' && commandArgs.length === 3) {
    const [, inputPath, operationPath] = commandArgs;
    console.log(JSON.stringify(previewTimelineEdit(readJson(resolve(inputPath)), readJson(resolve(operationPath))), null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'project-edit' && commandArgs.length >= 3 && commandArgs.length <= 4) {
    const [, timelinePath, operationPath, requestedLimit] = commandArgs;
    const limit = requestedLimit === undefined ? undefined : Number(requestedLimit);
    const result = editTimelineFile(resolve(timelinePath), readJson(resolve(operationPath)), limit === undefined ? {} : { limit });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'undo' && commandArgs.length === 2) {
    console.log(JSON.stringify(undoTimelineFile(resolve(commandArgs[1])), null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'redo' && commandArgs.length === 2) {
    console.log(JSON.stringify(redoTimelineFile(resolve(commandArgs[1])), null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'history' && commandArgs.length >= 2 && commandArgs.length <= 4) {
    const [, timelinePath, action = 'show', requestedLimit] = commandArgs;
    if (action === 'show' && requestedLimit === undefined) {
      console.log(JSON.stringify(getTimelineFileHistory(resolve(timelinePath)), null, 2));
      return;
    }
    if (action === 'reset') {
      const limit = requestedLimit === undefined ? undefined : Number(requestedLimit);
      console.log(JSON.stringify(resetTimelineFileHistory(resolve(timelinePath), limit === undefined ? {} : { limit }), null, 2));
      return;
    }
    throw new Error('Usage: timeline history <timeline.json> [show|reset [limit]]');
  }
  if (command === 'timeline' && commandArgs[0] === 'captions' && commandArgs.length >= 3 && commandArgs.length <= 4) {
    const [, transcriptPath, outputPath, optionsPath] = commandArgs;
    const options = optionsPath ? readJson(resolve(optionsPath)) : {};
    writeNewFile(resolve(outputPath), createCaptionTrack(readJson(resolve(transcriptPath)), options));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'edit' && commandArgs.length >= 4 && commandArgs.length <= 6) {
    const [project, assetId, transcriptPath, edlPath, requestedOutputPath, requestedQuality] = commandArgs;
    const qualityOnly = commandArgs.length === 5 && ['draft', 'standard', 'high'].includes(requestedOutputPath);
    const outputPath = qualityOnly ? undefined : requestedOutputPath;
    const quality = qualityOnly ? requestedOutputPath : requestedQuality ?? 'draft';
    const result = await runWithInterrupt((signal) => renderEditedProjectAsync(resolve(project), assetId, readJson(resolve(transcriptPath)), readJson(resolve(edlPath)), {
      ...(outputPath ? { outputPath: resolve(outputPath) } : {}),
      quality,
      signal,
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'render' && commandArgs.length >= 3 && commandArgs.length <= 6) {
    const [, project, timelinePath, outputPath, quality = 'draft', optionsPath] = commandArgs;
    const options = optionsPath ? readJson(resolve(optionsPath)) : {};
    console.log(JSON.stringify(await runWithInterrupt((signal) => renderTimelineAsync(resolve(project), readJson(resolve(timelinePath)), outputPath ? resolve(outputPath) : undefined, quality, { ...options, signal })), null, 2));
    return;
  }
  if (command === 'timeline' && commandArgs[0] === 'from-edl' && commandArgs.length >= 4 && commandArgs.length <= 5) {
    const [, edlPath, assetId, outputPath, optionsPath] = commandArgs;
    const edl = readJson(resolve(edlPath));
    const options = optionsPath ? readJson(resolve(optionsPath)) : {};
    writeNewFile(resolve(outputPath), timelineFromEdl(edl, assetId, options));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'audio-cues' && commandArgs.length === 2) {
    const [audio, output] = commandArgs;
    writeNewFile(resolve(output), audioLevelCues(resolve(audio)));
    console.log(`Wrote ${resolve(output)}`);
    return;
  }
  if (command === 'lip-sync' && (commandArgs.length === 2 || commandArgs.length === 3)) {
    const [audio, output, optionsPath] = commandArgs;
    const options = optionsPath ? readJson(resolve(optionsPath)) : {};
    writeNewFile(resolve(output), rhubarbLipSyncCues(resolve(audio), options));
    console.log(`Wrote ${resolve(output)}`);
    return;
  }
  if (command === 'avatar' && commandArgs[0] === 'validate-mouth-pack' && commandArgs.length === 2) {
    const specificationPath = resolve(commandArgs[1]);
    const specification = readJson(specificationPath);
    if (!specification || typeof specification !== 'object' || Array.isArray(specification)
        || !specification.states || typeof specification.states !== 'object' || Array.isArray(specification.states)) {
      throw new TypeError('Mouth-pack specification must contain a states object and optional options object.');
    }
    const states = Object.fromEntries(Object.entries(specification.states).map(([state, imagePath]) => [
      state,
      typeof imagePath === 'string' && imagePath.trim()
        ? isAbsolute(imagePath) ? imagePath : resolve(dirname(specificationPath), imagePath)
        : imagePath,
    ]));
    console.log(JSON.stringify(validateRhubarbSpriteStates(states, specification.options ?? {}), null, 2));
    return;
  }
  if (command === 'avatar-compose' && commandArgs.length === 2) {
    const [project, spec] = commandArgs;
    console.log(JSON.stringify(createAvatarComposition(resolve(project), readJson(resolve(spec))), null, 2));
    return;
  }
  if (command === 'retime') {
    const [transcriptPath, edlPath, outputPath, ...extra] = commandArgs;
    if (!transcriptPath || !edlPath || !outputPath || extra.length) {
      throw new Error('Usage: node src/cli.mjs retime <transcript.json> <approved-edl.json> <new-output.json>');
    }
    const transcript = readJson(resolve(transcriptPath));
    const edl = readJson(resolve(edlPath));
    const result = retimeTranscript(transcript, edl);
    const destination = resolve(outputPath);
    writeNewFile(destination, result);
    console.log(`Wrote ${destination}`);
    return;
  }
  if (command === 'project' && commandArgs[0] === 'create' && commandArgs.length >= 2) {
    const [, slug, ...tokens] = commandArgs;
    const options = parseProjectOptions(tokens);
    const projectPath = createVideoProject(process.cwd(), slug, options);
    console.log(`Created ${projectPath}`);
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'register' && commandArgs.length >= 3 && commandArgs.length <= 4) {
    const [, project, media, id] = commandArgs;
    const asset = await runWithInterrupt((signal) => registerMediaAssetAsync(resolve(project), media, { ...(id ? { id } : {}), signal }), 'Asset registration');
    console.log(JSON.stringify(asset, null, 2));
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'list' && commandArgs.length === 2) {
    console.log(JSON.stringify(listProjectAssets(resolve(commandArgs[1])), null, 2));
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'unregister' && commandArgs.length === 3) {
    console.log(JSON.stringify(unregisterProjectAsset(resolve(commandArgs[1]), commandArgs[2]), null, 2));
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'verify' && commandArgs.length === 2) {
    const results = verifyProjectAssets(resolve(commandArgs[1]));
    console.log(JSON.stringify(results, null, 2));
    if (results.some((asset) => asset.status !== 'ok')) process.exitCode = 1;
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'relink' && commandArgs.length === 4) {
    const [, project, assetId, media] = commandArgs;
    const asset = await runWithInterrupt((signal) => relinkProjectAssetAsync(resolve(project), assetId, resolve(media), { signal }), 'Asset relinking');
    console.log(JSON.stringify(asset, null, 2));
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'proxy' && commandArgs[1] === 'create' && commandArgs.length >= 4 && commandArgs.length <= 7) {
    const [, , project, assetId, maxDimension, crf, frameRate] = commandArgs;
    const proxy = await runWithInterrupt((signal) => createAssetProxyAsync(resolve(project), assetId, {
      ...(maxDimension ? { maxDimension: Number(maxDimension) } : {}),
      ...(crf ? { crf: Number(crf) } : {}),
      ...(frameRate ? { frameRate: normalizeFrameRate(frameRate) } : {}),
      signal,
    }), 'Proxy generation');
    console.log(JSON.stringify(proxy, null, 2));
    return;
  }
  if (command === 'asset' && commandArgs[0] === 'preview' && (commandArgs.length === 3 || commandArgs.length === 4)) {
    const [, project, assetId, optionsPath] = commandArgs;
    const options = optionsPath ? readJson(resolve(optionsPath)) : {};
    const preview = await runWithInterrupt((signal) => generateAssetPreview(resolve(project), assetId, { ...options, signal }), 'Asset preview');
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  if (command === 'probe' && commandArgs.length === 1) {
    const media = await runWithInterrupt((signal) => probeMediaAsync(commandArgs[0], { requireVideo: false, signal }), 'Media probe');
    console.log(JSON.stringify(media, null, 2));
    return;
  }
  if (command === 'apply-edl' && commandArgs.length === 3) {
    const [videoPath, edlPath, outputPath] = commandArgs;
    const result = renderCuts(videoPath, readJson(resolve(edlPath)), outputPath);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'plan-silence' && commandArgs.length === 2) {
    const [transcriptPath, outputPath] = commandArgs;
    writeNewFile(resolve(outputPath), planSilenceCuts(readJson(resolve(transcriptPath))));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'detect-silence' && commandArgs.length >= 2 && commandArgs.length <= 3) {
    const [mediaPath, outputPath, optionsPath] = commandArgs;
    writeNewFile(resolve(outputPath), detectAcousticSilence(resolve(mediaPath), optionsPath ? readJson(resolve(optionsPath)) : {}));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'analyze' && commandArgs.length >= 3 && commandArgs.length <= 4) {
    const [mediaPath, providerPath, outputPath, optionsPath] = commandArgs;
    const providerModule = await import(pathToFileURL(resolve(providerPath)).href);
    const provider = providerModule.default ?? providerModule.mediaAnalysisProvider ?? providerModule.provider;
    const result = await analyzeMediaWithProvider(resolve(mediaPath), provider, {
      ...(optionsPath ? { providerOptions: readJson(resolve(optionsPath)) } : {}),
    });
    writeNewFile(resolve(outputPath), result);
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'analysis-to-edl' && commandArgs.length >= 2 && commandArgs.length <= 3) {
    const [analysisPath, outputPath, optionsPath] = commandArgs;
    const result = readJson(resolve(analysisPath));
    writeNewFile(resolve(outputPath), mediaAnalysisToEdl(result.analysis ?? result, optionsPath ? readJson(resolve(optionsPath)) : {}));
    console.log(`Wrote ${resolve(outputPath)} (review required)`);
    return;
  }
  if (command === 'approve-edl' && commandArgs.length === 2) {
    const [candidatePath, outputPath] = commandArgs;
    writeNewFile(resolve(outputPath), approveEdl(readJson(resolve(candidatePath))));
    console.log(`Wrote ${resolve(outputPath)} (approved)`);
    return;
  }
  if (command === 'transcript' && commandArgs[0] === 'correct' && commandArgs.length === 4) {
    const [, transcriptPath, correctionsPath, outputPath] = commandArgs;
    writeNewFile(resolve(outputPath), applyTranscriptCorrections(readJson(resolve(transcriptPath)), readJson(resolve(correctionsPath))));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'transcript' && commandArgs[0] === 'export' && commandArgs.length === 4) {
    const [, transcriptPath, format, outputPath] = commandArgs;
    writeNewTextFile(resolve(outputPath), formatSubtitleText(readJson(resolve(transcriptPath)), format));
    console.log(`Wrote ${resolve(outputPath)}`);
    return;
  }
  if (command === 'mistake-candidates' && commandArgs.length === 1) {
    console.log(JSON.stringify(findMistakeCandidates(readJson(resolve(commandArgs[0]))), null, 2));
    return;
  }
  if (command === 'lint' && commandArgs.length === 1) {
    lintProject(commandArgs[0]);
    return;
  }
  if (command === 'preview' && commandArgs.length === 1) {
    previewProject(commandArgs[0]);
    return;
  }
  if (command === 'render' && commandArgs.length >= 1 && commandArgs.length <= 4) {
    const [projectPath, outputPath, quality = 'draft', optionsPath] = commandArgs;
    const options = optionsPath ? readJson(resolve(optionsPath)) : {};
    console.log(JSON.stringify(await runWithInterrupt((signal) => renderProjectAsync(projectPath, outputPath, quality, { ...options, signal })), null, 2));
    return;
  }
  if (command === 'transcribe' && commandArgs.length >= 2 && commandArgs.length <= 4) {
    const [projectPath, mediaPath, model, language] = commandArgs;
    console.log(JSON.stringify(transcribeProject(projectPath, mediaPath, { model, language }), null, 2));
    return;
  }
  if (command === 'import-transcript' && commandArgs.length === 3) {
    const [projectPath, mediaPath, transcriptPath] = commandArgs;
    console.log(JSON.stringify(importProjectTranscript(projectPath, mediaPath, transcriptPath), null, 2));
    return;
  }
  throw new Error(`Usage: node src/cli.mjs
  project create <slug> [WIDTHxHEIGHT] [fps] [durationSeconds] [--fit <contain|cover|fill>]
  project create <slug> --preset <name> [fps] [durationSeconds] [--fit <contain|cover|fill>]
  presets list | probe <media>
  asset register <project> <media> [assetId] | asset unregister <project> <asset-id>
  asset verify <project>
  asset relink <project> <assetId> <replacement-media>
  asset proxy create <project> <assetId> [maxDimension] [crf] [frameRate]
  edit <project> <assetId> <transcript.json> <approved-edl.json> [output.mp4] [draft|standard|high]
  timeline create <project> [output.json|durationSeconds] [durationSeconds] | timeline validate <timeline.json> | timeline preview-edit <timeline.json> <operation.json> | timeline edit <timeline.json> <operation.json> <new-timeline.json>
  timeline project-edit <timeline.json> <operation.json> [history-limit] | timeline undo|redo <timeline.json> | timeline history <timeline.json> [show|reset [limit]]
  timeline export-otio <project> <timeline.json> <new-output.otio>
  timeline import-otio <project> <input.otio> <new-timeline.json>
  timeline captions <transcript.json> <new-track.json> [options.json]
  timeline from-edl <approved-edl.json> <assetId> <new-timeline.json> [options.json]
  timeline render <project> <timeline.json> [output.mp4] [draft|standard|high]
  transcribe <project> <media> [model] [language] | import-transcript <project> <media> <transcript>
  plan-silence <transcript.json> <new-edl.json> | detect-silence <media> <new-edl.json> [options.json]
  analyze <media> <provider-module.mjs> <new-analysis.json> [provider-options.json]
  avatar validate-mouth-pack <mouth-pack.json> | avatar-compose <project> <spec.json>
  analysis-to-edl <analysis.json> <review-required-edl.json> [options.json]
  approve-edl <reviewed-edl.json> <new-approved-edl.json>
  mistake-candidates <transcript.json> | transcript correct <transcript.json> <corrections.json> <new-transcript.json>
  transcript export <transcript.json> <srt|vtt> <new-subtitles-file>
  apply-edl <media> <approved-edl.json> <output.mp4> | retime <transcript.json> <approved-edl.json> <new-output.json>
  asset preview <project> <asset-id> [options.json] |
  lint <project> | preview <project> | render <project> [output.mp4|output.webm|output.mov|output.gif] [draft|standard|high]`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
