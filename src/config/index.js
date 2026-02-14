require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/central-logging',
    options: {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }
  },
  
  auth: {
    apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',') : ['dev-key-123']
  },
  
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME || 'logging-bucket',
    projectId: process.env.GCS_PROJECT_ID || '',
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  },
  
  retention: {
    hotStorageDays: parseInt(process.env.HOT_STORAGE_DAYS || '7'),
    coldStorageDays: parseInt(process.env.COLD_STORAGE_DAYS || '90')
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
  }
};
