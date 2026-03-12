#!/bin/bash
# deploy.sh
# Script to deploy Fridge Chef AI to Google Cloud Run
# Usage: ./deploy.sh <GCP_PROJECT_ID> <GEMINI_API_KEY>

if [ "$#" -ne 2 ]; then
    echo "Usage: ./deploy.sh <GCP_PROJECT_ID> <GEMINI_API_KEY>"
    exit 1
fi

PROJECT_ID=$1
GEMINI_KEY=$2
REGION="us-central1"
SERVICE_NAME="fridgechef-ai"

echo "=========================================="
echo "🍳 Deploying Fridge Chef AI to Cloud Run"
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "=========================================="

# Ensure gcloud is pointing to the right project
gcloud config set project $PROJECT_ID

# Enable required APIs (Cloud Run, Cloud Build, Artifact Registry, Firestore)
echo "Enabling required GCP APIs..."
gcloud services enable run.googleapis.com \
    cloudbuild.googleapis.com \
    firestore.googleapis.com

# Deploy directly from source to Cloud Run
# This automatically builds the container using Cloud Build and deploys it
echo "Starting deployment..."
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --allow-unauthenticated \
    --port 8080 \
    --set-env-vars="GEMINI_API_KEY=$GEMINI_KEY,PORT=8080"

echo "=========================================="
echo "✅ Deployment Complete!"
echo "Check the URL provided above to access Chef Aika."
