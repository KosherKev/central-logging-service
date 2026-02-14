# Log Shipper Client

Client library for shipping logs from your APIs to the Central Logging Service.

## Installation

```bash
npm install node-fetch uuid
```

## Usage

### Basic Setup

```javascript
const LogShipper = require('./log-shipper');

const logger = new LogShipper({
  serviceUrl: 'https://your-logging-service.run.app',
  apiKey: 'your-api-key',
  serviceName: 'user-api',
  batchSize: 50,        // Send logs after 50 entries (default)
  flushInterval: 5000   // Or after 5 seconds (default)
});
```

### Manual Logging

```javascript
// Log with custom data
logger.log({
  level: 'info',
  traceId: 'custom-trace-id',
  method: 'POST',
  path: '/api/users',
  statusCode: 201,
  duration: 145,
  request: {
    body: { username: 'john' },
    query: {},
    ip: '192.168.1.1'
  },
  response: {
    body: { id: '123', username: 'john' }
  },
  metadata: {
    userId: 'user123'
  }
});

// Convenience methods
logger.info({ message: 'User logged in', userId: '123' });
logger.warn({ message: 'Rate limit approaching', current: 95 });
logger.error({ message: 'Database connection failed', error: err.message });
logger.debug({ message: 'Processing request', data: someData });
```

### Express Middleware (Recommended)

```javascript
const express = require('express');
const LogShipper = require('./log-shipper');

const app = express();

// Initialize logger
const logger = new LogShipper({
  serviceUrl: 'https://your-logging-service.run.app',
  apiKey: 'your-api-key',
  serviceName: 'user-api'
});

// Use middleware to automatically log all requests/responses
app.use(logger.middleware());

// Your routes
app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

// The middleware automatically logs:
// - Request method, path, headers, body, query
// - Response status code, body
// - Request duration
// - Trace ID (auto-generated or from X-Trace-ID header)
```

### Custom Trace ID

```javascript
// Pass trace ID in request header
const response = await fetch('/api/users', {
  headers: {
    'X-Trace-ID': 'my-custom-trace-id'
  }
});

// Or set it in middleware
app.use((req, res, next) => {
  req.traceId = generateTraceId();
  next();
});
```

### Graceful Shutdown

```javascript
// The logger automatically flushes on process exit
// But you can manually flush if needed:
await logger.flush();

// Or stop the logger completely
await logger.stop();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serviceUrl` | string | `http://localhost:8080` | URL of the central logging service |
| `apiKey` | string | required | API key for authentication |
| `serviceName` | string | `unknown-service` | Name of your service |
| `batchSize` | number | `50` | Number of logs to batch before sending |
| `flushInterval` | number | `5000` | Milliseconds between automatic flushes |
| `enabled` | boolean | `true` | Enable/disable logging |

## Log Entry Format

```typescript
{
  timestamp: string;      // ISO 8601 format
  level: string;          // 'info' | 'warn' | 'error' | 'debug'
  service: string;        // Your service name
  traceId: string;        // Unique request identifier
  method?: string;        // HTTP method
  path?: string;          // Request path
  statusCode?: number;    // HTTP status code
  duration?: number;      // Request duration in ms
  request?: {
    headers?: object;
    body?: any;
    query?: object;
    ip?: string;
    userAgent?: string;
  };
  response?: {
    headers?: object;
    body?: any;
  };
  error?: {
    message?: string;
    stack?: string;
    code?: string;
  };
  metadata?: object;      // Custom metadata
}
```

## Best Practices

1. **Use trace IDs**: Pass the same trace ID across microservices to track requests end-to-end
2. **Don't log sensitive data**: Avoid logging passwords, tokens, credit cards, etc.
3. **Use appropriate log levels**: 
   - `info`: Normal operations
   - `warn`: Potential issues
   - `error`: Actual errors
   - `debug`: Development debugging
4. **Add metadata**: Include userId, sessionId, or other context in metadata
5. **Batch wisely**: Default settings work for most cases, but adjust for high-traffic services

## Error Handling

The logger automatically retries failed log shipments and buffers logs in memory. If the buffer exceeds 10,000 entries, oldest logs are dropped to prevent memory issues.

```javascript
// Logs will be buffered and retried automatically
// No action needed on your part
```

## Disable in Development

```javascript
const logger = new LogShipper({
  // ... config
  enabled: process.env.NODE_ENV === 'production'
});
```

## License

MIT
