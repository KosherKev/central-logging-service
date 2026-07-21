const express = require('express');
const router = express.Router();
const Metric = require('../models/Metric');
const logger = require('../utils/logger');
const authenticate = require('../middleware/auth');
const metricsAuth = require('../middleware/metricsAuth');
const rateLimit = require('../middleware/rateLimit');
const { validateHealthReport, validateMetricsReport } = require('../middleware/validation');

/** Default window for distinct instanceId counting (15 minutes). */
const DEFAULT_INSTANCE_WINDOW_SECONDS = 900;

/**
 * Enforce that the authenticated key's subjectId matches the claimed appId.
 * A leaked key for app A must not be able to post as app B.
 */
function enforceAppScope(req, res) {
  if (req.body.appId !== req.telemetryAppId) {
    res.status(403).json({
      success: false,
      error: 'API key is not authorized for this appId.'
    });
    return false;
  }
  return true;
}

/**
 * Merge latest-health and latest-metric grouping rows into the read API shape.
 * Missing kinds become null (app may have reported only one kind).
 */
function mergeLatestByApp(healthRows, metricRows) {
  const byApp = new Map();

  for (const row of healthRows) {
    const appId = row._id;
    const doc = row.doc || {};
    byApp.set(appId, {
      appId,
      health: {
        status: doc.status,
        instanceId: doc.instanceId,
        uptimeSeconds: doc.uptimeSeconds,
        timestamp: doc.timestamp
      },
      metrics: null,
      metricsReportedAt: null
    });
  }

  for (const row of metricRows) {
    const appId = row._id;
    const doc = row.doc || {};
    const existing = byApp.get(appId) || {
      appId,
      health: null,
      metrics: null,
      metricsReportedAt: null
    };
    existing.metrics = doc.metrics != null ? doc.metrics : null;
    existing.metricsReportedAt = doc.timestamp != null ? doc.timestamp : null;
    byApp.set(appId, existing);
  }

  return Array.from(byApp.values());
}

/**
 * Attach distinct-instance stats for the activity window.
 * instanceCount is always set (never inferred from health.instanceId alone).
 */
function attachInstanceStats(rows, instanceRows) {
  const byApp = new Map();

  for (const inst of instanceRows) {
    const list = byApp.get(inst.appId) || [];
    list.push({
      instanceId: inst.instanceId,
      lastSeen: inst.lastSeen,
      status: inst.status != null ? inst.status : null,
      uptimeSeconds: inst.uptimeSeconds != null ? inst.uptimeSeconds : null
    });
    byApp.set(inst.appId, list);
  }

  for (const row of rows) {
    const instances = byApp.get(row.appId) || [];
    instances.sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
    row.instanceCount = instances.length;
    row.instances = instances;
  }

  return rows;
}

/**
 * Distinct instanceIds per app with activity in [windowStart, now].
 * lastSeen = max timestamp of any kind; status/uptime from latest health in window.
 */
async function fetchInstanceStats(appIdFilter, windowStart) {
  const baseMatch = {
    ...(appIdFilter ? { appId: appIdFilter } : {}),
    timestamp: { $gte: windowStart },
    instanceId: { $exists: true, $nin: [null, ''] }
  };

  return Metric.aggregate([
    { $match: baseMatch },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: { appId: '$appId', instanceId: '$instanceId' },
        lastSeen: { $max: '$timestamp' },
        // After sort desc, push health-only entries in recency order
        healthEntries: {
          $push: {
            $cond: [
              { $eq: ['$kind', 'health'] },
              {
                status: '$status',
                uptimeSeconds: '$uptimeSeconds'
              },
              '$$REMOVE'
            ]
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        appId: '$_id.appId',
        instanceId: '$_id.instanceId',
        lastSeen: 1,
        status: {
          $ifNull: [{ $arrayElemAt: ['$healthEntries.status', 0] }, null]
        },
        uptimeSeconds: {
          $ifNull: [{ $arrayElemAt: ['$healthEntries.uptimeSeconds', 0] }, null]
        }
      }
    }
  ]);
}

/**
 * Latest health-kind + metric-kind docs per app via aggregation
 * ($sort timestamp desc, $group by appId per kind), then merge in app code.
 * Plus distinct instanceCount/instances[] over instanceWindowSeconds.
 */
async function fetchLatestMetricsSnapshot(appIdFilter, options = {}) {
  const baseMatch = appIdFilter ? { appId: appIdFilter } : {};
  const instanceWindowSeconds =
    options.instanceWindowSeconds != null
      ? options.instanceWindowSeconds
      : DEFAULT_INSTANCE_WINDOW_SECONDS;
  const windowStart = new Date(Date.now() - instanceWindowSeconds * 1000);

  const latestByKind = (kind) =>
    Metric.aggregate([
      { $match: { ...baseMatch, kind } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$appId',
          doc: { $first: '$$ROOT' }
        }
      }
    ]);

  const [healthRows, metricRows, instanceRows] = await Promise.all([
    latestByKind('health'),
    latestByKind('metric'),
    fetchInstanceStats(appIdFilter, windowStart)
  ]);

  const merged = mergeLatestByApp(healthRows, metricRows);
  return attachInstanceStats(merged, instanceRows);
}

/**
 * @route   POST /api/v1/metrics/health
 * @desc    Ingest a health ping from @bevingh/telemetry
 * @access  Private (per-app API key)
 */
router.post('/health', metricsAuth, rateLimit, validateHealthReport, async (req, res) => {
  try {
    if (!enforceAppScope(req, res)) return;

    const { appId, status, timestamp, instanceId, uptimeSeconds } = req.validatedData;

    await Metric.create({
      appId,
      instanceId,
      timestamp: new Date(timestamp),
      kind: 'health',
      status,
      ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {})
    });

    res.status(201).json({
      success: true,
      message: 'Health report stored'
    });
  } catch (error) {
    logger.error('Error storing health metric', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to store health report'
    });
  }
});

/**
 * @route   POST /api/v1/metrics
 * @desc    Ingest free-form metrics from @bevingh/telemetry
 * @access  Private (per-app API key)
 */
router.post('/', metricsAuth, rateLimit, validateMetricsReport, async (req, res) => {
  try {
    if (!enforceAppScope(req, res)) return;

    const { appId, timestamp, instanceId, metrics } = req.validatedData;

    await Metric.create({
      appId,
      instanceId,
      timestamp: new Date(timestamp),
      kind: 'metric',
      metrics
    });

    res.status(201).json({
      success: true,
      message: 'Metrics report stored'
    });
  } catch (error) {
    logger.error('Error storing metrics', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to store metrics report'
    });
  }
});

/**
 * @route   GET /api/v1/metrics
 * @desc    Latest health + metrics snapshot per app (operator/dashboard read)
 * @access  Private (flat API key — same as GET /api/v1/logs; not per-app metricsAuth)
 * @query   appId - optional; when set, only that app; when omitted, one entry per appId
 * @query   instanceWindowSeconds - optional window for distinct instance count (default 900)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { appId, instanceWindowSeconds: rawWindow } = req.query;
    let instanceWindowSeconds = DEFAULT_INSTANCE_WINDOW_SECONDS;
    if (rawWindow != null && rawWindow !== '') {
      const parsed = parseInt(rawWindow, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          success: false,
          error: 'instanceWindowSeconds must be a positive integer'
        });
      }
      instanceWindowSeconds = parsed;
    }

    const data = await fetchLatestMetricsSnapshot(
      typeof appId === 'string' && appId.trim() ? appId.trim() : undefined,
      { instanceWindowSeconds }
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Error querying metrics', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to query metrics'
    });
  }
});

module.exports = router;
// Exported for unit tests
module.exports.enforceAppScope = enforceAppScope;
module.exports.mergeLatestByApp = mergeLatestByApp;
module.exports.attachInstanceStats = attachInstanceStats;
module.exports.fetchLatestMetricsSnapshot = fetchLatestMetricsSnapshot;
module.exports.fetchInstanceStats = fetchInstanceStats;
module.exports.DEFAULT_INSTANCE_WINDOW_SECONDS = DEFAULT_INSTANCE_WINDOW_SECONDS;
