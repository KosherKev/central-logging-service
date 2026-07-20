const mongoose = require('mongoose');
const config = require('../config');

/**
 * Telemetry metrics / health pings from @bevingh/telemetry clients.
 * kind: 'health' | 'metric'
 * - health: status, optional uptimeSeconds
 * - metric: free-form metrics object (Mixed — deliberately unconstrained)
 */
const metricSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    index: true
  },
  instanceId: {
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  kind: {
    type: String,
    required: true,
    enum: ['health', 'metric'],
    index: true
  },
  // Present only for kind: 'metric' — free-form payload from the emitter
  metrics: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  // Present only for kind: 'health'
  status: {
    type: String,
    required: false
  },
  uptimeSeconds: {
    type: Number,
    required: false
  }
}, {
  timestamps: true,
  collection: 'metrics'
});

// Compound indexes for common queries
metricSchema.index({ appId: 1, timestamp: -1 });
metricSchema.index({ appId: 1, kind: 1, timestamp: -1 });
metricSchema.index({ appId: 1, instanceId: 1, timestamp: -1 });
metricSchema.index({ kind: 1, timestamp: -1 });

// TTL index — auto-delete metrics older than retention period (same knob as logs)
metricSchema.index({ timestamp: 1 }, {
  expireAfterSeconds: 60 * 60 * 24 * (config.retention.hotStorageDays || 7)
});

const Metric = mongoose.model('Metric', metricSchema);

module.exports = Metric;
