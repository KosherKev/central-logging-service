const Log = require('../models/Log');
const config = require('../config');

/**
 * Purge old logs from MongoDB
 * Run daily via cron or Cloud Scheduler
 */
async function archiveOldLogs() {
  try {
    console.log('🔄 Starting log purge process...');
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retention.hotStorageDays);
    
    console.log(`📅 Deleting logs older than ${cutoffDate.toISOString()}`);
    
    const deleteResult = await Log.deleteMany({
      timestamp: { $lt: cutoffDate }
    });
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} logs from MongoDB`);
    console.log('✅ Log purge process completed successfully');
    
  } catch (error) {
    console.error('❌ Error during log purge:', error);
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
      console.error('Failed to run archive job:', error);
      process.exit(1);
    }
  })();
}

module.exports = archiveOldLogs;
