const Joi = require('joi');

const logEntrySchema = Joi.object({
  timestamp: Joi.date().iso().required(),
  level: Joi.string().valid('info', 'warn', 'error', 'debug').required(),
  service: Joi.string().required(),
  traceId: Joi.string().required(),
  method: Joi.string().optional(),
  path: Joi.string().optional(),
  statusCode: Joi.number().integer().optional(),
  duration: Joi.number().optional(),
  request: Joi.object({
    headers: Joi.object().optional(),
    body: Joi.any().optional(),
    query: Joi.object().optional(),
    ip: Joi.string().optional(),
    userAgent: Joi.string().optional()
  }).optional(),
  response: Joi.object({
    headers: Joi.object().optional(),
    body: Joi.any().optional()
  }).optional(),
  error: Joi.object({
    message: Joi.string().optional(),
    stack: Joi.string().optional(),
    code: Joi.string().optional()
  }).optional(),
  metadata: Joi.object().optional()
});

// Canonical health.status vocabulary (see docs/METRICS_READ_CONTRACT.md)
const HEALTH_STATUS_VALUES = ['ok', 'degraded', 'error', 'starting', 'stopping'];

const healthReportSchema = Joi.object({
  appId: Joi.string().required(),
  status: Joi.string().valid(...HEALTH_STATUS_VALUES).required(),
  timestamp: Joi.date().iso().required(),
  instanceId: Joi.string().required(),
  uptimeSeconds: Joi.number().optional()
});

// metrics is deliberately an unconstrained object — free-form is a design property
// of @bevingh/telemetry, not a validation gap
const metricsReportSchema = Joi.object({
  appId: Joi.string().required(),
  timestamp: Joi.date().iso().required(),
  instanceId: Joi.string().required(),
  metrics: Joi.object().unknown(true).required()
});

function validationFailed(res, error) {
  return res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message
    }))
  });
}

const validateLogBatch = (req, res, next) => {
  const schema = Joi.object({
    logs: Joi.array().items(logEntrySchema).min(1).max(1000).required()
  });
  
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  
  if (error) {
    return validationFailed(res, error);
  }
  
  req.validatedData = value;
  next();
};

const validateHealthReport = (req, res, next) => {
  const { error, value } = healthReportSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return validationFailed(res, error);
  }

  req.validatedData = value;
  next();
};

const validateMetricsReport = (req, res, next) => {
  const { error, value } = metricsReportSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return validationFailed(res, error);
  }

  req.validatedData = value;
  next();
};

module.exports = {
  validateLogBatch,
  validateHealthReport,
  validateMetricsReport,
  logEntrySchema,
  healthReportSchema,
  metricsReportSchema,
  HEALTH_STATUS_VALUES
};
