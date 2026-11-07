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

function warnProgressCallback(error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.emitWarning(`Render progress callback failed: ${detail}`);
}
