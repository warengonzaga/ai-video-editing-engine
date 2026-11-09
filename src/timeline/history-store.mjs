import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { editTimeline, editTimelineBatch } from './edit.mjs';
import { validateTimeline } from './validate.mjs';
import { timelineFingerprint } from './fingerprint.mjs';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;

export function editTimelineFile(timelinePath, operation, { limit } = {}) {
  return withHistoryLock(timelinePath, () => {
    const history = loadHistory(timelinePath, limit, { createIfMissing: true });
    const next = Array.isArray(operation)
      ? editTimelineBatch(history.timeline, operation)
      : editTimeline(history.timeline, operation);
    const undo = [...history.undo, history.timeline].slice(-history.limit);
    return commitHistory(timelinePath, {
      ...history,
      timeline: next,
      timelineHash: hashTimeline(next),
      previousTimelineHash: history.timelineHash,
      undo,
      redo: [],
    });
  });
}

/** Apply an explicitly approved review plan if it was created from the current timeline. */
export function applyTimelineReviewPlan(timelinePath, plan, { limit } = {}) {
  validateReviewPlan(plan);
  return withHistoryLock(timelinePath, () => {
    const { path, timeline } = readTimeline(timelinePath);
    const baseHash = hashTimeline(timeline);
    if (baseHash !== plan.baseTimelineSha256) {
      throw new Error('Review plan is stale because the timeline changed after the plan was created. Generate a new plan.');
    }
    const next = editTimelineBatch(timeline, plan.operations);
    const history = loadHistory(path, limit);
    if (history.timelineHash !== baseHash) {
      throw new Error('Review plan is stale because the timeline history changed after the plan was created. Generate a new plan.');
    }
    const undo = [...history.undo, history.timeline].slice(-history.limit);
    const result = commitHistory(path, {
      ...history,
      timeline: next,
      timelineHash: hashTimeline(next),
      previousTimelineHash: history.timelineHash,
      undo,
      redo: [],
    });
    return {
      ...result,
      appliedReviewPlan: plan.type,
      appliedOperationCount: plan.operations.length,
    };
  });
}

export function undoTimelineFile(timelinePath) {
  return withHistoryLock(timelinePath, () => {
    const history = loadHistory(timelinePath);
    if (history.undo.length === 0) return describeHistory(history);
    const undo = [...history.undo];
    const timeline = undo.pop();
    return commitHistory(timelinePath, {
      ...history,
      timeline,
      timelineHash: hashTimeline(timeline),
      previousTimelineHash: history.timelineHash,
      undo,
      redo: [...history.redo, history.timeline].slice(-history.limit),
    });
  });
}

export function redoTimelineFile(timelinePath) {
  return withHistoryLock(timelinePath, () => {
    const history = loadHistory(timelinePath);
    if (history.redo.length === 0) return describeHistory(history);
    const redo = [...history.redo];
    const timeline = redo.pop();
    return commitHistory(timelinePath, {
      ...history,
      timeline,
      timelineHash: hashTimeline(timeline),
      previousTimelineHash: history.timelineHash,
      undo: [...history.undo, history.timeline].slice(-history.limit),
      redo,
    });
  });
}

export function getTimelineFileHistory(timelinePath) {
  return withHistoryLock(timelinePath, () => describeHistory(loadHistory(timelinePath)));
}

export function resetTimelineFileHistory(timelinePath, { limit = DEFAULT_LIMIT } = {}) {
  validateLimit(limit);
  return withHistoryLock(timelinePath, () => {
    const { timeline } = readTimeline(timelinePath);
    return commitHistory(timelinePath, {
      schemaVersion: 1,
      limit,
      timeline,
      timelineHash: hashTimeline(timeline),
      previousTimelineHash: null,
      undo: [],
      redo: [],
    });
  });
}

function loadHistory(timelinePath, requestedLimit, { createIfMissing = false } = {}) {
  if (requestedLimit !== undefined) validateLimit(requestedLimit);
  const { path, timeline } = readTimeline(timelinePath);
  const historyPath = getHistoryPath(path);
  if (!existsSync(historyPath)) {
    const state = {
      schemaVersion: 1,
      limit: requestedLimit ?? DEFAULT_LIMIT,
      timeline,
      timelineHash: hashTimeline(timeline),
      previousTimelineHash: null,
      undo: [],
      redo: [],
    };
    if (createIfMissing) writeHistoryFile(historyPath, state);
    return state;
  }
  if (lstatSync(historyPath).isSymbolicLink()) throw new TypeError('Timeline history file cannot be a symbolic link.');
  if (statSync(historyPath).size > MAX_HISTORY_BYTES) throw new RangeError(`Timeline history exceeds the ${MAX_HISTORY_BYTES / 1024 / 1024} MiB limit.`);
  const state = JSON.parse(readFileSync(historyPath, 'utf8'));
  validateHistory(state);
  if (requestedLimit !== undefined && requestedLimit !== state.limit) {
    throw new TypeError(`Timeline history already uses limit ${state.limit}; reset it to change the limit.`);
  }

  const diskHash = hashTimeline(timeline);
  if (diskHash === state.timelineHash) return state;
  if (state.previousTimelineHash !== null && diskHash === state.previousTimelineHash) {
    writeTimelineFile(path, state.timeline);
    return state;
  }
  throw new Error(`Timeline changed outside its history session: ${path}. Use timeline history reset to start a new session.`);
}

function readTimeline(timelinePath) {
  const path = resolve(timelinePath);
  if (!existsSync(path)) throw new Error(`Timeline file not found: ${path}`);
  if (lstatSync(path).isSymbolicLink()) throw new TypeError('Timeline file cannot be a symbolic link when using persistent history.');
  const timeline = JSON.parse(readFileSync(path, 'utf8'));
  validateTimeline(timeline);
  return { path, timeline };
}

function commitHistory(timelinePath, state) {
  const { path } = readTimeline(timelinePath);
  validateHistory(state);
  writeHistoryFile(getHistoryPath(path), state);
  writeTimelineFile(path, state.timeline);
  return describeHistory(state);
}

function withHistoryLock(timelinePath, operation) {
  const timeline = resolve(timelinePath);
  const lockPath = join(dirname(timeline), `.${basename(timeline)}.history.lock`);
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST' && removeStaleHistoryLock(lockPath)) descriptor = openSync(lockPath, 'wx');
    else if (error.code === 'EEXIST') throw new Error(`Timeline history is locked by another operation: ${lockPath}`);
    else throw error;
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}

function removeStaleHistoryLock(lockPath) {
  try {
    if (lstatSync(lockPath).isSymbolicLink()) throw new TypeError('Timeline history lock cannot be a symbolic link.');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) {
      if (Date.now() - statSync(lockPath).mtimeMs < 30_000) return false;
      unlinkSync(lockPath);
      return true;
    }
    try {
      process.kill(lock.pid, 0);
      return false;
    } catch (error) {
      if (error.code !== 'ESRCH') return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    if (error instanceof SyntaxError && Date.now() - statSync(lockPath).mtimeMs >= 30_000) {
      unlinkSync(lockPath);
      return true;
    }
    return false;
  }
}

function validateHistory(state) {
  if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.limit)
      || state.limit < 1 || state.limit > MAX_LIMIT || !Array.isArray(state.undo)
      || !Array.isArray(state.redo) || state.undo.length > state.limit
      || state.redo.length > state.limit || !/^[\da-f]{64}$/.test(state.timelineHash ?? '')
      || (state.previousTimelineHash !== null && !/^[\da-f]{64}$/.test(state.previousTimelineHash ?? ''))) {
    throw new TypeError('Persistent timeline history has an invalid schema.');
  }
  validateTimeline(state.timeline);
  for (const snapshot of [...state.undo, ...state.redo]) validateTimeline(snapshot);
  if (hashTimeline(state.timeline) !== state.timelineHash) throw new TypeError('Persistent timeline history snapshot does not match its fingerprint.');
}

function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`Timeline history limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
}

function describeHistory(state) {
  return {
    schemaVersion: 1,
    canUndo: state.undo.length > 0,
    canRedo: state.redo.length > 0,
    undoDepth: state.undo.length,
    redoDepth: state.redo.length,
    limit: state.limit,
  };
}

function writeHistoryFile(path, state) {
  const content = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_HISTORY_BYTES) {
    throw new RangeError(`Timeline history exceeds the ${MAX_HISTORY_BYTES / 1024 / 1024} MiB limit.`);
  }
  writeAtomically(path, content);
}

function writeTimelineFile(path, timeline) {
  writeAtomically(path, `${JSON.stringify(timeline, null, 2)}\n`);
}

function writeAtomically(path, content) {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function getHistoryPath(timelinePath) {
  return join(dirname(timelinePath), `.${basename(timelinePath)}.history.json`);
}

function hashTimeline(timeline) {
  return timelineFingerprint(timeline);
}

function validateReviewPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
      || plan.schemaVersion !== 1 || plan.reviewRequired !== true
      || !/^[a-z][a-z0-9-]*$/.test(plan.type ?? '')
      || !/^[a-f0-9]{64}$/.test(plan.baseTimelineSha256 ?? '')
      || !Array.isArray(plan.operations) || plan.operations.length === 0 || plan.operations.length > 2000) {
    throw new TypeError('Review plan must be a schemaVersion 1 review-required plan with a SHA-256 timeline base and 1–2000 operations.');
  }
}
