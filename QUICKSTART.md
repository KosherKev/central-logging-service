# Quick Start Guide

Get the Central Logging Service running in 5 minutes.

## 1. Prerequisites

- Node.js 18+ installed
- MongoDB running (local or cloud)
- Git installed

## 2. Clone and Install

```bash
cd /Users/kevinafenyo/Documents/GitHub/central-logging-service
npm install
```

## 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
PORT=8080
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/central-logging
API_KEYS=dev-key-123
```

## 4. Start MongoDB (if local)

```bash
# macOS with Homebrew
brew services start mongodb-community

# Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

## 5. Start the Service

```bash
npm start
```

You should see:
```
╔════════════════════════════════════════════════╗
║   🚀 Central Logging Service                   ║
║   📡 Server running on port 8080               ║
║   🌍 Environment: development                  ║
║   📊 MongoDB: Connected                        ║
╚════════════════════════════════════════════════╝
```

## 6. Test the Service

```bash
# Health check
curl http://localhost:8080/health

# Submit test logs
curl -X POST http://localhost:8080/api/v1/logs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-123" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-02-14T10:30:45.123Z",
        "level": "info",
        "service": "test-api",
        "traceId": "test-123",
        "method": "GET",
        "path": "/test",
        "statusCode": 200,
        "duration": 45
      }
    ]
  }'

# Query logs
curl "http://localhost:8080/api/v1/logs?limit=10" \
  -H "X-API-Key: dev-key-123"
```

## 7. Integrate with Your API

### Install Client Library

```bash
# In your API project
cd ../your-api-project
npm install node-fetch uuid
```

### Copy Client Files

```bash
cp -r ../central-logging-service/client ./
```

### Use in Your Code

```javascript
const express = require('express');
const LogShipper = require('./client/log-shipper');

const app = express();

// Initialize logger
const logger = new LogShipper({
  serviceUrl: 'http://localhost:8080',
  apiKey: 'dev-key-123',
  serviceName: 'my-api'
});

// Add middleware
app.use(logger.middleware());

// Your routes...
app.get('/api/test', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(3000);
```

## 8. View Your Logs

```bash
# All logs
curl "http://localhost:8080/api/v1/logs" -H "X-API-Key: dev-key-123"

# Error logs only
curl "http://localhost:8080/api/v1/logs?level=error" -H "X-API-Key: dev-key-123"

# Stats
curl "http://localhost:8080/api/v1/logs/stats/summary" -H "X-API-Key: dev-key-123"
```

## 9. Next Steps

- Read [API_TESTING.md](./API_TESTING.md) for detailed API documentation
- Read [DEPLOYMENT.md](./DEPLOYMENT.md) to deploy to Google Cloud Run
- Check [examples/](./examples/) for integration examples
- Set up log archiving for production use

## Common Issues

### MongoDB Connection Failed
```bash
# Check if MongoDB is running
mongosh

# Or with Docker
docker ps | grep mongo
```

### Port Already in Use
```bash
# Find process using port 8080
lsof -i :8080

# Kill it
kill -9 <PID>

# Or use a different port
PORT=8081 npm start
```

### API Key Not Working
- Ensure you're using `X-API-Key` header (case-sensitive)
- Check the key matches what's in your `.env` file
- Verify Content-Type is `application/json`

## Development Mode

```bash
# Install nodemon
npm install -g nodemon

# Run with auto-reload
npm run dev
```

## Stop the Service

Press `Ctrl+C` in the terminal running the service.

Stop MongoDB:
```bash
# Homebrew
brew services stop mongodb-community

# Docker
docker stop mongodb
```

## Clean Up

```bash
# Remove node_modules
rm -rf node_modules

# Remove logs from MongoDB
mongosh central-logging --eval "db.logs.deleteMany({})"
```

---

That's it! You now have a fully functional centralized logging service running locally. 🎉

For production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md).
