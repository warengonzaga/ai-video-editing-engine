import { closeSync, createReadStream, linkSync, openSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { link, open, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Publish a staged file without overwriting an existing destination. */
export function linkOrCopySync(source, destination) {
  try {
    linkSync(source, destination);
  } catch (error) {
    if (!isUnsupportedHardLinkError(error)) throw error;
    copyFileExclusiveSync(source, destination);
  }
}

/** Publish a staged file asynchronously and report bytes only when copied. */
export async function linkOrCopyAsync(source, destination, { signal, onCopyProgress } = {}) {
  try {
    await link(source, destination);
  } catch (error) {
    if (!isUnsupportedHardLinkError(error)) throw error;
    const destinationHandle = await open(destination, 'wx');
    try {
      const progress = onCopyProgress ? createCopyProgress(source, onCopyProgress) : undefined;
      const streams = [createReadStream(source, { signal }), ...(progress ? [progress] : []), destinationHandle.createWriteStream()];
      await pipeline(...streams, { signal });
    } catch (copyError) {
      await destinationHandle.close().catch(() => {});
      await rm(destination, { force: true }).catch(() => {});
      throw copyError;
    }
  }
}

function isUnsupportedHardLinkError(error) {
  return ['EPERM', 'EXDEV', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error?.code);
}

function copyFileExclusiveSync(source, destination) {
  let sourceDescriptor;
  let destinationDescriptor;
  try {
    sourceDescriptor = openSync(source, 'r');
    destinationDescriptor = openSync(destination, 'wx');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead;
    while ((bytesRead = readSync(sourceDescriptor, buffer, 0, buffer.length, null)) > 0) {
      let offset = 0;
      while (offset < bytesRead) offset += writeSync(destinationDescriptor, buffer, offset, bytesRead - offset);
    }
    closeSync(destinationDescriptor);
    destinationDescriptor = undefined;
  } catch (error) {
    if (destinationDescriptor !== undefined) {
      try { closeSync(destinationDescriptor); } catch { /* Preserve the original copy error. */ }
      destinationDescriptor = undefined;
      try { rmSync(destination, { force: true }); } catch { /* Preserve the original copy error. */ }
    }
    throw error;
  } finally {
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
  }
}

function createCopyProgress(source, onCopyProgress) {
  const totalBytes = statSync(source).size;
  let completedBytes = 0;
  let lastPercent = -1;
  return new Transform({
    transform(chunk, encoding, callback) {
      completedBytes += chunk.length;
      const percent = totalBytes > 0 ? Math.floor(completedBytes / totalBytes * 100) : 100;
      if (percent > lastPercent || completedBytes >= totalBytes) {
        lastPercent = percent;
        onCopyProgress(completedBytes, totalBytes);
      }
      callback(null, chunk);
    },
  });
}
