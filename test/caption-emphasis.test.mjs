import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTION_LAYOUT_PRESETS } from '../src/timeline/caption-layouts.mjs';
import {
  buildCaptionTextMarkup,
  CAPTION_HIGHLIGHT_SCRIPT,
  CAPTION_WORD_CSS,
  createCaptionTrack,
  normalizeCaptionToken,
  resolveCaptionEmphasis,
} from '../src/timeline/captions.mjs';
import { setTimelineOverlay } from '../src/timeline/edit.mjs';
import { inspectTimeline } from '../src/timeline/inspect.mjs';
import { validateTimeline } from '../src/timeline/validate.mjs';

const transcript = {
  schemaVersion: 1,
  durationSeconds: 4,
  words: [
    { text: 'Use', start: 0.2, end: 0.5 },
    { text: 'Open-Source,', start: 0.5, end: 1.1 },
    { text: 'tools.', start: 1.1, end: 1.6 },
  ],
};

function timelineWith(track) {
  return {
    schemaVersion: 1,
    project: { id: 'sample-edit', width: 1920, height: 1080, fps: 30, durationSeconds: 4 },
    assets: [],
    tracks: [{ ...track, order: 0 }],
  };
}

test('matches punctuation and hyphen variants without collapsing symbols', () => {
  const clip = {
    timelineStart: 0,
    text: 'Use C++ and open\u2010source. Don\u2019t ship C or C++!',
    emphasisWords: ['c++', "don't", 'open-source'],
    emphasisColor: '#112233',
  };
  const html = buildCaptionTextMarkup(clip, 'center');
  assert.match(
    html,
    /<span class="caption-word" style="color:#112233" data-emphasis-color="#112233">C\+\+<\/span> and/,
  );
  assert.match(
    html,
    /<span class="caption-word" style="color:#112233" data-emphasis-color="#112233">open\u2010source\.<\/span>/,
  );
  assert.match(
    html,
    /<span class="caption-word" style="color:#112233" data-emphasis-color="#112233">Don\u2019t<\/span>/,
  );
  assert.match(html, /<span class="caption-word" style="color:#112233" data-emphasis-color="#112233">C\+\+!<\/span>/);
  assert.equal(html.includes('>C<'), false);
  assert.match(
    buildCaptionTextMarkup({ timelineStart: 0, text: 'open\uFF0Dsource and soft\u00ADhyphen' }, 'left'),
    /<span class="caption-word">open\uFF0Dsource<\/span> and <span class="caption-word">soft\u00ADhyphen<\/span>/,
  );
  assert.equal(normalizeCaptionToken('C++'), 'c++');
  assert.equal(normalizeCaptionToken('C'), 'c');
  assert.equal(normalizeCaptionToken('Don\u2019t'), "don't");
  assert.equal(normalizeCaptionToken('open\u2010source'), 'open-source');
  assert.throws(() => resolveCaptionEmphasis({ emphasisWords: ['***'], emphasisColor: '#fff' }), /emphasisWords/);
});

test('emphasizes matching words and keeps hyphenated tokens on one line', () => {
  assert.match(CAPTION_WORD_CSS, /white-space:nowrap/);
  assert.match(CAPTION_HIGHLIGHT_SCRIPT, /restingColor=word\.dataset\.emphasisColor\|\|baseColor/);
  assert.match(CAPTION_HIGHLIGHT_SCRIPT, /color:restingColor/);

  const simple = createCaptionTrack({
    schemaVersion: 1,
    durationSeconds: 2,
    words: [
      { text: 'Hello', start: 0.1, end: 0.4 },
      { text: 'there.', start: 0.4, end: 0.8 },
    ],
  });
  assert.equal(buildCaptionTextMarkup(simple.clips[0], 'center'), 'Hello there.');
  const lined = createCaptionTrack(transcript, { wordsPerLine: 2, wordWrap: false });
  const linedHtml = buildCaptionTextMarkup(lined.clips[0], 'center');
  assert.match(
    linedHtml,
    /<span class="caption-line"[^>]*>Use <span class="caption-word">Open-Source,<\/span><\/span>/,
  );
  assert.match(linedHtml, /<span class="caption-line"[^>]*>tools\.<\/span>/);

  const plain = createCaptionTrack(transcript);
  const plainHtml = buildCaptionTextMarkup(plain.clips[0], plain.clips[0].textAlign);
  assert.match(plainHtml, /<span class="caption-word">Open-Source,<\/span>/);
  assert.match(plainHtml, /caption-text/);
  assert.equal(plainHtml.includes('style="color:'), false);
  assert.equal(plain.clips[0].emphasisWords, undefined);
  assert.equal(
    buildCaptionTextMarkup({ text: 'Hello\nthere.', timelineStart: 0, wordWrap: false }, 'left'),
    'Hello\nthere.',
  );
  assert.equal(
    buildCaptionTextMarkup({ text: 'Hello\nopen-source  world', timelineStart: 0, wordWrap: false }, 'left'),
    '<span class="caption-text" style="display:block;width:100%;min-width:0;white-space:pre">Hello\n<span class="caption-word">open-source</span>  world</span>',
  );
  assert.equal(
    buildCaptionTextMarkup(
      {
        text: 'Keep\nopen-source  tools.',
        timelineStart: 0,
        wordWrap: true,
        emphasisWords: ['open-source'],
        emphasisColor: '#ff00aa',
      },
      'center',
    ),
    '<span class="caption-text" style="display:block;width:100%;min-width:0;white-space:pre-wrap">Keep\n<span class="caption-word" style="color:#ff00aa" data-emphasis-color="#ff00aa">open-source</span>  tools.</span>',
  );

  for (const layoutPreset of Object.keys(CAPTION_LAYOUT_PRESETS)) {
    const track = createCaptionTrack(transcript, {
      layoutPreset,
      emphasisWords: ['open-source'],
      emphasisColor: '#ff00aa',
      emphasisWeight: 'bold',
    });
    const clip = track.clips[0];
    const html = buildCaptionTextMarkup(clip, clip.textAlign);
    assert.match(
      html,
      /<span class="caption-word" style="color:#ff00aa;font-weight:bold" data-emphasis-color="#ff00aa"[^>]*>Open-Source,<\/span>/,
    );
    assert.equal(html.includes('Open-</span>'), false);
    assert.equal(html.includes('>Source,<'), false);
    const timeline = timelineWith(track);
    assert.equal(validateTimeline(timeline), timeline);
  }

  const partial = createCaptionTrack(transcript, { emphasisWords: ['source'], emphasisColor: '#ff00aa' });
  const partialHtml = buildCaptionTextMarkup(partial.clips[0], 'center');
  assert.equal(partialHtml.includes('data-emphasis-color'), false);
  assert.match(partialHtml, /<span class="caption-word">Open-Source,<\/span>/);

  const highlighted = createCaptionTrack(transcript, {
    layoutPreset: 'socialPop',
    emphasisWords: ['\uFF2Fpen-source'],
    emphasisColor: '#00ff00',
    emphasisWeight: 800,
  });
  assert.equal(highlighted.clips[0].wordHighlightAnimation, 'pop');
  assert.equal(highlighted.clips[0].wordHighlightColor, '#ffe45c');
  assert.equal(highlighted.clips[0].fontWeight, 800);
  assert.deepEqual(highlighted.clips[0].emphasisWords, ['\uFF2Fpen-source']);
  const highlightedHtml = buildCaptionTextMarkup(highlighted.clips[0], highlighted.clips[0].textAlign);
  assert.match(highlightedHtml, /data-word-start="0\.5"/);
  assert.match(highlightedHtml, /style="color:#00ff00;font-weight:800" data-emphasis-color="#00ff00" data-word-start=/);
  assert.equal(highlightedHtml.includes('caption-text'), false);

  const emphasisWords = ['open-source'];
  const copied = createCaptionTrack(transcript, { emphasisWords, emphasisColor: '#112233' });
  emphasisWords.push('later');
  assert.deepEqual(copied.clips[0].emphasisWords, ['open-source']);
  const split = createCaptionTrack(
    {
      schemaVersion: 1,
      durationSeconds: 4,
      words: [
        { text: 'Hello.', start: 0.1, end: 0.4 },
        { text: 'open-source', start: 0.5, end: 1 },
      ],
    },
    { emphasisWords: ['open-source'], emphasisColor: '#112233' },
  );
  split.clips[0].emphasisWords.push('later');
  assert.deepEqual(split.clips[1].emphasisWords, ['open-source']);

  const cueTranscript = {
    schemaVersion: 1,
    durationSeconds: 2,
    granularity: 'cue',
    words: [{ start: 0.1, end: 1.4, text: "Use Open-Source tools. Don't stop." }],
  };
  assert.throws(() => createCaptionTrack(cueTranscript, { wordHighlight: true }), /word-level transcript timing/);
  const cue = createCaptionTrack(cueTranscript, {
    emphasisWords: ['open-source', "don't"],
    emphasisColor: '#abcdef',
  });
  assert.equal(cue.clips[0].wordTimings, undefined);
  const cueHtml = buildCaptionTextMarkup(cue.clips[0], cue.clips[0].textAlign);
  assert.match(
    cueHtml,
    /<span class="caption-word" style="color:#abcdef" data-emphasis-color="#abcdef">Open-Source<\/span>/,
  );
  assert.match(
    cueHtml,
    /<span class="caption-word" style="color:#abcdef" data-emphasis-color="#abcdef">Don&#39;t<\/span>/,
  );
  assert.match(cueHtml, /caption-text/);
  const cueTimeline = timelineWith(cue);
  assert.equal(validateTimeline(cueTimeline), cueTimeline);

  const unsafe = createCaptionTrack(
    {
      schemaVersion: 1,
      durationSeconds: 2,
      words: [{ text: 'open-source<tag>', start: 0.1, end: 0.8 }],
    },
    { emphasisWords: ['red;}</style>'], emphasisColor: '#00ff00' },
  );
  unsafe.clips[0].text = 'open-source<tag> red;}</style>';
  unsafe.clips[0].emphasisWords = ['red;}</style>', 'open-source<tag>'];
  const unsafeHtml = buildCaptionTextMarkup(unsafe.clips[0], 'center');
  assert.match(unsafeHtml, /open-source&lt;tag&gt;/);
  assert.match(unsafeHtml, /red;}&lt;\/style&gt;/);
  assert.equal(unsafeHtml.includes('</style>'), false);
  assert.match(unsafeHtml, /style="color:#00ff00"/);

  const resolved = resolveCaptionEmphasis(
    { emphasisColor: '#abcdef' },
    { emphasisWords: ['hello'], emphasisColor: '#111111', emphasisWeight: 700 },
  );
  assert.deepEqual(resolved, { emphasisWords: ['hello'], emphasisColor: '#abcdef', emphasisWeight: 700 });
  assert.deepEqual(resolveCaptionEmphasis({}, { emphasisWords: ['hello'], emphasisColor: '#111111' }), {
    emphasisWords: ['hello'],
    emphasisColor: '#111111',
  });

  for (const options of [
    { emphasisColor: 'red' },
    { emphasisColor: '#fff;color:red' },
    { emphasisWeight: 700 },
    { emphasisWords: [] },
    { emphasisWords: 'open-source', emphasisColor: '#fff' },
    { emphasisWords: ['***'], emphasisColor: '#fff' },
    { emphasisWords: ['hello'], emphasisColor: 'red' },
    { emphasisWords: ['hello'], emphasisColor: '#fff', emphasisWeight: 'bolder' },
    { emphasisWords: ['hello'], emphasisColor: '#fff', emphasisWeight: 950 },
    { emphasisWords: [`${'a'.repeat(81)}`], emphasisColor: '#fff' },
  ]) {
    assert.throws(() => createCaptionTrack(transcript, options), /emphasis/);
  }

  const validTrack = createCaptionTrack(transcript, {
    wordHighlight: true,
    emphasisWords: ['open-source'],
    emphasisColor: '#ff00aa',
    emphasisWeight: 700,
  });
  const edited = setTimelineOverlay(timelineWith(validTrack), 'captions', 'caption-001', {
    emphasisColor: '#123456',
    emphasisWeight: 'bold',
  });
  const inspected = inspectTimeline(edited).tracks[0].clips[0];
  assert.equal(inspected.emphasisColor, '#123456');
  assert.equal(inspected.emphasisWeight, 'bold');
  assert.deepEqual(inspected.emphasisWords, ['open-source']);
  assert.equal(inspected.wordHighlightColor, '#ffe45c');
  const cleared = setTimelineOverlay(edited, 'captions', 'caption-001', {
    emphasisWords: null,
    emphasisColor: null,
    emphasisWeight: null,
  });
  assert.equal(inspectTimeline(cleared).tracks[0].clips[0].emphasisWords, undefined);
  assert.throws(
    () => setTimelineOverlay(edited, 'captions', 'caption-001', { emphasisColor: 'red' }),
    /emphasisColor must be a hex color/,
  );
  const broken = timelineWith(validTrack);
  broken.tracks[0].clips[0].emphasisColor = '#fff;background:url(https://example.test)';
  assert.throws(() => validateTimeline(broken), /Text overlay caption-001 emphasisColor must be a hex color/);
});
