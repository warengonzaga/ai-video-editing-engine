import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
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
    writeFileSync(image, createPng(420, 620));
    const mismatchedImage = join(root, 'sprite-state-mismatched.png');
    writeFileSync(mismatchedImage, createPng(620, 420));
    const track = (cues = []) => ({ schemaVersion: 1, durationSeconds: 2, cues });
    const spec = {
      durationSeconds: 2,
      layers: [
        { name: 'body', role: 'body', image, width: 0.5, track: track([]) },
        { name: 'mouth', role: 'mouth', image, states: { open: image }, relativeTo: 'body', anchor: [0.5, 0.31], width: 0.13, track: track([{ start: 0.5, end: 0.7, state: 'open' }]) },
      ],
    };
    const eyes = { name: 'eyes', role: 'eyes', image, states: { blink: mismatchedImage }, width: 0.5, track: track([{ start: 0.3, end: 0.4, state: 'blink' }]) };
    const invalidSpec = { ...spec, layers: [spec.layers[0], eyes, spec.layers[1]] };
    assert.throws(() => createAvatarComposition(root, invalidSpec), /matching canvas dimensions/);
    const result = createAvatarComposition(root, spec);
    const html = readFileSync(result.compositionPath, 'utf8');
    assert.match(html, /gsap\.timeline/);
    assert.match(html, /data-composition-id="avatar-scene"/);
    assert.match(html, /src="assets\/avatar\//);
    assert.match(html, /src="assets\/gsap\.min\.js"/);
    assert.match(html, /data-track-index="0"/);
    assert.match(html, /id="avatar-body" class="clip sprite"/);
    const mouthY = 0.5 + (0.31 - 0.5) * (0.5 * (620 / 420) * (1280 / 720));
    assert.ok(html.includes(`style="--x:0.5;--y:${mouthY};--w:0.065"`));
    assert.doesNotMatch(html, /\.\.\/assets|data-layer=/);
    const index = readFileSync(join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(index, /id="title"/);
    assert.doesNotMatch(index, /timeline\.from\('#title'/);
    assert.match(html, /tl\.set\(el,\{attr:\{src:t\.restState\? t\.states\[t\.restState\]:t\.states\.default\}\},c\.end\)/);
    assert.equal(result.layers, 2);
    assert.throws(() => createAvatarComposition(root, spec), /already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (1 + width * 4));
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type);
    const payload = Buffer.concat([typeBytes, data]);
    let checksum = 0xffffffff;
    for (const byte of payload) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    typeBytes.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, 8 + data.length);
    return output;
  };
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
