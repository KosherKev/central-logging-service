const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const authenticate = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { validateLogBatch } = require('../middleware/validation');

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
    console.error('Error storing logs:', error);
    
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
    }
    
    // Execute query
    const logs = await Log.find(query)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .limit(Math.min(parseInt(limit), 1000))
      .skip(parseInt(skip))
      .lean();
    
    const total = await Log.countDocuments(query);
    
    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: total > (parseInt(skip) + logs.length)
      }
    });
  } catch (error) {
    console.error('Error querying logs:', error);
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
    console.error('Error fetching logs by trace ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs'
    });
  }
});

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
            { $group: { _id: '$service', count: { $sum: 1 } } }
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
        byService: result.byService.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        byStatusCode: result.byStatusCode.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate statistics'
    });
  }
});

module.exports = router;
