import { editTimeline, editTimelineBatch } from './edit.mjs';
import { validateTimeline } from './validate.mjs';

const DEFAULT_HISTORY_LIMIT = 100;

/** Create an isolated, bounded undo/redo history for immutable timeline edits. */
export function createTimelineHistory(timeline, { limit = DEFAULT_HISTORY_LIMIT } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new TypeError('Timeline history limit must be an integer from 1 to 10000.');
  }

  validateTimeline(timeline);
  let current = structuredClone(timeline);
  const undoStack = [];
  const redoStack = [];

  return Object.freeze({
    get current() {
      return structuredClone(current);
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    get undoDepth() {
      return undoStack.length;
    },
    get redoDepth() {
      return redoStack.length;
    },
    apply(operation) {
      const next = editTimeline(current, operation);
      undoStack.push(current);
      if (undoStack.length > limit) undoStack.shift();
      current = next;
      redoStack.length = 0;
      return structuredClone(current);
    },
    applyBatch(operations) {
      const next = editTimelineBatch(current, operations);
      undoStack.push(current);
      if (undoStack.length > limit) undoStack.shift();
      current = next;
      redoStack.length = 0;
      return structuredClone(current);
    },
    undo() {
      if (undoStack.length === 0) return structuredClone(current);
      redoStack.push(current);
      current = undoStack.pop();
      return structuredClone(current);
    },
    redo() {
      if (redoStack.length === 0) return structuredClone(current);
      undoStack.push(current);
      current = redoStack.pop();
      return structuredClone(current);
    },
    reset(nextTimeline) {
      validateTimeline(nextTimeline);
      current = structuredClone(nextTimeline);
      undoStack.length = 0;
      redoStack.length = 0;
      return structuredClone(current);
    },
  });
}
