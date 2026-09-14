const mongoose = require('mongoose');
const config = require('../config');
const apiKeyService = require('../services/apiKeyService');

/**
 * CLI wrapper over apiKeyService.createKey (Phase 25) — kept for anyone
 * still scripting against it, but the admin UI (/admin/keys.html) or the
 * setup wizard (`npm run setup`) are the recommended path now.
 *
 * Usage:
 *   node src/utils/generateAppApiKey.js <appId> [--scopes=logs:read,logs:write] [--test|--live|--both]
 *
 * Examples:
 *   node src/utils/generateAppApiKey.js academicx --scopes=logs:write,metrics:write
 *   node src/utils/generateAppApiKey.js logpulse --scopes=logs:read --live
 *
 * Raw key is NEVER written to the database — only the bcrypt hash is upserted.
 */

function parseArgs(argv) {
  const positional = [];
  let scopes = null;
  let environment = 'live';

  for (const arg of argv) {
    if (arg === '--test') environment = 'test';
    else if (arg === '--live') environment = 'live';
    else if (arg === '--both') environment = 'both';
    else if (arg.startsWith('--scopes=')) scopes = arg.slice('--scopes='.length).split(',').filter(Boolean);
    else positional.push(arg);
  }

  return { appId: positional[0], scopes, environment };
}

async function main() {
  const { appId, scopes, environment } = parseArgs(process.argv.slice(2));

  if (!appId || !scopes || scopes.length === 0) {
    console.error(`
Usage: node src/utils/generateAppApiKey.js <appId> --scopes=<scope1,scope2,...> [--test|--live|--both]

  appId    Application id (becomes subjectId), e.g. academicx
  --scopes Comma-separated, from: logs:read, logs:write, metrics:read, metrics:write
  --test / --live / --both   Which environment(s) to issue (default: --live)

Prefer the admin UI (/admin/keys.html) or \`npm run setup\` for interactive use —
this CLI remains for scripting.
`);
    process.exit(1);
  }

  await mongoose.connect(config.mongodb.uri, config.mongodb.options);

  let result;
  try {
    result = await apiKeyService.createKey({ appId, scopes, environment });
  } finally {
    await mongoose.connection.close();
  }

  console.log(`
================================================================================
  UNIFIED API KEY (copy once — not stored in plaintext)
================================================================================
  appId:  ${result.appId}
  label:  ${result.label || '(none)'}
  scopes: ${result.scopes.join(', ')}
${result.rawKeys.test ? `
  Raw key (test, X-API-Key value):
  ${result.rawKeys.test}
` : ''}${result.rawKeys.live ? `
  Raw key (live, X-API-Key value):
  ${result.rawKeys.live}
` : ''}
  This same key authenticates both logs and metrics routes, subject to the
  scopes above. Configure it in @bevingh/telemetry's createTelemetryClient({ apiKey })
  and/or LogPulse Analytics' Settings, as appropriate.

  MongoDB: hash upserted on ApiKeyCandidate.subjectId="${result.appId}".
  The raw key above will never be shown again from this service.
================================================================================
`);
}

main().catch((err) => {
  console.error('Failed to generate app API key:', err.message);
  process.exit(1);
});
