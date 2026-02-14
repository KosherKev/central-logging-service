const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

router.get('/ready', async (req, res) => {
  const mongoose = require('mongoose');
  
  const isMongoReady = mongoose.connection.readyState === 1;
  
  if (!isMongoReady) {
    return res.status(503).json({
      success: false,
      status: 'not ready',
      mongodb: 'disconnected'
    });
  }
  
  res.json({
    success: true,
    status: 'ready',
    mongodb: 'connected'
  });
});

module.exports = router;
