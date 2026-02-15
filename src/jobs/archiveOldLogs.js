const Log = require('../models/Log');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Purge old logs from MongoDB
 * Run daily via cron or Cloud Scheduler
 */
async function archiveOldLogs() {
  try {
    logger.info('Starting log purge process');
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retention.hotStorageDays);
    
    logger.info(`Deleting logs older than ${cutoffDate.toISOString()}`);
    
    const deleteResult = await Log.deleteMany({
      timestamp: { $lt: cutoffDate }
    });
    logger.info(`Deleted ${deleteResult.deletedCount} logs from MongoDB`);
    logger.info('Log purge process completed successfully');
    
  } catch (error) {
    logger.error('Error during log purge', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    throw error;
  }
}

// Allow running as a standalone script
if (require.main === module) {
  const connectDB = require('../config/database');
  
  (async () => {
    try {
      await connectDB();
      await archiveOldLogs();
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
