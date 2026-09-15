# Quick Start Guide

Get the Central Logging Service running in 5 minutes.

**Don't want to run anything locally?** Click the "Deploy to Render" button
in `README.md` instead — paste a MongoDB URI, deploy, then skip straight to
step 6 below once it's live. Everything from here through step 5 is the
local/manual alternative.

## 1. Prerequisites

- Node.js 18+ installed
- MongoDB running (local or cloud)
- Git installed

## 2. Clone and Install

```bash
cd /Users/kevinafenyo/Documents/GitHub/central-logging-service
npm install
```

## 3. Run the setup wizard

```bash
npm run setup
```

This asks for a MongoDB connection string (prints a link to MongoDB Atlas's
free tier — signup, get a URI, no card required — if you don't already have
one), writes `.env` for you, generates an admin token for the key-provisioning
UI, and optionally creates your first API key on the spot.

Don't want the wizard? `cp .env.example .env` and fill it in by hand still
works — just remember to also generate an `ADMIN_SETUP_TOKEN`
(`node -e "console.log('admin_' + require('crypto').randomBytes(24).toString('hex'))"`)
and at least one app key via `npm run generate-app-key` (see step 7) before
anything can authenticate.

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

If `npm run setup` created a key for you, use it below in place of
`YOUR_KEY`. Otherwise open `http://localhost:8080/admin/keys.html`, paste
your `ADMIN_SETUP_TOKEN`, and create one with `logs:read` + `logs:write`.

```bash
# Health check
curl http://localhost:8080/health

# Submit test logs
curl -X POST http://localhost:8080/api/v1/logs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
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
  -H "X-API-Key: YOUR_KEY"
```

## 7. Integrate with Your API

Recommended: **`@bevingh/telemetry`**, which reports logs, metrics, and
health through one client and one unified key
(`createTelemetryClient({ appId, collectorUrl, apiKey })`, then
`telemetry.reportLog(entry)` / `logMiddleware()` for Express — see that
package's README). Provision its key with `logs:write` (+ `metrics:write`
if it also reports metrics) via `/admin/keys.html` or `npm run generate-app-key`.

`client/log-shipper.js` in this repo still works (logs only, same flat-key
scheme as before) but is deprecated in favor of `@bevingh/telemetry` — see
that file's header comment. If you're starting a new integration, use
`@bevingh/telemetry` instead:

```javascript
const express = require('express');
const { createTelemetryClient } = require('@bevingh/telemetry');
const { createLogMiddleware } = require('@bevingh/telemetry/adapters/express');

const app = express();

const telemetry = createTelemetryClient({
  appId: 'my-api',
  collectorUrl: 'http://localhost:8080',
  apiKey: 'YOUR_KEY', // needs the logs:write scope
});

app.use(createLogMiddleware({ client: telemetry }));

app.get('/api/test', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(3000);
```

## 8. View Your Logs

```bash
# All logs
curl "http://localhost:8080/api/v1/logs" -H "X-API-Key: YOUR_KEY"

# Error logs only
curl "http://localhost:8080/api/v1/logs?level=error" -H "X-API-Key: YOUR_KEY"

# Stats
curl "http://localhost:8080/api/v1/logs/stats/summary" -H "X-API-Key: YOUR_KEY"
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
- Check the key was issued with the scope the route needs (`logs:read`,
  `logs:write`, `metrics:read`, or `metrics:write`) — list existing keys and
  their scopes at `/admin/keys.html`, or `GET /admin/keys` with
  `Authorization: Bearer <ADMIN_SETUP_TOKEN>`
- A 403 with "not authorized for scope" means the key is valid but missing
  that scope, not that it's wrong — issue a new key or add the scope
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
