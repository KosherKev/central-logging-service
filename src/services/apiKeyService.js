const bcrypt = require('bcryptjs');
const ApiKeyCandidate = require('../models/ApiKeyCandidate');
const generateRawKey = require('../utils/generateRawKey');

const BCRYPT_COST = 12;

/**
 * Unified API key lifecycle (Phase 25) — one place that creates, lists,
 * revokes, and rotates the ApiKeyCandidate rows that back BOTH logs and
 * metrics auth (see src/middleware/apiKeyAuth.js). The admin API
 * (src/routes/admin/keys.js), the setup wizard (scripts/setup.js), and the
 * generateAppApiKey.js CLI all call into this module rather than touching
 * ApiKeyCandidate directly, so there is exactly one code path that ever
 * writes a key hash.
 */

function normalizeScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const invalid = list.filter((s) => !ApiKeyCandidate.API_KEY_SCOPES.includes(s));
  if (invalid.length > 0) {
    throw new Error(`Invalid scope(s): ${invalid.join(', ')}`);
  }
  return [...new Set(list)];
}

/**
 * Create (or add an environment to) an app's key.
 * @param {object} opts
 * @param {string} opts.appId - becomes subjectId
 * @param {string} [opts.label] - human-readable, shown in the admin UI
 * @param {string[]} opts.scopes - must be a subset of ApiKeyCandidate.API_KEY_SCOPES
 * @param {'test'|'live'|'both'} [opts.environment='live']
 * @returns {Promise<{ appId: string, label: string|undefined, scopes: string[], rawKeys: { test?: string, live?: string } }>}
 *   rawKeys is the ONLY time the plaintext value is available — never persisted, never logged.
 */
async function createKey({ appId, label, scopes, environment = 'live' }) {
  if (!appId || typeof appId !== 'string') {
    throw new Error('appId is required');
  }
  const normalizedScopes = normalizeScopes(scopes);
  if (normalizedScopes.length === 0) {
    throw new Error('At least one scope is required');
  }
  if (!['test', 'live', 'both'].includes(environment)) {
    throw new Error('environment must be "test", "live", or "both"');
  }

  const wantsTest = environment === 'test' || environment === 'both';
  const wantsLive = environment === 'live' || environment === 'both';

  const rawKeys = {};
  const update = {
    $set: { scopes: normalizedScopes },
    $setOnInsert: { subjectId: appId, createdAt: new Date() }
  };
  if (label !== undefined) update.$set.label = label;

  if (wantsTest) {
    rawKeys.test = generateRawKey('test');
    update.$set.testHash = await bcrypt.hash(rawKeys.test, BCRYPT_COST);
  }
  if (wantsLive) {
    rawKeys.live = generateRawKey('live');
    update.$set.liveHash = await bcrypt.hash(rawKeys.live, BCRYPT_COST);
  }
  // Un-revoke on (re)creation — issuing a new key for a previously revoked
  // app should make it live again, not stay silently dead.
  update.$set.revokedAt = null;

  await ApiKeyCandidate.findOneAndUpdate({ subjectId: appId }, update, {
    upsert: true,
    new: true
  });

  return { appId, label, scopes: normalizedScopes, rawKeys };
}

/**
 * List keys for the admin UI/CLI. Never returns hashes or raw keys.
 */
async function listKeys() {
  const rows = await ApiKeyCandidate.find({})
    .select('subjectId label scopes testHash liveHash createdAt lastUsedAt revokedAt')
    .sort({ createdAt: -1 })
    .lean();

  return rows.map((row) => ({
    appId: row.subjectId,
    label: row.label || null,
    scopes: row.scopes || [],
    environments: [row.testHash ? 'test' : null, row.liveHash ? 'live' : null].filter(Boolean),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
    revoked: row.revokedAt != null,
    revokedAt: row.revokedAt || null
  }));
}

/**
 * Soft-revoke — sets revokedAt, row stays for audit history. Idempotent:
 * revoking an already-revoked key is a no-op, not an error.
 */
async function revokeKey(appId) {
  const candidate = await ApiKeyCandidate.findOne({ subjectId: appId });
  if (!candidate) {
    throw new Error(`No key found for appId "${appId}"`);
  }
  if (candidate.revokedAt == null) {
    candidate.revokedAt = new Date();
    await candidate.save();
  }
  return { appId, revoked: true, revokedAt: candidate.revokedAt };
}

/**
 * Regenerate just one environment's hash — the old value for that
 * environment stops matching immediately; the other environment (if any)
 * and the app's scopes are untouched.
 */
async function rotateKey(appId, environment) {
  if (!['test', 'live'].includes(environment)) {
    throw new Error('environment must be "test" or "live"');
  }
  const candidate = await ApiKeyCandidate.findOne({ subjectId: appId });
  if (!candidate) {
    throw new Error(`No key found for appId "${appId}"`);
  }

  const rawKey = generateRawKey(environment);
  const hash = await bcrypt.hash(rawKey, BCRYPT_COST);
  if (environment === 'test') {
    candidate.testHash = hash;
  } else {
    candidate.liveHash = hash;
  }
  await candidate.save();

  return { appId, environment, rawKey };
}

/**
 * Candidates apiKeyAuth matches against — excludes revoked rows so a
 * revoked key stops authenticating on its very next request, with no
 * redeploy or cache to invalidate.
 */
async function findAuthCandidates() {
  return ApiKeyCandidate.find({ revokedAt: null })
    .select('subjectId scopes testHash liveHash')
    .lean();
}

/** Fire-and-forget — never let this slow down or fail the request it's attached to. */
function touchLastUsed(appId) {
  try {
    Promise.resolve(
      ApiKeyCandidate.updateOne({ subjectId: appId }, { $set: { lastUsedAt: new Date() } })
    ).catch(() => {
      // best-effort UI nicety only; logging failures here would be noise
    });
  } catch {
    // synchronous throw from a stub/mock — still must never affect the request
  }
}

module.exports = {
  createKey,
  listKeys,
  revokeKey,
  rotateKey,
  findAuthCandidates,
  touchLastUsed
};
