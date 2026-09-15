# PROGRESS.md — Central Logging Service (CLS)

> Project ledger. Bootstrapped 2026-09-14 from git history and the documents already in the
> repo (see Decisions log for what was consolidated). This file is the source of truth going
> forward for project state; the documents it consolidates are left in place and referenced,
> not edited. Companion client app: `logpulse-analytics` (LogPulse Analytics), which has its
> own `PROGRESS.md` — this repo is the data/API side of that pair.

## Status Snapshot

- **Phase**: No formal phase numbering exists in this repo (unlike LogPulse's Phase-N
  system) — work has shipped as a sequence of dated PRs described in `LOG.md`. The last
  *feature* PR was application-side error-group aggregation with improved
  message extraction (`LOG.md`, final entry, 2026-07-21, commit `39de821`), fixing an
  "Unknown error" megagroup bug in the P2 error-grouping feature. Most recently
  (2026-09-14): CLS-02 (private `@bevingh/auth` registry — resolved, packages are
  public now), CLS-12 (search/`q` param alias), and CLS-13 (`/logs/stats/summary`
  now respects `timeRange`) were fixed, deployed, and confirmed live by Kevin —
  see Known Limitations and Changelog below. This is the current deployed state.
- **Blocking issues**:
  - **Docs badly out of sync with code.** `HANDOFF.md` (dated 2026-06-17) and
    `PROJECT_SUMMARY.md` (dated 2026-02-14, never updated) both claim
    "production-ready" / "zero test coverage" / a 6-route API surface — all stale.
    Current repo has 6 test files under `tests/` and ~15 routes across 5 route files.
    `README.md` and `API_TESTING.md` are the two docs actually kept current commit-by-
    commit; treat those as the accurate source, not `HANDOFF.md`/`PROJECT_SUMMARY.md`.
  - **GCS "hot & cold storage" is advertised but not real.** `README.md` and
    `DEPLOYMENT.md` both describe Google Cloud Storage cold-archival. The archive job
    (`src/jobs/archiveOldLogs.js`) only deletes from MongoDB — it has never uploaded to
    GCS, going back to a same-day descope on the initial commit (`039bb46`,
    2026-02-14). `storageService.js` (the GCS wrapper) is dead code today.
  - ~~`@bevingh/auth` is a private GitHub Packages-scoped dependency~~ — **resolved
    2026-09-14** (`5c03118`): Kevin published `@bevingh/auth` (and `@bevingh/errors`)
    to the public npm registry. This was also the actual cause of the most recent
    deploy failure (`scripts/deploy.sh` hard-exits without a now-nonexistent token
    file) — removed the private-registry wiring from `.npmrc`/`Dockerfile`/
    `deploy.sh`/`README.md`. `npm install` and the full test suite (48/48) both
    verified working in this sandbox for the first time.
  - No `scripts/green-gate.sh` and no CI workflow (`.github/workflows/` absent) — same
    gap LogPulse had before `842b0ca`. `package.json` also has no `lint` or `build`
    script, so a green-gate run here would report both as gaps even once added.
  - In-memory rate limiter (`middleware/rateLimit.js`) is a plain `Map`, not shared
    across Cloud Run instances — noted as a known issue in `HANDOFF.md` §9 in June and
    never revisited since.
  - CORS is fully open (`app.use(cors())`, no origin allowlist) — `src/server.js`.
  - ~~Logs auth is a single flat pre-shared API key with no rotation, expiry, or
    per-key identity (metrics auth was upgraded to per-app bcrypt-hashed keys in
    PR-22, but logs auth was not)~~ — **resolved 2026-09-14 (Phase 25)**: one
    unified, scoped key model (`ApiKeyCandidate` + `apiKeyAuth` middleware) now
    guards logs and metrics alike, provisioned via `/admin/keys.html` or
    `npm run setup` instead of a hand-run script. The old flat `API_KEYS` list
    is kept only as a migration-window fallback — see Decisions log and
    Changelog. **Not yet deployed** — code-complete and test-verified in this
    sandbox only (see Next Steps).
- **Next action**: No feature work is queued server-side beyond what `LOG.md` already
  flags as deferred (stage-timing/timeline spans, webhooks — see Next Steps). The
  practical next action is documentation/process cleanup (this ledger) plus the
  open-source-readiness items in the Human pass queue, before any new CLS feature work
  starts.
- **Repo state**: Local `main` is 2 commits ahead of `origin/main`
  (`8031749` "force linux/amd64... scale down Cloud Run resource limits",
  `39de821` error-group fix above) — not yet pushed. 18 commits total, first commit
  2026-02-14, most recent 2026-07-21 (no commits in the ~8 weeks since, until this
  ledger). Working tree otherwise clean.
- **Verified running**: Not verified this session — no `npm test` / lint run was
  executed while building this ledger; status above is drawn from reading `LOG.md`,
  `package.json`, and `src/` structure, cross-checked against `git log`, not from
  executing the suite.
- **Machine**: Kevin's local MacBook (this repo lives at
  `/Users/kevinafenyo/Documents/GitHub/_Modules/central-logging-service`), not an
  ephemeral sandbox — unlike the LogPulse ledger's bootstrap session, toolchain
  availability here should be assumed normal for this machine.

## Decisions log

Consolidated from `LOG.md`'s dated dev-log entries (the most reliable source — dates
verified against the commits they describe), `docs/METRICS_READ_CONTRACT.md`, and
`README.md`.

- **2026-02-14** — MongoDB (Mongoose) chosen for storage; GCS cold-archival was
  designed in the initial commit and **descoped the same day**
  (`039bb46`): *"simplifies the system by eliminating cold storage complexity while
  maintaining configurable hot storage duration."* Retention since then is TTL-based
  deletion only. README/DEPLOYMENT/PROJECT_SUMMARY were never updated to reflect this
  — see Blocking issues.
- **2026-02-15 → 2026-03-28** — Winston structured logging was added with MongoDB
  persistence (`5daf41d`), then that persistence was removed the next time the logger
  was touched (`191e37f`), reverting to console-only transport. Final state (console
  only) is accurate in `HANDOFF.md` §8 but unmentioned in README/PROJECT_SUMMARY.
- **2026-06-17** — Log search implemented as **regex over indexed fields**, not
  MongoDB `$text` search. `LOG.md`'s "Evidence + Design Confirmation" entry records a
  5-point rationale: exact-substring UX expectations, inability to combine `$text`
  with range filters efficiently, `Mixed`-typed fields not being `$text`-indexable,
  and reserving the collection's one text-index slot for a possible future Atlas
  Search use. The most rigorously documented decision in this repo.
- **2026-07-20 (PR-22)** — Metrics/health ingestion given its **own auth scheme**:
  per-app bcrypt-hashed keys (`ApiKeyCandidate` model, `metricsAuth.js`) rather than
  the flat key used for logs, specifically so "a leaked AcademicX key cannot post as
  another app" (403 on `appId` mismatch). Reuses an external shared package,
  `@bevingh/auth` (`matchApiKey`), rather than building this in-house — see Blocking
  issues for the open-source cost of that reuse. Build-time secret handling decided
  as Docker BuildKit `--secret` mount only, never `ARG`/`ENV`, with a **read-only**
  PAT scope specifically (not the broader write:packages/repo-scoped one on hand).
- **2026-07-21 (P0-P2 read API)** — Metrics payload (`metrics` field) deliberately
  left schema-free ("any object, no fixed shape"), validated only for "is an object"
  (`docs/METRICS_READ_CONTRACT.md`). `GET /api/v1/metrics` is latest-snapshot only, no
  history/time-range query — explicit scope boundary, restated in the PR-24 entry and
  in the contract doc.
- **2026-07-21** — Error-group fingerprinting implemented as **application-side
  aggregation** (`Log.find` + JS grouping) rather than a Mongo `$group` pipeline
  (`39de821`), because grouping needs to parse error text out of `response.body` when
  producers set `error: null` — awkward to express as a single aggregation stage.
- **2026-07-21** — Log retention purge exposed as an **HTTP-triggerable route**
  (`POST /jobs/purge-logs`, alias `POST /jobs/archive` for the legacy name), intended
  to be called by **cron-job.org** (an external free cron SaaS) rather than GCP Cloud
  Scheduler (`9938b4c`). `DEPLOYMENT.md`/`PROJECT_SUMMARY.md` still describe the
  Cloud Scheduler → `/jobs/archive` path; `README.md` has the newer cron-job.org
  walkthrough. Both exist in docs without cross-reference — the cron-job.org path is
  what's actually documented as working end-to-end and should be treated as current.
- **2026-07-21** — Docker build pinned to `linux/amd64` and Cloud Run resource limits
  scaled down (`8031749`), implying an Apple Silicon dev-machine/Cloud Run arch
  mismatch was hit and fixed during a real deploy attempt.

## Known Limitations

- **CLS-01** — GCS cold-storage archival is advertised in `README.md` and
  `DEPLOYMENT.md` but has never been implemented; the purge job is delete-only. No
  cold-storage retrieval endpoint exists at all. (`HANDOFF.md` §7, `LOG.md` final
  entry, confirmed still true by reading `src/jobs/archiveOldLogs.js`.)
- ~~**CLS-02**~~ — **resolved 2026-09-14** (`5c03118`). Was: `@bevingh/auth` was a
  private, org-scoped npm dependency, blocking a new open-source contributor from
  `npm install`/Docker build without a personal `read:packages` PAT. Kevin published
  `@bevingh/auth` (and its dependency `@bevingh/errors`) publicly on npmjs.org —
  this was also the actual cause of the most recent deploy failure, since
  `scripts/deploy.sh` hard-exits when the now-obsolete `.secrets/npm_token` file is
  missing. Removed `.npmrc`'s GitHub Packages scope mapping, the Dockerfile's
  BuildKit secret mount, and `deploy.sh`'s token-file check; regenerated
  `package-lock.json` from a clean install so its resolved URLs point at
  `registry.npmjs.org`. **Verified**: `npm install` succeeds with zero auth, and
  the full test suite now runs and passes (48/48, 6 suites) for the first time
  this session — this sandbox had no way to do either before. This also fully
  resolves the open-source "clone → run" blocker flagged in the Human pass queue
  below.
- **CLS-03** — In-memory rate limiter (`middleware/rateLimit.js`) does not share state
  across Cloud Run instances — each instance enforces its own independent limit.
  (`HANDOFF.md` §9, unresolved since 2026-06-17.)
- **CLS-04** — CORS has no origin allowlist (`app.use(cors())` with no options) —
  `src/server.js`, confirmed current.
- **CLS-05** — Logs auth is a single flat pre-shared API key: no rotation, no expiry,
  no per-key identity/audit trail. (Metrics auth was upgraded in PR-22; logs auth was
  not.)
- **CLS-06** — No `lint` or `build` npm script exists (`package.json`). A future
  `scripts/green-gate.sh` (matching LogPulse's) would report both as gaps on day one.
- **CLS-07** — No CI workflow (`.github/workflows/` absent) — nothing runs `npm test`
  automatically on push.
- **CLS-08** — `HANDOFF.md` and `PROJECT_SUMMARY.md` are stale by roughly 9 routes'
  worth of API surface (everything metrics/services/error-groups/timeseries/purge-
  related, all added after those docs were last touched). Anyone reading only those
  two docs would believe the API is far smaller than it is. `README.md`/
  `API_TESTING.md` are current and should be preferred.
- **CLS-09** — `sortBy` query param on `GET /api/v1/logs` is passed through to
  Mongoose `.sort()` without an allowlist (flagged in `HANDOFF.md` §9, not re-verified
  against current `logs.js` in full this session — worth a direct check before
  treating as resolved or not).
- **CLS-10** — `client/` (the log-shipper library used by producer apps) is a
  standalone folder with its own `package.json`, not published/versioned as an
  installable package — must be manually copied into each consuming app.
- ~~**CLS-13**~~ — **fixed 2026-09-14** (`70a93f3`). Was: `GET
  /logs/stats/summary` (`src/routes/logs.js`) destructures only `service`, `from`,
  `to` from the query string — it never reads `timeRange`, unlike its three sibling
  routes (`/logs/stats/timeseries`, `/logs/errors/groups`, `/services`), which all
  correctly resolve `timeRange` via the shared `resolveTimeseriesWindow()` helper
  already defined in the same file. LogPulse Analytics sends `?timeRange=last_24h`
  (etc.) to this endpoint and never computes/sends `from`/`to` itself, so
  `matchQuery` on this route is **always `{}`** — every call aggregates the
  service's **entire history**, unconditionally. Confirmed live: switching
  LogPulse's Dashboard time-range pills (1h/24h/7d/30d) does not change Total Logs,
  Error Rate, Avg Latency, or the Service Health list at all, while the Traffic
  chart directly above/below them (a different endpoint) correctly goes to "No
  data" for a 1h window. This also explains an apparent discrepancy noticed during
  the review: the Dashboard's Service Health list showed a service (`unified-
  voting-api`) that the Services catalog page (`/services`, correctly time-scoped)
  did not — the former is all-time, the latter is genuinely last-24h.
  Fixed by calling `resolveTimeseriesWindow(req.query)` (already exported from this
  same module) and folding the resolved `start`/`end` into `matchQuery`, matching
  the pattern its three siblings already used. Also added a `$sort: {totalRequests:
  -1}` to the `byService` facet — `$group` has no ordering guarantee, which was
  visibly reshuffling LogPulse's Service Health list between identical-window
  refreshes. **Deployed and confirmed live 2026-09-14** — Kevin verified the
  Dashboard's stat cards now actually move when switching time ranges (this
  sandbox still can't run Jest itself against a real server — see CLS-02's
  `node_modules` note — so this was verified live in the real app, not by an
  integration test here).
- ~~**CLS-12**~~ — **fixed 2026-09-14** (`70a93f3`). Was: `GET /api/v1/logs` only
  accepted a `q` query param for regex search (`src/routes/logs.js:65-116`).
  LogPulse Analytics' client sends `search=<term>` instead
  (`ApiEndpoints.buildLogsQuery`), which this route silently ignored — the search
  fell through to the default unfiltered query. Fixed by accepting `search` as an
  alias for `q` (additive, backward-compatible — `q` stays canonical for any other
  caller). **Deployed and confirmed live 2026-09-14** — Kevin verified both the
  Logs page's own search bar and LogPulse's "Find Similar" action return real
  results now.
- **CLS-11** — No deployed-URL or live-production confirmation exists in any doc;
  `DEPLOYMENT.md`/`README.md` use placeholder values (`YOUR_PROJECT_ID`,
  `YOUR_SERVICE_URL`) throughout. The `linux/amd64` fix commit implies at least one
  real deploy attempt happened, but current live status is unverified from docs alone.

## Next Steps

~~**0. Fix CLS-12 and CLS-13.**~~ — **done 2026-09-14** (`70a93f3`), **deployed and
confirmed live 2026-09-14**. Both fixes are in production and Kevin has verified
them working against the real app — nothing outstanding here.

~~**0-deploy. Fix the deploy failure (CLS-02).**~~ — **done 2026-09-14** (`5c03118`):
the deploy that failed was blocked by the now-obsolete private-registry token
requirement (`@bevingh/auth` is public now); that requirement is removed
everywhere it was wired in (`.npmrc`, `Dockerfile`, `scripts/deploy.sh`,
`README.md`). `npm install` and the full test suite both verified working in this
sandbox for the first time. Kevin re-ran the deploy and it succeeded, carrying
CLS-12/CLS-13 with it.

~~**0-phase26. One-click Render deploy (Phase 26).**~~ — **built and
live-verified 2026-09-15.** Kevin clicked "Deploy to Render" for real: the
form asked only for `MONGODB_URI`, deploy succeeded, and the resulting
`*.onrender.com` instance worked end to end — confirmed. Full design in
`logpulse_analytics/PHASE_26_SPEC.md`.

**0-phase26b. Onboarding-doc smoothing pass (post-Phase-26) — done.**
Fresh-eyes audit of the whole self-hoster path (`README.md`, `QUICKSTART.md`,
`API_TESTING.md`, `DEPLOYMENT.md`) triggered by Kevin asking "anything else
I'm missing?" after the Render test succeeded. Found and fixed real bugs,
not just polish:
- `QUICKSTART.md` had Kevin's own personal clone path hardcoded
  (`cd /Users/kevinafenyo/...`) and an ASCII-art startup banner that has
  never matched the actual log output (confirmed via `grep` — the banner
  string exists nowhere in `src/`).
- `README.md`/`DEPLOYMENT.md`/`.env.example` all still advertised GCS
  cold-storage archival as a real feature — it was descoped the same day it
  was designed (`PROGRESS.md` Decisions log, 2026-02-14) and
  `GCS_BUCKET_NAME`/`GCS_PROJECT_ID`/`COLD_STORAGE_DAYS` are read nowhere in
  `src/` (confirmed via `grep`). Marked NOT CURRENTLY FUNCTIONAL everywhere
  it's mentioned rather than removing the vars outright (kept as
  placeholders in case archival gets built later).
- `DEPLOYMENT.md`'s manual Cloud Run env-var steps never included
  `ADMIN_SETUP_TOKEN` at all — anyone following that doc literally would
  deploy an instance with no way to reach `/admin/keys.html`. Added it, and
  switched `--set-env-vars` to `--update-env-vars` (the former wipes
  anything already set) to match `scripts/deploy.sh`'s own existing note.
- `DEPLOYMENT.md`'s "Integrate with Your APIs" step still only showed the
  deprecated `log-shipper.js` client; added `@bevingh/telemetry` as the
  recommended path, matching what README/QUICKSTART already did in Phase 25.
- `API_TESTING.md`'s `npm run generate-app-key -- academicx` example was
  broken by Phase 25 — that CLI now requires `--scopes`, so this printed
  usage and exited rather than working. Fixed, and rewrote the
  "Authentication" section to describe the unified scope model instead of
  the old flat-vs-per-app split (most of the doc's individual
  `dev-key-123` examples were left as-is with one caveat sentence, rather
  than rewriting ~500 lines of curl commands — they're still correct for
  every route except the two `metrics:write` ones, which never accepted
  flat keys before or after Phase 25).
- Added a short "what is this / pairs with LogPulse Analytics" intro to
  README's top — a cold visitor previously had no indication a companion
  dashboard app exists at all.
Verified: `npm test` still 68/68 (docs-only changes); all four edited docs'
code-fence counts confirmed even (no broken Markdown).

~~**0-phase25. Deploy the unified API key auth (Phase 25, Part A).**~~ —
**deployed and verified live 2026-09-14.** Sequence run: `migrate-scopes.js`
against production Mongo (1 of 1 `ApiKeyCandidate` backfilled with
`scopes: ['metrics:write']`), `ADMIN_SETUP_TOKEN` set on the Cloud Run
service, image rebuilt and deployed (revision `central-logging-service-00013-gtt`,
europe-west1). Smoke-tested live: `/health` 200, legacy flat key still reads
`/api/v1/logs` (confirms the fallback works, no forced flag day), `/admin/keys.html`
reachable. No other known caller of `GET /api/v1/metrics` besides LogPulse
(bevin-core's telemetry client isn't wired into any app yet), so Open Decision 1
in `PHASE_25_SPEC.md` is a non-issue for now. A real `logs:read` key for
`appId: logpulse` (environment `live`) was issued via `POST /admin/keys` —
**LogPulse-side confirmation (Part C) still pending**, see that repo's
`PROGRESS.md`.

Per `LOG.md`'s dated backlog (the most trustworthy forward-looking source — items here
have historically been worked in roughly this order):

1. **Stage-timing / timeline spans ("P3")** — flagged as the next phase after error
   groups/services catalog (P2) in the 2026-07-21 entry. Not started.
2. **Webhooks / alerting on error spikes** — repeatedly deferred across PR-22 through
   P2 entries. Not started.
3. **Dashboard/frontend UI wiring** — explicitly out of scope for this repo; this is
   what `logpulse-analytics` is for. No action needed here beyond keeping the API
   contract (`docs/METRICS_READ_CONTRACT.md`) accurate as the client evolves.
4. **History/time-range querying on `GET /api/v1/metrics`** — currently latest-
   snapshot only; deferred in the PR-24 entry.
5. **Process** — add a `scripts/green-gate.sh` (LogPulse already has one as of
   `842b0ca`; port the Node branch of that same script here) plus `lint`/`build`
   scripts in `package.json`, so this repo has the same one-command verification gate.
6. **Docs cleanup** — collapse the GCS/Cloud-Scheduler narrative out of
   `README.md`/`DEPLOYMENT.md`/`PROJECT_SUMMARY.md` in favor of the cron-job.org path
   that's actually wired up, and refresh `HANDOFF.md`/`PROJECT_SUMMARY.md`'s stale
   status claims (or fold their still-useful content into this ledger and mark them
   historical, consistent with how LogPulse's ledger treats its own legacy docs).

## Security observations (informational, 2026-09-14)

Noticed incidentally while reviewing real log data through LogPulse — not a CLS or
LogPulse code defect, but worth Kevin's attention since it's about the producer
services this collector is ingesting from:

- **`fyp-management-backend`** is getting repeated 404s for `/api/.git/config` and
  `/api/session/properties`, from `161.97.108.244`.
- **`academicx-api`** is getting 404s for `/firebase-key.json` and
  `/firebase-adminsdk.json` — someone specifically probing for an exposed Firebase
  service-account credential file.
- **`payment-gateway-api`** — a large share of its top-endpoint traffic is WordPress/
  wp-json reconnaissance (`/wordpress/`, `/wp/`, `/blog/wp-json/batch/v1`,
  `/wp-json/batch/v1`, etc.), the classic pattern of a scanner checking for an
  exposed or vulnerable WP install.
- All three look like routine, broad, automated vulnerability-scanner traffic
  (nothing suggests a successful hit — every one of these routes correctly 404s),
  but it's hitting three different services behind this same collector, which is
  worth a look if that source IP/pattern isn't already known or blocked at the
  infrastructure level.

## Human pass queue

Decisions this ledger surfaced that are Kevin's to make, not to be resolved
unilaterally:

- ~~**Deploy CLS-12/CLS-13 (and the CLS-02 registry fix) to production.**~~ —
  **done**: Kevin ran the deploy, it succeeded, and he's confirmed both log
  search and the Dashboard time-range selector work against real production
  data. Nothing outstanding from this round of fixes.
- ~~**Deploy Phase 25 (unified API keys).**~~ — **done 2026-09-14**, see Next
  Steps item 0-phase25 above. LogPulse-side key confirmation (Part C) is the
  one remaining piece, tracked in `logpulse_analytics/PROGRESS.md`.
- **Decide when to remove the legacy flat-`API_KEYS` fallback** in
  `apiKeyAuth.js` — deliberately left open in `PHASE_25_SPEC.md` rather than
  scheduled, pending confirmation every real consumer holds a DB-backed key.
- ~~**Open-source blocker**: what to do about `@bevingh/auth` being a private
  package~~ — **resolved**: Kevin published it (and `@bevingh/errors`) to the
  public npm registry. "Clone → run" now works with no private-registry access —
  confirmed by a clean `npm install` + full test-suite pass in this sandbox.
- Whether to actually build the GCS cold-storage path (CLS-01) or formally drop it
  from the docs and lean fully into TTL+purge as the real retention story — right now
  the docs and the code disagree, and a new open-source user would be misled by the
  docs.
- Whether to invest in `scripts/green-gate.sh` + CI here now (mirroring LogPulse), or
  defer until closer to the open-source push.
- Whether P3 (stage-timing spans) and webhooks are still wanted, or should be
  formally parked — no work has landed on either in ~8 weeks.

## Changelog

- **2026-09-14** — `ledger:` Bootstrapped `PROGRESS.md`, this repo's first ledger,
  consolidating `README.md`, `HANDOFF.md`, `PROJECT_SUMMARY.md`, `QUICKSTART.md`,
  `API_TESTING.md`, `DEPLOYMENT.md`, `LOG.md`, `client/README.md`, and
  `docs/METRICS_READ_CONTRACT.md`. Verified against `git log` (18 commits,
  2026-02-14 → 2026-07-21) rather than taking document claims at face value; found
  `HANDOFF.md`/`PROJECT_SUMMARY.md` stale by ~9 routes and several resolved-vs-open
  contradictions (see Known Limitations CLS-01 through CLS-11). Flagged the
  `@bevingh/auth` private-package dependency (CLS-02) as a blocker for the planned
  open-source release. Could not verify: current `npm test` pass/fail state —
  `node_modules` is not installed in this checkout and installing it would need the
  private-registry PAT (see CLS-02), so it wasn't attempted this session. Local `main`
  was 2 commits ahead of `origin/main` before this commit, not yet pushed.
  Commit: `9c545fb20ab068bfd08011f022d02e37596ff76c`.
- **2026-09-14 (same session, cross-repo review with live data)** — While reviewing
  LogPulse Analytics' screens against this service's real production data, found
  CLS-13: `/logs/stats/summary` never reads `timeRange` (only its 3 sibling routes
  do), so LogPulse's Dashboard home screen shows all-time numbers regardless of
  which time range the user selects — confirmed live by switching the selector and
  watching the stat cards not move while the (correctly-scoped) traffic chart did.
  Not fixed this session — flagged as high priority in Next Steps. Also logged
  incidental security observations (vulnerability-scanner traffic against 3
  producer services) for Kevin's awareness, unrelated to CLS/LogPulse code itself.
- **2026-09-14 (same session, bug-fix phase)** — Fixed CLS-12 (search/q alias) and
  CLS-13 (timeRange in stats/summary), plus a `$sort` on the byService facet for
  deterministic ordering. Part of a combined bug-fix pass across both repos,
  packaged as LogPulse's Phase 24 (see that repo's `PHASE_24_SPEC.md` and
  `PROGRESS.md`). Verified by syntax check only (`node --check`) — no
  `node_modules` in this sandbox to run Jest or a real server (CLS-02). **Not
  deployed** — needs a real deploy + smoke test before either fix is verified
  against production. Commit: `70a93f382095b52256d39a6adb32f57c0a9ff35d`.
- **2026-09-14 (same session, deploy-failure fix)** — Kevin reported the deploy
  attempt failed and correctly guessed why: the `@bevingh/*` private-registry auth
  requirement (CLS-02) was obsolete — he'd published `@bevingh/auth` and
  `@bevingh/errors` publicly on npmjs.org. Confirmed both packages public
  (`registry.npmjs.org` returns them), then removed the private-registry wiring
  everywhere it existed: `.npmrc` (deleted), `Dockerfile` (dropped the BuildKit
  secret mount), `scripts/deploy.sh` (dropped the token-file check that was
  exactly what made the deploy fail), `README.md`. Regenerated `package-lock.json`
  from a clean install (the old lockfile still pointed at the private registry
  even though a locally-cached install could paper over it — a real Docker build
  has no such cache). **Verified**: clean `npm install` with zero auth, and the
  full Jest suite (48/48, 6 suites) — both firsts for this session, since
  `node_modules` was previously unreachable. This resolves CLS-02 entirely and
  removes the open-source "clone → run" blocker it represented. Kevin still needs
  to re-run the actual deploy — this session has no GCP/deploy access. Commit:
  `5c031181c6ca9fad3601a70ee0aac950fbcf9052`.
- **2026-09-14 (same session, deploy confirmed)** — Kevin ran the deploy after
  the CLS-02 fix; it succeeded. He then confirmed live, separately: log search
  works (both the Logs page's own search bar and LogPulse's "Find Similar"),
  and the Dashboard's time-range selector actually changes the stat cards. CLS-12
  and CLS-13 are now fully verified in production, not just code-reviewed —
  nothing outstanding from this round of fixes. (LogPulse's own client-side
  fallout from this deploy — a theme-picker bug, a broken "Find Similar" message
  match, and a dead-end "View Trace" page — is recorded in LogPulse's own
  `PROGRESS.md`/`PHASE_24_SPEC.md`, not here, since the fixes were entirely
  client-side.)
- **2026-09-14 (same session, Phase 25 — unified API keys, Part A)** —
  Implemented `logpulse_analytics/PHASE_25_SPEC.md`'s Part A in full: added
  `scopes`/`label`/`lastUsedAt`/`revokedAt` to `ApiKeyCandidate`; added
  `src/services/apiKeyService.js` as the single write path for key
  lifecycle (create/list/revoke/rotate); replaced `middleware/auth.js` +
  `middleware/metricsAuth.js` with one `middleware/apiKeyAuth.js`
  (scope-checked, with a legacy flat-`API_KEYS` fallback restricted to the
  scopes that scheme already granted — explicitly excluding `metrics:write`,
  which never accepted flat keys); rewired every logs/services/metrics route
  onto it; added `/admin/keys` (REST) + `/admin/keys.html` (static, no
  framework) for provisioning, replacing the hand-run
  `generateAppApiKey.js` CLI (kept as a thin wrapper over the same service);
  added `npm run setup` (interactive wizard: Mongo URI with an Atlas
  signup link, admin token generation, optional first key) and
  `npm run migrate-scopes` (idempotent backfill for existing candidates).
  Deleted the now-superseded `middleware/metricsAuth.js` and its test after
  confirming (via `grep`) nothing but that test still imported it — moved
  its `enforceAppScope` coverage to a new `tests/metricsAppScope.test.js`.
  Deliberately left `middleware/auth.js` and `routes/jobs.js` (the
  `/jobs/purge-logs` cron endpoint) untouched — out of scope per the spec,
  confirmed by checking `jobs.js`'s import before touching anything.
  Tightened `GET /api/v1/metrics` from the flat scheme to `metrics:read`,
  but included `metrics:read` in the legacy fallback's allowed scopes so
  this is non-breaking for any existing caller. Updated `README.md`/
  `QUICKSTART.md` throughout. **Verified**: `npm test` 68/68 passing (added
  `apiKeyAuth.test.js`, `apiKeyService.test.js`, `adminAuth.test.js`,
  `metricsAppScope.test.js`); all touched/new files pass `node --check`.
  **Deployed and verified live 2026-09-14** — see Next Steps item 0-phase25
  for the rollout sequence and smoke-test results. Committed as `78f64f4`
  before deploy.
- **2026-09-15 (Phase 26 — one-click Render deploy)** — Following up on the
  Phase 25 onboarding-friction discussion, Kevin ruled out a shared
  multi-tenant backend but wanted standing up an instance to need as little
  terminal work as possible. Added `render.yaml` (Blueprint: Docker
  runtime against the existing `Dockerfile`, `/health` as the health
  check, every env var either hardcoded, `generateValue`-random, or —
  `MONGODB_URI` only — `sync: false` to prompt the user) plus a "Deploy to
  Render" badge in `README.md` and a pointer to it in `QUICKSTART.md`.
  Render was chosen over Railway specifically because Render needs only
  one config file reusing the Atlas-signup flow Phase 25 already built,
  versus a multi-service Railway template with its own env-var-reference
  dialect for the marginal gain of skipping one signup — see
  `logpulse_analytics/PHASE_26_SPEC.md` Background for the full reasoning.
  Verified: `render.yaml` parses cleanly (Python `yaml.safe_load`),
  `healthCheckPath` matches the real route in `src/routes/health.js`,
  `Dockerfile` unchanged (already `PORT`-aware and already has this exact
  health check). **Not verified live** — this session has no Render
  account; see Next Steps item 0-phase26 for what Kevin still needs to
  click through and confirm.
