const mongoose = require('mongoose');

/**
 * Per-app API key candidate for metrics/telemetry auth.
 * Stores bcrypt hashes only — never plaintext keys.
 * subjectId is the appId used by @bevingh/telemetry clients.
 */
const apiKeyCandidateSchema = new mongoose.Schema({
  subjectId: {
    type: String,
    required: true,
    unique: true,
    index: true
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
  }
}, {
  timestamps: false,
  collection: 'api_key_candidates'
});

const ApiKeyCandidate = mongoose.model('ApiKeyCandidate', apiKeyCandidateSchema);

module.exports = ApiKeyCandidate;
