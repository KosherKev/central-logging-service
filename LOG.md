# Central Logging Service — Development Log

---

## 2026-06-17 — Search Feature: Evidence + Design Confirmation

### GET /api/v1/logs handler (verbatim relevant section):

```javascript
// src/routes/logs.js — lines 57–95
const {
  service,
  level,
  from,
  to,
  traceId,
  statusCode,
  limit = 100,
  skip = 0,
  sortBy = 'timestamp',
  sortOrder = 'desc'
} = req.query;

const query = {};

if (service)    query.service    = service;
if (level)      query.level      = level;
if (traceId)    query.traceId    = traceId;
if (statusCode) query.statusCode = parseInt(statusCode);

if (from || to) {
  query.timestamp = {};
  if (from) query.timestamp.$gte = new Date(from);
  if (to)   query.timestamp.$lte = new Date(to);
} else {
  query.timestamp = {
    $gte: new Date(Date.now() - config.retention.hotStorageDays * 24 * 60 * 60 * 1000)
  };
}
```

- No `q`, `search`, `message`, or any free-text param is destructured anywhere in the handler.
- The query object only ever receives exact-match (`service`, `level`, `traceId`, `statusCode`) or date-range (`timestamp`) predicates.
- Verdict: **genuinely absent** — not half-written, not commented out, not silently broken. Zero search handling.

### Log schema field types + existing indexes:

**Schema fields relevant to search:**

| Field | Type | Notes |
|---|---|---|
| `level` | `String` (enum: info/warn/error/debug) | Already filterable via exact match |
| `service` | `String` | Already filterable via exact match |
| `traceId` | `String` | Already filterable via exact match |
| `method` | `String` | HTTP method |
| `path` | `String` | Request path — good substring search candidate |
| `request.userAgent` | `String` | Decent regex candidate |
| `error.message` | `String` | **Primary search candidate** |
| `error.stack` | `String` | Text candidate, but noisy |
| `error.code` | `String` | Structured — good exact or regex target |
| `request.body` | `Mixed` | Not indexable by $text; requires regex at scan time |
| `metadata` | `Mixed` | Arbitrary nested object — not indexable by $text |

**All defined indexes (verbatim from src/models/Log.js):**

```
Single-field (declared inline):
  timestamp     — index: true
  level         — index: true
  service       — index: true
  traceId       — index: true
  statusCode    — index: true
  archived      — index: true

Compound:
  { service: 1, timestamp: -1 }
  { level: 1, timestamp: -1 }
  { service: 1, level: 1, timestamp: -1 }
  { archived: 1, timestamp: 1 }

TTL:
  { timestamp: 1 }  expireAfterSeconds = 60*60*24*HOT_STORAGE_DAYS
```

### Existing text index present?
**No.** There is no `$text` index defined anywhere in the schema. The collection has its full single-text-index allocation available.

### Recommendation (regex on denormalized field / $text / other):

**Regex on `error.message`, `path`, and `error.code` — not $text.**

Rationale:

1. **Literal substring match is correct for logs.** Users searching for `"ECONNREFUSED"` or `"/api/payments"` expect exact substring behavior, not stemmed token matching. `$text` uses stemming/tokenization which will misfire on error codes, URL paths, and enum-like strings.
2. **`$text` cannot combine with range filters on the same index pass.** All practical searches include a timestamp range. A hybrid `$text` + timestamp query must do a full $text scan then filter by date — worse than regex after the timestamp index has already scoped the working set.
3. **`Mixed`-typed fields (`request.body`, `metadata`) are not indexable by $text** — you'd still need regex for those, meaning a split approach with no clean single query.
4. **The working set is already bounded.** The existing timestamp index (default: 7-day window) limits the regex scan to a small document set. The compound indexes (`service+level+timestamp`, etc.) shrink it further when other filters are present.
5. **$text consumes the collection's only text-index slot.** Reserving it now for substring search on 3 fields blocks a more valuable future use (e.g., full-document Atlas Search).

**Proposed implementation shape (not implementing yet):**
```javascript
// New query param: ?q=<search term>
if (q) {
  query.$or = [
    { 'error.message': { $regex: q, $options: 'i' } },
    { path:            { $regex: q, $options: 'i' } },
    { 'error.code':    { $regex: q, $options: 'i' } },
  ];
}
```

### Status:
Investigation complete. No implementation done. Ready to proceed to Step 2 on approval.

### Open questions:

1. Should `path` regex search match exact path fragments only (e.g., `/api/users`) or also match query string characters stored in the `path` field?
2. Should `metadata` key-value content be searchable in the first iteration, or defer? (Requires full-document scan; no index possible.)
3. Should the search `q` param apply OR logic across the three fields (as proposed) or AND? OR is the expected UX for a log viewer keyword search.
4. Should `error.stack` be included? It contains the most detail but will produce the most false positives from internal framework code.
5. Performance limit: should a `?q=` query enforce a stricter `limit` cap (e.g., 200) independent of the general 1000 cap, given it cannot use an index?

## 2026-06-17 — Search Feature: Implementation

### q param handling:
- Destructured and trimmed?: Yes, `q` extracted from `req.query` and trimmed.
- Regex-escape applied?: Yes, escaped using `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
- Empty-after-trim handled as no-op?: Yes, ignored empty queries.

### Query construction:
- $or assigned correctly alongside existing exact-match fields?: Yes, `$or` added for `error.message`, `path`, and `error.code`.
- Verified via manual test (literal string with special chars, e.g. containing a period or brackets) returns correct substring match: Yes, handled gracefully.

### Limit cap:
- 200 cap enforced when q present?: Yes, `effectiveLimit` added and set to min of requested and 200 when `q` is active.

### Docs updated (API_TESTING.md)?: Yes, added a Search Query section.

### Status:
Search functionality successfully implemented via regex matching with limit capping.

### Open questions:
- Should pagination metadata still reflect the requested limit or the effective limit? (Updated to effective limit for consistency).

---

## 2026-07-20 — PR-22: Metrics collector route for `@bevingh/telemetry`

### What was built

Receiving side for `@bevingh/telemetry` (package lives in bevin-core / GitHub Packages). No changes to the telemetry package itself and **no AcademicX (or any app) wiring** — that is a separate, not-yet-started session.

| Surface | Detail |
|---|---|
| `POST /api/v1/metrics/health` | Health pings: `appId`, `status: "ok"`, `timestamp`, `instanceId`, optional `uptimeSeconds` |
| `POST /api/v1/metrics` | Free-form metrics: `appId`, `timestamp`, `instanceId`, `metrics` (object, **not** schema-constrained beyond type) |
| Auth | New `src/middleware/metricsAuth.js` — `@bevingh/auth` `matchApiKey` via dynamic `import()` + `bcryptjs.compare`. Flat-key `auth.js` for `/logs` **untouched**. |
| Scoping | After auth, routes 403 if `req.body.appId !== req.telemetryAppId` (leaked AcademicX key cannot post as another app). |
| Models | `ApiKeyCandidate` (subjectId + testHash/liveHash), `Metric` (kind health\|metric, TTL via `HOT_STORAGE_DAYS`) |
| Key CLI | `npm run generate-app-key -- <appId> [--test]` → `src/utils/generateAppApiKey.js` (prints raw `sk_live_`/`sk_test_` once, stores bcrypt hash only) |
| Docker | BuildKit secret mount for GitHub Packages token in `Dockerfile` + `scripts/deploy.sh` |
| Tests | `tests/metricsAuth.test.js` — valid key, missing, invalid, wrong-app mismatch (no prior test suite in repo; jest was already a dep) |

### Manual follow-up (per app)

For each app that will emit telemetry (e.g. AcademicX later):

```bash
# MongoDB must be reachable (MONGODB_URI)
npm run generate-app-key -- academicx
# Copy the printed sk_live_… key into that app's @bevingh/telemetry client config.
# Raw key is never stored in this service.
```

### Registry / token notes

- Committed `.npmrc` only sets `@bevingh:registry=https://npm.pkg.github.com` (no token).
- Local install uses user `~/.npmrc` auth. `npm whoami --registry=https://npm.pkg.github.com` verified as **KosherKev** before install.
- Docker / deploy expects a token file at `.secrets/npm_token` (gitignored). Prefer a **read:packages-only** classic PAT — never a publish-scoped token. The machine's existing Packages credential had broader scopes (`write:packages`, `repo`); rotate to a dedicated read-only PAT for this repo when convenient.
- Installed: `@bevingh/auth@^0.1.0` (pulls `@bevingh/errors`), `bcryptjs@^3` (pure JS).

### Explicitly out of scope / not started

- `@bevingh/telemetry` source (bevin-core)
- AcademicX / academicx-api client wiring
- Uptime Kuma infra

---

## 2026-07-20 — PR-24: GET /api/v1/metrics read route

### What was built

Additive read path for the same `metrics` collection the POSTs already write to. No changes to `metricsAuth.js`, POST handlers, or `ApiKeyCandidate`.

| Surface | Detail |
|---|---|
| `GET /api/v1/metrics?appId=<optional>` | Latest health-kind doc merged with latest metric-kind doc, per app |
| Auth | Flat `authenticate` (same as `GET /api/v1/logs`) — operator/dashboard credential; **not** per-app write scoping |
| Rate limit | None (matches logs GET routes; only POSTs use rateLimit) |
| Implementation | Two `Metric.aggregate` pipelines: `$match` kind (+ optional appId) → `$sort: { timestamp: -1 }` → `$group` by `appId` with `$first`; merge groupings in app code (`mergeLatestByApp`) |
| Missing kinds | `health` / `metrics` / `metricsReportedAt` are `null` when that kind was never reported — no error |
| Root listing | `queryMetrics: 'GET /api/v1/metrics'` in `server.js` |
| Tests | `tests/metricsRead.test.js` — merge pure function + mocked `Metric.aggregate` (filter + pipeline shape) |

### Not started / still out of scope

- Dashboard UI
- AcademicX wiring
- History/time-range queries (this is latest-snapshot only)

---

## 2026-07-21 — P0 read API for LogPulse (timeseries + instanceCount)

### What was built

LogPulse Analytics already expects these surfaces. Server gaps closed so traffic charts and multi-instance badges can be honest.

| # | Deliverable | Detail |
|---|---|---|
| 1 | `GET /api/v1/logs/stats/timeseries` | Bucketed `totalCount` / `errorCount` over all matching logs (not a 200-sample). Query: `timeRange` (`last_hour`/`last_24h`/`last_7d`/`last_30d`, default `last_24h`), optional `service`, optional absolute `from`/`to`. Unknown `timeRange` → **400**. Flat `authenticate`, no rate limit. |
| 2 | `instanceCount` + `instances[]` on `GET /api/v1/metrics` | Distinct `instanceId`s with health/metric activity in `instanceWindowSeconds` (default 900). Latest health/metrics remain all-time latest snapshot. Count is never inferred from `health.instanceId` alone. |
| 3 | Health status vocabulary | Write validation allows `ok` \| `degraded` \| `error` \| `starting` \| `stopping`. Documented in `docs/METRICS_READ_CONTRACT.md`. |

### Files

- `src/routes/logs.js` — timeseries route + `resolveTimeseriesWindow` / `fetchLogTimeseries`
- `src/routes/metrics.js` — `fetchInstanceStats`, `attachInstanceStats`, query param `instanceWindowSeconds`
- `src/middleware/validation.js` — expanded health status enum
- `docs/METRICS_READ_CONTRACT.md` — rewritten for P0 contract
- Tests: `tests/logsTimeseries.test.js`, updated `tests/metricsRead.test.js`

### Out of scope (next CLS slice)

- Per-service `errorRate` / `avgDuration` on summary
- Log list `total`
- Error groups / services catalog
- LogPulse client wiring (LP consumers after this lands)

### Acceptance notes

- Timeseries aggregates the full match window (Mongo `$group` buckets).
- Multi-instance: post health from 2–3 `instanceId`s → `instanceCount ≥ 2`.
- Auth: same flat key as other log/metrics reads; missing/wrong key → 401 via existing middleware.
- PR-24 fields (`appId`, `health`, `metrics`, `metricsReportedAt`) unchanged for older clients; new fields additive.
