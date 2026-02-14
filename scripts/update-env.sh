#!/bin/bash

# Update environment variables for deployed Cloud Run service
# Usage: ./update-env.sh

set -e

# Configuration
PROJECT_ID="your-gcp-project-id"
REGION="us-central1"
SERVICE_NAME="central-logging-service"

echo "🔧 Updating environment variables for ${SERVICE_NAME}"
echo ""

# Prompt for MongoDB URI
read -p "MongoDB URI: " MONGODB_URI

# Prompt for API keys (comma-separated)
read -p "API Keys (comma-separated): " API_KEYS

# Prompt for GCS bucket name (optional)
read -p "GCS Bucket Name (optional, press enter to skip): " GCS_BUCKET_NAME

# Build env vars string
ENV_VARS="NODE_ENV=production,PORT=8080,MONGODB_URI=${MONGODB_URI},API_KEYS=${API_KEYS}"

if [ ! -z "$GCS_BUCKET_NAME" ]; then
  ENV_VARS="${ENV_VARS},GCS_BUCKET_NAME=${GCS_BUCKET_NAME},GCS_PROJECT_ID=${PROJECT_ID}"
fi

# Update Cloud Run service
echo ""
echo "📝 Updating Cloud Run service..."
gcloud run services update ${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --set-env-vars "${ENV_VARS}"

echo ""
echo "✅ Environment variables updated successfully!"
echo ""
echo "Verify with:"
echo "  gcloud run services describe ${SERVICE_NAME} --region ${REGION}"
