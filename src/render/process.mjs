import { spawn } from 'node:child_process';

export function runProcess(command, args, { cwd, signal, stdio = 'inherit', windowsHide = true } = {}) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const capture = stdio === 'capture';
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : stdio,
      windowsHide,
      detached: process.platform !== 'win32',
    });
    let settled = false;
    let killPromise;
    let forceTimer;
    const outputLimit = 16 * 1024 * 1024;
    const output = { stdout: [], stderr: [], stdoutBytes: 0, stderrBytes: 0 };
    const captureOutput = (stream, key, byteKey) => {
      stream?.on('data', (chunk) => {
        if (output[byteKey] >= outputLimit) return;
        const retained = chunk.subarray(0, outputLimit - output[byteKey]);
        output[key].push(retained);
        output[byteKey] += retained.length;
      });
    };
    if (capture) {
      captureOutput(child.stdout, 'stdout', 'stdoutBytes');
      captureOutput(child.stderr, 'stderr', 'stderrBytes');
    }
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      if (killPromise) return;
      killPromise = terminateProcessTree(child, (timer) => { forceTimer = timer; });
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      finish(reject, signal?.aborted ? abortReason(signal) : error);
    });
    child.once('close', async (code, signalName) => {
      if (killPromise) await killPromise;
      if (signal?.aborted) {
        finish(reject, abortReason(signal));
      } else if (code === 0) {
        finish(resolve, capture ? { stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') } : true);
      } else {
        const stderr = capture ? Buffer.concat(output.stderr).toString('utf8').trim() : '';
        finish(reject, new Error(`${command} exited with ${signalName ? `signal ${signalName}` : `code ${code}`}.${stderr ? ` ${stderr}` : ''}`));
      }
    });
    if (signal?.aborted) abort();
  });
}

function terminateProcessTree(child, setForceTimer) {
  if (!child.pid) {
    child.kill('SIGTERM');
    return Promise.resolve();
  }
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      let settled = false;
      const fallbackTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      }, 2000);
      setForceTimer(fallbackTimer);
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      killer.once('error', () => {
        child.kill('SIGTERM');
        finish();
      });
      killer.once('close', (code) => {
        if (code !== 0 && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        finish();
      });
    });
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const forceTimer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process tree already exited */ }
  }, 1500);
  forceTimer.unref();
  setForceTimer(forceTimer);
  return Promise.resolve();
}

function abortReason(signal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Render cancelled.');
  error.name = 'AbortError';
  return error;
}
