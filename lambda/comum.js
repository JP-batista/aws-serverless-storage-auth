// Código compartilhado pelas Lambdas. O AWS SDK v3 já vem no runtime nodejs20.x.
const crypto = require('crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// Dentro do LocalStack o endpoint vem em AWS_ENDPOINT_URL.
const cfg = { region: process.env.AWS_REGION || 'us-east-1', endpoint: process.env.AWS_ENDPOINT_URL };
const s3 = new S3Client({ ...cfg, forcePathStyle: true });
const sns = new SNSClient(cfg);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(cfg));

// Identificador do usuário: prefixo dos objetos no S3 e chave no DynamoDB.
const userId = email => crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);

// ---------- JWT HS256 ----------
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const hmac = data => crypto.createHmac('sha256', process.env.JWT_SECRET).update(data).digest('base64url');

function signToken(claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, iat: now, exp: now + ttlSeconds })}`;
  return `${data}.${hmac(data)}`;
}

function verifyToken(token) {
  const [h, p, sig] = String(token || '').split('.');
  if (!sig) return null;
  const expected = Buffer.from(hmac(`${h}.${p}`));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  return claims.exp > Date.now() / 1000 ? claims : null;
}

// ---------- HTTP (integração proxy do API Gateway) ----------
const header = (event, name) =>
  Object.entries(event.headers || {}).find(([k]) => k.toLowerCase() === name)?.[1] || '';

// O token chega em "Authorization: Bearer" ou no cookie HttpOnly.
function currentUser(event) {
  const bearer = header(event, 'authorization').replace(/^Bearer\s+/i, '');
  const cookie = /(?:^|;\s*)token=([^;]+)/.exec(header(event, 'cookie'))?.[1];
  return verifyToken(bearer || cookie);
}

function readJson(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body;
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

const json = (statusCode, body, headers = {}) =>
  ({ statusCode, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

// ---------- estado do processamento + evento no SNS ----------
async function finish({ owner, key, status, thumbKey }) {
  await ddb.send(new UpdateCommand({
    TableName: process.env.IMAGES_TABLE,
    Key: { userId: owner, imageKey: key },
    UpdateExpression: 'SET #s = :s, thumbKey = :t, updatedAt = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status, ':t': thumbKey || null, ':u': new Date().toISOString() },
  }));
  await sns.send(new PublishCommand({
    TopicArn: process.env.TOPIC_ARN,
    Message: JSON.stringify({ userId: owner, imageKey: key, status, occurredAt: new Date().toISOString() }),
  }));
}

module.exports = { s3, ddb, userId, signToken, currentUser, readJson, json, finish };
