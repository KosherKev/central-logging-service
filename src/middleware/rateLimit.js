const config = require('../config');

// Simple in-memory rate limiter
const rateLimitStore = new Map();

const rateLimit = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.ip;
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs;
  const maxRequests = config.rateLimit.maxRequests;
  
  // Get or initialize the request count for this API key
  if (!rateLimitStore.has(apiKey)) {
    rateLimitStore.set(apiKey, {
      count: 0,
      resetTime: now + windowMs
    });
  }
  
  const limit = rateLimitStore.get(apiKey);
  
  // Reset if window has passed
  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + windowMs;
  }
  
  // Increment request count
  limit.count++;
  
  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - limit.count));
  res.setHeader('X-RateLimit-Reset', new Date(limit.resetTime).toISOString());
  
  // Check if limit exceeded
  if (limit.count > maxRequests) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((limit.resetTime - now) / 1000)
    });
  }
  
  next();
};

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = rateLimit;
