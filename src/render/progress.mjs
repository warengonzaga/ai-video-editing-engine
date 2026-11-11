export function emitRenderProgress(onProgress, stage, phase, details = {}) {
  if (!onProgress) return;
  try {
    const percent = phase === 'completed' ? 100 : phase === 'started' ? 0 : undefined;
    const result = onProgress({ stage, phase, ...(percent !== undefined ? { percent } : {}), ...details });
    if (result && typeof result.then === 'function') Promise.resolve(result).catch(warnProgressCallback);
  } catch (error) {
    warnProgressCallback(error);
  }
}

export function createFfmpegProgressParser(onProgress, stage, durationSeconds, details = {}) {
  let pending = '';
  let currentTimeUs;
  const parseLine = (line) => {
    const separator = line.indexOf('=');
    if (separator < 0) return;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'out_time_us') currentTimeUs = Number(value);
    if (key !== 'progress' || !Number.isFinite(currentTimeUs)) return;
    const completed = Math.max(0, currentTimeUs / 1_000_000);
    const percent = Math.max(0, Math.min(99, (completed / durationSeconds) * 100));
    emitRenderProgress(onProgress, stage, 'progress', { percent, completed, total: durationSeconds, ...details });
  };
  return {
    push(chunk) {
      pending += chunk.toString('utf8');
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        parseLine(pending.slice(0, newline).replace(/\r$/, ''));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
      if (pending.length > 4096) pending = pending.slice(-4096);
    },
    flush() {
      if (pending) parseLine(pending);
      pending = '';
    },
  };
}

function warnProgressCallback(error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.emitWarning(`Progress callback failed: ${detail}`);
}
