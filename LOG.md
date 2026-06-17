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
