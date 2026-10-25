import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { probeMedia } from '../media/probe.mjs';
import { normalizeTranscript } from '../transcript/normalize.mjs';

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
  return processTranscript(project, resolve(transcriptPath), media.durationSeconds);
}

export function transcribeProject(projectPath, mediaPath, options = {}) {
  const project = resolve(projectPath);
  const media = probeMedia(mediaPath, { requireVideo: false });
  const args = ['transcribe', resolve(mediaPath), '--dir', project, '--json'];
  if (options.model) args.push('--model', options.model);
  if (options.language) args.push('--language', options.language);
  return processTranscript(project, resolve(mediaPath), media.durationSeconds, args);
}

export function renderProject(projectPath, outputPath, quality = 'draft') {
  const project = resolve(projectPath);
  const indexPath = join(project, 'index.html');
  const metaPath = join(project, 'meta.json');
  if (!existsSync(indexPath) || !existsSync(metaPath)) {
    throw new Error(`Not a video project: ${project}`);
  }
  if (!['draft', 'standard'].includes(quality)) {
    throw new TypeError('Quality must be draft or standard.');
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const output = resolve(outputPath ?? join(project, 'renders', 'draft.mp4'));
  if (extname(output).toLowerCase() !== '.mp4') throw new Error('Render output must use the .mp4 extension.');
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });
  const temporaryOutput = join(outputDir, `.${basename(output, '.mp4')}.${randomUUID()}.tmp.mp4`);
  let outputCreated = false;

  try {
    runHyperframes(['render', '--quality', quality, '--output', temporaryOutput], project);
    const rendered = probeMedia(temporaryOutput);
    if (Math.abs(rendered.durationSeconds - meta.durationSeconds) > Math.max(0.15, 1 / (meta.fps || 30))) {
      throw new Error(`Rendered duration ${rendered.durationSeconds.toFixed(3)}s does not match project duration ${meta.durationSeconds}s.`);
    }
    closeSync(openSync(output, 'wx'));
    outputCreated = true;
    copyFileSync(temporaryOutput, output);
    return { project, output, durationSeconds: rendered.durationSeconds, width: rendered.width, height: rendered.height };
  } catch (error) {
    if (outputCreated && existsSync(output)) unlinkSync(output);
    throw error;
  } finally {
    rmSync(temporaryOutput, { force: true });
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
