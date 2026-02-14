# Central Logging Service

A centralized logging service designed to collect, store, and analyze logs from multiple APIs deployed on Google Cloud Run.

## Features

- 📊 **Structured JSON Logging** - Standard log format across all services
- 🔥 **Hot & Cold Storage** - MongoDB for recent logs, Google Cloud Storage for archives
- 🚀 **Batch Processing** - Efficient log ingestion with batching support
- 🔍 **Advanced Querying** - Filter by service, level, time range, trace ID
- 🔐 **API Key Authentication** - Secure log submission
- 📈 **Analytics** - Error rates, performance metrics, aggregations
- ☁️ **Cloud Run Ready** - Optimized for Google Cloud Run deployment

## Architecture

```
Your APIs → Batch Logs → Logging Service (Cloud Run)
                              ↓
                    ┌─────────┴─────────┐
                    ↓                   ↓
              MongoDB (hot)    Google Cloud Storage (cold)
                    ↓
              Query API
                    ↓
              Dashboard App
```

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

Create a `.env` file:

```env
PORT=8080
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/central-logging
API_KEYS=your-api-key-1,your-api-key-2

# Google Cloud Storage (optional)
GCS_BUCKET_NAME=your-logging-bucket
GCS_PROJECT_ID=your-project-id

# Log Retention
HOT_STORAGE_DAYS=7
COLD_STORAGE_DAYS=90
```

### 3. Run the Service

```bash
# Development
npm run dev

# Production
npm start
```

## API Documentation

### Submit Logs

**Endpoint:** `POST /api/v1/logs`

**Headers:**
```
X-API-Key: your-api-key
Content-Type: application/json
```

**Body:**
```json
{
  "logs": [
    {
      "timestamp": "2026-02-14T10:30:45.123Z",
      "level": "info",
      "service": "user-api",
      "traceId": "unique-request-id",
      "method": "POST",
      "path": "/api/users",
      "statusCode": 201,
      "duration": 145,
      "request": {
        "headers": { "content-type": "application/json" },
        "body": { "username": "john" },
        "query": {},
        "ip": "192.168.1.1"
      },
      "response": {
        "body": { "id": "123", "username": "john" }
      },
      "error": null,
      "metadata": {
        "userId": "user123"
      }
    }
  ]
}
```

### Query Logs

**Endpoint:** `GET /api/v1/logs`

**Query Parameters:**
- `service` - Filter by service name
- `level` - Filter by log level (info, warn, error, debug)
- `from` - Start date (ISO 8601)
- `to` - End date (ISO 8601)
- `traceId` - Filter by trace ID
- `limit` - Number of results (default: 100, max: 1000)
- `skip` - Pagination offset

**Example:**
```bash
GET /api/v1/logs?service=user-api&level=error&from=2026-02-14&limit=50
```

### Get Log by Trace ID

**Endpoint:** `GET /api/v1/logs/:traceId`

Returns all logs associated with a specific request trace.

### Get Statistics

**Endpoint:** `GET /api/v1/logs/stats`

**Query Parameters:**
- `service` - Filter by service
- `from` - Start date
- `to` - End date

**Response:**
```json
{
  "totalLogs": 10000,
  "errorRate": 0.02,
  "avgDuration": 145,
  "byLevel": {
    "info": 8500,
    "warn": 1300,
    "error": 200
  },
  "byService": {
    "user-api": 5000,
    "payment-api": 3000,
    "order-api": 2000
  }
}
```

## Client Integration

### Node.js Client Example

```javascript
const LogShipper = require('./log-shipper');

const logger = new LogShipper({
  serviceUrl: 'https://your-logging-service.run.app',
  apiKey: 'your-api-key',
  serviceName: 'user-api',
  batchSize: 50,
  flushInterval: 5000
});

// Log in your Express middleware
app.use((req, res, next) => {
  const start = Date.now();
  const traceId = req.headers['x-trace-id'] || generateId();
  
  res.on('finish', () => {
    logger.log({
      level: res.statusCode >= 400 ? 'error' : 'info',
      traceId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - start,
      request: {
        body: req.body,
        query: req.query,
        headers: req.headers
      }
    });
  });
  
  next();
});
```

## Deployment to Google Cloud Run

### 1. Build Docker Image

```bash
docker build -t gcr.io/YOUR_PROJECT_ID/central-logging-service .
```

### 2. Push to Google Container Registry

```bash
docker push gcr.io/YOUR_PROJECT_ID/central-logging-service
```

### 3. Deploy to Cloud Run

```bash
gcloud run deploy central-logging-service \
  --image gcr.io/YOUR_PROJECT_ID/central-logging-service \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MONGODB_URI=your-mongodb-uri,API_KEYS=your-keys
```

## Log Retention & Archiving

The service automatically:
- Keeps logs in MongoDB for 7 days (configurable)
- Archives logs to Google Cloud Storage after 7 days
- Deletes logs from GCS after 90 days (configurable)

Run the archive job:
```bash
node src/jobs/archiveOldLogs.js
```

Schedule with Cloud Scheduler or cron:
```bash
0 2 * * * node src/jobs/archiveOldLogs.js
```

## Security

- API key authentication for log submission
- Rate limiting to prevent abuse
- Input validation with Joi
- Helmet.js security headers
- CORS configuration

## Performance

- Batch log submission reduces API calls
- Indexed MongoDB queries for fast retrieval
- Compression for reduced bandwidth
- Connection pooling

## License

MIT

## Author

Techknowslogic
