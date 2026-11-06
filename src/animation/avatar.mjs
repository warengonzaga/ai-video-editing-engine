import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateAnimationCues } from './cues.mjs';
import { pngDimensions } from './png-image.mjs';
import { mapRhubarbCuesToSpriteStates, rhubarbLipSyncCues, validateRhubarbSpriteStates } from './rhubarb.mjs';

/** Build a generic sprite-avatar composition from user-supplied images and timed cues. */
export function createAvatarComposition(projectPath, specification) {
  const project = resolve(projectPath);
  const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
  const { durationSeconds, narration, lipSync } = specification ?? {};
  let layers = specification?.layers;
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
  if (index.includes('data-composition-src="compositions/avatar-scene.html"')) throw new Error('Avatar composition is already mounted.');
  const narrationPath = narration ?? lipSync?.audioPath;
  if (narrationPath && (!existsSync(resolve(narrationPath)) || existsSync(join(project, 'assets', `narration${extname(narrationPath).toLowerCase()}`)))) throw new Error('Narration is missing or the destination already exists.');
  let lipSyncLayerIndex = -1;
  if (lipSync !== undefined) {
    if (!lipSync || typeof lipSync !== 'object' || Array.isArray(lipSync)
        || typeof lipSync.audioPath !== 'string' || !lipSync.audioPath.trim()
        || typeof lipSync.layer !== 'string' || !/^[a-z][a-z0-9-]*$/.test(lipSync.layer)
        || (lipSync.options !== undefined && (!lipSync.options || typeof lipSync.options !== 'object' || Array.isArray(lipSync.options)))) {
      throw new TypeError('Avatar lipSync requires an audioPath, a mouth layer name, and optional Rhubarb options.');
    }
    lipSyncLayerIndex = layers.findIndex((layer) => layer?.name === lipSync.layer && layer.role === 'mouth');
    if (lipSyncLayerIndex < 0) throw new TypeError(`Avatar lipSync layer ${lipSync.layer} must name a mouth layer.`);
    if (layers[lipSyncLayerIndex].track !== undefined) throw new TypeError(`Avatar lipSync layer ${lipSync.layer} already has a track.`);
    validateRhubarbSpriteStates({ default: layers[lipSyncLayerIndex].image, ...(layers[lipSyncLayerIndex].states ?? {}) }, lipSync.options ?? {});
  }
  const names = new Set();
  const layouts = new Map();
  const canvasAspect = meta.width / meta.height;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (!layer || names.has(layer.name) || !/^[a-z][a-z0-9-]*$/.test(layer.name) || !['eyes', 'mouth', 'body', 'custom'].includes(layer.role)) throw new TypeError('Invalid or duplicate avatar layer.');
    names.add(layer.name);
    const track = index === lipSyncLayerIndex ? undefined : validateAnimationCues(layer.track);
    if (track && Math.abs(track.durationSeconds - durationSeconds) > 0.001) throw new TypeError('Avatar layer timing does not match the scene.');
    const states = { default: layer.image, ...(layer.states ?? {}) };
    const dimensionsByState = [];
    let defaultDimensions;
    for (const [state, path] of Object.entries(states)) {
      if (!/^[a-z][a-z0-9-]*$/.test(state) || typeof path !== 'string' || !existsSync(resolve(path)) || extname(path).toLowerCase() !== '.png') throw new TypeError(`Invalid sprite for ${layer.name}.${state}.`);
      const dimensions = pngDimensions(readFileSync(resolve(path)), `${layer.name}.${state}`);
      dimensionsByState.push(dimensions);
      if (state === 'default') defaultDimensions = dimensions;
    }
    if (dimensionsByState.some(({ width, height }) =>
      width !== defaultDimensions.width || height !== defaultDimensions.height)) {
      throw new TypeError(`Sprite states for ${layer.name} must use matching canvas dimensions.`);
    }
    for (const cue of track?.cues ?? []) if (!Object.hasOwn(states, cue.state)) throw new TypeError(`Missing sprite for ${layer.name}.${cue.state}.`);
    const width = Number(layer.width ?? .2);
    let x, y;
    if (layer.relativeTo !== undefined) {
      const parent = layouts.get(layer.relativeTo);
      const anchor = layer.anchor;
      if (!parent) throw new TypeError(`Avatar layer ${layer.name} must reference an earlier parent layer.`);
      if (Object.hasOwn(layer, 'x') || Object.hasOwn(layer, 'y')
          || !Array.isArray(anchor) || anchor.length !== 2
          || !anchor.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
          || !Number.isFinite(width) || width <= 0 || width > 1) {
        throw new TypeError(`Invalid parent-relative placement for ${layer.name}.`);
      }
      x = parent.x + (anchor[0] - 0.5) * parent.width;
      y = parent.y + (anchor[1] - 0.5) * parent.height;
      const childWidth = parent.width * width;
      layouts.set(layer.name, { x, y, width: childWidth, height: childWidth * (defaultDimensions.height / defaultDimensions.width) * canvasAspect });
    } else {
      const position = [Number(layer.x ?? .5), Number(layer.y ?? .5), width];
      if (Object.hasOwn(layer, 'anchor') || !position.every(Number.isFinite)
          || position[0] < 0 || position[0] > 1 || position[1] < 0 || position[1] > 1
          || position[2] <= 0 || position[2] > 1) throw new TypeError(`Invalid placement for ${layer.name}.`);
      [x, y] = position;
      layouts.set(layer.name, { x, y, width, height: width * (defaultDimensions.height / defaultDimensions.width) * canvasAspect });
    }
  }
  if (lipSyncLayerIndex >= 0) {
    const { spriteStateMap, ...rhubarbOptions } = lipSync.options ?? {};
    const generatedTrack = rhubarbLipSyncCues(lipSync.audioPath, rhubarbOptions);
    const spriteTrack = mapRhubarbCuesToSpriteStates(generatedTrack, spriteStateMap);
    layers = layers.map((layer, index) => index === lipSyncLayerIndex
      ? { ...layer, track: {
        schemaVersion: spriteTrack.schemaVersion,
        durationSeconds,
        cues: spriteTrack.cues
          .filter((cue) => cue.start < durationSeconds)
          .map((cue) => ({ ...cue, end: Math.min(cue.end, durationSeconds) })),
      } }
      : layer);
  }
  const spriteCopies = [];
  const safeLayers = layers.map((layer) => {
    const source = resolve(layer.image ?? '');
    const cues = validateAnimationCues(layer.track);
    const states = { default: source, ...(layer.states ?? {}) };
    for (const [state, image] of Object.entries(states)) {
      const stateSource = resolve(image);
      const target = join(assetDir, `${layer.name}-${state}-${basename(stateSource)}`);
      if (existsSync(target)) {
        if (!readFileSync(target).equals(readFileSync(stateSource))) {
          throw new Error(`Avatar sprite output already exists with different content: ${target}. Refusing to reuse a stale sprite.`);
        }
      } else {
        spriteCopies.push({ source: stateSource, target });
      }
      states[state] = `assets/avatar/${encodeURIComponent(basename(target))}`;
    }
    const layout = layouts.get(layer.name);
    return { name: layer.name, role: layer.role, image: states.default, states, ...layout, cues };
  });
  const id = 'avatar-scene';
  const timeline = safeLayers.map((layer) => ({ name: layer.name, states: layer.states, cues: layer.cues })).map(({name,states,cues}) => ({name,states,cues:cues.cues}));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>*{box-sizing:border-box}html,body,#${id}{margin:0;width:${meta.width}px;height:${meta.height}px;overflow:hidden}#${id}{position:relative;background:transparent}.sprite{position:absolute;left:calc(var(--x)*100%);top:calc(var(--y)*100%);width:calc(var(--w)*100%);height:auto;transform:translate(-50%,-50%)}</style></head><body><div id="${id}" data-composition-id="${id}" data-start="0" data-duration="${durationSeconds}" data-width="${meta.width}" data-height="${meta.height}">${safeLayers.map((layer, index) => `<img id="avatar-${layer.name}" class="clip sprite" data-track-index="${index}" data-start="0" data-duration="${durationSeconds}" src="${layer.image}" style="--x:${layer.x};--y:${layer.y};--w:${layer.width}">`).join('')}</div><script>const tracks=${JSON.stringify(timeline)};const tl=gsap.timeline({paused:true});for(let i=0;i<tracks.length;i++){const t=tracks[i],el=document.querySelector('.sprite[data-track-index="'+i+'"]');for(const c of t.cues){const src=t.states[c.state];if(!src)throw new Error('Missing sprite for '+t.name+': '+c.state);tl.set(el,{attr:{src}},c.start);tl.set(el,{attr:{src:t.states.default}},c.end)}}window.__timelines=window.__timelines||{};window.__timelines['${id}']=tl;</script></body></html>`;
  const mount = `\n    <div id="avatar-scene-instance" data-composition-id="avatar-scene-instance" data-composition-src="compositions/avatar-scene.html" data-start="0" data-duration="${durationSeconds}" data-track-index="10"></div>`;
  const withoutStarterTitle = index
    .replace(/\s*<div id="title" class="clip" data-start="0" data-duration="[^"]+" data-track-index="0">[^<]*<\/div>/, '')
    .replace(/^\s*timeline\.from\('#title',\s*\{[^}]+\}\);\s*$/m, '');
  const updated = withoutStarterTitle.replace(/\n\s*<\/div>\s*\n\s*<script>/, (match) => `${mount}${match}`);
  if (updated === index) throw new Error('Could not find the generated project root composition.');
  const committedFiles = [];
  let temporaryDirectory;
  let temporaryIndex;
  try {
    temporaryDirectory = mkdtempSync(join(project, '.avatar-scene-'));
    const stagedSprites = spriteCopies.map(({ source, target }, index) => {
      const staged = join(temporaryDirectory, `sprite-${index}.png`);
      copyFileSync(source, staged);
      return { staged, target };
    });
    const stagedComposition = join(temporaryDirectory, 'avatar-scene.html');
    writeFileSync(stagedComposition, html, { flag: 'wx' });
    let stagedNarration;
    let narrationName;
    if (narrationPath) {
      const audio = resolve(narrationPath);
      narrationName = `narration${extname(audio).toLowerCase()}`;
      stagedNarration = join(temporaryDirectory, narrationName);
      copyFileSync(audio, stagedNarration);
    }
    const finalIndex = narrationName
      ? updated.replace('</body>', `<audio id="narration" src="assets/${encodeURIComponent(narrationName)}" data-start="0" data-duration="${durationSeconds}" data-volume="1" hidden></audio></body>`)
      : updated;
    temporaryIndex = join(project, `.index.html.${randomUUID()}.tmp`);
    writeFileSync(temporaryIndex, finalIndex, { flag: 'wx' });

    mkdirSync(assetDir, { recursive: true });
    for (const { staged, target } of stagedSprites) {
      linkSync(staged, target);
      committedFiles.push(target);
      unlinkSync(staged);
    }
    if (stagedNarration) {
      const narrationTarget = join(project, 'assets', narrationName);
      linkSync(stagedNarration, narrationTarget);
      committedFiles.push(narrationTarget);
      unlinkSync(stagedNarration);
    }
    linkSync(stagedComposition, output);
    committedFiles.push(output);
    unlinkSync(stagedComposition);
    renameSync(temporaryIndex, indexPath);
    temporaryIndex = undefined;
  } catch (error) {
    const rollbackErrors = [];
    for (const path of committedFiles.reverse()) {
      try { rmSync(path, { force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Avatar composition failed and rollback was incomplete. Preserve project files and inspect ${project}.`);
    throw error;
  } finally {
    if (temporaryIndex) rmSync(temporaryIndex, { force: true });
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return { compositionPath: output, layers: safeLayers.length };
}
