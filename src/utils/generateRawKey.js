const crypto = require('crypto');

/**
 * Raw per-app key generator — conduit-style `sk_test_`/`sk_live_` prefix,
 * matched by @bevingh/auth's parseApiKeyEnvironment. Extracted from
 * generateAppApiKey.js so both the CLI and apiKeyService.js share one
 * implementation instead of drifting.
 */
function generateRawKey(environment) {
  const randomBytes = crypto.randomBytes(32);
  const body = randomBytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const prefix = environment === 'test' ? 'sk_test_' : 'sk_live_';
  return `${prefix}${body}`;
}

module.exports = generateRawKey;
