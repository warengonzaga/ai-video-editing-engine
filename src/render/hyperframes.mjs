import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { cp, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { probeMedia, probeMediaAsync } from '../media/probe.mjs';
import { createFfmpegProgressParser, emitRenderProgress } from './progress.mjs';
import { normalizeTranscript } from '../transcript/normalize.mjs';
import { parseSubtitleText } from '../transcript/subtitles.mjs';
import { frameRateNumber } from '../media/frame-rate.mjs';
import { resolveColorProfile, resolveEncoderArgs, resolveProfileEncoder, resolveRenderControlArgs, resolveRenderFormat, resolveVideoEncoder } from './formats.mjs';
import { hasFfmpegEncoder, hasFfmpegFilter } from '../media/ffmpeg-capabilities.mjs';
import { runProcess } from './process.mjs';
import { fingerprintRenderProject, prepareRenderCheckpoint, removeRenderCheckpoint, restoreRenderCheckpoint, saveRenderCheckpoint } from './checkpoints.mjs';

const require = createRequire(import.meta.url);

export function lintProject(projectPath) {
  return runHyperframes(['lint'], projectPath);
}

export function previewProject(projectPath) {
  return runHyperframes(['preview'], projectPath);
}

export function doctorHyperframes(projectPath = process.cwd()) {
  return runHyperframes(['doctor'], projectPath);
}

export function importProjectTranscript(projectPath, mediaPath, transcriptPath) {
  const project = resolve(projectPath);
  const media = probeMedia(mediaPath, { requireVideo: false });
  const inputPath = resolve(transcriptPath);
  const inputExtension = extname(inputPath).toLowerCase();
  if (!existsSync(join(project, 'meta.json')) || !existsSync(join(project, 'index.html'))) throw new Error(`Not a video project: ${project}`);
  const rawPath = join(project, 'transcript.json');
  const outputPath = join(project, 'transcripts', 'transcript.json');
  if (existsSync(rawPath) || existsSync(outputPath)) {
    throw new Error('This project already has a transcript; create a new project to preserve the existing edit.');
  }
  const granularity = ['.srt', '.vtt'].includes(inputExtension) ? 'cue' : 'word';
  const raw = granularity === 'cue'
    ? parseSubtitleText(readFileSync(inputPath, 'utf8'), inputExtension.slice(1))
    : JSON.parse(readFileSync(inputPath, 'utf8'));
  const transcript = normalizeTranscript(raw, media.durationSeconds, granularity);
  writeFileSync(outputPath, `${JSON.stringify(transcript, null, 2)}\n`, { flag: 'wx' });
  return { transcriptPath: outputPath, wordCount: transcript.words.length, durationSeconds: transcript.durationSeconds };
}

export function transcribeProject(projectPath, mediaPath, options = {}) {
  const project = resolve(projectPath);
  const media = probeMedia(mediaPath, { requireVideo: false });
  const args = ['transcribe', resolve(mediaPath), '--dir', project, '--json'];
  if (options.model) args.push('--model', options.model);
  if (options.language) args.push('--language', options.language);
  return processTranscript(project, resolve(mediaPath), media.durationSeconds, args);
}

export function renderProject(projectPath, outputPath, quality = 'draft', options = {}) {
  if (options.resumeCheckpoint === true) throw new TypeError('Resumable checkpoints require renderProjectAsync.');
  if (options.signal !== undefined || options.timeoutSeconds !== undefined) {
    throw new TypeError('Cancellation and render timeouts require renderProjectAsync.');
  }
  if (options.onProgress !== undefined) throw new TypeError('Render progress callbacks require renderProjectAsync.');
  const project = resolve(projectPath);
  const indexPath = join(project, 'index.html');
  const metaPath = join(project, 'meta.json');
  if (!existsSync(indexPath) || !existsSync(metaPath)) {
    throw new Error(`Not a video project: ${project}`);
  }
  if (!['draft', 'standard', 'high'].includes(quality)) {
    throw new TypeError('Quality must be draft, standard, or high.');
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const output = resolve(outputPath ?? join(project, `renders/draft.${options.format ?? 'mp4'}`));
  const format = resolveRenderFormat(output, options.format);
  const encoderSettings = options.encoder ?? {};
  const videoEncoder = resolveVideoEncoder(format, encoderSettings);
  const colorProfile = resolveColorProfile(options.colorProfile, format);
  const finalEncoder = colorProfile ? resolveProfileEncoder(format, videoEncoder, colorProfile) : videoEncoder;
  if (finalEncoder.codec) hasFfmpegEncoder(finalEncoder.codec);
  if (colorProfile && !hasFfmpegFilter(colorProfile.requiredFilter)) throw new Error(`The ${colorProfile.id} color profile requires an FFmpeg build with the ${colorProfile.requiredFilter} filter.`);
  const encoderArgs = resolveEncoderArgs(format, encoderSettings);
  const renderControlArgs = resolveRenderControlArgs(options);
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });
  const pngSequence = format === 'png-sequence';
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'aive-render-'));
  const temporaryOutput = pngSequence
    ? join(temporaryDirectory, 'frames')
    : join(temporaryDirectory, `render.${format}`);
  const encodedOutput = finalEncoder.codec
    ? join(temporaryDirectory, `encoded.${format}`)
    : undefined;
  let outputCreated = false;

  try {
    runHyperframes(['render', '--format', format, '--fps', String(meta.fps), '--quality', quality, ...renderControlArgs, ...encoderArgs, '--output', temporaryOutput], project);
    if (pngSequence) {
      const frames = readdirSync(temporaryOutput, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'));
      const expectedFrames = Math.round(meta.durationSeconds * frameRateNumber(meta.fps ?? 30));
      if (frames.length !== expectedFrames || frames.length === 0) throw new Error(`PNG sequence has ${frames.length} frames; expected ${expectedFrames}.`);
      for (const frame of frames) {
        const data = readFileSync(join(temporaryOutput, frame.name));
        if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
            || data.readUInt32BE(16) !== meta.width || data.readUInt32BE(20) !== meta.height) {
          throw new Error(`PNG sequence frame ${frame.name} has an invalid signature or dimensions.`);
        }
      }
      if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
      publishPngSequenceSync(temporaryOutput, output, outputDir);
      return { project, output, format, durationSeconds: meta.durationSeconds, width: meta.width, height: meta.height, frameRate: frameRateNumber(meta.fps), frameCount: frames.length };
    }
    if (finalEncoder.codec) encodeVideoFile(temporaryOutput, encodedOutput, format, finalEncoder, colorProfile);
    const rendered = probeMedia(encodedOutput ?? temporaryOutput);
    const expectedFps = frameRateNumber(meta.fps ?? 30);
    if (Math.abs(rendered.durationSeconds - meta.durationSeconds) > Math.max(0.15, 1 / expectedFps)) {
      throw new Error(`Rendered duration ${rendered.durationSeconds.toFixed(3)}s does not match project duration ${meta.durationSeconds}s.`);
    }
    if (rendered.width !== meta.width || rendered.height !== meta.height) {
      throw new Error(`Rendered canvas ${rendered.width}×${rendered.height} does not match project canvas ${meta.width}×${meta.height}.`);
    }
    const renderedFrameRate = rendered.videoCodec === 'gif'
      ? rendered.nominalFrameRate ?? rendered.frameRate
      : rendered.frameRate;
    if (renderedFrameRate && Math.abs(renderedFrameRate - expectedFps) > 0.001) {
      throw new Error(`Rendered frame rate ${renderedFrameRate} fps does not match project frame rate ${meta.fps} fps.`);
    }
    const expectedCodec = { h264: 'h264', h265: 'hevc', vp9: 'vp9', prores: 'prores' }[finalEncoder.codecId];
    if (expectedCodec && rendered.videoCodec !== expectedCodec) {
      throw new Error(`Rendered video codec ${rendered.videoCodec} does not match requested codec ${finalEncoder.codecId}.`);
    }
    validateColorProfile(rendered, colorProfile);
    closeSync(openSync(output, 'wx'));
    outputCreated = true;
    copyFileSync(encodedOutput ?? temporaryOutput, output);
    return { project, output, format, durationSeconds: rendered.durationSeconds, width: rendered.width, height: rendered.height, frameRate: rendered.frameRate, videoCodec: rendered.videoCodec, ...(colorProfile ? { colorProfile: colorProfile.id } : {}) };
  } catch (error) {
    if (outputCreated && existsSync(output)) unlinkSync(output);
    throw error;
  } finally {
    cleanupTemporaryRenderOutputs(outputDir, temporaryOutput, encodedOutput, temporaryDirectory);
  }
}

export async function renderProjectAsync(projectPath, outputPath, quality = 'draft', options = {}) {
  const project = resolve(projectPath);
  const indexPath = join(project, 'index.html');
  const metaPath = join(project, 'meta.json');
  if (!existsSync(indexPath) || !existsSync(metaPath)) throw new Error(`Not a video project: ${project}`);
  if (!['draft', 'standard', 'high'].includes(quality)) throw new TypeError('Quality must be draft, standard, or high.');

  const { signal: externalSignal, onProgress, ...renderOptions } = options;
  if (externalSignal !== undefined && (typeof externalSignal.aborted !== 'boolean' || typeof externalSignal.addEventListener !== 'function')) {
    throw new TypeError('Render signal must be an AbortSignal.');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Render onProgress must be a function.');
  const controls = resolveRenderControlArgs(renderOptions);
  const resumeCheckpoint = renderOptions.resumeCheckpoint === true;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const output = resolve(outputPath ?? join(project, `renders/draft.${renderOptions.format ?? 'mp4'}`));
  const format = resolveRenderFormat(output, renderOptions.format);
  const encoderSettings = renderOptions.encoder ?? {};
  const videoEncoder = resolveVideoEncoder(format, encoderSettings);
  const colorProfile = resolveColorProfile(renderOptions.colorProfile, format);
  const finalEncoder = colorProfile ? resolveProfileEncoder(format, videoEncoder, colorProfile) : videoEncoder;
  if (finalEncoder.codec) hasFfmpegEncoder(finalEncoder.codec);
  if (colorProfile && !hasFfmpegFilter(colorProfile.requiredFilter)) throw new Error(`The ${colorProfile.id} color profile requires an FFmpeg build with the ${colorProfile.requiredFilter} filter.`);
  const encoderArgs = resolveEncoderArgs(format, encoderSettings);
  if (resumeCheckpoint && format === 'png-sequence') throw new TypeError('Resumable checkpoints do not support PNG sequence output.');
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });
  const pngSequence = format === 'png-sequence';
  let temporaryDirectory;
  let temporaryOutput;
  let encodedOutput;
  let checkpoint;
  let checkpointArtifact;
  let resumedFromCheckpoint = false;
  if (resumeCheckpoint) {
    const fingerprint = await fingerprintRenderProject(project, {
      quality,
      format,
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
      durationSeconds: meta.durationSeconds,
      encoder: encoderSettings,
      colorProfile: colorProfile?.id,
      workers: renderOptions.workers ?? 'auto',
      lowMemoryMode: renderOptions.lowMemoryMode ?? process.env.PRODUCER_LOW_MEMORY_MODE ?? 'default',
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      hyperframes: JSON.parse(readFileSync(resolveHyperframesPackage(), 'utf8')).version,
    });
    checkpoint = await prepareRenderCheckpoint(output, fingerprint, {
      ...(renderOptions.checkpointMaxBytes !== undefined ? { maxBytes: renderOptions.checkpointMaxBytes } : {}),
      ...(renderOptions.checkpointMaxAgeHours !== undefined ? { maxAgeHours: renderOptions.checkpointMaxAgeHours } : {}),
    });
    checkpointArtifact = await restoreRenderCheckpoint(checkpoint);
    resumedFromCheckpoint = Boolean(checkpointArtifact);
  }
  let outputCreated = false;
  let completed = false;
  const control = createRenderControl(externalSignal, renderOptions.timeoutSeconds);

  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'aive-render-'));
    temporaryOutput = pngSequence
      ? join(temporaryDirectory, 'frames')
      : join(temporaryDirectory, `render.${format}`);
    encodedOutput = finalEncoder.codec
      ? join(temporaryDirectory, `encoded.${format}`)
      : undefined;
    if (!checkpointArtifact) {
      emitRenderProgress(onProgress, 'capture', 'started');
      await runHyperframesAsync(['render', '--format', format, '--fps', String(meta.fps), '--quality', quality, ...controls, ...encoderArgs, '--output', temporaryOutput], project, control.signal, onProgress);
      emitRenderProgress(onProgress, 'capture', 'completed');
      if (checkpoint) {
        emitRenderProgress(onProgress, 'validation', 'started', { target: 'checkpoint-capture' });
        validateRenderedMedia(await probeMediaAsync(temporaryOutput, { signal: control.signal }), meta);
        emitRenderProgress(onProgress, 'validation', 'completed', { target: 'checkpoint-capture' });
        checkpointArtifact = await saveRenderCheckpoint(checkpoint, temporaryOutput);
      }
    } else {
      emitRenderProgress(onProgress, 'capture', 'skipped', { reason: 'checkpoint-resume' });
    }
    if (pngSequence) {
      emitRenderProgress(onProgress, 'validation', 'started', { target: 'png-sequence' });
      const frames = readdirSync(temporaryOutput, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'));
      const expectedFrames = Math.round(meta.durationSeconds * frameRateNumber(meta.fps ?? 30));
      if (frames.length !== expectedFrames || frames.length === 0) throw new Error(`PNG sequence has ${frames.length} frames; expected ${expectedFrames}.`);
      for (const frame of frames) {
        control.signal.throwIfAborted();
        if (!await hasExpectedPngHeader(join(temporaryOutput, frame.name), meta.width, meta.height)) {
          throw new Error(`PNG sequence frame ${frame.name} has an invalid signature or dimensions.`);
        }
      }
      emitRenderProgress(onProgress, 'validation', 'completed', { target: 'png-sequence', completed: frames.length, total: frames.length });
      if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
      control.signal.throwIfAborted();
      emitRenderProgress(onProgress, 'publish', 'started');
      await publishPngSequenceAsync(temporaryOutput, output, outputDir);
      outputCreated = true;
      control.signal.throwIfAborted();
      emitRenderProgress(onProgress, 'publish', 'completed');
      return { project, output, format, durationSeconds: meta.durationSeconds, width: meta.width, height: meta.height, frameRate: frameRateNumber(meta.fps), frameCount: frames.length };
    }
    const renderArtifact = checkpointArtifact ?? temporaryOutput;
    if (finalEncoder.codec) {
      emitRenderProgress(onProgress, 'encoding', 'started', { codec: finalEncoder.codecId });
      await encodeVideoFileAsync(renderArtifact, encodedOutput, format, finalEncoder, control.signal, colorProfile, meta.durationSeconds, onProgress);
      emitRenderProgress(onProgress, 'encoding', 'completed', { codec: finalEncoder.codecId });
    } else emitRenderProgress(onProgress, 'encoding', 'skipped', { reason: 'renderer-output-is-final' });
    emitRenderProgress(onProgress, 'validation', 'started', { target: 'final-output' });
    const rendered = await probeMediaAsync(encodedOutput ?? renderArtifact, { signal: control.signal });
    validateRenderedMedia(rendered, meta, finalEncoder.codecId);
    validateColorProfile(rendered, colorProfile);
    emitRenderProgress(onProgress, 'validation', 'completed', { target: 'final-output' });
    const outputFile = await open(output, 'wx');
    outputCreated = true;
    emitRenderProgress(onProgress, 'publish', 'started');
    await pipeline(createReadStream(encodedOutput ?? renderArtifact, { signal: control.signal }),
      outputFile.createWriteStream(), { signal: control.signal });
    emitRenderProgress(onProgress, 'publish', 'completed');
    completed = true;
    return { project, output, format, durationSeconds: rendered.durationSeconds, width: rendered.width, height: rendered.height, frameRate: rendered.frameRate, videoCodec: rendered.videoCodec, ...(colorProfile ? { colorProfile: colorProfile.id } : {}), ...(resumeCheckpoint ? { resumedFromCheckpoint } : {}) };
  } catch (error) {
    if (outputCreated && existsSync(output)) await rm(output, { recursive: true, force: true });
    if (checkpointArtifact) error.message += ' The completed capture is preserved for resume; retry the same render options to reuse it.';
    throw error;
  } finally {
    if (temporaryOutput) await cleanupTemporaryRenderOutputsAsync(outputDir, temporaryOutput, encodedOutput, temporaryDirectory);
    if (checkpoint && completed) {
      await removeRenderCheckpoint(checkpoint).catch((error) => process.emitWarning(`Could not remove completed render checkpoint: ${error.message}`));
    }
    control.dispose();
  }
}

async function hasExpectedPngHeader(path, width, height) {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && header.readUInt32BE(16) === width && header.readUInt32BE(20) === height;
  } finally {
    await file.close();
  }
}

async function cleanupTemporaryRenderOutputsAsync(outputDir, temporaryOutput, encodedOutput, temporaryDirectory) {
  await rm(temporaryOutput, { recursive: true, force: true });
  const outputName = basename(temporaryOutput);
  const transactionStem = outputName.replace(/\.(?:mp4|webm|mov|gif)$/i, '');
  const transactionPrefix = `.${transactionStem}.hf-transaction-`;
  const transactionDirectory = temporaryDirectory ?? outputDir;
  if (existsSync(transactionDirectory)) {
    for (const entry of await readdir(transactionDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(transactionPrefix)) {
        await rm(join(transactionDirectory, entry.name), { recursive: true, force: true });
      }
    }
  }
  if (encodedOutput) await rm(encodedOutput, { force: true });
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}

function validateRenderedMedia(rendered, meta, codecId) {
  const expectedFps = frameRateNumber(meta.fps ?? 30);
  if (Math.abs(rendered.durationSeconds - meta.durationSeconds) > Math.max(0.15, 1 / expectedFps)) throw new Error(`Rendered duration ${rendered.durationSeconds.toFixed(3)}s does not match project duration ${meta.durationSeconds}s.`);
  if (rendered.width !== meta.width || rendered.height !== meta.height) throw new Error(`Rendered canvas ${rendered.width}×${rendered.height} does not match project canvas ${meta.width}×${meta.height}.`);
  const renderedFrameRate = rendered.videoCodec === 'gif'
    ? rendered.nominalFrameRate ?? rendered.frameRate
    : rendered.frameRate;
  if (renderedFrameRate && Math.abs(renderedFrameRate - expectedFps) > 0.001) throw new Error(`Rendered frame rate ${renderedFrameRate} fps does not match project frame rate ${meta.fps} fps.`);
  const expectedCodec = { h264: 'h264', h265: 'hevc', vp9: 'vp9', prores: 'prores' }[codecId];
  if (expectedCodec && rendered.videoCodec !== expectedCodec) throw new Error(`Rendered video codec ${rendered.videoCodec} does not match requested codec ${codecId}.`);
}

function validateColorProfile(rendered, colorProfile) {
  if (!colorProfile) return;
  for (const field of ['colorSpace', 'colorTransfer', 'colorPrimaries', 'colorRange', ...(colorProfile.pixelFormat ? ['pixelFormat'] : [])]) {
    if (rendered[field] !== colorProfile[field]) {
      throw new Error(`Rendered ${field} ${rendered[field] ?? 'unknown'} does not match requested ${colorProfile.id} profile (${colorProfile[field]}).`);
    }
  }
}

function cleanupTemporaryRenderOutputs(outputDir, temporaryOutput, encodedOutput, temporaryDirectory) {
  rmSync(temporaryOutput, { recursive: true, force: true });
  const outputName = basename(temporaryOutput);
  const transactionStem = outputName.replace(/\.(?:mp4|webm|mov|gif)$/i, '');
  const transactionPrefix = `.${transactionStem}.hf-transaction-`;
  const transactionDirectory = temporaryDirectory ?? outputDir;
  if (existsSync(transactionDirectory)) {
    for (const entry of readdirSync(transactionDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(transactionPrefix)) {
        rmSync(join(transactionDirectory, entry.name), { recursive: true, force: true });
      }
    }
  }
  if (encodedOutput) rmSync(encodedOutput, { force: true });
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

function publishPngSequenceSync(temporaryOutput, output, outputDir) {
  const stagingDirectory = mkdtempSync(join(outputDir, '.aive-sequence-'));
  const stagingOutput = join(stagingDirectory, 'frames');
  try {
    cpSync(temporaryOutput, stagingOutput, { recursive: true, force: false, errorOnExist: true });
    if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
    renameSync(stagingOutput, output);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

async function publishPngSequenceAsync(temporaryOutput, output, outputDir) {
  const stagingDirectory = await mkdtemp(join(outputDir, '.aive-sequence-'));
  const stagingOutput = join(stagingDirectory, 'frames');
  try {
    await cp(temporaryOutput, stagingOutput, { recursive: true, force: false, errorOnExist: true });
    if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
    await rename(stagingOutput, output);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

function createRenderControl(externalSignal, timeoutSeconds) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) relayAbort();
  else externalSignal?.addEventListener('abort', relayAbort, { once: true });
  const timer = timeoutSeconds === undefined ? undefined : setTimeout(() => {
    const error = new Error(`Render exceeded the configured timeout of ${timeoutSeconds} seconds.`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutSeconds * 1000);
  timer?.unref();
  return {
    signal: controller.signal,
    dispose() {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', relayAbort);
    },
  };
}

async function encodeVideoFileAsync(inputPath, outputPath, format, encoder, signal, colorProfile, durationSeconds, onProgress) {
  const args = [
    '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?', '-c:v', encoder.codec,
  ];
  appendVideoProfileArgs(args, encoder, colorProfile);
  if (encoder.crf !== undefined) {
    args.push('-crf', String(encoder.crf));
    if (encoder.codecId === 'vp9') args.push('-b:v', '0');
  }
  if (encoder.videoBitrate !== undefined) args.push('-b:v', encoder.videoBitrate);
  args.push('-c:a', 'copy', '-progress', 'pipe:1', '-nostats');
  if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart');
  args.push(outputPath);
  const progressParser = onProgress ? createFfmpegProgressParser(onProgress, 'encoding', durationSeconds, { codec: encoder.codecId }) : undefined;
  await runProcess('ffmpeg', args, {
    signal,
    ...(progressParser ? {
      stdio: 'capture',
      onStdout: progressParser.push,
      onStderr: (chunk) => process.stderr.write(chunk),
    } : {}),
  });
  progressParser?.flush();
}

function encodeVideoFile(inputPath, outputPath, format, encoder, colorProfile) {
  const args = [
    '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?', '-c:v', encoder.codec,
  ];
  appendVideoProfileArgs(args, encoder, colorProfile);
  if (encoder.crf !== undefined) {
    args.push('-crf', String(encoder.crf));
    if (encoder.codecId === 'vp9') args.push('-b:v', '0');
  }
  if (encoder.videoBitrate !== undefined) args.push('-b:v', encoder.videoBitrate);
  args.push('-c:a', 'copy');
  if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart');
  args.push(outputPath);
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not encode ${encoder.codecId} video: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

function appendVideoProfileArgs(args, encoder, colorProfile) {
  if (encoder.codecId === 'prores') args.push('-profile:v', '3', '-pix_fmt', 'yuv422p10le');
  else args.push('-pix_fmt', colorProfile?.pixelFormat ?? 'yuv420p');
  if (colorProfile) {
    args.push('-vf', colorProfile.filter);
    if (colorProfile.id === 'hdr10') {
      args.push('-profile:v', 'main10', '-x265-params', `hdr10=1:master-display=${colorProfile.masteringDisplay}:max-cll=${colorProfile.contentLightLevel}`);
    }
    args.push('-color_primaries', colorProfile.colorPrimaries, '-color_trc', colorProfile.colorTransfer, '-colorspace', colorProfile.colorSpace, '-color_range', colorProfile.colorRange);
  }
}

function runHyperframes(args, projectPath) {
  const project = resolve(projectPath);
  const packagePath = resolveHyperframesPackage();
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.hyperframes;
  if (!bin) throw new Error('Installed HyperFrames package has no CLI entry point.');
  const cliPath = resolve(dirname(packagePath), bin);
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: project,
    stdio: 'inherit',
    windowsHide: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`HyperFrames ${args[0]} failed: ${result.error?.message ?? `exit code ${result.status}`}`);
  }
  return true;
}

async function runHyperframesAsync(args, projectPath, signal, onProgress) {
  const project = resolve(projectPath);
  const packagePath = resolveHyperframesPackage();
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.hyperframes;
  if (!bin) throw new Error('Installed HyperFrames package has no CLI entry point.');
  const cliPath = resolve(dirname(packagePath), bin);
  const progressParser = onProgress ? createHyperframesProgressParser(onProgress) : undefined;
  try {
    await runProcess(process.execPath, [cliPath, ...args], {
      cwd: project,
      signal,
      windowsHide: false,
      ...(progressParser ? {
        stdio: 'capture',
        onStdout: progressParser.push,
        onStderr: (chunk) => process.stderr.write(chunk),
      } : {}),
    });
    progressParser?.flush();
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
    throw new Error(`HyperFrames ${args[0]} failed: ${error.message}`);
  }
  return true;
}

function createHyperframesProgressParser(onProgress) {
  let pending = '';
  const parseLine = (line) => {
    const marker = line.indexOf('@hf-progress ');
    if (marker < 0) return;
    try {
      const progress = JSON.parse(line.slice(marker + '@hf-progress '.length));
      if (typeof progress.code !== 'string' || !Number.isFinite(progress.pct)) return;
      const event = {
        stage: 'capture',
        phase: progress.code,
        percent: Math.max(0, Math.min(100, progress.pct)),
        ...(Number.isFinite(progress.done) ? { completed: progress.done } : {}),
        ...(Number.isFinite(progress.total) ? { total: progress.total } : {}),
      };
      try {
        const result = onProgress(event);
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(warnProgressCallback);
        }
      } catch (error) {
        warnProgressCallback(error);
      }
    } catch {
      // Ignore malformed third-party progress lines; the renderer still reports its process result.
    }
  };
  return {
    push(chunk) {
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        parseLine(pending.slice(0, newline).replace(/\r$/, ''));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 16 * 1024) pending = pending.slice(-16 * 1024);
    },
    flush() {
      if (pending) parseLine(pending);
      pending = '';
    },
  };
}

function warnProgressCallback(error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.emitWarning(`Render progress callback failed: ${detail}`);
}

function processTranscript(project, inputPath, durationSeconds, command) {
  const metaPath = join(project, 'meta.json');
  const indexPath = join(project, 'index.html');
  const rawPath = join(project, 'transcript.json');
  const outputPath = join(project, 'transcripts', 'transcript.json');
  if (!existsSync(metaPath) || !existsSync(indexPath)) throw new Error(`Not a video project: ${project}`);
  if (existsSync(rawPath) || existsSync(outputPath)) {
    throw new Error('This project already has a transcript; create a new project to preserve the existing edit.');
  }
  const originalHtml = readFileSync(indexPath);
  try {
    runHyperframes(command ?? ['transcribe', inputPath, '--dir', project, '--json'], project);
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    const granularity = /\.(srt|vtt)$/i.test(inputPath) ? 'cue' : 'word';
    const transcript = normalizeTranscript(raw, durationSeconds, granularity);
    writeFileSync(outputPath, `${JSON.stringify(transcript, null, 2)}\n`, { flag: 'wx' });
    return { transcriptPath: outputPath, wordCount: transcript.words.length, durationSeconds };
  } catch (error) {
    writeFileSync(indexPath, originalHtml);
    rmSync(rawPath, { force: true });
    rmSync(outputPath, { force: true });
    throw error;
  }
}

function resolveHyperframesPackage() {
  try {
    return require.resolve('hyperframes/package.json');
  } catch {
    throw new Error('HyperFrames is not installed. Run npm install in the engine repository.');
  }
}
