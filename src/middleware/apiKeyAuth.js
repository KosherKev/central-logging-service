const bcrypt = require('bcryptjs');
const config = require('../config');
const logger = require('../utils/logger');
const apiKeyService = require('../services/apiKeyService');

/**
 * Scopes the legacy flat API_KEYS list is allowed to satisfy — exactly the
 * routes the old flat `authenticate` middleware guarded (logs read/write,
 * metrics read via GET /api/v1/metrics). Deliberately excludes
 * `metrics:write`: that route never accepted flat keys (it was always
 * per-app metricsAuth), so a leaked legacy log key still can't post metrics
 * as an arbitrary app under this fallback.
 */
const LEGACY_FALLBACK_SCOPES = ['logs:read', 'logs:write', 'metrics:read'];

/**
 * Unified API key auth (Phase 25) — one codepath for logs *and* metrics,
 * differing only in which scope a route requires. Replaces the old split
 * between src/middleware/auth.js (flat API_KEYS env list) and
 * src/middleware/metricsAuth.js (per-app bcrypt-hashed keys).
 *
 * @param {string} requiredScope - one of ApiKeyCandidate.API_KEY_SCOPES
 */
function apiKeyAuth(requiredScope) {
  let authModulePromise;
  function loadAuthModule() {
    authModulePromise ??= import('@bevingh/auth');
    return authModulePromise;
  }

  return async function apiKeyAuthMiddleware(req, res, next) {
    try {
      const rawKey = req.headers['x-api-key'];

      if (!rawKey) {
        return res.status(401).json({
          success: false,
          error: 'Missing API key. Include X-API-Key header.'
        });
      }

      const { matchApiKey } = await loadAuthModule();
      const candidates = await apiKeyService.findAuthCandidates();
      const match = await matchApiKey(rawKey, candidates, bcrypt.compare);

      if (match) {
        const candidate = candidates.find((c) => c.subjectId === match.subjectId);
        const scopes = candidate?.scopes || [];
        if (!scopes.includes(requiredScope)) {
          return res.status(403).json({
            success: false,
            error: `API key is not authorized for scope "${requiredScope}".`
          });
        }

        apiKeyService.touchLastUsed(match.subjectId);
        req.apiKeyAppId = match.subjectId;
        req.apiKeyEnvironment = match.environment;
        // Back-compat aliases for the metrics routes' existing app-scope check
        // (enforceAppScope in src/routes/metrics.js reads these names).
        req.telemetryAppId = match.subjectId;
        req.telemetryKeyEnvironment = match.environment;
        return next();
      }

      // Legacy fallback — the flat, comma-separated API_KEYS env list this
      // service used before Phase 25. Only satisfies the scopes that scheme
      // already granted (LEGACY_FALLBACK_SCOPES above), not every scope —
      // logged at warn level so real usage becomes visible ahead of a
      // future cleanup phase that removes this fallback once every
      // consumer holds a DB-backed key — see PHASE_25_SPEC.md Step 3.
      if (config.auth.apiKeys.includes(rawKey)) {
        if (!LEGACY_FALLBACK_SCOPES.includes(requiredScope)) {
          return res.status(403).json({
            success: false,
            error: `Legacy API key is not authorized for scope "${requiredScope}". Provision a scoped key via /admin/keys.`
          });
        }
        logger.warn('apiKeyAuth: legacy flat API key used', {
          metadata: { requiredScope, keyPrefix: rawKey.slice(0, 8) }
        });
        req.apiKeyAppId = null;
        req.apiKeyEnvironment = null;
        req.telemetryAppId = null;
        req.telemetryKeyEnvironment = null;
        req.usedLegacyApiKey = true;
        return next();
      }

      return res.status(403).json({
        success: false,
        error: 'Invalid API key.'
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = apiKeyAuth;
