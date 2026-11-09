import { createHash } from 'node:crypto';

/** Return a SHA-256 digest of a timeline object's JSON encoding. */
export function timelineFingerprint(timeline) {
  return createHash('sha256').update(JSON.stringify(timeline)).digest('hex');
}
