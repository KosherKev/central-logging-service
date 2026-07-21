const Log = require('../models/Log');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Purge old logs from MongoDB (hot retention window).
 * Run daily via cron-job.org → POST /jobs/purge-logs, or:
 *   node src/jobs/archiveOldLogs.js
 *
 * Cutoff = now - HOT_STORAGE_DAYS (default 7).
 * Metrics TTL is handled separately by MongoDB (Metric model).
 *
 * @returns {{ cutoffDate: Date, deletedCount: number, hotStorageDays: number }}
 */
async function archiveOldLogs() {
  logger.info('Starting log purge process');

  const hotStorageDays = config.retention.hotStorageDays || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - hotStorageDays);

  logger.info(`Deleting logs older than ${cutoffDate.toISOString()} (${hotStorageDays}d retention)`);

  const deleteResult = await Log.deleteMany({
    timestamp: { $lt: cutoffDate }
  });

  const deletedCount = deleteResult.deletedCount || 0;
  logger.info(`Deleted ${deletedCount} logs from MongoDB`);
  logger.info('Log purge process completed successfully');

  return {
    cutoffDate,
    deletedCount,
    hotStorageDays
  };
}

// Allow running as a standalone script (local / one-off)
if (require.main === module) {
  const connectDB = require('../config/database');

  (async () => {
    try {
      await connectDB();
      const result = await archiveOldLogs();
      console.log(
        `Purged ${result.deletedCount} logs older than ${result.cutoffDate.toISOString()}`
      );
      process.exit(0);
    } catch (error) {
      logger.error('Failed to run archive job', {
        error: {
          message: error.message,
          stack: error.stack
        }
      });
      process.exit(1);
    }
  })();
}

module.exports = archiveOldLogs;
