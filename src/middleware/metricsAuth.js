const bcrypt = require('bcryptjs');
const ApiKeyCandidate = require('../models/ApiKeyCandidate');

/**
 * Per-app API key auth for /api/v1/metrics routes.
 * Uses @bevingh/auth matchApiKey (ESM) via dynamic import from this CommonJS service.
 * Does NOT replace the flat-key auth used by /api/v1/logs.
 */

let authModulePromise;

function loadAuthModule() {
  authModulePromise ??= import('@bevingh/auth');
  return authModulePromise;
}

const metricsAuth = async (req, res, next) => {
  try {
    const rawKey = req.headers['x-api-key'];

    if (!rawKey) {
      return res.status(401).json({
        success: false,
        error: 'Missing API key. Include X-API-Key header.'
      });
    }

    const { matchApiKey } = await loadAuthModule();

    const candidates = await ApiKeyCandidate.find({})
      .select('subjectId testHash liveHash')
      .lean();

    const match = await matchApiKey(rawKey, candidates, bcrypt.compare);

    if (!match) {
      return res.status(403).json({
        success: false,
        error: 'Invalid API key.'
      });
    }

    req.telemetryAppId = match.subjectId;
    req.telemetryKeyEnvironment = match.environment;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = metricsAuth;
