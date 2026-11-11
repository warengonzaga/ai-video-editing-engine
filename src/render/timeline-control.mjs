export function createTimelineRenderControl(signal, timeoutSeconds) {
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('Render signal must be an AbortSignal.');
  }
  if (
    timeoutSeconds !== undefined &&
    (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86_400)
  ) {
    throw new TypeError('Render timeoutSeconds must be an integer from 1 to 86400.');
  }

  const controller = new AbortController();
  const deadline = timeoutSeconds === undefined ? undefined : Date.now() + timeoutSeconds * 1000;
  const timeoutError = () => {
    const error = new Error(`Render exceeded the configured timeout of ${timeoutSeconds} seconds.`);
    error.name = 'TimeoutError';
    return error;
  };
  const relayAbort = () => controller.abort(signal.reason ?? new DOMException('Render was aborted.', 'AbortError'));
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timer =
    deadline === undefined ? undefined : setTimeout(() => controller.abort(timeoutError()), timeoutSeconds * 1000);
  timer?.unref();

  return {
    signal: controller.signal,
    assertActive() {
      if (signal?.aborted && !controller.signal.aborted) relayAbort();
      if (deadline !== undefined && Date.now() >= deadline) controller.abort(timeoutError());
      if (controller.signal.aborted)
        throw controller.signal.reason ?? new DOMException('Render was aborted.', 'AbortError');
    },
    timeoutMs() {
      if (deadline === undefined) return undefined;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        controller.abort(timeoutError());
        this.assertActive();
      }
      return Math.max(1, Math.ceil(remaining));
    },
    processError(error) {
      if (signal?.aborted && !controller.signal.aborted) relayAbort();
      if (controller.signal.aborted) return controller.signal.reason;
      if (error?.code === 'ETIMEDOUT' || (deadline !== undefined && Date.now() >= deadline)) {
        controller.abort(timeoutError());
        return controller.signal.reason;
      }
      return error;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', relayAbort);
    },
  };
}
