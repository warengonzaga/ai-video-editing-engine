import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAvatarComposition } from '../src/animation/avatar.mjs';

test('creates a generic timed layered avatar composition and rejects overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-avatar-'));
  try {
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'compositions'));
    writeFileSync(join(root, 'meta.json'), JSON.stringify({ width: 1280, height: 720, durationSeconds: 2 }));
    writeFileSync(join(root, 'index.html'), '<div id="root">\n    <div id="title" class="clip" data-start="0" data-duration="2" data-track-index="0">sample-edit</div>\n  </div>\n  <script></script>');
    copyFileSync(new URL('../node_modules/gsap/dist/gsap.min.js', import.meta.url), join(root, 'assets', 'gsap.min.js'));
    const image = join(root, 'sprite.png');
    writeFileSync(image, 'fixture');
    const spec = { durationSeconds: 2, layers: [{ name: 'eyes', role: 'eyes', image, states: { blink: image }, track: { schemaVersion: 1, durationSeconds: 2, cues: [{ start: 0.3, end: 0.4, state: 'blink' }] } }] };
    const result = createAvatarComposition(root, spec);
    const html = readFileSync(result.compositionPath, 'utf8');
    assert.match(html, /gsap\.timeline/);
    assert.match(html, /data-composition-id="avatar-scene"/);
    assert.match(html, /src="assets\/avatar\//);
    assert.match(html, /src="assets\/gsap\.min\.js"/);
    assert.match(html, /data-track-index="0"/);
    assert.match(html, /id="avatar-eyes" class="clip sprite"/);
    assert.doesNotMatch(html, /\.\.\/assets|data-layer=/);
    assert.doesNotMatch(readFileSync(join(root, 'index.html'), 'utf8'), /id="title"/);
    assert.match(html, /tl\.set\(el,\{attr:\{src:t\.states\.default\}\},c\.end\)/);
    assert.equal(result.layers, 1);
    assert.throws(() => createAvatarComposition(root, spec), /already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
