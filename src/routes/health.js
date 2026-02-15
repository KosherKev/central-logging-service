const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

router.get('/health', (req, res) => {
  try {
    const payload = {
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
    logger.info('Health check', {
      metadata: {
        route: '/health',
        uptime: payload.uptime
      }
    });
    res.json(payload);
  } catch (error) {
    logger.error('Error in /health', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      status: 'unhealthy'
    });
  }
});

router.get('/ready', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const isMongoReady = mongoose.connection.readyState === 1;
    if (!isMongoReady) {
      logger.warn('Readiness check: MongoDB not ready', {
        metadata: {
          route: '/ready',
          mongodbState: mongoose.connection.readyState
        }
      });
      return res.status(503).json({
        success: false,
        status: 'not ready',
        mongodb: 'disconnected'
      });
    }
    logger.info('Readiness check: ready', {
      metadata: {
        route: '/ready',
        mongodb: 'connected'
      }
    });
    res.json({
      success: true,
      status: 'ready',
      mongodb: 'connected'
    });
  } catch (error) {
    logger.error('Error in /ready', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    res.status(500).json({
      success: false,
      status: 'not ready',
      mongodb: 'unknown'
    });
  }
});

module.exports = router;
