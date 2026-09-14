# PROGRESS.md — Central Logging Service (CLS)

> Project ledger. Bootstrapped 2026-09-14 from git history and the documents already in the
> repo (see Decisions log for what was consolidated). This file is the source of truth going
> forward for project state; the documents it consolidates are left in place and referenced,
> not edited. Companion client app: `logpulse-analytics` (LogPulse Analytics), which has its
> own `PROGRESS.md` — this repo is the data/API side of that pair.

## Status Snapshot

- **Phase**: No formal phase numbering exists in this repo (unlike LogPulse's Phase-N
  system) — work has shipped as a sequence of dated PRs described in `LOG.md`. The last
  completed unit of work is application-side error-group aggregation with improved
  message extraction (`LOG.md`, final entry, 2026-07-21, commit `39de821`), fixing an
  "Unknown error" megagroup bug in the P2 error-grouping feature.
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
  - **`@bevingh/auth` is a private GitHub Packages-scoped dependency.** `npm install`
    requires a personal `read:packages` GitHub PAT in a new contributor's own
    `~/.npmrc`; the Docker build needs the same token via a BuildKit `--secret` mount.
    **This is a real blocker for the open-source plan** — a new user cloning this repo
    cannot build it without private-registry access, unless `@bevingh/auth` is also
    published publicly or the dependency is inlined/replaced. Flagged for the Human
    pass queue below.
  - No `scripts/green-gate.sh` and no CI workflow (`.github/workflows/` absent) — same
    gap LogPulse had before `842b0ca`. `package.json` also has no `lint` or `build`
    script, so a green-gate run here would report both as gaps even once added.
  - In-memory rate limiter (`middleware/rateLimit.js`) is a plain `Map`, not shared
    across Cloud Run instances — noted as a known issue in `HANDOFF.md` §9 in June and
    never revisited since.
  - CORS is fully open (`app.use(cors())`, no origin allowlist) — `src/server.js`.
  - Logs auth is a single flat pre-shared API key with no rotation, expiry, or per-key
    identity (metrics auth was upgraded to per-app bcrypt-hashed keys in PR-22, but logs
    auth was not).
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
- **CLS-02** — `@bevingh/auth` is a private, org-scoped npm dependency. Blocks a new
  open-source contributor from `npm install`/Docker build without a personal
  `read:packages` PAT. No doc addresses making it (or an equivalent) public.
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
- **CLS-12 (verified 2026-09-14, cross-repo)** — `GET /api/v1/logs` only accepts a
  `q` query param for regex search (`src/routes/logs.js:65-116`). LogPulse Analytics'
  client sends `search=<term>` instead (`ApiEndpoints.buildLogsQuery`), which this
  route silently ignores — the search falls through to the default unfiltered query.
  Confirmed by reading both repos' current code, not from docs. Affects three UI
  entry points client-side (see LogPulse's `PROGRESS.md` KL-2609-search). Recommend
  fixing here by accepting `search` as an alias for `q` (`const { q, search, ... } =
  req.query;` then `const term = q || search;`) rather than changing the client,
  since that's a strictly additive, backward-compatible change.
- **CLS-11** — No deployed-URL or live-production confirmation exists in any doc;
  `DEPLOYMENT.md`/`README.md` use placeholder values (`YOUR_PROJECT_ID`,
  `YOUR_SERVICE_URL`) throughout. The `linux/amd64` fix commit implies at least one
  real deploy attempt happened, but current live status is unverified from docs alone.

## Next Steps

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

## Human pass queue

Decisions this ledger surfaced that are Kevin's to make, not to be resolved
unilaterally:

- **Open-source blocker**: what to do about `@bevingh/auth` being a private package
  (CLS-02) before this repo goes public under the `bevingh` org — publish it
  separately, inline the specific function used (`matchApiKey`), or accept that
  self-hosters need org access. This has to be decided before "clone → run" can
  actually work for an external contributor, which is a stated goal of the
  open-sourcing plan.
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
