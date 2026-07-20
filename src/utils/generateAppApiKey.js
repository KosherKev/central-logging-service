const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const ApiKeyCandidate = require('../models/ApiKeyCandidate');

/**
 * Generate a per-app telemetry API key, store only the bcrypt hash,
 * and print the raw key once for @bevingh/telemetry client config.
 *
 * Usage:
 *   node src/utils/generateAppApiKey.js <appId> [--test]
 *
 * Examples:
 *   node src/utils/generateAppApiKey.js academicx
 *   node src/utils/generateAppApiKey.js academicx --test
 *
 * Raw key is NEVER written to the database — only the bcrypt hash is upserted.
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

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--test');
  const isTest = process.argv.includes('--test');
  const appId = args[0];

  if (!appId) {
    console.error(`
Usage: node src/utils/generateAppApiKey.js <appId> [--test]

  appId   Application id (becomes subjectId / telemetry appId), e.g. academicx
  --test  Generate a sk_test_ key instead of sk_live_

The raw key is printed once. Store it in the app's @bevingh/telemetry config.
Only the bcrypt hash is saved to MongoDB.
`);
    process.exit(1);
  }

  const environment = isTest ? 'test' : 'live';
  const rawKey = generateRawKey(environment);
  const hash = await bcrypt.hash(rawKey, 12);

  await mongoose.connect(config.mongodb.uri, config.mongodb.options);

  const update =
    environment === 'test'
      ? { $set: { testHash: hash }, $setOnInsert: { subjectId: appId, createdAt: new Date() } }
      : { $set: { liveHash: hash }, $setOnInsert: { subjectId: appId, createdAt: new Date() } };

  await ApiKeyCandidate.findOneAndUpdate(
    { subjectId: appId },
    update,
    { upsert: true, new: true }
  );

  await mongoose.connection.close();

  console.log(`
================================================================================
  PER-APP TELEMETRY API KEY (copy once — not stored in plaintext)
================================================================================
  appId:       ${appId}
  environment: ${environment}
  prefix:      ${environment === 'test' ? 'sk_test_' : 'sk_live_'}

  Configure this raw key in the app's @bevingh/telemetry client:

    createTelemetryClient({
      appId: '${appId}',
      // service origin only — client appends /api/v1/metrics[/health]
      collectorUrl: 'https://<your-central-logging-service>',
      apiKey: '${rawKey}',
    })

  Raw key (X-API-Key value):
  ${rawKey}
================================================================================
  MongoDB: hash upserted on ApiKeyCandidate.subjectId="${appId}" (${environment}Hash)
  The raw key above will never be shown again from this service.
================================================================================
`);
}

main().catch((err) => {
  console.error('Failed to generate app API key:', err.message);
  process.exit(1);
});
