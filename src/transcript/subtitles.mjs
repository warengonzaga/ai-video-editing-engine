import { validateTranscript } from './validate.mjs';

export function parseSubtitleText(contents, format) {
  if (typeof contents !== 'string') throw new TypeError('Subtitle contents must be text.');
  if (!['srt', 'vtt'].includes(format)) throw new TypeError('Subtitle format must be srt or vtt.');
  const text = contents.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const words = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;
    const match = lines[timeIndex].match(/^\s*((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/);
    if (!match) throw new TypeError(`Invalid ${format.toUpperCase()} timestamp: ${lines[timeIndex]}`);
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    const cueText = lines.slice(timeIndex + 1).join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (cueText) words.push({ text: cueText, start, end });
  }
  if (!words.length) throw new TypeError(`No subtitle cues found in ${format.toUpperCase()} input.`);
  return { words };
}

export function formatSubtitleText(transcript, format) {
  validateTranscript(transcript);
  if (!['srt', 'vtt'].includes(format)) throw new TypeError('Subtitle format must be srt or vtt.');
  const cues = transcript.words.map((word, index) => [
    ...(format === 'srt' ? [String(index + 1)] : []),
    `${formatTimestamp(word.start, format)} --> ${formatTimestamp(word.end, format)}`,
    word.text.replace(/\s*\n\s*/g, ' '),
  ].join('\n'));
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${cues.join('\n\n')}\n`;
}

function parseTimestamp(value) {
  const normalized = value.replace(',', '.');
  const parts = normalized.split(':');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite) || minutes >= 60 || seconds >= 60) {
    throw new TypeError(`Invalid subtitle time: ${value}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimestamp(seconds, format) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const fraction = milliseconds % 1000;
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  return `${time}${format === 'srt' ? ',' : '.'}${String(fraction).padStart(3, '0')}`;
}
