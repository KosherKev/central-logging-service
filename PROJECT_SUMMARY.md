# Central Logging Service - Project Summary

## 🎯 Overview

A production-ready, centralized logging service designed for collecting, storing, and analyzing logs from multiple APIs deployed on Google Cloud Run. Built with Node.js, Express, MongoDB, and Google Cloud Storage.

## 📁 Project Structure

```
central-logging-service/
├── 📄 README.md                    # Main documentation
├── 📄 QUICKSTART.md                # 5-minute setup guide
├── 📄 DEPLOYMENT.md                # Cloud Run deployment guide
├── 📄 API_TESTING.md               # Complete API testing documentation
├── 📄 package.json                 # Node.js dependencies
├── 📄 Dockerfile                   # Docker container configuration
├── 📄 .env.example                 # Environment variables template
├── 📄 .gitignore                   # Git ignore rules
├── 📄 .dockerignore                # Docker ignore rules
│
├── 📂 src/                         # Application source code
│   ├── 📄 server.js                # Main Express application
│   │
│   ├── 📂 config/                  # Configuration files
│   │   ├── index.js                # Environment configuration
│   │   └── database.js             # MongoDB connection
│   │
│   ├── 📂 models/                  # Database models
│   │   └── Log.js                  # Log schema and indexes
│   │
│   ├── 📂 routes/                  # API routes
│   │   ├── logs.js                 # Log submission and query endpoints
│   │   └── health.js               # Health check endpoints
│   │
│   ├── 📂 middleware/              # Express middleware
│   │   ├── auth.js                 # API key authentication
│   │   ├── rateLimit.js            # Rate limiting
│   │   ├── validation.js           # Request validation with Joi
│   │   └── errorHandler.js         # Global error handling
│   │
│   ├── 📂 services/                # Business logic services
│   │   └── storageService.js       # Google Cloud Storage integration
│   │
│   ├── 📂 jobs/                    # Background jobs
│   │   └── archiveOldLogs.js       # Log archiving job
│   │
│   └── 📂 utils/                   # Utility functions
│
├── 📂 client/                      # Client library for APIs
│   ├── 📄 log-shipper.js           # Log shipping client
│   ├── 📄 package.json             # Client dependencies
│   └── 📄 README.md                # Client usage documentation
│
├── 📂 examples/                    # Integration examples
│   ├── express-integration.js      # Express API example
│   └── batch-job-logging.js        # Batch processing example
│
└── 📂 scripts/                     # Deployment scripts
    ├── deploy.sh                   # Cloud Run deployment script
    └── update-env.sh               # Environment update script
```

## ✨ Key Features

### 1. **Centralized Log Collection**
- Batch log submission (up to 1000 logs per request)
- Automatic retry with buffering
- Support for multiple services

### 2. **Structured JSON Logging**
- Standardized log format
- Request/response payload tracking
- Error stack traces
- Custom metadata support

### 3. **Hot & Cold Storage**
- MongoDB for recent logs (7 days default)
- Google Cloud Storage for archives (90 days default)
- Automatic archiving job
- TTL-based auto-deletion

### 4. **Advanced Querying**
- Filter by service, level, date range, status code
- Trace ID-based request tracking
- Pagination support
- Aggregated statistics

### 5. **Security & Performance**
- API key authentication
- Rate limiting (100 requests/minute)
- Request validation with Joi
- Compression and helmet.js
- MongoDB indexes for fast queries

### 6. **Cloud Run Optimized**
- Containerized with Docker
- Health checks and readiness probes
- Graceful shutdown
- Auto-scaling support

## 🚀 Getting Started

### Quick Local Setup (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI and API keys

# 3. Start the service
npm start

# 4. Test it
curl http://localhost:8080/health
```

### Deploy to Cloud Run (10 minutes)

```bash
# Make script executable
chmod +x scripts/deploy.sh

# Deploy
./scripts/deploy.sh YOUR_PROJECT_ID us-central1

# Update environment variables
./scripts/update-env.sh
```

## 📊 API Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/health` | GET | Health check | ❌ |
| `/ready` | GET | Readiness check | ❌ |
| `/api/v1/logs` | POST | Submit logs | ✅ |
| `/api/v1/logs` | GET | Query logs | ✅ |
| `/api/v1/logs/:traceId` | GET | Get logs by trace ID | ✅ |
| `/api/v1/logs/stats/summary` | GET | Get statistics | ✅ |

## 🔑 Authentication

All API requests (except health checks) require an API key:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:8080/api/v1/logs
```

## 💻 Client Integration

### Install Client Library

```bash
npm install node-fetch uuid
cp -r client/ ../your-api-project/
```

### Use in Your API

```javascript
const LogShipper = require('./client/log-shipper');

const logger = new LogShipper({
  serviceUrl: 'https://your-logging-service.run.app',
  apiKey: 'your-api-key',
  serviceName: 'user-api'
});

// Automatic logging middleware
app.use(logger.middleware());

// Manual logging
logger.info({ message: 'User logged in', userId: '123' });
logger.error({ message: 'Database error', error: err });
```

## 📈 Log Format

```json
{
  "timestamp": "2026-02-14T10:30:45.123Z",
  "level": "info|warn|error|debug",
  "service": "user-api",
  "traceId": "unique-request-id",
  "method": "POST",
  "path": "/api/users",
  "statusCode": 201,
  "duration": 145,
  "request": {
    "headers": {},
    "body": {},
    "query": {},
    "ip": "192.168.1.1"
  },
  "response": {
    "body": {}
  },
  "error": {
    "message": "",
    "stack": "",
    "code": ""
  },
  "metadata": {}
}
```

## 🔧 Configuration

### Environment Variables

```env
PORT=8080
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/central-logging
API_KEYS=key1,key2,key3
GCS_BUCKET_NAME=your-bucket
GCS_PROJECT_ID=your-project
HOT_STORAGE_DAYS=7
COLD_STORAGE_DAYS=90
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

## 🎛️ Maintenance

### Run Archive Job Manually

```bash
node src/jobs/archiveOldLogs.js
```

### Set Up Automated Archiving (Cloud Scheduler)

```bash
gcloud scheduler jobs create http archive-logs \
  --schedule="0 2 * * *" \
  --uri="https://YOUR_SERVICE_URL/jobs/archive" \
  --http-method=POST \
  --headers="X-API-Key=your-api-key"
```

## 📊 Monitoring

### View Logs
```bash
# Cloud Run logs
gcloud run services logs read central-logging-service --region us-central1

# MongoDB queries
mongosh central-logging --eval "db.logs.find().limit(10)"
```

### Performance Metrics
- Target latency: < 100ms
- Target throughput: > 1000 logs/second
- Recommended batch size: 50-100 logs

## 🔐 Security Best Practices

1. ✅ Rotate API keys regularly
2. ✅ Use HTTPS in production
3. ✅ Don't log sensitive data (passwords, tokens, credit cards)
4. ✅ Enable VPC connector for private MongoDB
5. ✅ Set up alerts for error rates
6. ✅ Regular security audits

## 💰 Cost Optimization

1. **Cloud Run**: 
   - Use min-instances=0 for free tier
   - Set appropriate memory (512Mi default)
   
2. **MongoDB**:
   - Archive to GCS regularly
   - Set TTL for auto-deletion
   - Use MongoDB Atlas free tier for dev

3. **Google Cloud Storage**:
   - Very cheap ($0.020/GB/month)
   - Auto-delete old archives
   - Use lifecycle policies

## 📚 Documentation

- **[README.md](./README.md)** - Main documentation and features
- **[QUICKSTART.md](./QUICKSTART.md)** - 5-minute setup guide
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Production deployment guide
- **[API_TESTING.md](./API_TESTING.md)** - Complete API reference
- **[client/README.md](./client/README.md)** - Client library usage

## 🤝 Integration Examples

- **[express-integration.js](./examples/express-integration.js)** - Express API integration
- **[batch-job-logging.js](./examples/batch-job-logging.js)** - Batch processing example

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB (hot storage)
- **Storage**: Google Cloud Storage (cold storage)
- **Validation**: Joi
- **Security**: Helmet.js, CORS
- **Deployment**: Docker, Google Cloud Run

## 📦 Dependencies

### Core
- express - Web framework
- mongoose - MongoDB ODM
- @google-cloud/storage - GCS client
- dotenv - Environment management

### Security & Validation
- helmet - Security headers
- cors - Cross-origin requests
- joi - Schema validation

### Utilities
- uuid - Unique ID generation
- compression - Response compression
- winston - Internal logging

## 🎯 Use Cases

1. **Multi-API Logging** - Collect logs from microservices
2. **Request Tracing** - Track requests across services
3. **Error Monitoring** - Centralized error tracking
4. **Performance Analysis** - Duration and response time metrics
5. **Audit Logging** - Compliance and security audits
6. **Debugging** - Trace issues across distributed systems

## 🚦 Status

- ✅ Production-ready
- ✅ Fully documented
- ✅ Docker containerized
- ✅ Cloud Run optimized
- ✅ Client library included
- ✅ Example integrations provided

## 📝 License

MIT License - See package.json

## 👨‍💻 Author

Techknowslogic

## 🙏 Acknowledgments

Built for managing logs across multiple APIs deployed on Google Cloud Run, with a focus on simplicity, performance, and cost-effectiveness.

---

**Next Steps:**
1. Read [QUICKSTART.md](./QUICKSTART.md) for local setup
2. Read [DEPLOYMENT.md](./DEPLOYMENT.md) for Cloud Run deployment
3. Check [API_TESTING.md](./API_TESTING.md) for API reference
4. Review [examples/](./examples/) for integration patterns
