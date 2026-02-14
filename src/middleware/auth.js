const config = require('../config');

const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Missing API key. Include X-API-Key header.'
    });
  }
  
  if (!config.auth.apiKeys.includes(apiKey)) {
    return res.status(403).json({
      success: false,
      error: 'Invalid API key.'
    });
  }
  
  next();
};

module.exports = authenticate;
