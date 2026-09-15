# Deployment Guide

This guide walks through deploying the Central Logging Service to Google Cloud Run.

**Want the fastest path instead?** `README.md` has a one-click "Deploy to
Render" button — paste a MongoDB URI, done, no `gcloud`/Docker required.
Keep reading here if you specifically want Cloud Run, or more control over
the deploy than a one-click button gives you.

## Prerequisites

- Google Cloud Platform account
- `gcloud` CLI installed and configured
- Docker installed (for local building)
- MongoDB Atlas account or self-hosted MongoDB

## Step 1: Set Up MongoDB

### Option A: MongoDB Atlas (Recommended for Cloud Run)

1. Create a free account at https://www.mongodb.com/atlas
2. Create a new cluster
3. Set up database access (username/password)
4. Whitelist all IPs (0.0.0.0/0) for Cloud Run
5. Get your connection string:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/central-logging?retryWrites=true&w=majority
   ```

### Option B: Self-hosted MongoDB

Ensure your MongoDB is accessible from Cloud Run with appropriate network configuration.

## Step 2: Prepare Google Cloud Storage (Optional, NOT CURRENTLY FUNCTIONAL)

**This step doesn't do anything today** — cold-storage archival to GCS was
designed early in this project and descoped the same day; the retention job
only ever deletes old logs from MongoDB, it never uploads them anywhere.
`GCS_BUCKET_NAME`/`GCS_PROJECT_ID` are read nowhere in the codebase. Safe to
skip this step entirely. Left here in case archival gets built later:

For log archiving to GCS:

1. Create a storage bucket:
   ```bash
   gsutil mb -p YOUR_PROJECT_ID -l us-central1 gs://your-logging-bucket
   ```

2. Create a service account:
   ```bash
   gcloud iam service-accounts create logging-service \
     --display-name="Central Logging Service"
   ```

3. Grant permissions:
   ```bash
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:logging-service@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/storage.objectAdmin"
   ```

4. Download key file:
   ```bash
   gcloud iam service-accounts keys create service-account-key.json \
     --iam-account=logging-service@YOUR_PROJECT_ID.iam.gserviceaccount.com
   ```

## Step 3: Configure Environment Variables

Create a `.env` file locally for testing:

```env
PORT=8080
NODE_ENV=production
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/central-logging

# Legacy fallback only — see README.md "Authentication". Real keys come
# from /admin/keys.html once ADMIN_SETUP_TOKEN below is set.
API_KEYS=your-secure-api-key-1,your-secure-api-key-2

# Guards /admin/keys.html — generate with:
#   node -e "console.log('admin_' + require('crypto').randomBytes(24).toString('hex'))"
ADMIN_SETUP_TOKEN=

HOT_STORAGE_DAYS=7
```

(`GCS_BUCKET_NAME`/`GCS_PROJECT_ID`/`COLD_STORAGE_DAYS` omitted — see Step 2,
not currently functional.)

## Step 4: Deploy to Cloud Run

### Automated Deployment

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh YOUR_PROJECT_ID us-central1
```

### Manual Deployment

1. Build the Docker image:
   ```bash
   docker build -t gcr.io/YOUR_PROJECT_ID/central-logging-service .
   ```

2. Push to Google Container Registry:
   ```bash
   docker push gcr.io/YOUR_PROJECT_ID/central-logging-service
   ```

3. Deploy to Cloud Run:
   ```bash
   gcloud run deploy central-logging-service \
     --image gcr.io/YOUR_PROJECT_ID/central-logging-service \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --port 8080 \
     --memory 512Mi \
     --cpu 1 \
     --min-instances 0 \
     --max-instances 10
   ```

## Step 5: Set Environment Variables

```bash
gcloud run services update central-logging-service \
  --region us-central1 \
  --update-env-vars "NODE_ENV=production" \
  --update-env-vars "PORT=8080" \
  --update-env-vars "MONGODB_URI=your-mongodb-uri" \
  --update-env-vars "API_KEYS=your-api-keys" \
  --update-env-vars "ADMIN_SETUP_TOKEN=your-admin-token"
```

Use `--update-env-vars` (not `--set-env-vars`, which wipes anything already
set on the service) — same note as `scripts/deploy.sh`'s own output. Skip
`GCS_BUCKET_NAME`/`GCS_PROJECT_ID` — see Step 2.

Or use the script:
```bash
chmod +x scripts/update-env.sh
./scripts/update-env.sh
```

## Step 6: Verify Deployment

Get your service URL:
```bash
gcloud run services describe central-logging-service \
  --region us-central1 \
  --format 'value(status.url)'
```

Test the health endpoint:
```bash
curl https://YOUR_SERVICE_URL/health
```

Expected response:
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-02-14T10:30:45.123Z",
  "uptime": 123.45,
  "memory": { ... }
}
```

## Step 7: Set Up Log Purging (Optional — "archiving" below is really deletion)

This job **deletes** logs older than `HOT_STORAGE_DAYS`, it doesn't archive
them anywhere (see Step 2 — nothing uploads to GCS). `README.md`'s "Log
Retention & Purging" section documents [cron-job.org](https://cron-job.org)
as the path actually verified working end-to-end; Cloud Scheduler below is
untested but should work the same way (same HTTP endpoint, same auth).

Create a Cloud Scheduler job to run it daily:

```bash
gcloud scheduler jobs create http archive-logs \
  --location us-central1 \
  --schedule="0 2 * * *" \
  --uri="https://YOUR_SERVICE_URL/jobs/archive" \
  --http-method=POST \
  --headers="X-API-Key=your-api-key"
```

Or run manually:
```bash
node src/jobs/archiveOldLogs.js
```

## Step 8: Integrate with Your APIs

Recommended: `@bevingh/telemetry` — one client for logs, metrics, and
health, under one scoped key (needs `logs:write` at least). See
`README.md`'s "Client Integration" section for the full example.

```bash
npm install @bevingh/telemetry
```

```javascript
const { createTelemetryClient } = require('@bevingh/telemetry');
const { createLogMiddleware } = require('@bevingh/telemetry/adapters/express');

const telemetry = createTelemetryClient({
  appId: 'your-api-name',
  collectorUrl: 'https://YOUR_SERVICE_URL',
  apiKey: 'your-api-key', // needs logs:write
});

app.use(createLogMiddleware({ client: telemetry }));
```

`client/log-shipper.js` (this repo, logs only, same flat-key scheme) still
works but is deprecated — see `README.md`'s "Client Integration" section
for its example if you need it, use `@bevingh/telemetry` above instead for
anything new.

## Monitoring and Maintenance

### View Cloud Run Logs
```bash
gcloud run services logs read central-logging-service \
  --region us-central1 \
  --limit 50
```

### Scale the Service
```bash
gcloud run services update central-logging-service \
  --region us-central1 \
  --max-instances 20 \
  --memory 1Gi
```

### Update the Service
After making code changes:
```bash
./scripts/deploy.sh YOUR_PROJECT_ID us-central1
```

## Cost Optimization

1. **Use minimum instances = 0** for cold start (free tier friendly)
2. **Set `HOT_STORAGE_DAYS`** and run the purge job (Step 7) to keep MongoDB from growing unbounded — GCS archival doesn't exist (see Step 2), so this is the only retention lever there is today
3. **Set TTL on MongoDB** to auto-delete old logs
4. **Batch logs** efficiently to reduce Cloud Run invocations

## Troubleshooting

### Service won't start
- Check Cloud Run logs
- Verify MongoDB connection string
- Ensure environment variables are set correctly

### Can't submit logs
- Verify API key is correct
- Check service URL is accessible
- Ensure Content-Type header is set to application/json

### High costs
- Reduce `HOT_STORAGE_DAYS` and run the purge job more frequently
- Implement sampling for high-volume services

## Security Best Practices

1. **Rotate API keys** regularly — `/admin/keys.html`'s "Rotate" button
   (or `POST /admin/keys/:appId/rotate`) does this without a redeploy
2. **Use VPC connector** for private MongoDB access
3. **Enable authentication** on Cloud Run (remove --allow-unauthenticated)
4. **Audit access** regularly
5. **Don't log sensitive data** (passwords, tokens, credit cards)

## Next Steps

- Set up alerts for error rates
- Create a dashboard for log visualization
- Implement log sampling for high-traffic services
- Set up automated backups of MongoDB
