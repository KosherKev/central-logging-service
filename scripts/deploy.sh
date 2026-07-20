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

# Build Docker image (BuildKit secret for GitHub Packages — token file is never committed)
# Place a read:packages PAT in .secrets/npm_token (gitignored), or override NPM_TOKEN_FILE.
# Generate: https://github.com/settings/tokens/new?scopes=read:packages
NPM_TOKEN_FILE=${NPM_TOKEN_FILE:-"$(dirname "$0")/../.secrets/npm_token"}
if [ ! -f "${NPM_TOKEN_FILE}" ]; then
    echo "❌ Missing GitHub Packages token file: ${NPM_TOKEN_FILE}"
    echo "   Create a read:packages-only PAT and write it to that path (never commit it)."
    echo "   Example: mkdir -p .secrets && printf '%s' \"\$TOKEN\" > .secrets/npm_token && chmod 600 .secrets/npm_token"
    exit 1
fi

echo "🏗️  Building Docker image (DOCKER_BUILDKIT=1, secret id=npm_token)..."
DOCKER_BUILDKIT=1 docker build \
  --secret id=npm_token,src="${NPM_TOKEN_FILE}" \
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
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 60 \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "PORT=8080"

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
echo "1. Set environment variables (MongoDB URI, API keys, etc.):"
echo "   gcloud run services update ${SERVICE_NAME} --region ${REGION} \\"
echo "     --set-env-vars MONGODB_URI=your-mongodb-uri,API_KEYS=your-keys"
echo ""
echo "2. Test the service:"
echo "   curl ${SERVICE_URL}/health"
echo ""
echo "3. Set up Cloud Scheduler for log archiving (optional):"
echo "   gcloud scheduler jobs create http archive-logs \\"
echo "     --schedule='0 2 * * *' \\"
echo "     --uri='${SERVICE_URL}/jobs/archive' \\"
echo "     --http-method=POST"
