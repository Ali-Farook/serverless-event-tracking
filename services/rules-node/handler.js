const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const rulesTable = process.env.RULES_TABLE;
const eventsTable = process.env.EVENTS_TABLE;
const alertTable = process.env.ALERTS_TABLE;

const ruleSchema = z.object({
  device_id: z.string().min(1, "Device ID is required"),
  metric: z.string().min(1, "Metric is required"),
  operator: z.enum(['>', '<', '>=', '<=', '=='], {
    errorMap: () => ({ message: "Operator must be one of: >, <, >=, <=, ==" })
  }),
  threshold: z.number()
    .int("Threshold must be an integer, not a float")
    .min(0, "Threshold must be a positive number"),
  enabled: z.boolean().optional().default(true)
});

module.exports.createRule = async (event) => {
  try {
    const body = JSON.parse(event.body);

    const parsed = ruleSchema.safeParse(body);

    if (!parsed.success) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Validation failed',
          details: parsed.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        })
      };
    }

    const ruleId = uuidv4();
    const rule = {
      PK: `RULE#${ruleId}`,
      rule_id: ruleId,
      ...parsed.data,
      created_at: Date.now()
    };

    await dynamodb.put({
      TableName: rulesTable,
      Item: rule
    }).promise();

    console.log(JSON.stringify({
      level: 'INFO',
      action: 'rule_created',
      rule_id: ruleId,
      device_id: body.device_id
    }));

    return {
      statusCode: 201,
      body: JSON.stringify({
        message: 'Rule created successfully',
        rule_id: ruleId,
        rule
      })
    };

  } catch (error) {
    console.error('Error creating rule:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

module.exports.listRules = async (event) => {
  try {
    const deviceId = event.queryStringParameters?.device_id;

    let rules;
    if (deviceId) {
      // device_id using GSI
      const result = await dynamodb.query({
        TableName: rulesTable,
        IndexName: 'DeviceIdIndex',
        KeyConditionExpression: 'device_id = :device_id',
        ExpressionAttributeValues: {
          ':device_id': deviceId
        }
      }).promise();
      rules = result.Items || [];
    } else {
      const result = await dynamodb.scan({
        TableName: rulesTable,
        Limit: 100
      }).promise();
      rules = result.Items || [];
    }

    const enabledRules = rules.filter(rule => rule.enabled !== false);

    return {
      statusCode: 200,
      body: JSON.stringify({
        rules: enabledRules,
        count: enabledRules.length
      })
    };

  } catch (error) {
    console.error('Error listing rules:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

module.exports.evaluateAlerts = async (event) => {
  const failedMessageIds = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);

      // For Testing of DLQ and Cloudwatch Alarm
      if (message.device_id === 'FAIL_TEST') {
        throw new Error('Forced failure for DLQ testing - device_id: FAIL_TEST');
      }

      // Get rules for this device
      const rulesResult = await dynamodb.query({
        TableName: rulesTable,
        IndexName: 'DeviceIdIndex',
        KeyConditionExpression: 'device_id = :device_id',
        FilterExpression: 'enabled = :enabled',
        ExpressionAttributeValues: {
          ':device_id': message.device_id,
          ':enabled': true
        }
      }).promise();

      const rules = rulesResult.Items || [];

      // Evaluate rules
      for (const rule of rules) {
        if (rule.metric === message.type) {
          const triggered = evaluateRule(rule, message.value);

          if (triggered) {
            console.log(JSON.stringify({
              level: 'ALERT',
              action: 'alert_triggered',
              device_id: message.device_id,
              rule_id: rule.rule_id,
              metric: rule.metric,
              value: message.value,
              threshold: rule.threshold,
              operator: rule.operator,
              timestamp: Date.now()
            }));

            // Add the alert into alerts table
            await dynamodb.put({
              TableName: alertTable,
              Item: {
                PK: `DEVICE#${message.device_id}`,
                SK: Date.now(),
                rule_id: rule.rule_id,
                metric: rule.metric,
                value: message.value,
                threshold: rule.threshold
              }
            }).promise();
          }
        }
      }

    } catch (error) {
      console.error('Error processing SQS message:', error, record);
      failedMessageIds.push(record.messageId);
    }
  }

  return {
    batchItemFailures: failedMessageIds.map(id => ({ itemIdentifier: id }))
  };
};

function evaluateRule(rule, value) {
  const threshold = Number(rule.threshold);
  const actualValue = Number(value);

  switch (rule.operator) {
    case '>': return actualValue > threshold;
    case '<': return actualValue < threshold;
    case '>=': return actualValue >= threshold;
    case '<=': return actualValue <= threshold;
    case '==': return actualValue === threshold;
    default: return false;
  }
}

module.exports.getAlerts = async (event) => {
  try {
    const deviceId = event.queryStringParameters?.device_id;
    
    if (!deviceId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'device_id parameter is required' })
      };
    }

    const result = await dynamodb.query({
      TableName: alertTable,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `DEVICE#${deviceId}`
      },
      ScanIndexForward: false,  // Most recent first
      Limit: 50
    }).promise();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        alerts: result.Items || [],
        count: result.Items?.length || 0
      })
    };

  } catch (error) {
    console.error('Error getting alerts:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
