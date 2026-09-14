#!/usr/bin/env node
/**
 * Interactive onboarding wizard (Phase 25) — replaces "hand-edit .env, then
 * separately remember to run generateAppApiKey.js" with one command that
 * gets a fresh clone to a working, credentialed instance.
 *
 * Usage: npm run setup
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

const ATLAS_SIGNUP_URL = 'https://www.mongodb.com/cloud/atlas/register';

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function generateAdminToken() {
  return 'admin_' + crypto.randomBytes(24).toString('hex');
}

/** Replace or append a KEY=value line in .env-style text. */
function setEnvLine(content, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  return content.trimEnd() + '\n' + line + '\n';
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\ncentral-logging-service setup\n' + '='.repeat(30) + '\n');

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await ask(
      rl,
      '.env already exists. Re-run setup and overwrite affected values? [y/N] '
    );
    if (!/^y(es)?$/i.test(overwrite.trim())) {
      console.log('Leaving .env untouched. Exiting.');
      rl.close();
      return;
    }
  }

  let envContent = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8')
    : fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');

  // 1. Mongo URI
  console.log(
    `\nNeed a MongoDB connection string? MongoDB Atlas's free tier gives you\none in about two minutes, no card required:\n  ${ATLAS_SIGNUP_URL}\n`
  );
  const defaultMongo = 'mongodb://localhost:27017/central-logging';
  const mongoUri = (await ask(rl, `MongoDB URI [${defaultMongo}]: `)).trim() || defaultMongo;
  envContent = setEnvLine(envContent, 'MONGODB_URI', mongoUri);

  // 2. Admin token
  const adminToken = generateAdminToken();
  envContent = setEnvLine(envContent, 'ADMIN_SETUP_TOKEN', adminToken);
  console.log(`\nGenerated an admin token for /admin/keys.html (also written to .env):\n  ${adminToken}\n`);

  fs.writeFileSync(ENV_PATH, envContent);
  console.log(`Wrote ${ENV_PATH}`);

  // 3. Optional first app key
  const wantsKey = await ask(rl, '\nCreate a first app key now? [Y/n] ');
  if (/^n(o)?$/i.test(wantsKey.trim())) {
    console.log('\nSkipped. You can create keys later via /admin/keys.html or `npm run generate-app-key`.');
    rl.close();
    return;
  }

  const appId = (await ask(rl, 'App ID (e.g. academicx, or "logpulse" for a dashboard reader): ')).trim();
  if (!appId) {
    console.log('No appId given — skipping key creation.');
    rl.close();
    return;
  }

  console.log('\nScopes: logs:read, logs:write, metrics:read, metrics:write');
  const scopesInput = await ask(rl, 'Scopes for this app (comma-separated): ');
  const scopes = scopesInput.split(',').map((s) => s.trim()).filter(Boolean);

  const envAnswer = (await ask(rl, 'Environment [live/test/both] (default live): ')).trim() || 'live';

  rl.close();

  // Re-require config now that .env has been written, and connect directly
  // to apiKeyService (not the HTTP layer — the server isn't running yet).
  process.env.MONGODB_URI = mongoUri;
  const mongoose = require('mongoose');
  const config = require('../src/config');
  const apiKeyService = require('../src/services/apiKeyService');

  await mongoose.connect(mongoUri, config.mongodb.options);
  try {
    const result = await apiKeyService.createKey({ appId, scopes, environment: envAnswer });
    console.log(`
================================================================================
  KEY CREATED (copy now — shown once)
================================================================================
  appId:  ${result.appId}
  scopes: ${result.scopes.join(', ')}
${result.rawKeys.test ? `  test key: ${result.rawKeys.test}\n` : ''}${result.rawKeys.live ? `  live key: ${result.rawKeys.live}\n` : ''}
  Use this in @bevingh/telemetry's createTelemetryClient({ apiKey }), or in
  LogPulse Analytics' Settings screen if this is a dashboard-reader key.
================================================================================
`);
  } finally {
    await mongoose.connection.close();
  }

  console.log('Setup complete. Start the server with `npm run dev`, then open /admin/keys.html for any further keys.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
