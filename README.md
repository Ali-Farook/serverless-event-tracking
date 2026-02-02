# Serverless IoT Platform

This repository contains a serverless IoT platform built with Python (Events Service) and Node.js (Rules Service). This architecture handles device event ingestion, real-time rule evaluation, and automated alerting.

## 🚀 Deployment Instructions

### 1. Prerequisites

Before deploying, ensure you have the following installed and configured:

- **AWS CLI**: [Installed] and [configured].
  - Run `aws configure` to set up your access keys. Make sure the account that you have configured in AWS CLI has access to DynamoDB, SQS, cloudwatch, Lambda, Cloudformation, API Gateway and other aws services
- **Serverless Framework (v3)**: Version 3.x is required.
  - Install: `npm install -g serverless@3`
- **Python (3.11+)**: Must be newer than 3.9. 
- **pip**: Python package installer.
- **Node.js & npm**: Required for the Rules Service.

---

### 2. Deployment Methods

#### Option A: Deploy All (Recommended)
You can deploy all services at once using the deployment script. Make sure to run this command in bash script if you are using windows

```bash
# Default deployment to 'dev' stage
bash deploy.sh

# Deploy to a specific stage
bash deploy.sh --stage dev

bash deploy.sh --stage prod
```

#### Option B: Individual Service Deployment
You can also deploy services individually by navigating to their respective directories.

**Events Service (Python):**
```bash
cd services/events-python
sls deploy --stage dev
```

**Rules Service (Node.js):**
```bash
cd services/rules-node
npm install
sls deploy --stage dev
```

---

## 🛠️ Testing the APIs

You can test the deployed services using `curl` or the provided Postman collection.

### Using Curl

**1. Create an Alert Rule:**
```bash
curl --request POST 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev/rules' \
--header 'Content-Type: application/json' \
--data-raw '{
    "device_id": "sensor-001",
    "metric": "temperature",
    "operator": ">",
    "threshold": 80
}'
```

**2. Ingest a Device Event:**
```bash
curl --request POST 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev/events' \
--header 'Content-Type: application/json' \
--data-raw '{
    "device_id": "sensor-001",
    "type": "temperature",
    "value": 85,
    "ts": 1706659200000
}'
```

**3. Get Device Alerts:**
```bash
curl --request GET 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev/alerts?device_id=sensor-001'
```

### Using Postman
Import the collection from `shared/docs/postman_collection.json` into Postman. Update the `base_url` variable with your service endpoint.

---

## 🧪 Special Test Scenarios

### CloudWatch Alarm & DLQ Test
To test the Dead Letter Queue (DLQ) and associated CloudWatch alarms, send an event with a specific failure-triggering ID:

```bash
curl --request POST 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev/events' \
--header 'Content-Type: application/json' \
--data-raw '{
    "device_id": "FAIL_TEST",
    "type": "temperature",
    "value": 100,
    "ts": 1706659200000
}'
```
*Logic in `handler.js` will force a failure when `device_id` is `FAIL_TEST`, allowing you to verify that the message correctly flows to the DLQ after retries.*

---

## 📂 Project Structure

- `services/events-python`: Python service for event ingestion.
- `services/rules-node`: Node.js service for rule management & evaluation.
- `shared/docs`: Documentation and Postman exports.
