const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const logsRoutes = require('./routes/logs');
const healthRoutes = require('./routes/health');

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(compression()); // Compress responses
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging in development
if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Routes
app.use('/api/v1/logs', logsRoutes);
app.use('/', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Central Logging Service',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      ready: '/ready',
      submitLogs: 'POST /api/v1/logs',
      queryLogs: 'GET /api/v1/logs',
      getLogsByTraceId: 'GET /api/v1/logs/:traceId',
      getStats: 'GET /api/v1/logs/stats/summary'
    },
    documentation: 'See README.md for full API documentation'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   🚀 Central Logging Service                   ║
║   📡 Server running on port ${PORT}              ║
║   🌍 Environment: ${config.nodeEnv.padEnd(27)}║
║   📊 MongoDB: Connected                        ║
╚════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

module.exports = app;
