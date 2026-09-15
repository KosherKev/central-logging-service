# Central Logging Service

A centralized logging + metrics collector for your APIs — ship structured
logs and health/metrics from one or more backend services, then query them
back over a small REST API. Pairs with
[LogPulse Analytics](https://github.com/KosherKev/logpulse_analytics), a
Flutter dashboard app built specifically to read this API (Dashboard,
Logs, Errors, and Services tabs) — point LogPulse at your deployed instance
and a `logs:read` key and you have a working dashboard with no other setup.
Runs anywhere that runs a Docker container or plain Node.js; not tied to
any one cloud.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/KosherKev/central-logging-service)

Click the button, paste a MongoDB URI (free tier at
[MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) if you don't
have one — everything else is auto-generated), and deploy. Once it's live,
open `https://<your-service>.onrender.com/admin/keys.html` with the
`ADMIN_SETUP_TOKEN` Render generated (find it in the service's Environment
tab in the Render dashboard) to create your first API key — same flow as
the local `npm run setup` path below, no terminal required. Render's free
plan spins the service down after inactivity, so the first request after a
while takes a few seconds to wake back up — not a bug, upgrade the plan if
that matters for your use case.

Prefer to run it yourself? See "Quick Start" below, or `QUICKSTART.md`.

## Features

- 📊 **Structured JSON Logging** - Standard log format across all services
- 📡 **Metrics / Health Ingestion** - `POST /api/v1/metrics` + `/health` for `@bevingh/telemetry` clients
- 🔥 **Hot Storage with TTL Retention** - MongoDB holds `HOT_STORAGE_DAYS` of logs/metrics, then an explicit purge job (or a background TTL index) clears them. (Cold storage to Google Cloud Storage was designed early on and never built — see Known Limitations in `PROGRESS.md` if you're relying on this README, not just skimming it.)
- 🚀 **Batch Processing** - Efficient log ingestion with batching support
- 🔍 **Advanced Querying** - Filter by service, level, time range, trace ID
- 🔐 **Unified, Scoped API Keys** - One per-app key type (`sk_live_`/`sk_test_`) authorizes logs and metrics, gated by scopes (`logs:read`, `logs:write`, `metrics:read`, `metrics:write`); provision via `/admin/keys.html` or `npm run setup`
- 📈 **Analytics** - Error rates, performance metrics, aggregations
- ☁️ **Deploy anywhere** - One-click on Render (see button above), or self-manage on Google Cloud Run / any Docker host

## Architecture

```
Your APIs → Batch Logs/Metrics → This Service (Render, Cloud Run, or any Docker host)
                                          ↓
                                  MongoDB (TTL retention)
                                          ↓
                                      Query API
                                          ↓
                              LogPulse Analytics (or your own dashboard)
```

## Quick Start

### 1. Installation

```bash
npm install
```

`@bevingh/*` packages (`@bevingh/auth`, `@bevingh/errors`) are published publicly
on npmjs.org — no private registry or auth token needed.

### 2. Environment Setup

```bash
npm run setup
```

Interactive wizard: asks for a MongoDB URI (prints a MongoDB Atlas free-tier
signup link if you need one), writes `.env`, generates an `ADMIN_SETUP_TOKEN`
for `/admin/keys.html`, and can create your first app key on the spot.

Prefer to do it by hand? `cp .env.example .env`:

```env
PORT=8080
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/central-logging

# Legacy, migration-only fallback — see "Authentication" below.
API_KEYS=your-api-key-1,your-api-key-2

# Guards /admin/keys — generate with:
#   node -e "console.log('admin_' + require('crypto').randomBytes(24).toString('hex'))"
ADMIN_SETUP_TOKEN=

# Google Cloud Storage — NOT CURRENTLY FUNCTIONAL, see .env.example. Safe to leave unset.
GCS_BUCKET_NAME=your-logging-bucket
GCS_PROJECT_ID=your-project-id

# Log / metrics retention (MongoDB TTL). COLD_STORAGE_DAYS is likewise
# unused today — see .env.example.
HOT_STORAGE_DAYS=7
COLD_STORAGE_DAYS=90
```

### 3. Run the Service

```bash
# Development
npm run dev

# Production
npm start
```

## Authentication

One key type authorizes both logs and metrics, gated by scopes:

| Scope | Guards |
|---|---|
| `logs:read` | `GET /api/v1/logs*`, `GET /api/v1/services*` |
| `logs:write` | `POST /api/v1/logs` |
| `metrics:read` | `GET /api/v1/metrics` |
| `metrics:write` | `POST /api/v1/metrics`, `POST /api/v1/metrics/health` |

Create one via `/admin/keys.html` (paste your `ADMIN_SETUP_TOKEN`), `npm run
setup`, or the CLI:

```bash
node src/utils/generateAppApiKey.js academicx --scopes=logs:write,metrics:write --live
```

Every route checks `X-API-Key` against these DB-backed, bcrypt-hashed,
individually revocable keys first. A flat, comma-separated `API_KEYS` env
list is still accepted as a **legacy fallback** (migration only — satisfies
`logs:read`, `logs:write`, and `metrics:read`, never `metrics:write`) so
existing consumers keep working without a forced flag-day cutover. New
integrations should get a scoped key instead.

## API Documentation

### Submit Logs

**Endpoint:** `POST /api/v1/logs`

**Headers:**
```
X-API-Key: your-api-key   # needs the logs:write scope
Content-Type: application/json
```

**Body:**
```json
{
  "logs": [
    {
      "timestamp": "2026-02-14T10:30:45.123Z",
      "level": "info",
      "service": "user-api",
      "traceId": "unique-request-id",
      "method": "POST",
      "path": "/api/users",
      "statusCode": 201,
      "duration": 145,
      "request": {
        "headers": { "content-type": "application/json" },
        "body": { "username": "john" },
        "query": {},
        "ip": "192.168.1.1"
      },
      "response": {
        "body": { "id": "123", "username": "john" }
      },
      "error": null,
      "metadata": {
        "userId": "user123"
      }
    }
  ]
}
```

### Submit Health Metric (`@bevingh/telemetry`)

**Endpoint:** `POST /api/v1/metrics/health`

Needs a key with the `metrics:write` scope (see "Authentication" above —
`metrics:write` is the one scope the legacy flat-key fallback never
satisfies, so this route always needs a real scoped key):

```bash
# requires MongoDB; prints the raw key once
npm run generate-app-key -- academicx --scopes=metrics:write --live
```

**Headers:**
```
X-API-Key: sk_live_...
Content-Type: application/json
```

**Body:**
```json
{
  "appId": "academicx",
  "status": "ok",
  "timestamp": "2026-07-20T12:00:00.000Z",
  "instanceId": "rev-abc-1",
  "uptimeSeconds": 3600
}
```

The authenticated key's `subjectId` must equal `appId` or the request is rejected with 403.

### Submit Free-form Metrics (`@bevingh/telemetry`)

**Endpoint:** `POST /api/v1/metrics`

**Headers:** same as health (`X-API-Key` per-app key)

**Body:**
```json
{
  "appId": "academicx",
  "timestamp": "2026-07-20T12:00:00.000Z",
  "instanceId": "rev-abc-1",
  "metrics": {
    "requestCount": 42,
    "p95LatencyMs": 180,
    "anyCustomShape": { "nested": true }
  }
}
```

`metrics` is intentionally unconstrained (any object). Schema validation only checks that it is an object.

### Query Latest Metrics Snapshot

**Endpoint:** `GET /api/v1/metrics`

Operator/dashboard read — needs the `metrics:read` scope (Phase 25 tightened
this from the flat `API_KEYS` list `GET /api/v1/logs` uses; the legacy
fallback still satisfies `metrics:read`, so existing flat-key callers are
unaffected). Full contract: [`docs/METRICS_READ_CONTRACT.md`](docs/METRICS_READ_CONTRACT.md).

**Query Parameters:**
- `appId` — optional; when set, only that app; when omitted, one entry per distinct `appId`
- `instanceWindowSeconds` — optional window for distinct instance counting (default `900`)

**Example:**
```bash
GET /api/v1/metrics
GET /api/v1/metrics?appId=academicx
GET /api/v1/metrics?appId=academicx&instanceWindowSeconds=900
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "appId": "academicx",
      "health": {
        "status": "ok",
        "instanceId": "rev-abc-1",
        "uptimeSeconds": 1234,
        "timestamp": "2026-07-20T12:00:00.000Z"
      },
      "metrics": {
        "activeStudents": 412
      },
      "metricsReportedAt": "2026-07-20T12:05:00.000Z",
      "instanceCount": 2,
      "instances": [
        {
          "instanceId": "rev-abc-1",
          "lastSeen": "2026-07-20T12:05:00.000Z",
          "status": "ok",
          "uptimeSeconds": 1234
        },
        {
          "instanceId": "rev-def-2",
          "lastSeen": "2026-07-20T12:04:00.000Z",
          "status": "ok",
          "uptimeSeconds": 800
        }
      ]
    }
  ]
}
```

`health` / `metrics` are `null` if that app has never reported that kind. `instanceCount` is a distinct aggregation over the activity window — not inferred from `health.instanceId` alone.

### Log Traffic Timeseries (LogPulse charts)

**Endpoint:** `GET /api/v1/logs/stats/timeseries`

**Query Parameters:**
- `timeRange` — `last_hour` | `last_24h` (default) | `last_7d` | `last_30d`
- `service` — optional log service filter
- `from` / `to` — optional absolute ISO-8601 window

**Example:**
```bash
GET /api/v1/logs/stats/timeseries?timeRange=last_24h
GET /api/v1/logs/stats/timeseries?timeRange=last_hour&service=user-api
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "timestamp": "2026-07-21T00:00:00.000Z", "totalCount": 120, "errorCount": 4 },
    { "timestamp": "2026-07-21T01:00:00.000Z", "totalCount": 98, "errorCount": 1 }
  ],
  "meta": { "bucketMs": 3600000, "timeRange": "last_24h", "from": "…", "to": "…" }
}
```

### Query Logs

**Endpoint:** `GET /api/v1/logs`

**Query Parameters:**
- `service` - Filter by service name
- `level` - Filter by log level (info, warn, error, debug)
- `from` - Start date (ISO 8601)
- `to` - End date (ISO 8601)
- `traceId` - Filter by trace ID
- `limit` - Number of results (default: 100, max: 1000)
- `skip` - Pagination offset

**Example:**
```bash
GET /api/v1/logs?service=user-api&level=error&from=2026-02-14&limit=50
```

**Response envelope:**
```json
{
  "success": true,
  "data": [ /* page */ ],
  "total": 4821,
  "meta": { "limit": 50, "skip": 0 },
  "pagination": { "total": 4821, "limit": 50, "skip": 0, "hasMore": true }
}
```

Prefer top-level `total` + `meta` (LogPulse). `pagination` is kept for older clients.

### Get Log by Trace ID

**Endpoint:** `GET /api/v1/logs/:traceId`

Returns all logs associated with a specific request trace.

### Error Groups (LogPulse Errors tab)

**Endpoint:** `GET /api/v1/logs/errors/groups`

Needs the `logs:read` scope. Groups logs where `level === 'error'` **or** `statusCode >= 400` (matches LogPulse `LogEntry.isError`). Fingerprint = `fp_` + sha1(normalized message + code). Sorted by `lastSeen` desc.

**Query:** `timeRange` (default `last_24h`), optional `service`, `limit` (default 50, max 200).

### Services Catalog

**Endpoint:** `GET /api/v1/services`  
**Endpoint:** `GET /api/v1/services/:name`

Union of log `service` names and metrics `appId`s for the window. Detail includes top-20 endpoint rollups plus the same `health` / `metrics` / `instances` shapes as `GET /api/v1/metrics`. Unknown name → 404.

### Get Statistics

**Endpoint:** `GET /api/v1/logs/stats/summary`

**Query Parameters:**
- `service` - Filter by service
- `from` - Start date
- `to` - End date

**Response:**
```json
{
  "totalLogs": 10000,
  "errorRate": "2.50",
  "avgDuration": 145,
  "byLevel": {
    "info": 8500,
    "warn": 1300,
    "error": 200
  },
  "byService": {
    "user-api": {
      "totalRequests": 5000,
      "errorCount": 100,
      "errorRate": 2,
      "avgDuration": 120.5
    },
    "payment-api": {
      "totalRequests": 3000,
      "errorCount": 90,
      "errorRate": 3,
      "avgDuration": 180.2
    }
  }
}
```

Per-service `errorRate` is percent 0–100; `avgDuration` is ms (LogPulse maps to avgLatency).

## Client Integration

### Node.js Client Example — `@bevingh/telemetry` (recommended)

One client, one unified key, for logs *and* metrics/health:

```javascript
const { createTelemetryClient } = require('@bevingh/telemetry');
const { createLogMiddleware } = require('@bevingh/telemetry/adapters/express');

const telemetry = createTelemetryClient({
  appId: 'user-api',
  collectorUrl: 'https://your-logging-service.run.app',
  apiKey: 'your-api-key', // needs logs:write (+ metrics:write if also reporting metrics)
});

app.use(createLogMiddleware({ client: telemetry }));
```

### Node.js Client Example — `client/log-shipper.js` (deprecated)

Still works (logs only, same flat-key scheme), but new integrations should
use `@bevingh/telemetry` above:

```javascript
const LogShipper = require('./log-shipper');

const logger = new LogShipper({
  serviceUrl: 'https://your-logging-service.run.app',
  apiKey: 'your-api-key',
  serviceName: 'user-api',
  batchSize: 50,
  flushInterval: 5000
});

// Log in your Express middleware
app.use((req, res, next) => {
  const start = Date.now();
  const traceId = req.headers['x-trace-id'] || generateId();
  
  res.on('finish', () => {
    logger.log({
      level: res.statusCode >= 400 ? 'error' : 'info',
      traceId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - start,
      request: {
        body: req.body,
        query: req.query,
        headers: req.headers
      }
    });
  });
  
  next();
});
```

## Deployment to Google Cloud Run

### 1. Build Docker Image

```bash
docker build -t gcr.io/YOUR_PROJECT_ID/central-logging-service .
```

Or use `./scripts/deploy.sh`, which builds and deploys in one step. No
private-registry auth needed — `@bevingh/*` packages are public on npmjs.org.

### 2. Push to Google Container Registry

```bash
docker push gcr.io/YOUR_PROJECT_ID/central-logging-service
```

### 3. Deploy to Cloud Run

```bash
gcloud run deploy central-logging-service \
  --image gcr.io/YOUR_PROJECT_ID/central-logging-service \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MONGODB_URI=your-mongodb-uri,API_KEYS=your-keys,ADMIN_SETUP_TOKEN=your-admin-token
```

## Log Retention & Purging

Logs older than **`HOT_STORAGE_DAYS`** (default **7**) can be deleted with an explicit purge job. MongoDB also has a TTL index on `timestamp` as a backup; the HTTP job is the reliable way to clear volume on a schedule.

### One-off (local / shell)

```bash
# requires MONGODB_URI / HOT_STORAGE_DAYS in env
node src/jobs/archiveOldLogs.js
```

### HTTP (for cron-job.org)

```
POST /jobs/purge-logs
Header: X-API-Key: <your flat API_KEYS value>
```

Alias: `POST /jobs/archive` (same handler).

**Example response:**
```json
{
  "success": true,
  "message": "Purged 1234 logs older than 7 days",
  "data": {
    "deletedCount": 1234,
    "cutoffDate": "2026-07-14T02:00:00.000Z",
    "hotStorageDays": 7
  }
}
```

### Set up on [cron-job.org](https://cron-job.org)

1. Deploy this service and note the public URL (e.g. `https://central-logging-service-xxxx.run.app`).
2. Confirm purge works once:
   ```bash
   curl -X POST "https://YOUR_SERVICE_URL/jobs/purge-logs" \
     -H "X-API-Key: YOUR_API_KEY"
   ```
3. Sign in at https://cron-job.org → **Create cronjob**.
4. Fill in:
   | Field | Value |
   |---|---|
   | **Title** | `CLS purge old logs` |
   | **URL** | `https://YOUR_SERVICE_URL/jobs/purge-logs` |
   | **Schedule** | Daily — e.g. every day at **02:00** (UTC or your preferred timezone) |
   | **Request method** | **POST** |
   | **Request timeout** | 30–60s (large deletes may need the high end) |
5. **Request headers** → add:
   | Header | Value |
   |---|---|
   | `X-API-Key` | same value as in `API_KEYS` (one of the flat keys) |
6. Optional: enable email/notifications on non-2xx so you notice failures.
7. Save → **Run now** once and check the execution history + service logs for `Deleted N logs`.

**Retention knob:** set `HOT_STORAGE_DAYS=7` (or whatever you want) on the Cloud Run / host env. The purge deletes documents with `timestamp < now - HOT_STORAGE_DAYS`.

**Not purged by this job:** metrics collection (uses its own MongoDB TTL). Metrics write keys / per-app keys are unrelated — use a **flat** `API_KEYS` secret for this endpoint.

## Security

- Unified, scoped API keys (`ApiKeyCandidate` + `@bevingh/auth` `matchApiKey`) for logs and metrics — bcrypt-hashed, individually revocable via `/admin/keys.html`, never stored in plaintext
- Metrics routes additionally reject `appId` ≠ authenticated subject, so a leaked key can't post as a different app
- Legacy flat `API_KEYS` env list still accepted as a migration-only fallback (`logs:read`/`logs:write`/`metrics:read`, never `metrics:write`) — see "Authentication" above
- `/admin/keys` (provisioning) is guarded by a separate `ADMIN_SETUP_TOKEN` bearer, a higher trust tier than app-level keys
- Rate limiting to prevent abuse
- Input validation with Joi (`metrics` object left free-form by design)
- Helmet.js security headers
- CORS configuration

## Performance

- Batch log submission reduces API calls
- Indexed MongoDB queries for fast retrieval
- Compression for reduced bandwidth
- Connection pooling

## License

MIT

## Author

Techknowslogic
