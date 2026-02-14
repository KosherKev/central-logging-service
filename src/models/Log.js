const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  level: {
    type: String,
    required: true,
    enum: ['info', 'warn', 'error', 'debug'],
    index: true
  },
  service: {
    type: String,
    required: true,
    index: true
  },
  traceId: {
    type: String,
    required: true,
    index: true
  },
  method: {
    type: String,
    required: false
  },
  path: {
    type: String,
    required: false
  },
  statusCode: {
    type: Number,
    required: false,
    index: true
  },
  duration: {
    type: Number,
    required: false
  },
  request: {
    headers: mongoose.Schema.Types.Mixed,
    body: mongoose.Schema.Types.Mixed,
    query: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String
  },
  response: {
    headers: mongoose.Schema.Types.Mixed,
    body: mongoose.Schema.Types.Mixed
  },
  error: {
    message: String,
    stack: String,
    code: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  archived: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  collection: 'logs'
});

// Compound indexes for common queries
logSchema.index({ service: 1, timestamp: -1 });
logSchema.index({ level: 1, timestamp: -1 });
logSchema.index({ service: 1, level: 1, timestamp: -1 });
logSchema.index({ archived: 1, timestamp: 1 });

// TTL index - auto-delete logs older than retention period
// This will be set dynamically based on config
logSchema.index({ timestamp: 1 }, { 
  expireAfterSeconds: 60 * 60 * 24 * 7 // 7 days default
});

const Log = mongoose.model('Log', logSchema);

module.exports = Log;
