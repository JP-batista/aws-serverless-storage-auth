// Atividade 1: upload, listagem e download (S3), atrás do API Gateway.
// O JWT é validado aqui, em toda rota. Cada usuário só alcança o próprio prefixo.
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { s3, ddb, currentUser, readJson, json } = require('./comum');

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp']; // formatos que o jimp lê
const MAX_BYTES = 3 * 1024 * 1024; // cabe no payload de 6 MB da Lambda mesmo após o base64

async function upload(event, user) {
  const { name, type, data } = readJson(event);
  if (!TYPES.includes(type)) return json(415, { error: 'Envie PNG, JPEG, GIF ou BMP' });
  const body = Buffer.from(String(data || ''), 'base64');
  if (!body.length) return json(400, { error: 'Arquivo vazio' });
  if (body.length > MAX_BYTES) return json(413, { error: 'Imagem acima de 3 MB' });

  const key = `${Date.now()}-${String(name || 'imagem').replace(/[^\w.\-]/g, '_').slice(-80)}`;
  // O registro é criado antes do PutObject para o processamento sempre encontrá-lo.
  await ddb.send(new PutCommand({
    TableName: process.env.IMAGES_TABLE,
    Item: { userId: user.sub, imageKey: key, size: body.length, status: 'PROCESSANDO', createdAt: new Date().toISOString() },
  }));
  await s3.send(new PutObjectCommand({ Bucket: process.env.BUCKET, Key: `${user.sub}/${key}`, Body: body, ContentType: type }));
  return json(201, { key });
}

async function queryByUser(table, user) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: table, KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': user.sub }, ScanIndexForward: false,
  }));
  return Items;
}

async function list(user) {
  const items = await queryByUser(process.env.IMAGES_TABLE, user);
  return json(200, items.map(i => ({
    key: i.imageKey, size: i.size, lastModified: i.createdAt, status: i.status, processed: i.thumbKey || null,
  })));
}

async function notifications(user) {
  const items = await queryByUser(process.env.NOTIFICATIONS_TABLE, user);
  return json(200, items.slice(0, 20).map(i => ({ id: i.notificationId, key: i.imageKey, status: i.status, occurredAt: i.occurredAt })));
}

async function download(event, user, bucket) {
  const key = decodeURIComponent(event.pathParameters.key);
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `${user.sub}/${key}` }));
    const headers = { 'Content-Type': out.ContentType };
    if (event.queryStringParameters?.download) headers['Content-Disposition'] = `attachment; filename="${key.replace(/[^\w.\-]/g, '_')}"`;
    return { statusCode: 200, headers, isBase64Encoded: true, body: await out.Body.transformToString('base64') };
  } catch (e) {
    if (e.name === 'NoSuchKey') return json(404, { error: 'Arquivo não encontrado' });
    throw e;
  }
}

exports.handler = async event => {
  const user = currentUser(event);
  if (!user) return json(401, { error: 'Não autenticado' });
  const route = `${event.httpMethod} ${event.resource}`;
  if (route === 'POST /files') return upload(event, user);
  if (route === 'GET /files') return list(user);
  if (route === 'GET /files/{key}') return download(event, user, process.env.BUCKET);
  if (route === 'GET /processed/{key}') return download(event, user, process.env.OUTPUT_BUCKET);
  if (route === 'GET /notifications') return notifications(user);
  return json(404, { error: 'Rota não encontrada' });
};
