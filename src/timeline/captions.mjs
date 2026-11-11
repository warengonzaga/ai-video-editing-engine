import { validateTranscript } from '../transcript/validate.mjs';
import { resolveCaptionLayoutPreset } from './caption-layouts.mjs';
import { resolveSpeechBubble } from './speech-bubble.mjs';

export function createCaptionTrack(transcript, options = {}) {
  validateTranscript(transcript);
  const layout = resolveCaptionLayoutPreset(options.layoutPreset);
  const wordHighlight = options.wordHighlight ?? layout.wordHighlight ?? false;
  if (typeof wordHighlight !== 'boolean') throw new TypeError('wordHighlight must be a boolean.');
  if (wordHighlight && transcript.granularity === 'cue')
    throw new TypeError('Word highlighting requires word-level transcript timing.');
  const wordHighlightColor = options.wordHighlightColor ?? layout.wordHighlightColor ?? '#ffe45c';
  if (
    typeof wordHighlightColor !== 'string' ||
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(wordHighlightColor)
  ) {
    throw new TypeError('wordHighlightColor must be a hex color.');
  }
  if (!wordHighlight && options.wordHighlightColor !== undefined)
    throw new TypeError('wordHighlightColor requires wordHighlight: true.');
  const wordHighlightAnimation = options.wordHighlightAnimation ?? layout.wordHighlightAnimation ?? 'scale';
  if (!['scale', 'pop'].includes(wordHighlightAnimation))
    throw new TypeError('wordHighlightAnimation must be scale or pop.');
  if (!wordHighlight && options.wordHighlightAnimation !== undefined)
    throw new TypeError('wordHighlightAnimation requires wordHighlight: true.');
  const wordsPerCaption = options.wordsPerCaption ?? layout.wordsPerCaption ?? 6;
  if (!Number.isSafeInteger(wordsPerCaption) || wordsPerCaption < 1 || wordsPerCaption > 20)
    throw new TypeError('wordsPerCaption must be an integer from 1 to 20.');
  const wordsPerLine = options.wordsPerLine ?? layout.wordsPerLine;
  if (wordsPerLine !== undefined && (!Number.isSafeInteger(wordsPerLine) || wordsPerLine < 1 || wordsPerLine > 20)) {
    throw new TypeError('wordsPerLine must be an integer from 1 to 20.');
  }
  const wordWrap = options.wordWrap ?? layout.wordWrap ?? false;
  if (typeof wordWrap !== 'boolean') throw new TypeError('wordWrap must be a boolean.');
  const maxGapSeconds = options.maxGapSeconds ?? 0.8;
  if (!Number.isFinite(maxGapSeconds) || maxGapSeconds < 0)
    throw new TypeError('maxGapSeconds must be a non-negative number.');
  const bubbleSource = options.bubble ?? layout.bubble;
  const bubble = bubbleSource === undefined ? undefined : resolveSpeechBubble(bubbleSource, layout.bubble);

  const groups = [];
  let group = [];
  for (const word of transcript.words) {
    if (
      group.length &&
      (group.length >= wordsPerCaption ||
        word.start - group.at(-1).end > maxGapSeconds ||
        /[.!?]$/.test(group.at(-1).text))
    ) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);

  const clips = groups.map((words, index) => ({
    id: `caption-${String(index + 1).padStart(3, '0')}`,
    timelineStart: words[0].start,
    durationSeconds: words.at(-1).end - words[0].start,
    text: words.map(({ text }) => text).join(' '),
    ...(wordsPerLine !== undefined ? { wordsPerLine } : {}),
    ...(wordHighlight
      ? {
          wordTimings: words.map((word) => ({
            text: word.text,
            start: word.start - words[0].start,
            end: word.end - words[0].start,
          })),
          wordHighlightColor,
          wordHighlightAnimation,
        }
      : {}),
    x: options.x ?? layout.x,
    y: options.y ?? layout.y,
    width: options.width ?? layout.width,
    height: options.height ?? layout.height,
    fontSize: options.fontSize ?? layout.fontSize,
    ...(options.fontFamily !== undefined ? { fontFamily: options.fontFamily } : {}),
    fontWeight: options.fontWeight ?? layout.fontWeight,
    ...(options.lineHeight !== undefined || layout.lineHeight !== undefined
      ? { lineHeight: options.lineHeight ?? layout.lineHeight }
      : {}),
    verticalAlign: options.verticalAlign ?? layout.verticalAlign,
    wordWrap,
    paddingPixels: options.paddingPixels ?? layout.paddingPixels,
    textOutline: options.textOutline ?? layout.textOutline,
    textShadow: options.textShadow ?? layout.textShadow,
    color: options.color ?? layout.color,
    backgroundColor: options.backgroundColor ?? layout.backgroundColor,
    textAlign: options.textAlign ?? layout.textAlign,
    ...(bubble === undefined ? {} : { bubble: structuredClone(bubble) }),
    ...(options.fadeInSeconds ? { fadeInSeconds: options.fadeInSeconds } : {}),
    ...(options.fadeOutSeconds ? { fadeOutSeconds: options.fadeOutSeconds } : {}),
  }));

  return { id: options.trackId ?? 'captions', kind: 'overlay', order: options.order ?? 100, clips };
}
