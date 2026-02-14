# Deployment Guide

This guide walks through deploying the Central Logging Service to Google Cloud Run.

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

## Step 2: Prepare Google Cloud Storage (Optional)

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
API_KEYS=your-secure-api-key-1,your-secure-api-key-2
GCS_BUCKET_NAME=your-logging-bucket
GCS_PROJECT_ID=your-project-id
HOT_STORAGE_DAYS=7
COLD_STORAGE_DAYS=90
```

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
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "PORT=8080" \
  --set-env-vars "MONGODB_URI=your-mongodb-uri" \
  --set-env-vars "API_KEYS=your-api-keys" \
  --set-env-vars "GCS_BUCKET_NAME=your-bucket" \
  --set-env-vars "GCS_PROJECT_ID=your-project-id"
```

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

## Step 7: Set Up Log Archiving (Optional)

Create a Cloud Scheduler job to run daily archiving:

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

1. Copy the client library to your API projects:
   ```bash
   cp -r client/ ../your-api-project/
   ```

2. Install dependencies in your API:
   ```bash
   npm install node-fetch uuid
   ```

3. Use the logger in your API:
   ```javascript
   const LogShipper = require('./client/log-shipper');
   
   const logger = new LogShipper({
     serviceUrl: 'https://YOUR_SERVICE_URL',
     apiKey: 'your-api-key',
     serviceName: 'your-api-name'
   });
   
   app.use(logger.middleware());
   ```

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
2. **Archive to GCS** regularly to reduce MongoDB costs
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
- Reduce log retention periods
- Archive more frequently
- Implement sampling for high-volume services

## Security Best Practices

1. **Rotate API keys** regularly
2. **Use VPC connector** for private MongoDB access
3. **Enable authentication** on Cloud Run (remove --allow-unauthenticated)
4. **Audit access** regularly
5. **Don't log sensitive data** (passwords, tokens, credit cards)

## Next Steps

- Set up alerts for error rates
- Create a dashboard for log visualization
- Implement log sampling for high-traffic services
- Set up automated backups of MongoDB
