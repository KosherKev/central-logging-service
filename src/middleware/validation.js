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

const validateLogBatch = (req, res, next) => {
  const schema = Joi.object({
    logs: Joi.array().items(logEntrySchema).min(1).max(1000).required()
  });
  
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }))
    });
  }
  
  req.validatedData = value;
  next();
};

module.exports = {
  validateLogBatch,
  logEntrySchema
};
