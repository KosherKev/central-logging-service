const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const logger = require('../utils/logger');
const authenticate = require('../middleware/auth');
const {
  resolveTimeseriesWindow,
  formatByServiceStats
} = require('./logs');
const { fetchLatestMetricsSnapshot } = require('./metrics');
const { formatDisplayName } = require('../utils/displayName');

const DEFAULT_ENDPOINT_LIMIT = 20;

/**
 * Per-service rollups from logs in [start, end].
 * errorRate uses same isError rule as groups: level===error OR statusCode>=400
 * for errorCount — but summary byService used only level===error.
 * Prefer level===error here to stay aligned with summary byService / P1.
 */
async function fetchServiceLogRollups({ start, end, service }) {
  const matchQuery = {
    timestamp: { $gte: start, $lte: end }
  };
  if (service) matchQuery.service = service;

  const rows = await Log.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$service',
        totalRequests: { $sum: 1 },
        errorCount: {
          $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
        },
        avgDuration: { $avg: '$duration' },
        lastSeen: { $max: '$timestamp' }
      }
    }
  ]);

  return rows;
}

/**
 * Endpoint rollups for one service (method + path), top N by requestCount.
 */
async function fetchEndpointRollups({ start, end, service, limit = DEFAULT_ENDPOINT_LIMIT }) {
  const rows = await Log.aggregate([
    {
      $match: {
        service,
        timestamp: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: {
          method: { $ifNull: ['$method', ''] },
          path: { $ifNull: ['$path', ''] }
        },
        requestCount: { $sum: 1 },
        errorCount: {
          $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
        },
        avgLatency: { $avg: '$duration' }
      }
    },
    { $sort: { requestCount: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        method: '$_id.method',
        path: '$_id.path',
        requestCount: 1,
        errorCount: 1,
        avgLatency: { $ifNull: ['$avgLatency', 0] },
        errorRate: {
          $cond: [
            { $gt: ['$requestCount', 0] },
            {
              $round: [
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$requestCount'] },
                    100
                  ]
                },
                2
              ]
            },
            0
          ]
        }
      }
    }
  ]);

  return rows;
}

function maxDate(...dates) {
  const valid = dates
    .filter((d) => d != null)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a > b ? a : b));
}

/**
 * Union log services + metrics appIds into catalog rows.
 * Sorted by totalRequests desc, then lastSeen desc.
 */
async function buildServicesCatalog({ start, end }) {
  const windowSeconds = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / 1000)
  );

  const [logRows, metricsRows] = await Promise.all([
    fetchServiceLogRollups({ start, end }),
    fetchLatestMetricsSnapshot(undefined, {
      instanceWindowSeconds: windowSeconds
    })
  ]);

  const byService = formatByServiceStats(logRows);
  const lastSeenByService = {};
  for (const row of logRows) {
    if (row._id) lastSeenByService[row._id] = row.lastSeen;
  }

  const metricsByApp = new Map(
    (metricsRows || []).map((m) => [m.appId, m])
  );

  const names = new Set([
    ...Object.keys(byService),
    ...metricsByApp.keys()
  ]);

  const data = [];
  for (const name of names) {
    const stats = byService[name] || {
      totalRequests: 0,
      errorCount: 0,
      errorRate: 0,
      avgDuration: 0
    };
    const metric = metricsByApp.get(name);
    const lastSeen = maxDate(
      lastSeenByService[name],
      metric?.health?.timestamp,
      metric?.metricsReportedAt
    );

    data.push({
      name,
      displayName: formatDisplayName(name),
      totalRequests: stats.totalRequests,
      errorRate: stats.errorRate,
      avgLatency: stats.avgDuration,
      lastSeen,
      instanceCount:
        metric && typeof metric.instanceCount === 'number'
          ? metric.instanceCount
          : null
    });
  }

  data.sort((a, b) => {
    if (b.totalRequests !== a.totalRequests) {
      return b.totalRequests - a.totalRequests;
    }
    const at = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
    const bt = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
    return bt - at;
  });

  return data;
}

/**
 * Single service detail: log rollups + endpoints + metrics snapshot shapes.
 * @returns {object|null} null if unknown (no logs in window and no metrics)
 */
async function buildServiceDetail({ name, start, end }) {
  const windowSeconds = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / 1000)
  );

  const [logRows, endpoints, metricsRows] = await Promise.all([
    fetchServiceLogRollups({ start, end, service: name }),
    fetchEndpointRollups({ start, end, service: name }),
    fetchLatestMetricsSnapshot(name, {
      instanceWindowSeconds: windowSeconds
    })
  ]);

  const statsMap = formatByServiceStats(logRows);
  const stats = statsMap[name] || {
    totalRequests: 0,
    errorCount: 0,
    errorRate: 0,
    avgDuration: 0
  };
  const logLastSeen = logRows[0]?.lastSeen || null;
  const metric = (metricsRows || [])[0] || null;

  const hasLogs = stats.totalRequests > 0 || logLastSeen != null;
  const hasMetrics =
    metric &&
    (metric.health != null ||
      metric.metrics != null ||
      (metric.instanceCount != null && metric.instanceCount > 0));

  if (!hasLogs && !hasMetrics) {
    return null;
  }

  const lastSeen = maxDate(
    logLastSeen,
    metric?.health?.timestamp,
    metric?.metricsReportedAt
  );

  return {
    name,
    displayName: formatDisplayName(name),
    totalRequests: stats.totalRequests,
    errorRate: stats.errorRate,
    avgLatency: stats.avgDuration,
    lastSeen,
    instanceCount:
      metric && typeof metric.instanceCount === 'number'
        ? metric.instanceCount
        : null,
    endpoints: endpoints || [],
    health: metric?.health ?? null,
    metrics: metric?.metrics ?? null,
    instances: metric?.instances ?? []
  };
}

/**
 * @route   GET /api/v1/services
 * @desc    Catalog of known services (logs ∪ metrics appIds) with rollups
 * @access  Private (flat API key)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const resolved = resolveTimeseriesWindow(req.query);
    if (resolved.error) {
      return res.status(400).json({
        success: false,
        error: resolved.error
      });
    }

    const { start, end, timeRange } = resolved;
    const data = await buildServicesCatalog({ start, end });

    res.json({
      success: true,
      data,
      meta: {
        timeRange,
        from: start.toISOString(),
        to: end.toISOString()
      }
    });
  } catch (error) {
    logger.error('Error listing services', {
      error: { message: error.message, stack: error.stack }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to list services'
    });
  }
});

/**
 * @route   GET /api/v1/services/:name
 * @desc    Service detail — endpoints + latest health/metrics/instances
 * @access  Private (flat API key)
 */
router.get('/:name', authenticate, async (req, res) => {
  try {
    const name =
      typeof req.params.name === 'string' ? req.params.name.trim() : '';
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Service name is required'
      });
    }

    const resolved = resolveTimeseriesWindow(req.query);
    if (resolved.error) {
      return res.status(400).json({
        success: false,
        error: resolved.error
      });
    }

    const { start, end, timeRange } = resolved;
    const data = await buildServiceDetail({ name, start, end });

    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Unknown service: ${name}`
      });
    }

    res.json({
      success: true,
      data,
      meta: {
        timeRange,
        from: start.toISOString(),
        to: end.toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching service detail', {
      error: { message: error.message, stack: error.stack }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch service detail'
    });
  }
});

module.exports = router;
module.exports.fetchServiceLogRollups = fetchServiceLogRollups;
module.exports.fetchEndpointRollups = fetchEndpointRollups;
module.exports.buildServicesCatalog = buildServicesCatalog;
module.exports.buildServiceDetail = buildServiceDetail;
