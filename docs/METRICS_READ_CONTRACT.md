# Metrics Read API — contract for LogPulse (and other dashboards)

**Status as of 2026-07-21 (P0 read slice):** `GET /api/v1/metrics` is the
canonical latest-snapshot read. It was introduced in **PR-24** and extended
in this PR with **`instanceCount` / `instances[]`**. Log write-side
auth remains flat `X-API-Key`; metrics **writes** still use per-app
`metricsAuth`.

Related: `GET /api/v1/logs/stats/timeseries` (P0 traffic chart) lives under
the logs router; see §6.

---

## 1. `GET /api/v1/metrics`

```
GET /api/v1/metrics?appId=<optional>&instanceWindowSeconds=<optional>
Auth: flat X-API-Key (same `authenticate` middleware as GET /api/v1/logs —
      NOT the per-app metricsAuth used by the POST routes)
Rate limit: none (matches other GET routes)
```

| Query | Default | Notes |
|---|---|---|
| `appId` | (all apps) | When set, only that app’s row |
| `instanceWindowSeconds` | `900` (15m) | Window for **distinct instance count only**. Latest health/metrics stay all-time latest snapshot |

### Response shape

```json
{
  "success": true,
  "data": [
    {
      "appId": "academicx",
      "health": {
        "status": "ok",
        "instanceId": "rev-abc-xyz",
        "uptimeSeconds": 86400,
        "timestamp": "2026-07-21T12:00:00.000Z"
      },
      "metrics": {
        "students": 120,
        "activeToday": 45
      },
      "metricsReportedAt": "2026-07-21T12:01:00.000Z",
      "instanceCount": 3,
      "instances": [
        {
          "instanceId": "rev-abc-xyz",
          "lastSeen": "2026-07-21T12:00:00.000Z",
          "status": "ok",
          "uptimeSeconds": 86400
        },
        {
          "instanceId": "rev-def-uvw",
          "lastSeen": "2026-07-21T11:58:00.000Z",
          "status": "ok",
          "uptimeSeconds": 1200
        },
        {
          "instanceId": "rev-ghi-rst",
          "lastSeen": "2026-07-21T11:55:00.000Z",
          "status": "degraded",
          "uptimeSeconds": 300
        }
      ]
    }
  ]
}
```

### Semantics

- **Latest-snapshot for `health` / `metrics`:** still two `Metric.aggregate`
  pipelines (`$match kind` → `$sort timestamp desc` → `$group by appId,
  $first`) merged in app code. No history / `timeRange` on this route.
- **`health` and `metrics` can independently be `null`** if that kind was
  never reported.
- **`health.instanceId` is the single latest health reporter**, not a
  multi-instance rollup. Do **not** treat “health present ⇒ 1 instance”.
- **`instanceCount`** = number of distinct `instanceId` values that have
  **any** health or metric document with `timestamp` in the last
  `instanceWindowSeconds`. Computed by aggregation, never inferred from
  `health.instanceId` alone.
- **`instances[]`** = optional drill-down: per-instance `lastSeen` (max
  timestamp of any kind in the window), plus `status` / `uptimeSeconds`
  from the latest **health** doc for that instance in the window when
  present (else `null`). Sorted by `lastSeen` descending.
- **No computed error rate / latency** on this route (still a future /
  log-derived concern for LogPulse).
- **No `serviceName`** — only `appId`. Display naming is a client concern.
- **Backward compatible:** older clients that ignore `instanceCount` /
  `instances` keep working.

---

## 2. Canonical `health.status` vocabulary

Validated on **`POST /api/v1/metrics/health`** (`validation.js`).

| Value | Meaning | Suggested LogPulse mapping |
|---|---|---|
| `ok` | Healthy | → healthy (green pulse) |
| `degraded` | Running, impaired | → degraded |
| `error` | Failing checks | → unhealthy |
| `starting` | Optional warm-up | → degraded (until client has a dedicated state) |
| `stopping` | Optional drain | → degraded (until client has a dedicated state) |

Unknown strings are rejected at write time (400). Reads may still show
legacy rows if any were stored before validation expanded; clients should
treat unknown status as degraded.

---

## 3. Metrics **write** routes (unchanged threat model)

| Route | Auth |
|---|---|
| `POST /api/v1/metrics` | Per-app `metricsAuth` (`sk_live_` / `sk_test_`) + `appId` must match key subject |
| `POST /api/v1/metrics/health` | Same |

`collectorUrl` for `@bevingh/telemetry` is the **service origin only**
(client appends `/api/v1/metrics` and `/api/v1/metrics/health`).

---

## 4. Field mapping notes for LogPulse

| LogPulse concern | Use this |
|---|---|
| Path | `GET /api/v1/metrics` (not `/metrics/summary`) |
| Health color | `health.status` (see vocabulary above) |
| Process uptime duration | `health.uptimeSeconds` (raw seconds, not %) |
| Custom free-form map | `metrics` |
| Last metrics report | `metricsReportedAt` |
| Multi-instance badge | `instanceCount` (hide when `null` or `≤ 1`) |
| Drill-down | `instances[]` |

Still **not** on this route: `errorRate`, `avgLatency`, `errorCount`
aggregates (use log stats / future PR).

---

## 5. Indexes used

From `src/models/Metric.js` (no new index required for this PR):

- `{ appId: 1, kind: 1, timestamp: -1 }` — latest snapshot per kind
- `{ appId: 1, instanceId: 1, timestamp: -1 }` — instance activity window
- `{ appId: 1, timestamp: -1 }`, `{ kind: 1, timestamp: -1 }`, TTL on `timestamp`

---

## 6. Related P0: log timeseries (traffic charts)

```
GET /api/v1/logs/stats/timeseries?timeRange=last_24h&service=<optional>
Auth: flat X-API-Key
```

| `timeRange` | Bucket |
|---|---|
| `last_hour` | 5 min |
| `last_24h` (default) | 1 h |
| `last_7d` | 12 h |
| `last_30d` | 1 d |

Optional absolute `from` / `to` (ISO-8601). Unknown `timeRange` → **400**.

```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2026-07-21T00:00:00.000Z",
      "totalCount": 120,
      "errorCount": 4
    }
  ],
  "meta": {
    "bucketMs": 3600000,
    "timeRange": "last_24h",
    "from": "…",
    "to": "…"
  }
}
```

Buckets are ascending UTC bucket starts. Aggregation covers **all** matching
logs in the window (not a 200-row sample).

---

## 7. History of this document

- **PR-24:** first documented real read contract (latest snapshot only).
- **P0 read (this PR):** `instanceCount` / `instances[]`, health vocabulary,
  and log timeseries pointer for LogPulse Phase 18 consumers.
