const { Storage } = require('@google-cloud/storage');
const config = require('../config');

class StorageService {
  constructor() {
    this.storage = null;
    this.bucket = null;
    this.isConfigured = false;
    
    this.initialize();
  }
  
  initialize() {
    try {
      if (!config.gcs.projectId || !config.gcs.bucketName) {
        console.warn('⚠️  Google Cloud Storage not configured. Archiving disabled.');
        return;
      }
      
      const options = {
        projectId: config.gcs.projectId
      };
      
      if (config.gcs.keyFilename) {
        options.keyFilename = config.gcs.keyFilename;
      }
      
      this.storage = new Storage(options);
      this.bucket = this.storage.bucket(config.gcs.bucketName);
      this.isConfigured = true;
      
      console.log('✅ Google Cloud Storage initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Google Cloud Storage:', error.message);
    }
  }
  
  async uploadLogs(logs, filename) {
    if (!this.isConfigured) {
      throw new Error('Google Cloud Storage is not configured');
    }
    
    try {
      const file = this.bucket.file(filename);
      const content = JSON.stringify(logs, null, 2);
      
      await file.save(content, {
        contentType: 'application/json',
        metadata: {
          uploadedAt: new Date().toISOString(),
          logCount: logs.length
        }
      });
      
      console.log(`✅ Uploaded ${logs.length} logs to GCS: ${filename}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to upload logs to GCS:', error);
      throw error;
    }
  }
  
  async downloadLogs(filename) {
    if (!this.isConfigured) {
      throw new Error('Google Cloud Storage is not configured');
    }
    
    try {
      const file = this.bucket.file(filename);
      const [content] = await file.download();
      return JSON.parse(content.toString());
    } catch (error) {
      console.error('❌ Failed to download logs from GCS:', error);
      throw error;
    }
  }
  
  async deleteOldArchives(daysToKeep) {
    if (!this.isConfigured) {
      return;
    }
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      const [files] = await this.bucket.getFiles({
        prefix: 'archives/'
      });
      
      let deletedCount = 0;
      
      for (const file of files) {
        const [metadata] = await file.getMetadata();
        const fileDate = new Date(metadata.timeCreated);
        
        if (fileDate < cutoffDate) {
          await file.delete();
          deletedCount++;
        }
      }
      
      console.log(`✅ Deleted ${deletedCount} old archive files from GCS`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Failed to delete old archives:', error);
      throw error;
    }
  }
  
  async listArchives(startDate, endDate) {
    if (!this.isConfigured) {
      throw new Error('Google Cloud Storage is not configured');
    }
    
    try {
      const [files] = await this.bucket.getFiles({
        prefix: 'archives/'
      });
      
      const archives = [];
      
      for (const file of files) {
        const [metadata] = await file.getMetadata();
        const fileDate = new Date(metadata.timeCreated);
        
        if ((!startDate || fileDate >= startDate) && (!endDate || fileDate <= endDate)) {
          archives.push({
            name: file.name,
            size: metadata.size,
            created: metadata.timeCreated,
            logCount: metadata.metadata?.logCount || 0
          });
        }
      }
      
      return archives;
    } catch (error) {
      console.error('❌ Failed to list archives:', error);
      throw error;
    }
  }
}

module.exports = new StorageService();
