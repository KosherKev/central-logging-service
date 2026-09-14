const mongoose = require('mongoose');

/** Unified scope vocabulary — one key can hold several. */
const API_KEY_SCOPES = ['logs:read', 'logs:write', 'metrics:read', 'metrics:write'];

/**
 * Per-app API key candidate — unified auth for logs *and* metrics/telemetry
 * (Phase 25). Stores bcrypt hashes only — never plaintext keys. subjectId is
 * the appId used by @bevingh/telemetry clients and by apiKeyAuth's `req.apiKeyAppId`.
 *
 * scopes gate what a matched key may do (see src/middleware/apiKeyAuth.js) —
 * shared across a candidate's test and live key rather than split per
 * environment, since no real use case has needed that split yet.
 */
const apiKeyCandidateSchema = new mongoose.Schema({
  subjectId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  label: {
    type: String,
    required: false
  },
  scopes: {
    type: [String],
    enum: API_KEY_SCOPES,
    default: []
  },
  testHash: {
    type: String,
    required: false
  },
  liveHash: {
    type: String,
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsedAt: {
    type: Date,
    required: false,
    default: null
  },
  revokedAt: {
    type: Date,
    required: false,
    default: null
  }
}, {
  timestamps: false,
  collection: 'api_key_candidates'
});

const ApiKeyCandidate = mongoose.model('ApiKeyCandidate', apiKeyCandidateSchema);

module.exports = ApiKeyCandidate;
module.exports.API_KEY_SCOPES = API_KEY_SCOPES;
