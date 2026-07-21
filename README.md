# Central Logging Service

A centralized logging service designed to collect, store, and analyze logs from multiple APIs deployed on Google Cloud Run.

## Features

- 📊 **Structured JSON Logging** - Standard log format across all services
- 📡 **Metrics / Health Ingestion** - `POST /api/v1/metrics` + `/health` for `@bevingh/telemetry` clients
- 🔥 **Hot & Cold Storage** - MongoDB for recent logs, Google Cloud Storage for archives
- 🚀 **Batch Processing** - Efficient log ingestion with batching support
- 🔍 **Advanced Querying** - Filter by service, level, time range, trace ID
- 🔐 **API Key Authentication** - Flat keys for logs; per-app hashed keys for metrics
- 📈 **Analytics** - Error rates, performance metrics, aggregations
- ☁️ **Cloud Run Ready** - Optimized for Google Cloud Run deployment

## Architecture

```
Your APIs → Batch Logs → Logging Service (Cloud Run)
                              ↓
                    ┌─────────┴─────────┐
                    ↓                   ↓
              MongoDB (hot)    Google Cloud Storage (cold)
                    ↓
              Query API
                    ↓
              Dashboard App
```

## Quick Start

### 1. Installation

Private `@bevingh/*` packages resolve from GitHub Packages. This repo's committed `.npmrc` only sets the scope (no token). Put a **read:packages**-only PAT in your user `~/.npmrc`:

```ini
@bevingh:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_READ_PACKAGES_TOKEN
```

Verify, then install:

```bash
npm whoami --registry=https://npm.pkg.github.com
npm install
```

### 2. Environment Setup

Create a `.env` file:

```env
PORT=8080
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/central-logging
API_KEYS=your-api-key-1,your-api-key-2

# Google Cloud Storage (optional)
GCS_BUCKET_NAME=your-logging-bucket
GCS_PROJECT_ID=your-project-id

# Log / metrics retention (MongoDB TTL for both logs and metrics collections)
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

## API Documentation

### Submit Logs

**Endpoint:** `POST /api/v1/logs`

**Headers:**
```
X-API-Key: your-api-key
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

Uses **per-app** API keys (`sk_live_` / `sk_test_`), not the flat `API_KEYS` list used by `/api/v1/logs`. Generate one with:

```bash
# requires MongoDB; prints the raw key once
npm run generate-app-key -- academicx
# or test key:
node src/utils/generateAppApiKey.js academicx --test
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

Operator/dashboard read (flat `API_KEYS` auth — same as `GET /api/v1/logs`, **not** per-app `metricsAuth`). Full contract: [`docs/METRICS_READ_CONTRACT.md`](docs/METRICS_READ_CONTRACT.md).

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

Flat `X-API-Key`. Groups logs where `level === 'error'` **or** `statusCode >= 400` (matches LogPulse `LogEntry.isError`). Fingerprint = `fp_` + sha1(normalized message + code). Sorted by `lastSeen` desc.

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

### Node.js Client Example

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

`npm ci` needs GitHub Packages at build time. Use a BuildKit secret (never `ARG`/`ENV` for the token). Token file is **never committed** (see `.secrets/` in `.gitignore`).

```bash
mkdir -p .secrets
# write a read:packages-only PAT (not a publish token)
printf '%s' "$GITHUB_READ_PACKAGES_TOKEN" > .secrets/npm_token
chmod 600 .secrets/npm_token

DOCKER_BUILDKIT=1 docker build \
  --secret id=npm_token,src=.secrets/npm_token \
  -t gcr.io/YOUR_PROJECT_ID/central-logging-service .
```

Or use `./scripts/deploy.sh`, which wires the secret mount the same way.

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
  --set-env-vars MONGODB_URI=your-mongodb-uri,API_KEYS=your-keys
```

## Log Retention & Archiving

The service automatically:
- Keeps logs in MongoDB for 7 days (configurable)
- Archives logs to Google Cloud Storage after 7 days
- Deletes logs from GCS after 90 days (configurable)

Run the archive job:
```bash
node src/jobs/archiveOldLogs.js
```

Schedule with Cloud Scheduler or cron:
```bash
0 2 * * * node src/jobs/archiveOldLogs.js
```

## Security

- API key authentication for log submission (flat `API_KEYS` env list)
- Per-app hashed API keys for metrics (`ApiKeyCandidate` + `@bevingh/auth` `matchApiKey`); route rejects `appId` ≠ authenticated subject
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
