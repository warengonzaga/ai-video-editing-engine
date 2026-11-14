import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { normalizeFrameRate } from '../media/frame-rate.mjs';
import { DEFAULT_PROJECT_BACKGROUND_COLOR, validateProjectBackgroundColor } from '../timeline/background.mjs';
import { createProjectTimeline } from '../timeline/project.mjs';
import { DEFAULT_SOURCE_FIT, validateSourceFit } from '../timeline/source-fit.mjs';
import { resolveCanvasPreset } from './presets.mjs';

const require = createRequire(import.meta.url);

export function createVideoProject(root, slug, options = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new TypeError('Use a lowercase kebab-case slug, not a path.');
  }
  const {
    fps: requestedFps = 30,
    durationSeconds = 10,
    sourceFit = DEFAULT_SOURCE_FIT,
    backgroundColor = DEFAULT_PROJECT_BACKGROUND_COLOR,
  } = options;
  if (options.preset !== undefined && (options.width !== undefined || options.height !== undefined)) {
    throw new TypeError('Choose a canvas preset or custom width and height, not both.');
  }
  const preset = options.preset === undefined ? undefined : resolveCanvasPreset(options.preset);
  const width = preset?.width ?? options.width ?? 1920;
  const height = preset?.height ?? options.height ?? 1080;
  validateSourceFit(sourceFit, 'sourceFit');
  validateProjectBackgroundColor(backgroundColor, 'backgroundColor');
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Width and height must be positive integers.');
  }
  const fps = normalizeFrameRate(requestedFps);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('durationSeconds must be a positive number.');
  }
  if (options.projectsDirectory !== undefined && (typeof options.projectsDirectory !== 'string' || !options.projectsDirectory.trim())) {
    throw new TypeError('projectsDirectory must be a non-empty path.');
  }
  const projectsPath = resolve(options.projectsDirectory ?? join(root, 'video-projects'));
  const projectPath = resolve(projectsPath, slug);
  if (existsSync(projectPath)) throw new Error(`Project already exists: ${slug}`);

  const project = {
    schemaVersion: 1,
    id: slug,
    name: slug,
    width,
    height,
    fps,
    durationSeconds,
    sourceFit,
    backgroundColor,
    ...(preset ? { canvasPreset: preset.id } : {}),
  };
  const directories = ['assets', 'transcripts', 'edits', 'compositions', 'renders'];
  mkdirSync(projectsPath, { recursive: true });
  mkdirSync(projectPath);
  try {
    for (const directory of directories) mkdirSync(join(projectPath, directory));
    const gsapPath = join(dirname(require.resolve('gsap')), 'gsap.min.js');
    copyFileSync(gsapPath, join(projectPath, 'assets', 'gsap.min.js'));
    writeFileSync(join(projectPath, 'meta.json'), `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(
      join(projectPath, 'hyperframes.json'),
      `${JSON.stringify(
        {
          $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
          paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    );
    writeFileSync(join(projectPath, 'index.html'), starterHtml(project), { flag: 'wx' });
    writeFileSync(
      join(projectPath, 'timeline.json'),
      `${JSON.stringify(createProjectTimeline(projectPath), null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch (error) {
    rmSync(projectPath, { recursive: true, force: true });
    throw error;
  }
  return projectPath;
}

function starterHtml({ name, width, height, durationSeconds, backgroundColor }) {
  const background = backgroundColor ?? 'transparent';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, initial-scale=1">
  <title>${escapeHtml(name)}</title>
  <link rel="icon" href="data:,">
  <style>html,body,#root{box-sizing:border-box;margin:0;width:${width}px;height:${height}px}body{background:${background};color:#f5f5f5;font:48px system-ui,sans-serif}#root{display:grid;place-items:center}</style>
  <script src="assets/gsap.min.js"></script>
</head>
<body>
  <div id="root" data-composition-id="root" data-start="0" data-duration="${durationSeconds}" data-width="${width}" data-height="${height}">
    <div id="title" class="clip" data-start="0" data-duration="${durationSeconds}" data-track-index="0">${escapeHtml(name)}</div>
  </div>
  <script>
    const timeline = gsap.timeline({ paused: true });
    timeline.from('#title', { opacity: 0, y: 24, duration: 0.8, ease: 'power2.out' });
    window.__timelines = window.__timelines || {};
    window.__timelines.root = timeline;
  </script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}
