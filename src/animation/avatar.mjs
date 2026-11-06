import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { validateAnimationCues } from './cues.mjs';

/** Build a generic sprite-avatar composition from user-supplied images and timed cues. */
export function createAvatarComposition(projectPath, specification) {
  const project = resolve(projectPath);
  const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
  const { durationSeconds, layers, narration } = specification ?? {};
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds - meta.durationSeconds) > 0.001 || !Array.isArray(layers) || !layers.length) {
    throw new TypeError('Avatar specification duration must match project duration and include layers.');
  }
  const assetDir = join(project, 'assets', 'avatar');
  const compositionDir = join(project, 'compositions');
  const output = join(compositionDir, 'avatar-scene.html');
  const indexPath = join(project, 'index.html');
  if (existsSync(output)) throw new Error('Avatar composition already exists.');
  const index = readFileSync(indexPath, 'utf8');
  if (!/\n\s*<\/div>\s*\n\s*<script>/.test(index)) throw new Error('Could not find the generated project root composition.');
  if (narration && (!existsSync(resolve(narration)) || existsSync(join(project, 'assets', `narration${extname(narration).toLowerCase()}`)))) throw new Error('Narration is missing or the destination already exists.');
  const names = new Set();
  for (const layer of layers) {
    if (!layer || names.has(layer.name) || !/^[a-z][a-z0-9-]*$/.test(layer.name) || !['eyes', 'mouth', 'body', 'custom'].includes(layer.role)) throw new TypeError('Invalid or duplicate avatar layer.');
    names.add(layer.name);
    const track = validateAnimationCues(layer.track);
    if (Math.abs(track.durationSeconds - durationSeconds) > 0.001) throw new TypeError('Avatar layer timing does not match the scene.');
    const states = { default: layer.image, ...(layer.states ?? {}) };
    for (const [state, path] of Object.entries(states)) {
      if (!/^[a-z][a-z0-9-]*$/.test(state) || typeof path !== 'string' || !existsSync(resolve(path)) || extname(path).toLowerCase() !== '.png') throw new TypeError(`Invalid sprite for ${layer.name}.${state}.`);
    }
    for (const cue of track.cues) if (!Object.hasOwn(states, cue.state)) throw new TypeError(`Missing sprite for ${layer.name}.${cue.state}.`);
    const position = [Number(layer.x ?? .5), Number(layer.y ?? .5), Number(layer.width ?? .2)];
    if (!position.every(Number.isFinite) || position[0] < 0 || position[0] > 1 || position[1] < 0 || position[1] > 1 || position[2] <= 0 || position[2] > 1) throw new TypeError(`Invalid placement for ${layer.name}.`);
  }
  mkdirSync(assetDir, { recursive: true });
  const safeLayers = layers.map((layer, index) => {
    if (!layer || !/^[a-z][a-z0-9-]*$/.test(layer.name) || !['eyes', 'mouth', 'body', 'custom'].includes(layer.role)) throw new TypeError(`Invalid avatar layer at index ${index}.`);
    const source = resolve(layer.image ?? '');
    if (!existsSync(source) || extname(source).toLowerCase() !== '.png') throw new TypeError(`Avatar layer ${layer.name} must reference an existing PNG.`);
    const cues = validateAnimationCues(layer.track);
    if (Math.abs(cues.durationSeconds - durationSeconds) > 0.001) throw new TypeError(`Avatar layer ${layer.name} timing does not match the scene.`);
    const states = { default: source, ...(layer.states ?? {}) };
    for (const [state, image] of Object.entries(states)) {
      if (!/^[a-z][a-z0-9-]*$/.test(state)) throw new TypeError(`Invalid state name for ${layer.name}.`);
      const stateSource = resolve(image);
      if (!existsSync(stateSource) || extname(stateSource).toLowerCase() !== '.png') throw new TypeError(`State ${state} for ${layer.name} must reference an existing PNG.`);
      const target = join(assetDir, `${layer.name}-${state}-${basename(stateSource)}`);
      if (!existsSync(target)) copyFileSync(stateSource, target);
      states[state] = `assets/avatar/${basename(target)}`;
    }
    const x = Number(layer.x ?? 0.5), y = Number(layer.y ?? 0.5), width = Number(layer.width ?? 0.2);
    if (![x, y, width].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1 || width <= 0 || width > 1) throw new TypeError(`Invalid normalized placement for ${layer.name}.`);
    return { name: layer.name, role: layer.role, image: states.default, states, x, y, width, cues };
  });
  const id = 'avatar-scene';
  const timeline = safeLayers.map((layer) => ({ name: layer.name, states: layer.states, cues: layer.cues })).map(({name,states,cues}) => ({name,states,cues:cues.cues}));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>*{box-sizing:border-box}html,body,#${id}{margin:0;width:${meta.width}px;height:${meta.height}px;overflow:hidden}#${id}{position:relative;background:transparent}.sprite{position:absolute;left:calc(var(--x)*100%);top:calc(var(--y)*100%);width:calc(var(--w)*100%);height:auto;transform:translate(-50%,-50%)}</style></head><body><div id="${id}" data-composition-id="${id}" data-start="0" data-duration="${durationSeconds}" data-width="${meta.width}" data-height="${meta.height}">${safeLayers.map((layer, index) => `<img id="avatar-${layer.name}" class="clip sprite" data-track-index="${index}" data-start="0" data-duration="${durationSeconds}" src="${layer.image}" style="--x:${layer.x};--y:${layer.y};--w:${layer.width}">`).join('')}</div><script>const tracks=${JSON.stringify(timeline)};const tl=gsap.timeline({paused:true});for(let i=0;i<tracks.length;i++){const t=tracks[i],el=document.querySelector('.sprite[data-track-index="'+i+'"]');for(const c of t.cues){const src=t.states[c.state];if(!src)throw new Error('Missing sprite for '+t.name+': '+c.state);tl.set(el,{attr:{src}},c.start);tl.set(el,{attr:{src:t.states.default}},c.end)}}window.__timelines=window.__timelines||{};window.__timelines['${id}']=tl;</script></body></html>`;
  writeFileSync(output, html, { flag: 'wx' });
  if (index.includes('data-composition-src="compositions/avatar-scene.html"')) throw new Error('Avatar composition is already mounted.');
  const mount = `\n    <div id="avatar-scene-instance" data-composition-id="avatar-scene-instance" data-composition-src="compositions/avatar-scene.html" data-start="0" data-duration="${durationSeconds}" data-track-index="10"></div>`;
  const withoutStarterTitle = index.replace(/\s*<div id="title" class="clip" data-start="0" data-duration="[^"]+" data-track-index="0">[^<]*<\/div>/, '');
  const updated = withoutStarterTitle.replace(/\n\s*<\/div>\s*\n\s*<script>/, (match) => `${mount}${match}`);
  if (updated === index) throw new Error('Could not find the generated project root composition.');
  writeFileSync(indexPath, updated);
  if (narration) {
    const audio = resolve(narration);
    if (!existsSync(audio)) throw new TypeError('Narration file does not exist.');
    const audioName = `narration${extname(audio).toLowerCase()}`;
    copyFileSync(audio, join(project, 'assets', audioName));
    const withAudio = readFileSync(indexPath, 'utf8').replace('</body>', `<audio id="narration" src="assets/${audioName}" data-start="0" data-duration="${durationSeconds}" data-volume="1" hidden></audio></body>`);
    writeFileSync(indexPath, withAudio);
  }
  return { compositionPath: output, layers: safeLayers.length };
}
