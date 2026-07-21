const crypto = require('crypto');

/**
 * Normalize error message for stable grouping.
 * Collapses UUIDs, bare numbers, and whitespace so the same class of error
 * fingerprints together (LogPulse Errors tab).
 */
function normalizeErrorMessage(msg) {
  if (msg == null) return '';
  const s = String(msg);
  return s
    .toLowerCase()
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<uuid>'
    )
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Stable group id: fp_ + first 12 hex of sha1(normalizedMessage|code).
 */
function fingerprintError(message, errorCode) {
  const code = errorCode != null && errorCode !== '' ? String(errorCode) : '';
  const key = `${normalizeErrorMessage(message)}|${code}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `fp_${hash}`;
}

/**
 * Compare first half vs second half of the window.
 * @returns {'increasing'|'decreasing'|'stable'}
 */
function computeTrend(earlierCount, recentCount) {
  const earlier = earlierCount || 0;
  const recent = recentCount || 0;
  if (earlier === 0 && recent === 0) return 'stable';
  if (earlier === 0 && recent > 0) return 'increasing';
  if (recent === 0 && earlier > 0) return 'decreasing';
  const ratio = recent / earlier;
  if (ratio >= 1.2) return 'increasing';
  if (ratio <= 0.8) return 'decreasing';
  return 'stable';
}

/**
 * Display message for a group: prefer non-empty error.message.
 */
function pickDisplayMessage(errorMessage, errorCode) {
  if (errorMessage && String(errorMessage).trim()) return String(errorMessage).trim();
  if (errorCode) return String(errorCode);
  return 'Unknown error';
}

module.exports = {
  normalizeErrorMessage,
  fingerprintError,
  computeTrend,
  pickDisplayMessage
};
