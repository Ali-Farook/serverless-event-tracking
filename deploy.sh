#!/bin/bash

# Exit immediately if a command fails
set -e

# Default stage
STAGE="dev"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--stage dev|prod]"
      exit 1
      ;;
  esac
done

# Validate stage
if [[ "$STAGE" != "dev" && "$STAGE" != "prod" ]]; then
  echo "Error: Stage must be 'dev' or 'prod'"
  exit 1
fi

echo "=============================="
echo "Deploying to stage: $STAGE"
echo "=============================="

echo ""
echo "=============================="
echo "Deploying events-python service"
echo "=============================="

# Navigate to events-python
cd services/events-python

# Deploy with Serverless
echo "Deploying events-python..."
sls deploy --stage $STAGE

echo ""
echo "=============================="
echo "Deploying rules-node service"
echo "=============================="

# Navigate to rules-node
cd ../rules-node

# Install dependencies (aws-sdk, zod, uuid)
echo "Installing Node dependencies..."
npm install

# Deploy with Serverless
echo "Deploying rules-node..."
sls deploy --stage $STAGE

echo ""
echo "=============================="
echo "All services deployed successfully to $STAGE!"
echo "=============================="