#!/usr/bin/env node
/**
 * Phase 25 one-off migration — backfill `scopes` on every existing
 * ApiKeyCandidate row. Run once before deploying the route rewiring
 * (PHASE_25_SPEC.md Part A, Step 4) so no existing candidate is left with
 * an empty scope list that would suddenly authorize nothing.
 *
 * Every row that exists today was provisioned for metrics ingestion only
 * (the per-app scheme never guarded anything else before this phase) — so
 * backfill is unconditionally ['metrics:write'], not a guess per row.
 *
 * Idempotent: rows that already have a non-empty `scopes` are left alone,
 * so running this twice (or after Step 5 has already issued new-style
 * keys) is safe.
 *
 * Usage: node scripts/migrate-scopes.js
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const ApiKeyCandidate = require('../src/models/ApiKeyCandidate');

async function main() {
  await mongoose.connect(config.mongodb.uri, config.mongodb.options);

  const result = await ApiKeyCandidate.updateMany(
    { $or: [{ scopes: { $exists: false } }, { scopes: { $size: 0 } }] },
    { $set: { scopes: ['metrics:write'] } }
  );

  console.log(
    `Backfilled scopes on ${result.modifiedCount} of ${result.matchedCount} matched candidate(s).`
  );

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error('Scope migration failed:', err.message);
  process.exit(1);
});
