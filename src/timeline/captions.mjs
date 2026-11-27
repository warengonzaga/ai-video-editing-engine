import { validateTranscript } from '../transcript/validate.mjs';
import { resolveCaptionLayoutPreset } from './caption-layouts.mjs';
import { resolveSpeechBubble } from './speech-bubble.mjs';

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const FONT_WEIGHTS = ['normal', 'bold', 100, 200, 300, 400, 500, 600, 700, 800, 900];
const HYPHENATED_TOKEN = /[\u2010\u2011\u2012\u2013\u2014-]/;
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right']);

export const CAPTION_WORD_CSS = '.caption-word{display:inline-block;white-space:nowrap;transform-origin:center}';

export const CAPTION_HIGHLIGHT_SCRIPT =
  "if(el.dataset.wordHighlightColor){const baseColor=el.dataset.wordBaseColor,animation=el.dataset.wordHighlightAnimation;for(const word of el.querySelectorAll('.caption-word')){const wordStart=Number(word.dataset.wordStart),wordEnd=Number(word.dataset.wordEnd),restingColor=word.dataset.emphasisColor||baseColor;if(animation==='pop'){const popDuration=Math.min(.14,wordEnd-wordStart);timeline.set(word,{color:el.dataset.wordHighlightColor,scale:.92},wordStart).to(word,{scale:1.08,duration:popDuration,ease:'back.out(1.6)'},wordStart)}else timeline.set(word,{color:el.dataset.wordHighlightColor,scale:1.08},wordStart);timeline.set(word,{color:restingColor,scale:1},wordEnd)}}";

function hasControlCharacter(text) {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

const escapeAttr = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export function normalizeCaptionToken(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function resolveCaptionEmphasis(options = {}, layout = {}, label = '') {
  const emphasisWords = options.emphasisWords ?? layout.emphasisWords;
  const emphasisColor = options.emphasisColor ?? layout.emphasisColor;
  const emphasisWeight = options.emphasisWeight ?? layout.emphasisWeight;
  const prefix = label ? `${label} ` : '';
  const hasWords = emphasisWords !== undefined;
  const hasColor = emphasisColor !== undefined;
  const hasWeight = emphasisWeight !== undefined;
  if (!hasWords && !hasColor && !hasWeight) return undefined;
  if (!hasWords) {
    throw new TypeError(`${prefix}${hasColor ? 'emphasisColor' : 'emphasisWeight'} requires emphasisWords.`);
  }
  if (!Array.isArray(emphasisWords) || emphasisWords.length < 1 || emphasisWords.length > 100) {
    throw new TypeError(`${prefix}emphasisWords must contain 1 to 100 words.`);
  }
  for (const word of emphasisWords) {
    if (typeof word !== 'string' || word.length > 80 || hasControlCharacter(word) || !normalizeCaptionToken(word)) {
      throw new TypeError(`${prefix}emphasisWords entries must be non-empty text up to 80 characters.`);
    }
  }
  if (!hasColor) throw new TypeError(`${prefix}emphasisColor is required when emphasisWords is set.`);
  if (typeof emphasisColor !== 'string' || !HEX_COLOR.test(emphasisColor)) {
    throw new TypeError(`${prefix}emphasisColor must be a hex color.`);
  }
  if (hasWeight && !FONT_WEIGHTS.includes(emphasisWeight)) {
    throw new TypeError(`${prefix}emphasisWeight must be normal, bold, or a hundred-step weight from 100 to 900.`);
  }
  return {
    emphasisWords: [...emphasisWords],
    emphasisColor,
    ...(hasWeight ? { emphasisWeight } : {}),
  };
}

function captionWords(clip) {
  if (clip.wordTimings) return clip.wordTimings;
  return String(clip.text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text }));
}

function emphasisPresentation(clip) {
  const color =
    typeof clip.emphasisColor === 'string' && HEX_COLOR.test(clip.emphasisColor) ? clip.emphasisColor : undefined;
  const weight = FONT_WEIGHTS.includes(clip.emphasisWeight) ? clip.emphasisWeight : undefined;
  const tokens = new Set((clip.emphasisWords ?? []).map((word) => normalizeCaptionToken(word)).filter(Boolean));
  return { color, weight, tokens };
}

function markupCaptionWord(clip, word, presentation) {
  const emphasized = presentation.color !== undefined && presentation.tokens.has(normalizeCaptionToken(word.text));
  const timed = clip.wordTimings !== undefined;
  if (!emphasized && !timed && !HYPHENATED_TOKEN.test(word.text)) return escapeAttr(word.text);
  const styleParts = [];
  if (emphasized) styleParts.push(`color:${presentation.color}`);
  if (emphasized && presentation.weight !== undefined) styleParts.push(`font-weight:${presentation.weight}`);
  const style = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
  const emphasisAttr = emphasized ? ` data-emphasis-color="${presentation.color}"` : '';
  const timing = timed
    ? ` data-word-start="${clip.timelineStart + word.start}" data-word-end="${clip.timelineStart + word.end}"`
    : '';
  return `<span class="caption-word"${style}${emphasisAttr}${timing}>${escapeAttr(word.text)}</span>`;
}

function markupUntimedCaption(clip, presentation) {
  const text = String(clip.text ?? '');
  let needsSpan = false;
  const pieces = text.split(/(\s+)/).map((part) => {
    if (part === '' || /^\s+$/.test(part)) return escapeAttr(part);
    const markup = markupCaptionWord(clip, { text: part }, presentation);
    if (markup.startsWith('<span')) needsSpan = true;
    return markup;
  });
  if (!needsSpan) return escapeAttr(text);
  const whiteSpace = clip.wordWrap === false ? 'pre' : 'pre-wrap';
  return `<span class="caption-text" style="display:block;width:100%;min-width:0;white-space:${whiteSpace}">${pieces.join('')}</span>`;
}

export function buildCaptionTextMarkup(clip, textAlign = 'center') {
  const align = TEXT_ALIGNMENTS.has(textAlign) ? textAlign : 'center';
  const presentation = emphasisPresentation(clip);
  const renderWords = (items) => items.map((word) => markupCaptionWord(clip, word, presentation)).join(' ');
  if (Number.isSafeInteger(clip.wordsPerLine) && clip.wordsPerLine > 0) {
    const words = captionWords(clip);
    const lines = Array.from({ length: Math.ceil(words.length / clip.wordsPerLine) }, (_, index) =>
      words.slice(index * clip.wordsPerLine, (index + 1) * clip.wordsPerLine),
    );
    return lines
      .map(
        (line) =>
          `<span class="caption-line" style="display:block;width:100%;text-align:${align}">${renderWords(line)}</span>`,
      )
      .join('');
  }
  if (clip.wordTimings) return renderWords(captionWords(clip));
  return markupUntimedCaption(clip, presentation);
}

export function createCaptionTrack(transcript, options = {}) {
  validateTranscript(transcript);
  const layout = resolveCaptionLayoutPreset(options.layoutPreset);
  const wordHighlight = options.wordHighlight ?? layout.wordHighlight ?? false;
  if (typeof wordHighlight !== 'boolean') throw new TypeError('wordHighlight must be a boolean.');
  if (wordHighlight && transcript.granularity === 'cue')
    throw new TypeError('Word highlighting requires word-level transcript timing.');
  const wordHighlightColor = options.wordHighlightColor ?? layout.wordHighlightColor ?? '#ffe45c';
  if (typeof wordHighlightColor !== 'string' || !HEX_COLOR.test(wordHighlightColor)) {
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
  const emphasis = resolveCaptionEmphasis(options, layout);

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
    ...(emphasis
      ? {
          emphasisWords: [...emphasis.emphasisWords],
          emphasisColor: emphasis.emphasisColor,
          ...(emphasis.emphasisWeight !== undefined ? { emphasisWeight: emphasis.emphasisWeight } : {}),
        }
      : {}),
    backgroundColor: options.backgroundColor ?? layout.backgroundColor,
    textAlign: options.textAlign ?? layout.textAlign,
    ...(bubble === undefined ? {} : { bubble: structuredClone(bubble) }),
    ...(options.fadeInSeconds ? { fadeInSeconds: options.fadeInSeconds } : {}),
    ...(options.fadeOutSeconds ? { fadeOutSeconds: options.fadeOutSeconds } : {}),
  }));

  return { id: options.trackId ?? 'captions', kind: 'overlay', order: options.order ?? 100, clips };
}
