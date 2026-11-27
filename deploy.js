// Cria toda a infraestrutura no LocalStack. Pode ser executado várias vezes.
const crypto = require('crypto');
const path = require('path');
const AdmZip = require('adm-zip');
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketNotificationConfigurationCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { SNSClient, CreateTopicCommand, SubscribeCommand } = require('@aws-sdk/client-sns');
const {
  LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand,
  GetFunctionCommand, ListEventSourceMappingsCommand, CreateEventSourceMappingCommand,
  waitUntilFunctionActiveV2, waitUntilFunctionUpdatedV2,
} = require('@aws-sdk/client-lambda');
const {
  APIGatewayClient, GetRestApiCommand, CreateRestApiCommand, GetResourcesCommand, CreateResourceCommand,
  PutMethodCommand, PutIntegrationCommand, CreateDeploymentCommand,
} = require('@aws-sdk/client-api-gateway');

const REGION = 'us-east-1';
const cfg = {
  region: REGION,
  endpoint: process.env.AWS_ENDPOINT || 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client({ ...cfg, forcePathStyle: true });
const ddb = new DynamoDBClient(cfg);
const sqs = new SQSClient(cfg);
const sns = new SNSClient(cfg);
const lambda = new LambdaClient(cfg);
const apigw = new APIGatewayClient(cfg);

const BUCKET = 'meu-bucket';
const OUTPUT_BUCKET = 'meu-bucket-processado';
const API_ID = 'cloudlens'; // id fixo (tag _custom_id_ do LocalStack)

async function ensureTable(name, ...keys) {
  try { await ddb.send(new DescribeTableCommand({ TableName: name })); return; }
  catch (e) { if (e.name !== 'ResourceNotFoundException') throw e; }
  await ddb.send(new CreateTableCommand({
    TableName: name,
    KeySchema: keys.map((k, i) => ({ AttributeName: k, KeyType: i ? 'RANGE' : 'HASH' })),
    AttributeDefinitions: keys.map(k => ({ AttributeName: k, AttributeType: 'S' })),
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await waitUntilTableExists({ client: ddb, maxWaitTime: 60 }, { TableName: name });
}

async function ensureQueue(name, attributes) {
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name }));
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl, Attributes: attributes }));
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }));
  return Attributes.QueueArn;
}

async function ensureFunction(name, handler, ZipFile, Variables) {
  const config = { FunctionName: name, Handler: handler, Timeout: 20, MemorySize: 512, Environment: { Variables } };
  const wait = { client: lambda, maxWaitTime: 180 };
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: name }));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile }));
    await waitUntilFunctionUpdatedV2(wait, { FunctionName: name });
    await lambda.send(new UpdateFunctionConfigurationCommand(config));
    await waitUntilFunctionUpdatedV2(wait, { FunctionName: name });
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await lambda.send(new CreateFunctionCommand({
      ...config, Runtime: 'nodejs20.x', Code: { ZipFile },
      Role: 'arn:aws:iam::000000000000:role/lambda-role', // LocalStack aceita qualquer role
    }));
    await waitUntilFunctionActiveV2(wait, { FunctionName: name });
  }
  console.log(`  Lambda ${name}`);
  return `arn:aws:lambda:${REGION}:000000000000:function:${name}`;
}

async function ensureTrigger(FunctionName, EventSourceArn) {
  const { EventSourceMappings } = await lambda.send(new ListEventSourceMappingsCommand({ FunctionName, EventSourceArn }));
  if (!EventSourceMappings.length)
    await lambda.send(new CreateEventSourceMappingCommand({ FunctionName, EventSourceArn, BatchSize: 1 }));
}

async function ensureApi(routes) {
  try { await apigw.send(new GetRestApiCommand({ restApiId: API_ID })); }
  catch (e) {
    if (e.name !== 'NotFoundException') throw e;
    await apigw.send(new CreateRestApiCommand({ name: 'cloudlens-api', binaryMediaTypes: ['*/*'], tags: { _custom_id_: API_ID } }));
  }
  const resources = async () => (await apigw.send(new GetResourcesCommand({ restApiId: API_ID, limit: 500 }))).items;
  for (const [route, functionArn] of Object.entries(routes)) {
    let items = await resources();
    let parent = items.find(r => r.path === '/');
    let current = '';
    for (const part of route.split('/').filter(Boolean)) {
      current += '/' + part;
      let found = items.find(r => r.path === current);
      if (!found) {
        found = await apigw.send(new CreateResourceCommand({ restApiId: API_ID, parentId: parent.id, pathPart: part }));
        items = await resources();
      }
      parent = found;
    }
    const method = { restApiId: API_ID, resourceId: parent.id, httpMethod: 'ANY' };
    // Sem Lambda Authorizer: no teste com LocalStack 3.8 Community ele não foi aplicado. As Lambdas validam o JWT.
    try { await apigw.send(new PutMethodCommand({ ...method, authorizationType: 'NONE' })); }
    catch (e) { if (e.name !== 'ConflictException') throw e; }
    await apigw.send(new PutIntegrationCommand({
      ...method, type: 'AWS_PROXY', integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${functionArn}/invocations`,
    }));
  }
  await apigw.send(new CreateDeploymentCommand({ restApiId: API_ID, stageName: 'dev' }));
}

async function main() {
  for (const Bucket of [BUCKET, OUTPUT_BUCKET]) {
    try { await s3.send(new HeadBucketCommand({ Bucket })); }
    catch { await s3.send(new CreateBucketCommand({ Bucket })); }
  }
  await ensureTable('usuarios', 'email');
  await ensureTable('imagens', 'userId', 'imageKey');
  await ensureTable('notificacoes', 'userId', 'notificationId');
  console.log('  S3 e DynamoDB prontos');

  // Visibility timeout curto (30 s) para a DLQ aparecer durante a demonstração.
  const dlqArn = await ensureQueue('fila-processamento-dlq', { VisibilityTimeout: '30' });
  const processArn = await ensureQueue('fila-processamento', {
    VisibilityTimeout: '30',
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: '3' }),
  });
  const notifyArn = await ensureQueue('fila-notificacoes', { VisibilityTimeout: '30' });
  const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: 'imagem-processada' }));
  await sns.send(new SubscribeCommand({ TopicArn, Protocol: 'sqs', Endpoint: notifyArn }));
  console.log('  SQS e SNS prontos');

  const zip = new AdmZip();
  zip.addLocalFolder(path.join(__dirname, 'lambda'));
  const code = zip.toBuffer();
  const env = {
    BUCKET, OUTPUT_BUCKET, TOPIC_ARN: TopicArn,
    USERS_TABLE: 'usuarios', IMAGES_TABLE: 'imagens', NOTIFICATIONS_TABLE: 'notificacoes',
  };
  const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'); // nunca vai para o Git

  const auth = await ensureFunction('auth', 'auth.handler', code, { ...env, JWT_SECRET });
  const files = await ensureFunction('arquivos', 'arquivos.handler', code, { ...env, JWT_SECRET });
  await ensureFunction('processa-imagem', 'index.handler', code, env);
  await ensureFunction('registra-falha', 'falha.handler', code, env);
  await ensureFunction('notifica', 'notifica.handler', code, env);

  await ensureTrigger('processa-imagem', processArn);
  await ensureTrigger('registra-falha', dlqArn);
  await ensureTrigger('notifica', notifyArn);
  await s3.send(new PutBucketNotificationConfigurationCommand({
    Bucket: BUCKET,
    NotificationConfiguration: { QueueConfigurations: [{ QueueArn: processArn, Events: ['s3:ObjectCreated:*'] }] },
  }));
  console.log('  Gatilhos: S3 -> SQS -> processa-imagem -> SNS -> SQS -> notifica');

  await ensureApi({
    '/register': auth, '/login': auth, '/logout': auth, '/me': auth,
    '/files': files, '/files/{key}': files, '/processed/{key}': files, '/notifications': files,
  });
  console.log(`  API Gateway: ${cfg.endpoint}/restapis/${API_ID}/dev/_user_request_`);
}

main().catch(e => { console.error('Falha no deploy. O LocalStack está rodando?\n', e); process.exit(1); });
