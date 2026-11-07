import { probeMediaAsync } from './probe.mjs';
import { runProcess } from '../render/process.mjs';

const DEFAULT_SCENE_THRESHOLD = 0.35;
const DEFAULT_MINIMUM_SPACING_SECONDS = 0.5;
const DEFAULT_MAXIMUM_FINDINGS = 2000;

/** Find visually distinct shot boundaries with FFmpeg's scene-change score. */
export async function detectSceneChangesAsync(inputPath, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Scene detection options must be an object.');
  }
  const allowedOptions = new Set(['threshold', 'minimumSpacingSeconds', 'maximumFindings', 'signal']);
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) throw new TypeError(`Unsupported scene detection option: ${key}.`);
  }
  const media = await probeMediaAsync(inputPath, { signal: options.signal });
  if (!media.videoStreams.length) throw new TypeError('Scene detection requires a video stream.');

  const threshold = options.threshold ?? DEFAULT_SCENE_THRESHOLD;
  const minimumSpacingSeconds = options.minimumSpacingSeconds ?? DEFAULT_MINIMUM_SPACING_SECONDS;
  const maximumFindings = options.maximumFindings ?? DEFAULT_MAXIMUM_FINDINGS;
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 1) {
    throw new TypeError('Scene threshold must be between 0.05 and 1.');
  }
  if (!Number.isFinite(minimumSpacingSeconds) || minimumSpacingSeconds < 0 || minimumSpacingSeconds > 60) {
    throw new TypeError('minimumSpacingSeconds must be between 0 and 60.');
  }
  if (!Number.isSafeInteger(maximumFindings) || maximumFindings < 1 || maximumFindings > 10000) {
    throw new TypeError('maximumFindings must be an integer between 1 and 10000.');
  }

  const filter = `select=gt(scene\\,${threshold}),metadata=mode=print:key=lavfi.scene_score`;
  let stderrBytes = 0;
  const result = await runProcess('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'info', '-i', media.path,
    '-map', '0:v:0', '-vf', filter, '-an', '-sn', '-dn', '-f', 'null', '-',
  ], {
    signal: options.signal,
    stdio: 'capture',
    onStderr: (chunk) => { stderrBytes += chunk.length; },
  });
  if (stderrBytes >= 16 * 1024 * 1024) {
    throw new RangeError('FFmpeg scene analysis exceeded the safe log size. Raise the threshold or analyze a shorter source range.');
  }

  const parsed = parseSceneDetectionOutput(result.stderr, media.durationSeconds);
  const findings = suppressNearbyCuts(parsed, minimumSpacingSeconds);
  if (findings.length > maximumFindings) {
    throw new RangeError(`Scene detection found more than ${maximumFindings} cuts; increase maximumFindings or raise the threshold.`);
  }

  return {
    providerId: 'ffmpeg-scene-detection',
    analysis: {
      schemaVersion: 1,
      durationSeconds: media.durationSeconds,
      findings: findings.map((finding, index) => ({
        id: `finding-${String(index + 1).padStart(3, '0')}`,
        type: 'scene-cut',
        startSeconds: finding.startSeconds,
        confidence: finding.confidence,
        description: `FFmpeg scene-change score ${finding.confidence.toFixed(3)}. Review this candidate boundary.`,
      })),
    },
    settings: { threshold, minimumSpacingSeconds },
    reviewRequired: true,
  };
}

export function parseSceneDetectionOutput(log, durationSeconds) {
  if (typeof log !== 'string' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('Scene detection output requires a log string and positive duration.');
  }
  const frames = [...log.matchAll(/frame:\s*\d+\s+pts:\s*-?\d+\s+pts_time:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g)];
  const findings = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const blockStart = frame.index + frame[0].length;
    const blockEnd = index + 1 < frames.length ? frames[index + 1].index : log.length;
    const scoreMatch = /lavfi\.scene_score\s*=\s*((?:\d+(?:\.\d*)?|\.\d+))/.exec(log.slice(blockStart, blockEnd));
    if (!scoreMatch) continue;
    const startSeconds = Number(frame[1]);
    const confidence = Number(scoreMatch[1]);
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds >= durationSeconds
        || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    findings.push({ startSeconds: round(startSeconds), confidence: round(confidence) });
  }
  return findings;
}

function suppressNearbyCuts(findings, minimumSpacingSeconds) {
  const kept = [];
  for (const finding of findings) {
    const previous = kept.at(-1);
    if (previous && finding.startSeconds - previous.startSeconds < minimumSpacingSeconds) {
      if (finding.confidence > previous.confidence) kept[kept.length - 1] = finding;
    } else {
      kept.push(finding);
    }
  }
  return kept;
}

function round(value) {
  return Number(value.toFixed(3));
}
