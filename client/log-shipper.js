/**
 * LogShipper — legacy-compatible client for shipping logs to Central Logging
 * Service, now a thin shim over @bevingh/telemetry (≥ 0.2.2).
 *
 * SECURITY (2026-09-24): the previous implementation's middleware() shipped
 * raw request headers (Authorization bearer tokens, cookies, API keys),
 * request bodies (passwords) and response bodies (issued access/refresh
 * tokens), and the collector stores entries as-is. Every entry now goes
 * through @bevingh/telemetry's redaction before it leaves the process:
 *   - credential headers → "[REDACTED]"
 *   - credential-named keys at any depth → "[REDACTED]"
 *   - sensitive URL query params → "[REDACTED]"
 *   - JWT-shaped strings → "[REDACTED]"
 *   - request/response bodies are NOT captured by middleware() unless
 *     `includeBodies: true`, and are redacted even then
 * Manual log()/info()/… calls are redacted too.
 *
 * New integrations should use @bevingh/telemetry directly (createTelemetryClient
 * + createLogMiddleware). This file keeps the old LogShipper API so existing
 * integrations can swap the file without code changes.
 *
 * Configuration: explicit options win, then environment:
 *   serviceUrl   ← TELEMETRY_COLLECTOR_URL | LOGGING_SERVICE_URL
 *   apiKey       ← TELEMETRY_API_KEY       | LOGGING_API_KEY      (needs logs:write)
 *   serviceName  ← TELEMETRY_APP_ID        | SERVICE_NAME
 *   enabled      ← LOG_SHIPPER_ENABLED / ENABLE_TELEMETRY ("false" disables)
 * With no URL or no key it is a silent no-op (one warning), never a crash.
 *
 * Usage:
 *   const LogShipper = require('./log-shipper');
 *   const logger = new LogShipper();                 // everything from env
 *   app.use(logger.middleware());                    // redacted request logs
 *   logger.info({ message: 'User logged in', userId: '123' });
 *
 * Requires Node ≥ 18 (global fetch, crypto.randomUUID) and
 * `npm install @bevingh/telemetry@^0.2.2`.
 */

const { randomUUID } = require('crypto');

const TELEMETRY_MIN = '0.2.2';
const MAX_PENDING = 10000;

// Fields the collector's log schema accepts at top level; anything else a
// caller passes (message, userId, …) is moved into metadata instead of being
// dropped (old behavior) or failing the whole batch's validation.
const TOP_LEVEL = new Set([
  'timestamp', 'level', 'traceId', 'method', 'path', 'statusCode', 'duration',
  'request', 'response', 'error', 'metadata',
]);

const firstSet = (...values) => values.find((v) => v !== undefined && v !== null && v !== '');

class LogShipper {
  constructor(options = {}) {
    const env = process.env;
    this.serviceUrl = String(firstSet(options.serviceUrl, env.TELEMETRY_COLLECTOR_URL, env.LOGGING_SERVICE_URL) || '').replace(/\/$/, '');
    this.apiKey = firstSet(options.apiKey, env.TELEMETRY_API_KEY, env.LOGGING_API_KEY) || '';
    this.serviceName = firstSet(options.serviceName, env.TELEMETRY_APP_ID, env.SERVICE_NAME) || 'unknown-service';
    this.batchSize = Number(firstSet(options.batchSize, options.maxBatchSize)) || 50;
    this.flushInterval = Number(options.flushInterval) || 5000;
    this.middlewareOptions = {
      includeBodies: options.includeBodies === true,
      ...(options.redactHeaders ? { redactHeaders: options.redactHeaders } : {}),
      ...(options.redactKeys ? { redactKeys: options.redactKeys } : {}),
      ...(options.redact ? { redact: options.redact } : {}),
    };

    const envDisabled = env.LOG_SHIPPER_ENABLED === 'false' || env.ENABLE_TELEMETRY === 'false';
    this.enabled = options.enabled !== false && !envDisabled;
    if (this.enabled && (!this.serviceUrl || !this.apiKey)) {
      console.warn('⚠️  LogShipper: no collector URL or API key (TELEMETRY_COLLECTOR_URL / TELEMETRY_API_KEY) — logging disabled.');
      this.enabled = false;
    }

    this.pending = []; // entries logged before the ESM package finished loading
    this.telemetry = null; // { client, redactLogEntry, createLogMiddleware }
    this.ready = this.enabled ? this._load(options) : Promise.resolve(null);
  }

  /** @bevingh/telemetry is ESM-only, so it's loaded with import() from this CommonJS file. */
  _load(options) {
    return Promise.all([import('@bevingh/telemetry'), import('@bevingh/telemetry/adapters/express')])
      .then(([core, adapter]) => {
        if (typeof core.redactLogEntry !== 'function') {
          throw new Error(`@bevingh/telemetry ≥ ${TELEMETRY_MIN} is required (this version cannot redact)`);
        }
        const client = core.createTelemetryClient({
          appId: this.serviceName,
          collectorUrl: this.serviceUrl,
          apiKey: this.apiKey,
          batchSize: this.batchSize,
          flushIntervalMs: this.flushInterval,
          // Flush-only shutdown hooks; unlike the old client this never calls process.exit().
          installProcessHooks: options.installProcessHooks !== false,
          onReportError: (err) => console.error('❌ LogShipper: failed to ship logs:', err && err.message ? err.message : String(err)),
        });
        this.telemetry = { client, redactLogEntry: core.redactLogEntry, createLogMiddleware: adapter.createLogMiddleware };
        const queued = this.pending;
        this.pending = [];
        for (const entry of queued) this._ship(entry);
        return this.telemetry;
      })
      .catch((err) => {
        console.error(`❌ LogShipper: disabled — ${err.message}. Install @bevingh/telemetry@^${TELEMETRY_MIN}.`);
        this.enabled = false;
        this.pending = [];
        return null;
      });
  }

  _normalize(entry = {}) {
    const out = { metadata: { ...(entry.metadata || {}) } };
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'metadata' || value === undefined) continue;
      if (key === 'service') continue; // always this shipper's serviceName
      if (TOP_LEVEL.has(key)) out[key] = value;
      else out.metadata[key] = value;
    }
    out.level = out.level || 'info';
    out.traceId = out.traceId || randomUUID();
    out.timestamp = out.timestamp || new Date().toISOString();
    return out;
  }

  _ship(entry) {
    const { client, redactLogEntry } = this.telemetry;
    let safe;
    try {
      safe = redactLogEntry(entry, this.middlewareOptions);
      if (this.middlewareOptions.redact) safe = this.middlewareOptions.redact(safe);
    } catch {
      return; // never ship an entry that couldn't be redacted
    }
    void client.reportLog(safe);
  }

  /**
   * Log an entry. Unknown fields go into metadata. Redacted before shipping.
   * @param {Object} entry
   */
  log(entry) {
    if (!this.enabled) return;
    const normalized = this._normalize(entry);
    if (this.telemetry) return this._ship(normalized);
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push(normalized);
  }

  info(data) { this.log({ ...data, level: 'info' }); }
  warn(data) { this.log({ ...data, level: 'warn' }); }
  error(data) { this.log({ ...data, level: 'error' }); }
  debug(data) { this.log({ ...data, level: 'debug' }); }

  /** Ship everything buffered now. Never rejects. */
  async flush() {
    const t = await this.ready;
    if (t) await t.client.flush();
  }

  /** Stop the background timer and flush once. Never rejects. */
  async stop() {
    const t = await this.ready;
    if (t) await t.client.stop();
  }

  /**
   * Express middleware for automatic request logging (redacted; no bodies
   * unless `includeBodies: true`). Sets req.traceId from `x-trace-id` or a new
   * UUID, and logs it with the entry, as before.
   */
  middleware() {
    return (req, res, next) => {
      const headerTrace = req.headers && req.headers['x-trace-id'];
      const traceId = (typeof headerTrace === 'string' && headerTrace) || randomUUID();
      req.traceId = traceId;
      if (!this.enabled || !this.telemetry) return next();
      try {
        // Per-request adapter so the entry carries this request's traceId; the
        // package middleware does the capture + redaction.
        const client = { reportLog: (entry) => this.telemetry.client.reportLog({ ...entry, traceId }) };
        return this.telemetry.createLogMiddleware({ client, ...this.middlewareOptions })(req, res, next);
      } catch {
        return next();
      }
    };
  }
}

module.exports = LogShipper;
