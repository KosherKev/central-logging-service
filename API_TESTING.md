# API Testing Guide

Complete guide for testing the Central Logging Service API.

## Prerequisites

- Service deployed and running
- API key configured
- `curl` or Postman installed

## Base URL

```
Local: http://localhost:8080
Production: https://your-service.run.app
```

## Authentication

All requests (except health check) require an API key in the header:

```
X-API-Key: your-api-key
```

---

## 1. Health Check

**No authentication required**

### Request
```bash
curl http://localhost:8080/health
```

### Response
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-02-14T10:30:45.123Z",
  "uptime": 123.45,
  "memory": {
    "rss": 50331648,
    "heapTotal": 18874368,
    "heapUsed": 12345678,
    "external": 1234567
  }
}
```

---

## 2. Submit Logs (Batch)

### Request
```bash
curl -X POST http://localhost:8080/api/v1/logs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-123" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-02-14T10:30:45.123Z",
        "level": "info",
        "service": "user-api",
        "traceId": "trace-123",
        "method": "POST",
        "path": "/api/users",
        "statusCode": 201,
        "duration": 145,
        "request": {
          "body": { "username": "john" },
          "query": {},
          "ip": "192.168.1.1"
        },
        "response": {
          "body": { "id": "123", "username": "john" }
        },
        "metadata": {
          "userId": "user123"
        }
      },
      {
        "timestamp": "2026-02-14T10:31:00.000Z",
        "level": "error",
        "service": "user-api",
        "traceId": "trace-124",
        "method": "GET",
        "path": "/api/users/999",
        "statusCode": 404,
        "duration": 12,
        "error": {
          "message": "User not found",
          "code": "USER_NOT_FOUND"
        }
      }
    ]
  }'
```

### Response
```json
{
  "success": true,
  "message": "Successfully stored 2 logs",
  "count": 2
}
```

---

## 3. Query Logs

### Basic Query
```bash
curl "http://localhost:8080/api/v1/logs?limit=10" \
  -H "X-API-Key: dev-key-123"
```

### Filter by Service
```bash
curl "http://localhost:8080/api/v1/logs?service=user-api&limit=20" \
  -H "X-API-Key: dev-key-123"
```

### Filter by Log Level
```bash
curl "http://localhost:8080/api/v1/logs?level=error&limit=50" \
  -H "X-API-Key: dev-key-123"
```

### Filter by Date Range
```bash
curl "http://localhost:8080/api/v1/logs?from=2026-02-14T00:00:00Z&to=2026-02-14T23:59:59Z" \
  -H "X-API-Key: dev-key-123"
```

### Filter by Status Code
```bash
curl "http://localhost:8080/api/v1/logs?statusCode=500" \
  -H "X-API-Key: dev-key-123"
```

### Complex Query
```bash
curl "http://localhost:8080/api/v1/logs?service=user-api&level=error&from=2026-02-14T00:00:00Z&limit=100&sortOrder=desc" \
  -H "X-API-Key: dev-key-123"
```

### Response
```json
{
  "success": true,
  "data": [
    {
      "_id": "65d1234567890abcdef12345",
      "timestamp": "2026-02-14T10:30:45.123Z",
      "level": "info",
      "service": "user-api",
      "traceId": "trace-123",
      "method": "POST",
      "path": "/api/users",
      "statusCode": 201,
      "duration": 145,
      "request": { ... },
      "response": { ... },
      "metadata": { ... },
      "createdAt": "2026-02-14T10:30:46.000Z",
      "updatedAt": "2026-02-14T10:30:46.000Z"
    }
  ],
  "pagination": {
    "total": 1234,
    "limit": 100,
    "skip": 0,
    "hasMore": true
  }
}
```

---

## 4. Get Logs by Trace ID

Retrieve all logs for a specific request trace.

### Request
```bash
curl "http://localhost:8080/api/v1/logs/trace-123" \
  -H "X-API-Key: dev-key-123"
```

### Response
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2026-02-14T10:30:45.000Z",
      "level": "info",
      "service": "api-gateway",
      "traceId": "trace-123",
      "path": "/api/users"
    },
    {
      "timestamp": "2026-02-14T10:30:45.050Z",
      "level": "info",
      "service": "user-api",
      "traceId": "trace-123",
      "path": "/users"
    },
    {
      "timestamp": "2026-02-14T10:30:45.100Z",
      "level": "debug",
      "service": "database",
      "traceId": "trace-123",
      "message": "Query executed"
    }
  ],
  "count": 3
}
```

---

## 5. Get Statistics

### Request
```bash
curl "http://localhost:8080/api/v1/logs/stats/summary" \
  -H "X-API-Key: dev-key-123"
```

### With Filters
```bash
curl "http://localhost:8080/api/v1/logs/stats/summary?service=user-api&from=2026-02-14T00:00:00Z&to=2026-02-14T23:59:59Z" \
  -H "X-API-Key: dev-key-123"
```

### Response
```json
{
  "success": true,
  "data": {
    "totalLogs": 10000,
    "errorRate": "2.50",
    "avgDuration": 145.67,
    "byLevel": {
      "info": 8500,
      "warn": 1250,
      "error": 250,
      "debug": 0
    },
    "byService": {
      "user-api": 5000,
      "payment-api": 3000,
      "order-api": 2000
    },
    "byStatusCode": {
      "200": 7000,
      "201": 1500,
      "400": 800,
      "404": 450,
      "500": 250
    }
  }
}
```

---

## Error Responses

### Invalid API Key (401)
```json
{
  "success": false,
  "error": "Missing API key. Include X-API-Key header."
}
```

### Rate Limit Exceeded (429)
```json
{
  "success": false,
  "error": "Rate limit exceeded. Please try again later.",
  "retryAfter": 45
}
```

### Validation Error (400)
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "logs.0.level",
      "message": "\"level\" must be one of [info, warn, error, debug]"
    }
  ]
}
```

### Not Found (404)
```json
{
  "success": false,
  "error": "No logs found for this trace ID"
}
```

### Server Error (500)
```json
{
  "success": false,
  "error": "Failed to store logs"
}
```

---

## Postman Collection

Import this collection into Postman for easier testing:

```json
{
  "info": {
    "name": "Central Logging Service",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "base_url",
      "value": "http://localhost:8080"
    },
    {
      "key": "api_key",
      "value": "dev-key-123"
    }
  ],
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "header": [],
        "url": "{{base_url}}/health"
      }
    },
    {
      "name": "Submit Logs",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "X-API-Key",
            "value": "{{api_key}}"
          },
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"logs\": [\n    {\n      \"timestamp\": \"2026-02-14T10:30:45.123Z\",\n      \"level\": \"info\",\n      \"service\": \"user-api\",\n      \"traceId\": \"trace-123\",\n      \"method\": \"POST\",\n      \"path\": \"/api/users\",\n      \"statusCode\": 201,\n      \"duration\": 145\n    }\n  ]\n}"
        },
        "url": "{{base_url}}/api/v1/logs"
      }
    },
    {
      "name": "Query Logs",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "X-API-Key",
            "value": "{{api_key}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/v1/logs?limit=10",
          "host": ["{{base_url}}"],
          "path": ["api", "v1", "logs"],
          "query": [
            {
              "key": "limit",
              "value": "10"
            }
          ]
        }
      }
    },
    {
      "name": "Get Stats",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "X-API-Key",
            "value": "{{api_key}}"
          }
        ],
        "url": "{{base_url}}/api/v1/logs/stats/summary"
      }
    }
  ]
}
```

---

## Performance Testing

### Load Test with Apache Bench

```bash
# Install Apache Bench
# macOS: already installed
# Ubuntu: sudo apt-get install apache2-utils

# Test submitting logs
ab -n 1000 -c 10 -T 'application/json' -H 'X-API-Key: dev-key-123' \
  -p test-payload.json \
  http://localhost:8080/api/v1/logs
```

Create `test-payload.json`:
```json
{
  "logs": [
    {
      "timestamp": "2026-02-14T10:30:45.123Z",
      "level": "info",
      "service": "load-test",
      "traceId": "trace-test",
      "method": "GET",
      "path": "/test"
    }
  ]
}
```

### Expected Performance

- **Latency**: < 100ms for log submission
- **Throughput**: > 1000 logs/second
- **Batch size**: 50-100 logs per request optimal

---

## Troubleshooting

### Connection Refused
- Ensure service is running: `curl http://localhost:8080/health`
- Check port configuration

### Authentication Failed
- Verify API key is correct
- Check header name is `X-API-Key` (case-sensitive)

### Slow Queries
- Add indexes to MongoDB
- Reduce query range
- Use pagination

### High Error Rate
- Check MongoDB connection
- Verify schema validation
- Check service logs
