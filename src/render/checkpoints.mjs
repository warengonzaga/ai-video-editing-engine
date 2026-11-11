import { createHash } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const CHECKPOINT_VERSION = 1;
const EXCLUDED_DIRECTORIES = new Set(['.git', '.aive-checkpoints', 'node_modules', 'renders']);

export async function fingerprintRenderProject(projectPath, profile) {
  const root = resolve(projectPath);
  const hash = createHash('sha256');
  hash.update(JSON.stringify(profile));
  const files = await collectFiles(root);
  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join('/');
    hash.update(`\0${relativePath}\0`);
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function prepareRenderCheckpoint(outputPath, fingerprint, options = {}) {
  const maxBytes = options.maxBytes ?? 8 * 1024 ** 3;
  const maxAgeHours = options.maxAgeHours ?? 72;
  validateCheckpointLimits(maxBytes, maxAgeHours);
  const root = join(dirname(resolve(outputPath)), '.aive-checkpoints');
  await pruneExpiredRenderCheckpoints(root, maxAgeHours);
  const id = createHash('sha256')
    .update(`${basename(outputPath)}\0${fingerprint}`)
    .digest('hex');
  const directory = join(root, id);
  await assertSafeCheckpointDirectory(root, directory);
  const artifact = join(directory, `capture.${extension(outputPath)}`);
  const manifest = join(directory, 'checkpoint.json');
  return { root, id, directory, artifact, manifest, fingerprint, maxBytes, maxAgeHours };
}

export async function restoreRenderCheckpoint(checkpoint) {
  await assertSafeCheckpointDirectory(checkpoint.root, checkpoint.directory);
  let record;
  try {
    const parsed = JSON.parse(await readFile(checkpoint.manifest, 'utf8'));
    const info = await lstat(checkpoint.artifact);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size <= 0 ||
      info.size > checkpoint.maxBytes ||
      parsed.sizeBytes !== info.size ||
      parsed.version !== CHECKPOINT_VERSION ||
      parsed.fingerprint !== checkpoint.fingerprint ||
      parsed.artifact !== basename(checkpoint.artifact) ||
      !Number.isFinite(parsed.createdAt) ||
      Date.now() - parsed.createdAt > checkpoint.maxAgeHours * 60 * 60 * 1000
    ) {
      await rm(checkpoint.directory, { recursive: true, force: true });
      return undefined;
    }
    record = parsed;
    if ((await hashFile(checkpoint.artifact)) !== record.sha256) {
      await rm(checkpoint.directory, { recursive: true, force: true });
      return undefined;
    }
    return checkpoint.artifact;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError)
      await rm(checkpoint.directory, { recursive: true, force: true });
    return undefined;
  }
}

export async function saveRenderCheckpoint(checkpoint, completedArtifact) {
  await assertSafeCheckpointDirectory(checkpoint.root, checkpoint.directory);
  const info = await stat(completedArtifact);
  if (!info.isFile() || info.size <= 0) throw new Error('Cannot checkpoint an empty render artifact.');
  if (info.size > checkpoint.maxBytes) {
    await rm(checkpoint.directory, { recursive: true, force: true });
    return undefined;
  }
  await mkdir(checkpoint.directory, { recursive: true, mode: 0o700 });
  const temporaryArtifact = `${checkpoint.artifact}.tmp`;
  const temporaryManifest = `${checkpoint.manifest}.tmp`;
  try {
    await rm(temporaryArtifact, { force: true });
    await rm(temporaryManifest, { force: true });
    await copyFile(completedArtifact, temporaryArtifact);
    const record = {
      version: CHECKPOINT_VERSION,
      fingerprint: checkpoint.fingerprint,
      artifact: basename(checkpoint.artifact),
      sizeBytes: info.size,
      sha256: await hashFile(temporaryArtifact),
      createdAt: Date.now(),
    };
    await writeFile(temporaryManifest, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await copyFile(temporaryArtifact, checkpoint.artifact, fsConstants.COPYFILE_EXCL);
    await rm(temporaryArtifact, { force: true });
    await copyFile(temporaryManifest, checkpoint.manifest, fsConstants.COPYFILE_EXCL);
    await rm(temporaryManifest, { force: true });
    return checkpoint.artifact;
  } catch (error) {
    await rm(temporaryArtifact, { force: true });
    await rm(temporaryManifest, { force: true });
    throw error;
  }
}

export async function removeRenderCheckpoint(checkpoint) {
  await assertSafeCheckpointDirectory(checkpoint.root, checkpoint.directory);
  await rm(checkpoint.directory, { recursive: true, force: true });
}

export async function pruneExpiredRenderCheckpoints(rootPath, maxAgeHours = 72) {
  const root = resolve(rootPath);
  const rootInfo = await lstatIfPresent(root);
  if (rootInfo && (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())) {
    throw new TypeError('Render checkpoint root must be a real directory, not a symbolic link.');
  }
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const expireBefore = Date.now() - maxAgeHours * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    try {
      const record = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8'));
      if (!Number.isFinite(record.createdAt) || record.createdAt < expireBefore) {
        await rm(directory, { recursive: true, force: true });
      }
    } catch {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function assertSafeCheckpointDirectory(rootPath, directoryPath) {
  const root = resolve(rootPath);
  const directory = resolve(directoryPath);
  if (dirname(directory) !== root)
    throw new TypeError('Render checkpoint directory must be directly inside its checkpoint root.');
  const rootInfo = await lstatIfPresent(root);
  if (rootInfo && (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())) {
    throw new TypeError('Render checkpoint root must be a real directory, not a symbolic link.');
  }
  const directoryInfo = await lstatIfPresent(directory);
  if (directoryInfo && (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory())) {
    throw new TypeError('Render checkpoint directory must be a real directory, not a symbolic link.');
  }
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function validateCheckpointLimits(maxBytes, maxAgeHours) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 * 1024 || maxBytes > 100 * 1024 ** 3) {
    throw new TypeError('checkpointMaxBytes must be an integer from 1048576 to 107374182400.');
  }
  if (!Number.isSafeInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 720) {
    throw new TypeError('checkpointMaxAgeHours must be an integer from 1 to 720.');
  }
}

async function collectFiles(root) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await stat(path);
        if (target.isFile()) files.push(path);
        else if (target.isDirectory())
          throw new Error(`Cannot fingerprint a project containing a linked directory: ${relative(root, path)}`);
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(path);
      } else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function extension(path) {
  const value = basename(path).split('.').at(-1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(value) ? value : 'bin';
}
