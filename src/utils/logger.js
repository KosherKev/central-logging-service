const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const Log = require('../models/Log');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

function buildLogDocument(level, message, meta) {
  const metadata = meta && meta.metadata ? meta.metadata : {};
  const mergedMetadata = Object.assign({}, metadata, { message });
  return {
    timestamp: new Date(),
    level,
    service: meta && meta.service ? meta.service : 'central-logging-service',
    traceId: meta && meta.traceId ? meta.traceId : uuidv4(),
    method: meta && meta.method,
    path: meta && meta.path,
    statusCode: meta && meta.statusCode,
    duration: meta && meta.duration,
    request: meta && meta.request,
    response: meta && meta.response,
    error: meta && meta.error,
    metadata: mergedMetadata
  };
}

function persist(level, message, meta) {
  try {
    const doc = buildLogDocument(level, message, meta || {});
    Log.create(doc).catch(() => {});
  } catch (e) {}
}

function log(level, message, meta) {
  logger.log(level, message, meta);
  persist(level, message, meta);
}

module.exports = {
  logger,
  log,
  info(message, meta) {
    log('info', message, meta);
  },
  warn(message, meta) {
    log('warn', message, meta);
  },
  error(message, meta) {
    log('error', message, meta);
  },
  debug(message, meta) {
    log('debug', message, meta);
  }
};

