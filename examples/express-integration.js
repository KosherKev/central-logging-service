const express = require('express');
const LogShipper = require('../client/log-shipper');

const app = express();
app.use(express.json());

// Initialize the log shipper
const logger = new LogShipper({
  serviceUrl: process.env.LOGGING_SERVICE_URL || 'http://localhost:8080',
  apiKey: process.env.LOGGING_API_KEY || 'dev-key-123',
  serviceName: 'user-api',
  batchSize: 50,
  flushInterval: 5000
});

// Use middleware for automatic logging of all requests
app.use(logger.middleware());

// Example routes
app.get('/api/users', async (req, res) => {
  try {
    // Your business logic here
    const users = [
      { id: 1, name: 'John Doe' },
      { id: 2, name: 'Jane Smith' }
    ];
    
    // Additional custom logging if needed
    logger.info({
      message: 'Users fetched successfully',
      metadata: {
        count: users.length,
        userId: req.headers['x-user-id']
      }
    });
    
    res.json({ success: true, data: users });
  } catch (error) {
    // Log errors explicitly
    logger.error({
      message: 'Failed to fetch users',
      error: {
        message: error.message,
        stack: error.stack
      },
      metadata: {
        userId: req.headers['x-user-id']
      }
    });
    
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    
    // Validation
    if (!name || !email) {
      logger.warn({
        message: 'Invalid user creation request',
        metadata: {
          provided: { name: !!name, email: !!email }
        }
      });
      
      return res.status(400).json({ 
        success: false, 
        error: 'Name and email are required' 
      });
    }
    
    // Your business logic here
    const newUser = { id: 3, name, email };
    
    logger.info({
      message: 'User created successfully',
      metadata: {
        userId: newUser.id,
        createdBy: req.headers['x-user-id']
      }
    });
    
    res.status(201).json({ success: true, data: newUser });
  } catch (error) {
    logger.error({
      message: 'Failed to create user',
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Your business logic here
    logger.info({
      message: 'User deleted',
      metadata: {
        userId: id,
        deletedBy: req.headers['x-user-id']
      }
    });
    
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    logger.error({
      message: 'Failed to delete user',
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({
    message: 'Unhandled error',
    error: {
      message: err.message,
      stack: err.stack
    },
    metadata: {
      url: req.originalUrl,
      method: req.method
    }
  });
  
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, flushing logs...');
  await logger.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, flushing logs...');
  await logger.stop();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`User API running on port ${PORT}`);
});
