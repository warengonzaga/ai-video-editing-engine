import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/render/process.mjs';

test('runs external process and terminates it on abort', async () => {
  await assert.doesNotReject(() => runProcess(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }));
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', signal: controller.signal,
  });
  setTimeout(() => controller.abort(Object.assign(new Error('Render cancelled by caller.'), { name: 'AbortError' })), 100);
  await assert.rejects(pending, (error) => error.name === 'AbortError' && /cancelled by caller/.test(error.message));
});
