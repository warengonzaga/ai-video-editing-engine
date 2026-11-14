import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createStudioProject, setupStudioWorkspace } from '../src/studio/workspaces.mjs';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

test('sets up an isolated Studio workspace and creates Engine projects inside it', () => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-studio-'));
  try {
    const paths = setupStudioWorkspace('explainer', root);
    assert.equal(paths.root, root);
    assert.equal(existsSync(join(paths.avatarPacks)), true);
    assert.equal(existsSync(join(paths.projects)), true);
    const project = createStudioProject('explainer', 'open-source', root, { preset: 'vertical' });
    const meta = JSON.parse(readFileSync(join(project, 'meta.json'), 'utf8'));
    assert.equal(project, join(paths.projects, 'open-source'));
    assert.deepEqual(
      { width: meta.width, height: meta.height, canvasPreset: meta.canvasPreset },
      { width: 1080, height: 1920, canvasPreset: 'vertical' },
    );
    assert.throws(() => createStudioProject('explainer', 'open-source', root), /already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Studio setup CLI returns workspace paths for the host plugin to save', () => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-studio-cli-'));
  try {
    const output = execFileSync(process.execPath, [cliPath, 'studio', 'setup', 'explainer', '--home', root], {
      encoding: 'utf8',
    });
    const paths = JSON.parse(output);
    assert.equal(paths.avatarPacks, join(root, 'Studios', 'Explainer', 'Library', 'Avatar Packs'));
    assert.equal(paths.projects, join(root, 'Studios', 'Explainer', 'Projects'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Studio project CLI creates a video project at its workspace path', () => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-studio-project-'));
  try {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'studio', 'project', 'create', 'explainer', 'first-film', '--home', root, '--preset', 'vertical'],
      { encoding: 'utf8' },
    );
    const { project } = JSON.parse(output);
    assert.equal(project, join(root, 'Studios', 'Explainer', 'Projects', 'first-film'));
    assert.equal(existsSync(join(project, 'timeline.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid Studio and project identifiers', () => {
  const root = mkdtempSync(join(tmpdir(), 'aivee-studio-invalid-'));
  try {
    assert.throws(() => setupStudioWorkspace('../outside', root), /kebab-case studio id/);
    assert.throws(() => createStudioProject('explainer', '../outside', root), /kebab-case slug/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
