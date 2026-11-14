import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createVideoProject } from '../project/create.mjs';

const STUDIO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function studioPaths(studioId, root = join(homedir(), 'AIVEE')) {
  if (!STUDIO_ID.test(studioId)) throw new TypeError('Use a lowercase kebab-case studio id.');
  const studioName = studioId.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
  const directory = resolve(root, 'Studios', studioName);
  return {
    root: resolve(root),
    studio: directory,
    library: join(directory, 'Library'),
    avatarPacks: join(directory, 'Library', 'Avatar Packs'),
    projects: join(directory, 'Projects'),
  };
}

export function setupStudioWorkspace(studioId, root) {
  const paths = studioPaths(studioId, root);
  for (const directory of [paths.avatarPacks, paths.projects]) mkdirSync(directory, { recursive: true });
  return paths;
}

export function createStudioProject(studioId, slug, root, options = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new TypeError('Use a lowercase kebab-case slug, not a path.');
  const paths = setupStudioWorkspace(studioId, root);
  return createVideoProject(paths.studio, slug, { ...options, projectsDirectory: paths.projects });
}
