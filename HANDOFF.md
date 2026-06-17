# Central Logging Service — AI Development Handoff Document

> **Purpose:** Paste this document into a new AI-assisted development session as the complete context foundation. All details were extracted directly from the codebase as of **2026-06-17**.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Name** | Central Logging Service |
| **npm Package** | `central-logging-service` |
| **Version** | `1.0.0` |
| **Author** | Techknowslogic |
| **License** | MIT |
| **Stage** | Production-ready (all core features implemented and containerized) |
| **Purpose** | A centralized, API-key-authenticated log collection, storage, and analytics service. Designed to receive structured JSON logs from multiple microservices (via a bundled client library) and store them in MongoDB (hot) and Google Cloud Storage (cold). |
| **Primary Audience** | Backend API teams deploying services on Google Cloud Run that need a single place to ship, query, and analyze logs. |

---

## 2. Tech Stack

### Backend / Server
| Technology | Version / Details |
|---|---|
| **Runtime** | Node.js ≥ 18.0.0 |
| **Framework** | Express.js `^4.18.2` |
| **Database ODM** | Mongoose `^8.0.3` (MongoDB) |
| **Validation** | Joi `^17.11.0` |
| **Security Headers** | Helmet `^7.1.0` |
| **CORS** | cors `^2.8.5` |
| **Compression** | compression `^1.7.4` |
| **Internal Logging** | Winston `^3.11.0` |
| **ID Generation** | uuid `^9.0.1` |
| **Env Management** | dotenv `^16.3.1` |

### Storage
| Technology | Role |
|---|---|
| **MongoDB** | Primary (hot) storage — logs stored for `HOT_STORAGE_DAYS` (default: 7 days), enforced via TTL index |
| **Google Cloud Storage** | Cold archive storage — logs archived for up to `COLD_STORAGE_DAYS` (default: 90 days) |

### Auth
- **API Key authentication** — flat list of pre-shared keys stored in the `API_KEYS` env var (comma-separated). No JWT, no OAuth.
- Auth header: `X-API-Key: <key>`
- No role differentiation — all valid keys have full access to every endpoint.

### Infrastructure / Deployment
| Technology | Purpose |
|---|---|
| **Docker** | Container image (`node:18-alpine`) |
| **Google Cloud Run** | Target deployment platform |
| **Google Container Registry** | Image registry (`gcr.io/PROJECT_ID/central-logging-service`) |
| **Google Cloud Scheduler** | Trigger archive/purge job on a cron (`0 2 * * *`) |

### Dev Tools
| Tool | Purpose |
|---|---|
| `nodemon ^3.0.2` | Dev server auto-restart |
| `jest ^29.7.0` | Test runner (no tests written yet) |

### Client Library (bundled in `/client`)
- `node-fetch` — HTTP requests to the logging service
- `uuid` — Trace ID generation

---

## 3. Repo Structure

```
central-logging-service/
├── src/                        ← All server source code
│   ├── server.js               ← Express app entry point (main file)
│   ├── config/
│   │   ├── index.js            ← All env vars loaded here; single config object exported
│   │   └── database.js         ← Mongoose connect() with event listeners
│   ├── models/
│   │   └── Log.js              ← Only data model; full schema + indexes
│   ├── routes/
│   │   ├── logs.js             ← All /api/v1/logs/* route handlers
│   │   └── health.js           ← /health and /ready endpoints
│   ├── middleware/
│   │   ├── auth.js             ← API key check (reads X-API-Key header)
│   │   ├── rateLimit.js        ← In-memory rate limiter (Map-based, not Redis)
│   │   ├── validation.js       ← Joi schema for POST /api/v1/logs body
│   │   └── errorHandler.js     ← Global Express error handler (last middleware)
│   ├── services/
│   │   └── storageService.js   ← Google Cloud Storage wrapper (singleton)
│   ├── jobs/
│   │   └── archiveOldLogs.js   ← Standalone purge script (deletes old logs from MongoDB)
│   └── utils/
│       ├── logger.js           ← Winston logger wrapper (console transport only)
│       ├── generateApiKey.js   ← CLI script: node src/utils/generateApiKey.js [count]
│       └── seedDatabase.js     ← CLI script: node src/utils/seedDatabase.js [count]
│
├── client/                     ← Standalone client library for consuming APIs to use
│   ├── log-shipper.js          ← LogShipper class: batching, flushing, Express middleware
│   ├── package.json            ← Client-specific deps (node-fetch, uuid)
│   └── README.md               ← Client usage documentation
│
├── examples/
│   ├── express-integration.js  ← Example: LogShipper in an Express API
│   └── batch-job-logging.js    ← Example: logging from a batch/cron process
│
├── scripts/
│   ├── deploy.sh               ← Full Cloud Run build + push + deploy script
│   └── update-env.sh           ← Updates Cloud Run service env vars from .env
│
├── Dockerfile                  ← node:18-alpine, non-root user, EXPOSE 8080
├── .env.example                ← Template with all required env vars
├── package.json                ← Root package; entry: src/server.js
├── README.md                   ← User-facing feature overview + API docs
├── QUICKSTART.md               ← 5-minute local setup
├── DEPLOYMENT.md               ← Step-by-step Cloud Run deployment guide
├── API_TESTING.md              ← Complete curl + Postman examples for all endpoints
└── PROJECT_SUMMARY.md          ← Architecture overview and feature summary
```

**Monorepo / Workspace:** No. Single Node.js app at root. The `client/` folder is a separate standalone library meant to be copied into consuming projects — it is **not** a workspace package.

---

## 4. Data Models

### `Log` (MongoDB collection: `logs`)

The only model in the system. Defined in [`src/models/Log.js`](./src/models/Log.js).

| Field | Type | Required | Indexed | Notes |
|---|---|---|---|---|
| `timestamp` | `Date` | ✅ | ✅ | Request time; also used for TTL expiry |
| `level` | `String` | ✅ | ✅ | Enum: `info`, `warn`, `error`, `debug` |
| `service` | `String` | ✅ | ✅ | Name of the originating service (e.g., `user-api`) |
| `traceId` | `String` | ✅ | ✅ | Unique ID to correlate logs across services for one request |
| `method` | `String` | ❌ | ❌ | HTTP method (GET, POST, etc.) |
| `path` | `String` | ❌ | ❌ | Request path |
| `statusCode` | `Number` | ❌ | ✅ | HTTP response status code |
| `duration` | `Number` | ❌ | ❌ | Response time in milliseconds |
| `request` | `Mixed` | ❌ | ❌ | Object with `headers`, `body`, `query`, `ip`, `userAgent` |
| `response` | `Mixed` | ❌ | ❌ | Object with `headers`, `body` |
| `error` | `Mixed` | ❌ | ❌ | Object with `message`, `stack`, `code` |
| `metadata` | `Mixed` | ❌ | ❌ | Arbitrary key-value data; default `{}` |
| `archived` | `Boolean` | — | ✅ | Default `false`; flag for archival status |
| `createdAt` | `Date` | — | — | Auto-added by Mongoose `timestamps: true` |
| `updatedAt` | `Date` | — | — | Auto-added by Mongoose `timestamps: true` |

**Compound Indexes (for query performance):**
- `{ service: 1, timestamp: -1 }`
- `{ level: 1, timestamp: -1 }`
- `{ service: 1, level: 1, timestamp: -1 }`
- `{ archived: 1, timestamp: 1 }`

**TTL Index:**
- `{ timestamp: 1 }` with `expireAfterSeconds = 60 * 60 * 24 * HOT_STORAGE_DAYS`
- MongoDB automatically deletes documents older than the retention window.

**No other models exist.** There is no User, ApiKey, Service, or Archive model.

---

## 5. API Surface

Base path: `/`
API version prefix: `/api/v1`
Auth: `X-API-Key` header required for all `/api/v1/*` routes.

### Health / Infrastructure

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | ❌ | Returns process uptime, memory usage, and `status: "healthy"`. Used by Docker HEALTHCHECK and Cloud Run liveness probe. |
| `GET` | `/ready` | ❌ | Checks MongoDB connection `readyState === 1`. Returns 503 if not connected. Used as Cloud Run readiness probe. |
| `GET` | `/` | ❌ | Returns service name, version, and a list of available endpoints. |

### Logs (`/api/v1/logs`)

All routes below require `X-API-Key` in the request header. The `POST` route additionally runs rate limiting and Joi validation middleware.

| Method | Path | Auth | Middleware | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/logs` | ✅ | `authenticate` → `rateLimit` → `validateLogBatch` | Submit a batch of 1–1000 log entries. Uses `Log.insertMany` with `ordered: false`. Handles duplicate key errors with partial success (HTTP 207). Returns `{ success, message, count }`. |
| `GET` | `/api/v1/logs` | ✅ | `authenticate` | Query logs with filters. Defaults to the last `HOT_STORAGE_DAYS` days if no date range specified. Max 1000 results per call. Returns `{ success, data[], pagination }`. |
| `GET` | `/api/v1/logs/stats/summary` | ✅ | `authenticate` | Aggregated stats via MongoDB `$facet` pipeline: total count, error rate %, avg duration, breakdown by level/service/statusCode. |
| `GET` | `/api/v1/logs/:traceId` | ✅ | `authenticate` | Fetch all logs for a given `traceId`, sorted ascending by timestamp. Returns 404 if no logs found. |

> ⚠️ **Route ordering note:** `GET /api/v1/logs/stats/summary` must be registered **before** `GET /api/v1/logs/:traceId` in Express — and it is. If this order is accidentally reversed, Express will treat `stats` as a `:traceId` value.

### Query Parameters for `GET /api/v1/logs`

| Param | Type | Default | Description |
|---|---|---|---|
| `service` | string | — | Exact match on `service` field |
| `level` | string | — | Exact match: `info`, `warn`, `error`, `debug` |
| `from` | ISO date | 7 days ago | Start of timestamp range (`$gte`) |
| `to` | ISO date | — | End of timestamp range (`$lte`) |
| `traceId` | string | — | Exact match on `traceId` |
| `statusCode` | integer | — | Exact match on `statusCode` |
| `limit` | integer | `100` | Max records returned (hard cap: 1000) |
| `skip` | integer | `0` | Pagination offset |
| `sortBy` | string | `timestamp` | Field to sort by |
| `sortOrder` | string | `desc` | `asc` or `desc` |

---

## 6. Roles and Permissions

The system has **no role-based access control**. There is a single permission level:

| Actor | Access |
|---|---|
| **Unauthenticated caller** | `/health`, `/ready`, `/` only |
| **Authenticated caller** (valid `X-API-Key`) | Full read/write access to all log endpoints |

All valid API keys (listed in `API_KEYS` env var, comma-separated) have identical permissions. There is no admin vs. read-only distinction. Key management is entirely manual — keys are hardcoded in the environment variable.

---

## 7. Current State

### ✅ Fully Working
- Express server with Helmet, CORS, compression, JSON body parsing
- MongoDB connection with reconnect event handling and graceful shutdown
- `Log` model with full schema, compound indexes, and TTL auto-deletion
- `POST /api/v1/logs` — batch ingestion with ordered:false and duplicate handling
- `GET /api/v1/logs` — filtered query with pagination
- `GET /api/v1/logs/:traceId` — trace-level log retrieval
- `GET /api/v1/logs/stats/summary` — MongoDB aggregation pipeline
- `GET /health` and `GET /ready` health probes
- API key authentication middleware
- In-memory rate limiting (Map-based, resets on restart)
- Joi schema validation for batch log submissions
- Global error handler (handles Mongoose ValidationError, CastError, JWT errors, and generic errors)
- Winston console logger (used throughout server code)
- Google Cloud Storage service (`storageService.js`) — upload, download, delete, list archives
- `archiveOldLogs.js` — standalone purge script (deletes expired MongoDB logs)
- Docker container configuration (non-root user, health check, EXPOSE 8080)
- `LogShipper` client library — buffering, batch flushing, Express middleware integration
- Utility scripts: `generateApiKey.js`, `seedDatabase.js`
- Deployment scripts: `deploy.sh`, `update-env.sh`
- Full documentation set: README, QUICKSTART, DEPLOYMENT, API_TESTING, PROJECT_SUMMARY

### ⚠️ Partially Built / Not Connected
- **GCS archiving is implemented but not wired into the server lifecycle.** `storageService.js` exists and works, but `archiveOldLogs.js` only deletes from MongoDB — it does **not** upload to GCS before deleting. The archive-to-GCS flow must be run via `storageService.uploadLogs()` separately.
- **No HTTP endpoint to trigger the archive job remotely.** `PROJECT_SUMMARY.md` and `DEPLOYMENT.md` reference a Cloud Scheduler hitting `POST /jobs/archive`, but that route **does not exist** in `server.js` or any routes file.
- **No actual cold-storage retrieval endpoint.** There is no API route to query archived logs from GCS.

### ❌ Known Missing / Not Implemented
- **No test suite.** Jest is listed as a devDependency but zero test files exist.
- **No dashboard or frontend.** README mentions a "Dashboard App" in the architecture diagram, but no UI code exists anywhere.
- **Rate limiter is not persistent.** The in-memory Map resets on every process restart / Cloud Run instance spin-up, meaning limits are not shared across instances.
- **No search/full-text capability.** You cannot search log `metadata` or `request.body` content via the API.
- **No webhook or alerting integration.** Error spikes do not trigger external notifications.

---

## 8. Recent Work (Last Commits)

```
191e37f refactor(logger): remove database persistence from logging utility
5daf41d feat: replace console logging with structured logger
039bb46 refactor: simplify log retention by removing archival process
85e88a7 feat: add utility scripts and comprehensive documentation
23007fb docs: add deployment and usage documentation for central logging service
5e1fa2f feat: add centralized logging service with client library
acf6262 initial commit
```

**What was last worked on:**
1. **`191e37f`** — Refactored the internal `logger.js` utility. Previously had some database persistence layer; it was removed. Logger now only uses Winston's console transport. This was the most recent commit.
2. **`5daf41d`** — Replaced `console.log/error` calls across the codebase with the structured Winston logger (`src/utils/logger.js`).
3. **`039bb46`** — Simplified log retention. The original design likely had a two-phase archive-then-delete flow; it was simplified to just delete-from-MongoDB (the archive-to-GCS step was removed from the job). The `storageService.js` still exists but is no longer called by the archive job.

**State it was left in:** The refactoring is complete and stable. The service runs correctly in its current simplified form. The GCS archival integration is present but disconnected from the main retention flow.

---

## 9. Open Issues / Tech Debt

| # | Category | Description |
|---|---|---|
| 1 | **Bug / Missing Route** | `POST /jobs/archive` is documented in `DEPLOYMENT.md` and `PROJECT_SUMMARY.md` as a Cloud Scheduler target but **does not exist**. Any scheduler pointed at it will receive a 404. |
| 2 | **Incomplete Feature** | GCS archive flow is broken by design: `archiveOldLogs.js` deletes MongoDB logs without first uploading them to GCS. Cold storage path is effectively dead. |
| 3 | **No Tests** | Zero test coverage. `jest` is installed but unused. |
| 4 | **Rate Limiter — Not Production-Safe** | In-memory rate limiter (Map) does not persist across restarts or Cloud Run instances. On multi-instance deployments, each instance has its own independent limit. Replace with Redis-backed limiter (`express-rate-limit` + `rate-limit-redis`) for production. |
| 5 | **Security: API Keys in Env Var** | API keys are stored as a plain comma-separated string in `API_KEYS`. No rotation mechanism, no per-key metadata (owner, expiry). Scaling key management will require a proper key store. |
| 6 | **CORS is Fully Open** | `app.use(cors())` with no options allows any origin. Should be restricted to known consumer domains in production. |
| 7 | **Error Handler References JWT** | `errorHandler.js` handles `JsonWebTokenError`, but the project uses API keys, not JWTs. This is dead code that implies an earlier or planned JWT-based auth that was never implemented. |
| 8 | **No GCS Retrieval Endpoint** | Logs archived to GCS are write-only from the API's perspective. There is no endpoint to query or retrieve cold-storage logs. |
| 9 | **`sortBy` is Unsanitized** | `GET /api/v1/logs` passes the `sortBy` query param directly to Mongoose `.sort()` without validating it is a known field. A caller can sort by any arbitrary field. |
| 10 | **`client/` Not a Managed Package** | The client library in `client/` depends on `node-fetch` and `uuid` but has no install instructions baked into the server workflow. It must be manually copied and installed in consuming projects. |

---

## 10. File Location Reference

| What | File Path |
|---|---|
| **Server entry point** | [`src/server.js`](./src/server.js) |
| **App config (all env vars)** | [`src/config/index.js`](./src/config/index.js) |
| **MongoDB connection** | [`src/config/database.js`](./src/config/database.js) |
| **Log model (schema + indexes)** | [`src/models/Log.js`](./src/models/Log.js) |
| **Logs routes (all CRUD/query)** | [`src/routes/logs.js`](./src/routes/logs.js) |
| **Health check routes** | [`src/routes/health.js`](./src/routes/health.js) |
| **Auth middleware** | [`src/middleware/auth.js`](./src/middleware/auth.js) |
| **Rate limit middleware** | [`src/middleware/rateLimit.js`](./src/middleware/rateLimit.js) |
| **Joi validation middleware** | [`src/middleware/validation.js`](./src/middleware/validation.js) |
| **Global error handler** | [`src/middleware/errorHandler.js`](./src/middleware/errorHandler.js) |
| **GCS storage service** | [`src/services/storageService.js`](./src/services/storageService.js) |
| **Archive / purge job** | [`src/jobs/archiveOldLogs.js`](./src/jobs/archiveOldLogs.js) |
| **Internal Winston logger** | [`src/utils/logger.js`](./src/utils/logger.js) |
| **API key generator** | [`src/utils/generateApiKey.js`](./src/utils/generateApiKey.js) |
| **DB seed script** | [`src/utils/seedDatabase.js`](./src/utils/seedDatabase.js) |
| **Client log shipper** | [`client/log-shipper.js`](./client/log-shipper.js) |
| **Client README** | [`client/README.md`](./client/README.md) |
| **Express integration example** | [`examples/express-integration.js`](./examples/express-integration.js) |
| **Batch job example** | [`examples/batch-job-logging.js`](./examples/batch-job-logging.js) |
| **Cloud Run deploy script** | [`scripts/deploy.sh`](./scripts/deploy.sh) |
| **Env update script** | [`scripts/update-env.sh`](./scripts/update-env.sh) |
| **Dockerfile** | [`Dockerfile`](./Dockerfile) |
| **Env vars template** | [`.env.example`](./.env.example) |

---

## Continuation Prompt (paste into new session)

> I'm continuing development on **Central Logging Service** — a Node.js/Express centralized log collection API designed for Google Cloud Run. The full context is in `HANDOFF.md` at the repo root. Here is the current state:
>
> - **Working:** Full CRUD log API (POST batch, GET query, GET by traceId, GET stats), MongoDB with TTL, API key auth, rate limiting, Joi validation, Docker, GCS service class.
> - **Broken / Missing:** The `POST /jobs/archive` route referenced in docs does not exist. The GCS cold-storage archive flow is disconnected from the retention job. No tests exist. Rate limiter is in-memory and not shared across Cloud Run instances.
> - **Stack:** Node.js 18, Express 4, Mongoose 8, MongoDB, Google Cloud Storage, Docker, deployed on Cloud Run.
> - **The task I want to work on next is:** [DESCRIBE YOUR NEXT TASK HERE]
