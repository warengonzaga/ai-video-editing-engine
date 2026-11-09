import { existsSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { probeMedia } from '../media/probe.mjs';
import { normalizeTranscript } from './normalize.mjs';

/** Run an injected transcription provider and persist its normalized result. */
export async function transcribeWithProvider(projectPath, mediaPath, provider, options = {}) {
  const project = resolve(projectPath);
  const media = resolve(mediaPath);
  if (!existsSync(join(project, 'meta.json'))) throw new Error(`Not a video project: ${project}`);
  if (!provider || typeof provider !== 'object'
      || !/^[a-z][a-z0-9-]*$/.test(provider.id ?? '')
      || typeof provider.transcribe !== 'function') {
    throw new TypeError('Provider must define a kebab-case id and async transcribe function.');
  }
  const granularity = options.granularity ?? 'word';
  if (!['word', 'cue'].includes(granularity)) throw new TypeError('Provider granularity must be word or cue.');

  const mediaInfo = probeMedia(media, { requireVideo: false });
  const raw = await provider.transcribe({
    mediaPath: media,
    durationSeconds: mediaInfo.durationSeconds,
    options: structuredClone(options.providerOptions ?? {}),
  });
  const transcript = normalizeTranscript(raw, mediaInfo.durationSeconds, granularity);
  const transcriptPath = join(project, 'transcripts', 'transcript.json');
  const fd = openSync(transcriptPath, 'wx');
  try {
    writeFileSync(fd, `${JSON.stringify(transcript, null, 2)}\n`);
  } catch (error) {
    unlinkSync(transcriptPath);
    throw error;
  } finally {
    closeSync(fd);
  }
  return {
    providerId: provider.id,
    transcriptPath,
    wordCount: transcript.words.length,
    durationSeconds: transcript.durationSeconds,
  };
}
