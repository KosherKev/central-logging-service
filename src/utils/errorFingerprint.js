const crypto = require('crypto');

const DISPLAY_MESSAGE_MAX = 500;
const FINGERPRINT_MESSAGE_MAX = 200;

/**
 * Normalize error message for stable fingerprinting.
 * Collapses UUIDs, bare numbers, IPs, and whitespace.
 * Display messages are not passed through this (only fingerprint input).
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
    .replace(/\b[0-9a-f]{24}\b/gi, '<oid>') // Mongo ObjectId-ish
    .replace(
      /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g,
      '<ip>'
    )
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FINGERPRINT_MESSAGE_MAX);
}

/**
 * Stable group id: fp_ + first 12 hex of sha1(normalize(message) + \0 + code).
 */
function fingerprintError(message, errorCode) {
  const code = errorCode != null && errorCode !== '' ? String(errorCode) : '';
  const key = `${normalizeErrorMessage(message)}\0${code}`;
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

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function looksLikeHtml(s) {
  return /^\s*</.test(s) && /<\/?[a-z][\s\S]*>/i.test(s);
}

/**
 * Cap + first-line trim for display (keeps useful text; fingerprint uses normalize).
 */
function formatDisplayMessage(msg) {
  if (msg == null) return '';
  const firstLine = String(msg).replace(/\r\n/g, '\n').split('\n')[0].trim();
  return firstLine.slice(0, DISPLAY_MESSAGE_MAX);
}

/**
 * Prefer short string codes (ECONNREFUSED) or 4xx/5xx integers.
 */
function coerceErrorCode(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 400 && value < 600) return String(value);
    return null;
  }
  const s = String(value).trim();
  if (!s || s.length > 64) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 400 && n < 600) return s;
    return null;
  }
  return s;
}

/**
 * Parse response.body when it is a JSON string or already an object.
 * @returns {object|string|null}
 */
function parseResponseBody(body) {
  if (body == null) return null;
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return null;

  const trimmed = body.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Non-JSON string body — return as raw string for message fallback
    return trimmed;
  }
}

/**
 * Extract display message / code / stack from a log document.
 * Priority matches LogPulse displayError + P2 "response message" rule:
 *   1) top-level error.message / code / stack
 *   2) response.body (nested error.message → message → string error → …)
 *   3) HTTP ${statusCode} or "Error" — never invent "Unknown error" when status is known
 *
 * @param {object} log
 * @returns {{ message: string, errorCode: string|null, stack: string|null, statusCode: number|null }}
 */
function extractErrorDisplay(log = {}) {
  let message = null;
  let errorCode = null;
  let stack = null;
  const statusCode =
    log.statusCode != null && Number.isFinite(Number(log.statusCode))
      ? Number(log.statusCode)
      : null;

  // 1) Top-level structured error
  const top = log.error;
  if (top && typeof top === 'object') {
    if (nonEmptyString(top.message)) message = top.message.trim();
    errorCode = coerceErrorCode(top.code) || errorCode;
    if (nonEmptyString(top.stack)) stack = top.stack;
  }

  // 2) response.body (string or object)
  const rawBody =
    log.response && Object.prototype.hasOwnProperty.call(log.response, 'body')
      ? log.response.body
      : log.responseBody; // allow flat fixture field

  const body = parseResponseBody(rawBody);

  if (body != null && typeof body === 'object' && !Array.isArray(body)) {
    const nested = body.error;

    // Prefer nested error.message (specific) over generic string "Internal Server Error"
    if (!message && nested && typeof nested === 'object' && nonEmptyString(nested.message)) {
      message = nested.message.trim();
    }
    if (!message && nonEmptyString(body.message)) {
      message = body.message.trim();
    }
    // body.error as string only if still no message
    if (!message && typeof nested === 'string' && nonEmptyString(nested)) {
      message = nested.trim();
    }

    if (!stack && nested && typeof nested === 'object' && nonEmptyString(nested.stack)) {
      stack = nested.stack;
    }
    if (!stack && nonEmptyString(body.stack)) {
      stack = body.stack;
    }

    if (!errorCode && nested && typeof nested === 'object') {
      errorCode =
        coerceErrorCode(nested.code) ||
        coerceErrorCode(nested.statusCode) ||
        errorCode;
    }
    if (!errorCode) {
      errorCode =
        coerceErrorCode(body.code) ||
        coerceErrorCode(body.statusCode) ||
        errorCode;
    }
  } else if (typeof body === 'string' && !message) {
    if (body.length <= DISPLAY_MESSAGE_MAX && !looksLikeHtml(body)) {
      message = body;
    }
  }

  // 3) HTTP fallback — never use "Unknown error" when status is known
  if (!message) {
    if (statusCode != null) {
      message = `HTTP ${statusCode}`;
    } else {
      message = 'Error';
    }
  }

  return {
    message: formatDisplayMessage(message) || (statusCode != null ? `HTTP ${statusCode}` : 'Error'),
    errorCode: errorCode || null,
    stack: stack || null,
    statusCode
  };
}

/**
 * @deprecated Use extractErrorDisplay. Kept for any older call sites.
 */
function pickDisplayMessage(errorMessage, errorCode) {
  if (errorMessage && String(errorMessage).trim()) return String(errorMessage).trim();
  if (errorCode) return String(errorCode);
  return 'Error';
}

module.exports = {
  normalizeErrorMessage,
  fingerprintError,
  computeTrend,
  pickDisplayMessage,
  extractErrorDisplay,
  parseResponseBody,
  formatDisplayMessage,
  DISPLAY_MESSAGE_MAX,
  FINGERPRINT_MESSAGE_MAX
};
