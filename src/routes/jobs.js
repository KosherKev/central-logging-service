const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const archiveOldLogs = require('../jobs/archiveOldLogs');
const logger = require('../utils/logger');

/**
 * @route   POST /jobs/purge-logs
 * @desc    Delete logs older than HOT_STORAGE_DAYS (default 7)
 * @access  Private (flat X-API-Key — same as log reads)
 *
 * Intended for cron-job.org (or any external cron) to hit daily.
 * Alias: POST /jobs/archive (legacy name from older docs).
 */
async function handlePurge(req, res) {
  try {
    const result = await archiveOldLogs();

    res.json({
      success: true,
      message: `Purged ${result.deletedCount} logs older than ${result.hotStorageDays} days`,
      data: {
        deletedCount: result.deletedCount,
        cutoffDate: result.cutoffDate.toISOString(),
        hotStorageDays: result.hotStorageDays
      }
    });
  } catch (error) {
    logger.error('Purge job failed via HTTP', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      error: 'Failed to purge old logs'
    });
  }
}

router.post('/purge-logs', authenticate, handlePurge);
// Legacy path referenced in older deployment docs
router.post('/archive', authenticate, handlePurge);

module.exports = router;
