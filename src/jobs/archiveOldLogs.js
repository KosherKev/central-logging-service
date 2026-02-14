const Log = require('../models/Log');
const storageService = require('../services/storageService');
const config = require('../config');

/**
 * Archive old logs to Google Cloud Storage
 * This job should be run daily via cron or Cloud Scheduler
 */
async function archiveOldLogs() {
  try {
    console.log('🔄 Starting log archival process...');
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retention.hotStorageDays);
    
    console.log(`📅 Archiving logs older than ${cutoffDate.toISOString()}`);
    
    // Find logs to archive
    const logsToArchive = await Log.find({
      timestamp: { $lt: cutoffDate },
      archived: false
    }).lean();
    
    if (logsToArchive.length === 0) {
      console.log('✅ No logs to archive');
      return;
    }
    
    console.log(`📦 Found ${logsToArchive.length} logs to archive`);
    
    // Group logs by date for organized storage
    const logsByDate = logsToArchive.reduce((acc, log) => {
      const date = new Date(log.timestamp).toISOString().split('T')[0];
      if (!acc[date]) acc[date] = [];
      acc[date].push(log);
      return acc;
    }, {});
    
    // Upload each date's logs to GCS
    let totalArchived = 0;
    
    for (const [date, logs] of Object.entries(logsByDate)) {
      const filename = `archives/${date}.json`;
      
      try {
        await storageService.uploadLogs(logs, filename);
        
        // Mark logs as archived
        const logIds = logs.map(log => log._id);
        await Log.updateMany(
          { _id: { $in: logIds } },
          { $set: { archived: true } }
        );
        
        totalArchived += logs.length;
        console.log(`✅ Archived ${logs.length} logs for ${date}`);
      } catch (error) {
        console.error(`❌ Failed to archive logs for ${date}:`, error);
      }
    }
    
    console.log(`✅ Archival complete. Total logs archived: ${totalArchived}`);
    
    // Delete old archived logs from MongoDB
    const deleteResult = await Log.deleteMany({
      timestamp: { $lt: cutoffDate },
      archived: true
    });
    
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} archived logs from MongoDB`);
    
    // Clean up old archives from GCS
    if (storageService.isConfigured) {
      const deletedArchives = await storageService.deleteOldArchives(
        config.retention.coldStorageDays
      );
      console.log(`🗑️  Deleted ${deletedArchives} old archive files from GCS`);
    }
    
    console.log('✅ Log archival process completed successfully');
    
  } catch (error) {
    console.error('❌ Error during log archival:', error);
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
