const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const config = require('../config');
const logger = require('../utils/logger');
const authenticate = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { validateLogBatch } = require('../middleware/validation');
const {
  normalizeErrorMessage,
  fingerprintError,
  computeTrend,
  extractErrorDisplay
} = require('../utils/errorFingerprint');

/**
 * @route   POST /api/v1/logs
 * @desc    Submit batch of logs
 * @access  Private (API Key required)
 */
router.post('/', authenticate, rateLimit, validateLogBatch, async (req, res) => {
  try {
    const { logs } = req.validatedData;
    
    // Insert logs in batch
    const insertedLogs = await Log.insertMany(logs, { ordered: false });
    
    res.status(201).json({
      success: true,
      message: `Successfully stored ${insertedLogs.length} logs`,
      count: insertedLogs.length
    });
  } catch (error) {
    logger.error('Error storing logs', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    
    // Handle partial success in case of duplicate keys
    if (error.code === 11000) {
      const successCount = error.result?.nInserted || 0;
      return res.status(207).json({
        success: true,
        message: `Stored ${successCount} logs (some duplicates skipped)`,
        count: successCount
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to store logs'
    });
  }
});

/**
 * @route   GET /api/v1/logs
 * @desc    Query logs with filters
 * @access  Private (API Key required)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      service,
      level,
      from,
      to,
      traceId,
      statusCode,
      q,
      limit = 100,
      skip = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;
    
    // Build query
    const query = {};
    
    if (service) query.service = service;
    if (level) query.level = level;
    if (traceId) query.traceId = traceId;
    if (statusCode) query.statusCode = parseInt(statusCode);
    
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) query.timestamp.$lte = new Date(to);
    } else {
      query.timestamp = {
        $gte: new Date(Date.now() - config.retention.hotStorageDays * 24 * 60 * 60 * 1000)
      };
    }
    
    let effectiveLimit = Math.min(parseInt(limit), 1000);

    if (q) {
      const trimmedQ = q.trim();
      if (trimmedQ) {
        // Escape regex metacharacters
        const escapedQ = trimmedQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Note: error.stack (too noisy) and metadata (Mixed type, requires full-doc scan) 
        // were deliberately excluded from v1 search scope.
        query.$or = [
          { 'error.message': { $regex: escapedQ, $options: 'i' } },
          { path: { $regex: escapedQ, $options: 'i' } },
          { 'error.code': { $regex: escapedQ, $options: 'i' } }
        ];
        
        // Enforce a stricter limit cap for regex searches since they don't use indexes
        effectiveLimit = Math.min(parseInt(limit), 200);
      }
    }
    
    const skipN = parseInt(skip, 10) || 0;

    // Execute query
    const logs = await Log.find(query)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .limit(effectiveLimit)
      .skip(skipN)
      .lean();
    
    const total = await Log.countDocuments(query);
    
    // Prefer top-level total + meta for LogPulse; keep pagination for older clients
    res.json({
      success: true,
      data: logs,
      total,
      meta: {
        limit: effectiveLimit,
        skip: skipN
      },
      pagination: {
        total,
        limit: effectiveLimit,
        skip: skipN,
        hasMore: total > (skipN + logs.length)
      }
    });
  } catch (error) {
    logger.error('Error querying logs', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to query logs'
    });
  }
});

/**
 * @route   GET /api/v1/logs/:traceId
 * @desc    Get all logs for a specific trace ID
 * @access  Private (API Key required)
 */
router.get('/:traceId', authenticate, async (req, res) => {
  try {
    const { traceId } = req.params;
    
    const logs = await Log.find({ traceId })
      .sort({ timestamp: 1 })
      .lean();
    
    if (logs.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No logs found for this trace ID'
      });
    }
    
    res.json({
      success: true,
      data: logs,
      count: logs.length
    });
  } catch (error) {
    logger.error('Error fetching logs by trace ID', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs'
    });
  }
});

/**
 * Preset windows for LogPulse traffic charts.
 * Bucket sizes chosen so charts stay readable (~12–24 points typical).
 */
const TIME_RANGE_PRESETS = {
  last_hour: { windowMs: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  last_24h: { windowMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  last_7d: { windowMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 12 * 60 * 60 * 1000 },
  last_30d: { windowMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 }
};

/**
 * Resolve timeseries window + bucket from query.
 * @returns {{ start: Date, end: Date, bucketMs: number, timeRange: string, service?: string } | { error: string }}
 */
function resolveTimeseriesWindow(query = {}) {
  const { timeRange = 'last_24h', from, to, service } = query;

  if (timeRange != null && timeRange !== '' && !TIME_RANGE_PRESETS[timeRange]) {
    return {
      error: `Invalid timeRange. Expected one of: ${Object.keys(TIME_RANGE_PRESETS).join(', ')}`
    };
  }

  const rangeKey = TIME_RANGE_PRESETS[timeRange] ? timeRange : 'last_24h';
  const preset = TIME_RANGE_PRESETS[rangeKey];
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(end.getTime())) {
    return { error: 'Invalid "to" date; expected ISO-8601' };
  }

  let start;
  if (from) {
    start = new Date(from);
    if (Number.isNaN(start.getTime())) {
      return { error: 'Invalid "from" date; expected ISO-8601' };
    }
  } else {
    start = new Date(end.getTime() - preset.windowMs);
  }

  if (start > end) {
    return { error: '"from" must be before "to"' };
  }

  let bucketMs = preset.bucketMs;
  // Absolute from/to without a known preset range: pick bucket from duration
  if (from && to && !TIME_RANGE_PRESETS[timeRange]) {
    const duration = end.getTime() - start.getTime();
    if (duration <= 2 * 60 * 60 * 1000) bucketMs = 5 * 60 * 1000;
    else if (duration <= 2 * 24 * 60 * 60 * 1000) bucketMs = 60 * 60 * 1000;
    else if (duration <= 14 * 24 * 60 * 60 * 1000) bucketMs = 12 * 60 * 60 * 1000;
    else bucketMs = 24 * 60 * 60 * 1000;
  }

  return {
    start,
    end,
    bucketMs,
    timeRange: rangeKey,
    ...(typeof service === 'string' && service.trim()
      ? { service: service.trim() }
      : {})
  };
}

/**
 * Aggregate total/error counts into UTC-aligned time buckets.
 * Counts every matching log in the window — not a sample.
 */
async function fetchLogTimeseries({ start, end, bucketMs, service }) {
  const matchQuery = {
    timestamp: { $gte: start, $lte: end }
  };
  if (service) matchQuery.service = service;

  const rows = await Log.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: {
          $toDate: {
            $subtract: [
              { $toLong: '$timestamp' },
              { $mod: [{ $toLong: '$timestamp' }, bucketMs] }
            ]
          }
        },
        totalCount: { $sum: 1 },
        errorCount: {
          $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
        }
      }
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        timestamp: '$_id',
        totalCount: 1,
        errorCount: 1
      }
    }
  ]);

  return rows;
}

/**
 * Map per-service aggregation rows → LogPulse-friendly objects.
 * Values are objects with totalRequests/errorCount/errorRate/avgDuration
 * (not bare ints — those were the legacy count-only shape).
 */
function formatByServiceStats(rows = []) {
  return rows.reduce((acc, item) => {
    if (item == null || item._id == null) return acc;
    const totalRequests = item.totalRequests || 0;
    const errorCount = item.errorCount || 0;
    acc[item._id] = {
      totalRequests,
      errorCount,
      errorRate:
        totalRequests > 0
          ? parseFloat(((errorCount / totalRequests) * 100).toFixed(2))
          : 0,
      avgDuration: item.avgDuration != null ? item.avgDuration : 0
    };
    return acc;
  }, {});
}

/**
 * @route   GET /api/v1/logs/stats
 * @desc    Get aggregated statistics
 * @access  Private (API Key required)
 */
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    const { service, from, to } = req.query;
    
    // Build match query
    const matchQuery = {};
    if (service) matchQuery.service = service;
    if (from || to) {
      matchQuery.timestamp = {};
      if (from) matchQuery.timestamp.$gte = new Date(from);
      if (to) matchQuery.timestamp.$lte = new Date(to);
    }
    
    // Aggregation pipeline
    const stats = await Log.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          byLevel: [
            { $group: { _id: '$level', count: { $sum: 1 } } }
          ],
          byService: [
            {
              $group: {
                _id: '$service',
                totalRequests: { $sum: 1 },
                errorCount: {
                  $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
                },
                avgDuration: { $avg: '$duration' }
              }
            }
          ],
          byStatusCode: [
            { $group: { _id: '$statusCode', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ],
          avgDuration: [
            { $match: { duration: { $exists: true } } },
            { $group: { _id: null, avg: { $avg: '$duration' } } }
          ],
          total: [
            { $count: 'count' }
          ],
          errorRate: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                errors: {
                  $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
                }
              }
            }
          ]
        }
      }
    ]);
    
    const result = stats[0];
    
    // Format response
    const response = {
      success: true,
      data: {
        totalLogs: result.total[0]?.count || 0,
        errorRate: result.errorRate[0] 
          ? (result.errorRate[0].errors / result.errorRate[0].total * 100).toFixed(2)
          : 0,
        avgDuration: result.avgDuration[0]?.avg || 0,
        byLevel: result.byLevel.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        byService: formatByServiceStats(result.byService),
        byStatusCode: result.byStatusCode.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error calculating stats', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to calculate statistics'
    });
  }
});

/**
 * @route   GET /api/v1/logs/stats/timeseries
 * @desc    Bucketed total/error counts for LogPulse traffic charts
 * @access  Private (flat API key — same as other log reads)
 * @query   timeRange=last_hour|last_24h|last_7d|last_30d (default last_24h)
 * @query   service, from, to (optional ISO-8601 absolute window)
 */
router.get('/stats/timeseries', authenticate, async (req, res) => {
  try {
    const resolved = resolveTimeseriesWindow(req.query);
    if (resolved.error) {
      return res.status(400).json({
        success: false,
        error: resolved.error
      });
    }

    const { start, end, bucketMs, timeRange, service } = resolved;
    const data = await fetchLogTimeseries({ start, end, bucketMs, service });

    res.json({
      success: true,
      data,
      meta: {
        bucketMs,
        timeRange,
        from: start.toISOString(),
        to: end.toISOString()
      }
    });
  } catch (error) {
    logger.error('Error calculating log timeseries', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to calculate timeseries'
    });
  }
});

/**
 * Error rule matching LogPulse LogEntry.isError:
 * level === 'error' OR statusCode >= 400
 */
const ERROR_LOG_MATCH = {
  $or: [{ level: 'error' }, { statusCode: { $gte: 400 } }]
};

/**
 * Group error/status>=400 logs for the Errors tab.
 *
 * Message extraction uses extractErrorDisplay() (top-level error → response.body
 * → HTTP status). Fingerprinting happens in application code so body-only
 * failures do not collapse into one "Unknown error" megagroup.
 *
 * Sorted by lastSeen desc. Empty window → [].
 */
async function fetchErrorGroups({ start, end, service, limit = 50 }) {
  const midMs = start.getTime() + (end.getTime() - start.getTime()) / 2;
  const mid = new Date(midMs);

  const matchQuery = {
    timestamp: { $gte: start, $lte: end },
    ...ERROR_LOG_MATCH
  };
  if (service) matchQuery.service = service;

  // Project only fields needed for extraction + grouping (all matching logs in window)
  const docs = await Log.find(matchQuery)
    .select({
      timestamp: 1,
      service: 1,
      statusCode: 1,
      traceId: 1,
      error: 1,
      'response.body': 1
    })
    .lean();

  const byFp = new Map();

  for (const doc of docs) {
    const extracted = extractErrorDisplay(doc);
    const message = extracted.message;
    const errorCode = extracted.errorCode;
    const id = fingerprintError(message, errorCode);
    const ts = doc.timestamp ? new Date(doc.timestamp) : new Date(0);
    const isRecent = ts.getTime() >= mid.getTime();

    const existing = byFp.get(id);
    if (!existing) {
      byFp.set(id, {
        id,
        message,
        errorCode,
        count: 1,
        services: new Set(doc.service ? [doc.service] : []),
        firstSeen: ts,
        lastSeen: ts,
        sampleStack: extracted.stack || null,
        sampleTraceId: doc.traceId || null,
        sampleStatusCode: extracted.statusCode,
        recentCount: isRecent ? 1 : 0,
        earlierCount: isRecent ? 0 : 1
      });
      continue;
    }

    existing.count += 1;
    if (isRecent) existing.recentCount += 1;
    else existing.earlierCount += 1;
    if (doc.service) existing.services.add(doc.service);
    if (ts < existing.firstSeen) existing.firstSeen = ts;
    if (ts >= existing.lastSeen) {
      // Prefer newest sample for message/stack/trace (same fingerprint)
      existing.lastSeen = ts;
      existing.message = message;
      existing.errorCode = errorCode;
      existing.sampleStack = extracted.stack || existing.sampleStack;
      existing.sampleTraceId = doc.traceId || existing.sampleTraceId;
      existing.sampleStatusCode =
        extracted.statusCode != null
          ? extracted.statusCode
          : existing.sampleStatusCode;
    }
  }

  const groups = Array.from(byFp.values())
    .map((g) => ({
      id: g.id,
      message: g.message,
      errorCode: g.errorCode != null ? g.errorCode : null,
      count: g.count,
      services: Array.from(g.services).sort(),
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      sampleStack: g.sampleStack,
      sampleTraceId: g.sampleTraceId,
      sampleStatusCode:
        g.sampleStatusCode != null ? g.sampleStatusCode : null,
      trend: computeTrend(g.earlierCount, g.recentCount)
    }))
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
    .slice(0, limit);

  return groups;
}

/**
 * @route   GET /api/v1/logs/errors/groups
 * @desc    Fingerprinted error groups for LogPulse Errors tab
 * @access  Private (flat API key)
 * @query   timeRange, service, limit (default 50, max 200)
 *
 * Inclusion rule (matches LogPulse LogEntry.isError):
 *   level === 'error' OR statusCode >= 400
 * Sort: lastSeen descending.
 */
router.get('/errors/groups', authenticate, async (req, res) => {
  try {
    const resolved = resolveTimeseriesWindow(req.query);
    if (resolved.error) {
      return res.status(400).json({
        success: false,
        error: resolved.error
      });
    }

    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);

    const { start, end, service } = resolved;
    const data = await fetchErrorGroups({ start, end, service, limit });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Error fetching error groups', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch error groups'
    });
  }
});

module.exports = router;
module.exports.TIME_RANGE_PRESETS = TIME_RANGE_PRESETS;
module.exports.resolveTimeseriesWindow = resolveTimeseriesWindow;
module.exports.fetchLogTimeseries = fetchLogTimeseries;
module.exports.formatByServiceStats = formatByServiceStats;
module.exports.fetchErrorGroups = fetchErrorGroups;
module.exports.ERROR_LOG_MATCH = ERROR_LOG_MATCH;
module.exports.normalizeErrorMessage = normalizeErrorMessage;
module.exports.fingerprintError = fingerprintError;
module.exports.computeTrend = computeTrend;
module.exports.extractErrorDisplay = extractErrorDisplay;
