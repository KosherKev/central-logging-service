const mongoose = require('mongoose');
const Log = require('../models/Log');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

/**
 * Seed database with sample logs for testing
 * Usage: node src/utils/seedDatabase.js [count]
 */

const services = ['user-api', 'payment-api', 'order-api', 'notification-api', 'auth-api'];
const levels = ['info', 'warn', 'error', 'debug'];
const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const paths = [
  '/api/users',
  '/api/users/:id',
  '/api/orders',
  '/api/payments',
  '/api/notifications',
  '/auth/login',
  '/auth/register',
  '/api/products'
];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateSampleLog() {
  const level = randomItem(levels);
  const service = randomItem(services);
  const method = randomItem(methods);
  const path = randomItem(paths);
  
  // Generate timestamp within last 7 days
  const now = new Date();
  const pastDate = new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000);
  
  // Status code based on level
  let statusCode;
  if (level === 'error') {
    statusCode = randomItem([500, 502, 503, 504]);
  } else if (level === 'warn') {
    statusCode = randomItem([400, 401, 403, 404, 429]);
  } else {
    statusCode = randomItem([200, 201, 204]);
  }
  
  const duration = Math.floor(Math.random() * 1000) + 10;
  
  const log = {
    timestamp: pastDate,
    level,
    service,
    traceId: uuidv4(),
    method,
    path,
    statusCode,
    duration,
    request: {
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      },
      body: method !== 'GET' ? { data: 'sample' } : undefined,
      query: {},
      ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
      userAgent: 'Mozilla/5.0'
    },
    response: {
      body: statusCode < 400 ? { success: true } : { error: 'Error message' }
    },
    error: level === 'error' ? {
      message: 'Sample error message',
      code: 'SAMPLE_ERROR'
    } : undefined,
    metadata: {
      userId: `user-${Math.floor(Math.random() * 1000)}`,
      environment: 'development'
    }
  };
  
  return log;
}

async function seedDatabase(count = 100) {
  try {
    console.log('🌱 Seeding database...');
    
    // Connect to MongoDB
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log('✅ Connected to MongoDB');
    
    // Generate sample logs
    const logs = Array.from({ length: count }, () => generateSampleLog());
    
    // Insert logs
    const result = await Log.insertMany(logs);
    console.log(`✅ Inserted ${result.length} sample logs`);
    
    // Show summary
    const summary = await Log.aggregate([
      {
        $facet: {
          byLevel: [
            { $group: { _id: '$level', count: { $sum: 1 } } }
          ],
          byService: [
            { $group: { _id: '$service', count: { $sum: 1 } } }
          ]
        }
      }
    ]);
    
    console.log('\n📊 Summary:');
    console.log('\nBy Level:');
    summary[0].byLevel.forEach(item => {
      console.log(`  ${item._id}: ${item.count}`);
    });
    
    console.log('\nBy Service:');
    summary[0].byService.forEach(item => {
      console.log(`  ${item._id}: ${item.count}`);
    });
    
    console.log('\n✅ Database seeding complete!');
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

// Get count from command line args
const count = parseInt(process.argv[2]) || 100;
seedDatabase(count);
