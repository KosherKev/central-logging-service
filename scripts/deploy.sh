#!/bin/bash

# Deploy Central Logging Service to Google Cloud Run
# Usage: ./deploy.sh [PROJECT_ID] [REGION]

set -e

# Configuration
PROJECT_ID=${1:-"your-gcp-project-id"}
REGION=${2:-"us-central1"}
SERVICE_NAME="central-logging-service"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🚀 Deploying Central Logging Service"
echo "   Project: ${PROJECT_ID}"
echo "   Region: ${REGION}"
echo "   Service: ${SERVICE_NAME}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found. Please install it first."
    exit 1
fi

# Set project
echo "📝 Setting GCP project..."
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo "🔌 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

echo "🏗️  Building Docker image (linux/amd64)..."
# --platform is required on Apple Silicon (arm64) — Cloud Run runs linux/amd64,
# and a locally-built arm64 image fails at container start with
# "exec format error" (the binary format doesn't match the host CPU).
# No private-registry secret needed — @bevingh/* packages are public on
# npmjs.org now (was previously a BuildKit secret against GitHub Packages).
docker build \
  --platform linux/amd64 \
  -t ${IMAGE_NAME}:latest .

# Push to Google Container Registry
echo "📤 Pushing image to GCR..."
docker push ${IMAGE_NAME}:latest

# Deploy to Cloud Run
echo "☁️  Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 60 \
  --update-env-vars "NODE_ENV=production"

# Get service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo "🌐 Service URL: ${SERVICE_URL}"
echo ""
echo "Next steps:"
echo "1. Set environment variables (MongoDB URI, API keys, etc.) — use --update-env-vars,"
echo "   not --set-env-vars, so you don't wipe whatever is already set on the service:"
echo "   gcloud run services update ${SERVICE_NAME} --region ${REGION} \\"
echo "     --update-env-vars MONGODB_URI=your-mongodb-uri,API_KEYS=your-keys"
echo ""
echo "2. Test the service:"
echo "   curl ${SERVICE_URL}/health"
echo ""
echo "3. Set up Cloud Scheduler for log archiving (optional):"
echo "   gcloud scheduler jobs create http archive-logs \\"
echo "     --schedule='0 2 * * *' \\"
echo "     --uri='${SERVICE_URL}/jobs/archive' \\"
echo "     --http-method=POST"
