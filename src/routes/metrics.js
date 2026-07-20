const express = require('express');
const router = express.Router();
const Metric = require('../models/Metric');
const logger = require('../utils/logger');
const metricsAuth = require('../middleware/metricsAuth');
const rateLimit = require('../middleware/rateLimit');
const { validateHealthReport, validateMetricsReport } = require('../middleware/validation');

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

module.exports = router;
// Exported for unit tests (wrong-app mismatch is security-critical)
module.exports.enforceAppScope = enforceAppScope;
