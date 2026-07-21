# Metrics Read API — actual contract vs. LogPulse's provisional contract

**Status as of 2026-07-21: this document corrects the assumption ("no read
route exists yet") carried in the LogPulse/telemetry continuity thread.**
`GET /api/v1/metrics` was built and merged in **PR-24** (LOG.md, 2026-07-20),
the same day as PR-22 (write routes). It is live, tested
(`tests/metricsRead.test.js`), and listed in `server.js`'s root endpoint
listing. It does **not**, however, match the shape LogPulse's client code
was written against. This doc is the reconciliation.

## 1. The real, as-built contract (PR-24)

```
GET /api/v1/metrics?appId=<optional>
Auth: flat X-API-Key (same `authenticate` middleware as GET /api/v1/logs —
      NOT the per-app metricsAuth used by the POST routes)
Rate limit: none (matches other GET routes)
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "appId": "academicx",
      "health": {
        "status": "ok",
        "instanceId": "rev-1-a3f9",
        "uptimeSeconds": 1234,
        "timestamp": "2026-07-20T12:00:00.000Z"
      },
      "metrics": { "activeStudents": 412 },
      "metricsReportedAt": "2026-07-20T12:05:00.000Z"
    }
  ]
}
```

**Semantics — read carefully, this is the part that surprises people:**

- **Latest-snapshot only, not a time range.** Implementation is two
  `Metric.aggregate` pipelines (`$match kind` → `$sort timestamp desc` →
  `$group by appId, $first`) merged in app code. There is no `from`/`to`/
  `timeRange` query support. Asking for history returns the same single
  latest doc regardless.
- **One row per `appId`, not per `instanceId`.** If three instances of
  `academicx` are reporting, this endpoint returns whichever one's health
  ping sorted last — not a count, not an aggregate across instances.
- **`health` and `metrics` come from separate `kind` documents** and can be
  independently `null` — an app that only calls `reportHealth()` and never
  `reportMetrics()` (or vice versa) is fully expected and not an error.
- **No computed fields.** No error rate, no latency, no uptime percentage.
  `health.uptimeSeconds` is the process's raw seconds-since-start (from
  `reportHealth()`'s optional `uptimeSeconds` arg) — semantically different
  from an uptime *percentage*.
- **No `serviceName`** — only `appId`. Display naming is a client concern.

## 2. LogPulse's provisional contract (written without coordination)

`logpulse_analytics/lib/data/models/service_metrics_entry.dart` and
`api_endpoints.dart` were written against a *guessed* contract:

```
GET /metrics/summary?timeRange=<optional>
{ "data": [ { appId, serviceName, errorRate, avgLatency, uptime,
              errorCount, instanceCount, lastReportedAt, metrics } ] }
```

`parseServiceMetricsResponse()` is defensive (tries snake_case and
camelCase variants, tolerates missing fields), but it was never going to
line up with PR-24 because it assumes a flat record with computed
aggregate fields, not a nested `health`/`metrics` merge of raw latest docs.

## 3. Field-by-field diff

| LogPulse expects | Real API has | Result today |
|---|---|---|
| `GET /metrics/summary` | `GET /metrics` (no `/summary`) | **404** — LogPulse's own 404-tolerant code path treats this as "no metrics yet" and silently returns `[]`. The dashboard has never actually surfaced real metrics data, even though the collector has been able to serve it since 2026-07-20. |
| `serviceName` | not present | falls back to `appId` via `resolvedName` — fine, no fix needed |
| `errorRate`, `avgLatency`, `errorCount` | not present anywhere | always `null` — these aren't computed server-side at all today |
| `uptime` (implies %) | `health.uptimeSeconds` (nested, raw seconds) | always `null` — wrong shape *and* wrong unit even if path were fixed |
| `instanceCount` | not present (route returns 1 doc per appId, not a distinct-instance count) | always `null` |
| `lastReportedAt` | `metricsReportedAt` (top-level) | parser doesn't check this key name — would stay `null` even after the path fix |
| `metrics` (custom map) | `metrics` (top-level, same key) | **this one actually matches** — once the path is fixed, custom metrics would flow through correctly |
| `?timeRange=` query param | not supported (only optional `?appId=`) | silently ignored server-side — harmless but implies a capability that doesn't exist |

## 4. Decision points for whoever picks this up next

1. **Path + key-name fix (mechanical, no server change needed).** Point
   LogPulse at `/metrics` instead of `/metrics/summary`, and teach
   `parseServiceMetricsResponse()` to read `health.status`,
   `health.uptimeSeconds`, `health.instanceId`, and `metricsReportedAt`
   instead of the flat/wrong-named fields. This alone would light up
   `metrics` (custom map) and health status — the two fields that already
   exist server-side.
2. **`errorRate` / `avgLatency` / `errorCount`** — these were never part of
   PR-24's scope. Either (a) leave them `null` forever and let LogPulse's
   existing log-derived stats keep covering error rate / latency the way it
   already does today, or (b) scope a v2 aggregation on the collector side
   that computes these from `kind:metric` payload conventions (would
   require the emitter side to agree on standard metric key names first —
   `MetricsPayload` is deliberately free-form today).
3. **`uptime` as a percentage vs. `uptimeSeconds`** — a percentage requires
   a window and a definition of "down" that doesn't exist yet (Uptime Kuma
   isn't stood up). Recommend LogPulse's UI show raw uptime duration
   (formatted from `uptimeSeconds`) rather than inventing a percentage.
4. **`instanceCount`** — would need a new aggregation (distinct
   `instanceId` count per `appId` within a window) if this is wanted. Not
   built. Worth doing only once more than one instance of an app is
   actually reporting (AcademicX isn't wired up yet either).
5. **`timeRange` query param** — drop from LogPulse's query builder, or
   add real support server-side if historical metrics browsing (not just
   latest snapshot) becomes a real requirement.

## 5. Recommended near-term scope

Given nothing is actually consuming this data yet (AcademicX isn't wired to
`@bevingh/telemetry`), the lowest-risk path is **decision point 1 only**:
fix the path and field names in LogPulse so it correctly renders whatever
health/metrics data does eventually arrive, and leave `errorRate`/
`avgLatency`/`errorCount`/`instanceCount`/`uptime%` as known gaps rather
than backfilling collector-side aggregation for data that doesn't exist yet.
