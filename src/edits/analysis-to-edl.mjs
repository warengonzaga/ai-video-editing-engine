import { validateEdl } from './retime-transcript.mjs';
import { normalizeMediaFindings } from '../media/analysis-provider.mjs';

/** Convert explicit provider cut suggestions into an EDL that requires review. */
export function mediaAnalysisToEdl(analysis, { minConfidence = 0 } = {}) {
  if (!analysis || typeof analysis !== 'object' || analysis.schemaVersion !== 1
      || !Number.isFinite(analysis.durationSeconds) || analysis.durationSeconds <= 0
      || !Array.isArray(analysis.findings)) {
    throw new TypeError('Media analysis must be a normalized schemaVersion 1 result.');
  }
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new TypeError('minConfidence must be between 0 and 1.');
  }
  const normalizedFindings = normalizeMediaFindings({ findings: analysis.findings }, analysis.durationSeconds).findings;

  const cuts = normalizedFindings
    .filter((finding) => finding.suggestion && (finding.confidence ?? 0) >= minConfidence)
    .map((finding) => ({
      sourceStart: finding.suggestion.sourceStart,
      sourceEnd: finding.suggestion.sourceEnd,
      reason: `${finding.id}: ${finding.suggestion.reason}`,
    }))
    .sort((left, right) => left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd)
    .reduce((result, cut) => {
      const previous = result.at(-1);
      if (previous && cut.sourceStart < previous.sourceEnd) {
        previous.sourceEnd = Math.max(previous.sourceEnd, cut.sourceEnd);
        previous.reason = `${previous.reason}; ${cut.reason}`;
      } else {
        result.push(cut);
      }
      return result;
    }, []);

  const edl = {
    schemaVersion: 1,
    sourceDurationSeconds: analysis.durationSeconds,
    reviewStatus: 'needs-review',
    cuts,
  };
  validateEdl(edl, analysis.durationSeconds);
  return edl;
}
