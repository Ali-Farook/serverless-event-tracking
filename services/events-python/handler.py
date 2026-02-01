import json
import time
import uuid
import boto3
import os
from decimal import Decimal

QUEUE_URL = os.environ['EVENTS_QUEUE_URL']

dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')
events_table = dynamodb.Table(os.environ['EVENTS_TABLE'])

# ========== VALIDATION ==========

def validate_event(body):
    """Simple validation without Pydantic"""
    errors = []
    
    # Check required fields
    required_fields = ['device_id', 'type', 'value', 'ts']
    for field in required_fields:
        if field not in body:
            errors.append(f'Missing required field: {field}')
            return errors  # Return early if missing
    
    # device_id
    device_id = str(body['device_id']).strip()
    if not device_id:
        errors.append('device_id cannot be empty')
    
    # type
    event_type = str(body['type']).strip()
    if not event_type:
        errors.append('type cannot be empty')
    
    # value - MUST BE INTEGER, NOT FLOAT
    try:
        value = body['value']
        
        # Check if it's a float string like "60.5"
        if isinstance(value, str) and '.' in value:
            errors.append('value must be an integer, not float')
        # Check if it's a float
        elif isinstance(value, float):
            if not value.is_integer():
                errors.append('value must be an integer, not float')
            value = int(value)
        # Convert to int
        else:
            value = int(value)
        
        # Store validated value
        if not errors:
            body['value'] = value
            
    except (ValueError, TypeError):
        errors.append('value must be a valid integer')
    
    # Validate timestamp
    try:
        timestamp = int(body['ts'])
        body['ts'] = timestamp
    except (ValueError, TypeError):
        errors.append('ts must be a valid integer timestamp')
    
    return errors

# ========== HELPER FUNCTION ==========

def convert_decimals(obj):
    """Convert Decimal to int for JSON serialization"""
    if isinstance(obj, Decimal):
        return int(obj)
    elif isinstance(obj, list):
        return [convert_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    return obj

# ========== LAMBDA HANDLERS ==========

def post_event(event, context):
    """POST /events handler"""
    try:
        body = json.loads(event.get('body', '{}'))
        
        # Validate with simple validation
        errors = validate_event(body)
        if errors:
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'error': 'Validation failed',
                    'details': errors
                })
            }
        
        device_id = str(body['device_id']).strip()
        event_type = str(body['type']).strip()
        value = body['value'] 
        timestamp = body['ts'] 
        
        request_id = str(uuid.uuid4())
        event_id = str(uuid.uuid4())
        
        item = {
            'PK': f'DEVICE#{device_id}',
            'SK': timestamp,
            'event_id': event_id,
            'type': event_type,
            'value': value,
            'raw': json.dumps(body),
            'ingested_at': int(time.time() * 1000),
            'request_id': request_id
        }

        events_table.put_item(Item=item)
        
        sqs_message = {
            'device_id': device_id,
            'event_id': event_id,
            'type': event_type,
            'value': value,
            'timestamp': timestamp,
            'evaluated_at': int(time.time() * 1000)
        }

        sqs.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps(sqs_message)
        )
        
        print(json.dumps({
            'level': 'INFO',
            'action': 'event_ingested',
            'device_id': device_id,
            'event_id': event_id,
            'request_id': request_id
        }))
        
        return {
            'statusCode': 201,
            'body': json.dumps({
                'message': 'Event ingested successfully',
                'event_id': event_id,
                'request_id': request_id
            })
        }
        
    except Exception as e:
        print(json.dumps({
            'level': 'ERROR',
            'error': str(e),
            'action': 'event_ingestion_failed'
        }))
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error'})
        }

def get_device_events(event, context):
    """GET /devices/{device_id}/events handler"""
    try:
        device_id = event['pathParameters']['device_id']
        
        query_params = event.get('queryStringParameters') or {}
        start_time = query_params.get('start_time')
        end_time = query_params.get('end_time')
        
        key_condition = 'PK = :pk'
        expression_values = {':pk': f'DEVICE#{device_id}'}
        
        if start_time and end_time:
            key_condition += ' AND SK BETWEEN :start AND :end'
            expression_values[':start'] = int(start_time)
            expression_values[':end'] = int(end_time)
        
        response = events_table.query(
            KeyConditionExpression=key_condition,
            ExpressionAttributeValues=expression_values,
            Limit=100
        )
        
        items = convert_decimals(response.get('Items', []))
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'device_id': device_id,
                'events': items,
                'count': len(items)
            })
        }
        
    except Exception as e:
        print(json.dumps({
            'level': 'ERROR',
            'error': str(e),
            'action': 'get_events_failed'
        }))
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error'})
        }