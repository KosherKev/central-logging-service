# Log Shipper Client (2.0)

> **2.0 is a security fix.** 1.x's `middleware()` shipped raw request headers
> (`Authorization` bearer tokens, cookies, API keys), request bodies
> (passwords) and response bodies (issued access/refresh tokens) to this
> service, which stores log entries as-is. 2.0 keeps the same `LogShipper`
> API but is a thin shim over **`@bevingh/telemetry` ≥ 0.2.2**, and every
> entry is redacted before it leaves your process. If you vendored a 1.x copy
> of this file into another repo, replace it.
>
> New integrations should use `@bevingh/telemetry` directly
> (`createTelemetryClient` + `createLogMiddleware`); see its README.

Client for shipping logs from your APIs to the Central Logging Service.

## Installation

Requires Node ≥ 18.

```bash
npm install @bevingh/telemetry@^0.2.2
```

Copy `log-shipper.js` into your project (it has no other dependencies).

## Configuration: environment first

```bash
TELEMETRY_COLLECTOR_URL=https://your-logging-service.example   # or legacy LOGGING_SERVICE_URL
TELEMETRY_API_KEY=sk_live_...                                   # or legacy LOGGING_API_KEY — needs logs:write
TELEMETRY_APP_ID=user-api                                       # or legacy SERVICE_NAME
# LOG_SHIPPER_ENABLED=false  /  ENABLE_TELEMETRY=false          # switch off without unsetting
```

```javascript
const LogShipper = require('./log-shipper');
const logger = new LogShipper(); // everything from env
```

Explicit options still win over env: `serviceUrl`, `apiKey`, `serviceName`,
`batchSize` (alias `maxBatchSize`), `flushInterval`, `enabled`,
`installProcessHooks`, plus the redaction options below. With no URL or no
key the shipper is a **no-op** (one warning), never a crash. There is no
hard-coded default URL or key.

## Express middleware

```javascript
app.use(express.json());
app.use(logger.middleware());
```

Logs method, **full** path, status, duration, redacted headers, query, IP,
user agent and `metadata.url`. Sets `req.traceId` from the `x-trace-id`
header, or a new UUID, and ships it with the entry.

**Bodies are not captured** unless you opt in:

```javascript
const logger = new LogShipper({
  includeBodies: true,              // still redacted; avoid on auth/payment routes
  redactHeaders: ['x-tenant-key'],  // extra header names/RegExps
  redactKeys: [/e-?mail/i, /phone/i], // extra body/query/metadata keys (PII)
  redact: (entry) => entry,         // final app-specific pass
});
```

## What is redacted (always)

| Where | Rule |
|---|---|
| Headers | `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, and names matching `token\|secret\|signature\|api-key\|password\|session\|credential` → `"[REDACTED]"` |
| Body / query / metadata keys (any depth) | `password`, `token`, `secret`, `otp`, `pin`, `apiKey`, `cvv`, `cardNumber`, `signature`, `session`, `cookie`, `credential`, `privateKey`, … → `"[REDACTED]"` |
| URL query params (`metadata.url`) | same key rule, e.g. `?token=[REDACTED]` |
| Anywhere | JWT-shaped strings → `"[REDACTED]"` |

If redaction (or your `redact` hook) throws, the entry is **dropped**, never
shipped raw. Manual `log()`/`info()`/… calls are redacted too.

## Manual logging

```javascript
logger.info({ message: 'User logged in', userId: '123' });
logger.warn({ message: 'Rate limit approaching', current: 95 });
logger.error({ message: 'Payment failed', error: { message: err.message, code: err.code } });
logger.log({ level: 'debug', traceId: req.traceId, method: 'POST', path: '/api/users', statusCode: 201 });
```

Collector-schema fields (`timestamp`, `level`, `traceId`, `method`, `path`,
`statusCode`, `duration`, `request`, `response`, `error`, `metadata`) are
sent as-is. **Any other field (e.g. `message`, `userId`) goes into
`metadata`.** 1.x silently dropped them.

## Batching, retry, shutdown

From `@bevingh/telemetry`: buffered (`batchSize` default 50, `flushInterval`
default 5000 ms), requeue on failure, drop-oldest past 10,000 entries.
`flush()` / `stop()` never reject. On `beforeExit`/`SIGINT`/`SIGTERM` it
**flushes only**; unlike 1.x it never calls `process.exit()` (pass
`installProcessHooks: false` if your app owns shutdown). Entries logged
before the ESM package finishes loading are queued and sent once it's ready.
Requests that arrive in that same window are not logged.

## Log entry format

```typescript
{
  timestamp: string; level: 'info' | 'warn' | 'error' | 'debug';
  service: string;   traceId: string;
  method?: string;   path?: string; statusCode?: number; duration?: number;
  request?:  { headers?: object; body?: any; query?: object; ip?: string; userAgent?: string };
  response?: { headers?: object; body?: any };
  error?:    { message?: string; stack?: string; code?: string };
  metadata?: object;
}
```

## License

MIT
