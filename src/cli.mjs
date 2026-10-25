#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { retimeTranscript } from './edits/retime-transcript.mjs';
import { createVideoProject } from './project/create.mjs';
import { probeMedia } from './media/probe.mjs';
import { renderCuts } from './media/render-cuts.mjs';
import { planSilenceCuts } from './edits/plan-silence-cuts.mjs';
import { findMistakeCandidates } from './edits/find-mistake-candidates.mjs';
import { importProjectTranscript, lintProject, previewProject, renderProject, transcribeProject } from './render/hyperframes.mjs';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON file ${path}: ${error.message}`);
  }
}

function writeNewFile(path, data) {
  if (existsSync(path)) throw new Error(`Output already exists: ${path}`);
  const tempPath = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw new Error(`Could not write output ${path}: ${error.message}`);
  }
}

function main(args) {
  const [command, ...commandArgs] = args;
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
  if (command === 'project' && commandArgs[0] === 'create' && commandArgs.length >= 2 && commandArgs.length <= 5) {
    const [, slug, size = '1920x1080', fps = '30', durationSeconds = '10'] = commandArgs;
    const match = /^(\d+)x(\d+)$/i.exec(size);
    if (!match) throw new Error('Canvas size must use WIDTHxHEIGHT, such as 1080x1920.');
    const projectPath = createVideoProject(process.cwd(), slug, {
      width: Number(match[1]),
      height: Number(match[2]),
      fps: Number(fps),
      durationSeconds: Number(durationSeconds),
    });
    console.log(`Created ${projectPath}`);
    return;
  }
  if (command === 'probe' && commandArgs.length === 1) {
    console.log(JSON.stringify(probeMedia(commandArgs[0]), null, 2));
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
  if (command === 'render' && commandArgs.length >= 1 && commandArgs.length <= 3) {
    const [projectPath, outputPath, quality = 'draft'] = commandArgs;
    console.log(JSON.stringify(renderProject(projectPath, outputPath, quality), null, 2));
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
  throw new Error('Usage: node src/cli.mjs project create <slug> [WIDTHxHEIGHT] [fps] [durationSeconds] | probe <video> | transcribe <project> <video> [model] [language] | import-transcript <project> <video> <transcript> | plan-silence <transcript.json> <new-edl.json> | mistake-candidates <transcript.json> | apply-edl <video> <approved-edl.json> <output.mp4> | retime <transcript.json> <approved-edl.json> <new-output.json> | lint <project> | preview <project> | render <project> [output.mp4] [draft|standard]');
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
