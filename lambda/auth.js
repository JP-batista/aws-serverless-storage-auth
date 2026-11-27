// Atividade 2: contas e autenticação (DynamoDB), atrás do API Gateway.
const bcrypt = require('bcryptjs');
const { PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, userId, signToken, currentUser, readJson, json } = require('./comum');

const TTL = 60 * 60; // 1 hora
const cookie = (value, age) => `token=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}`;

async function register(event) {
  const { email, password, name } = readJson(event);
  if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 4)
    return json(400, { error: 'Informe email e senha (mín. 4 caracteres)' });
  const id = email.trim().toLowerCase();
  try {
    await ddb.send(new PutCommand({
      TableName: process.env.USERS_TABLE,
      Item: { email: id, name: String(name || id), passwordHash: await bcrypt.hash(password, 10), createdAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(email)',
    }));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return json(409, { error: 'Email já cadastrado' });
    throw e;
  }
  return json(201, { ok: true });
}

async function login(event) {
  const { email, password } = readJson(event);
  const id = String(email || '').trim().toLowerCase();
  const { Item } = id
    ? await ddb.send(new GetCommand({ TableName: process.env.USERS_TABLE, Key: { email: id } }))
    : {};
  if (!Item || !(await bcrypt.compare(String(password || ''), Item.passwordHash)))
    return json(401, { error: 'Email ou senha inválidos' });
  const user = { email: Item.email, name: Item.name };
  const token = signToken({ sub: userId(Item.email), ...user }, TTL);
  return json(200, user, { 'Set-Cookie': cookie(token, TTL) });
}

exports.handler = async event => {
  const route = `${event.httpMethod} ${event.resource}`;
  if (route === 'POST /register') return register(event);
  if (route === 'POST /login') return login(event);
  if (route === 'POST /logout') return json(200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  if (route === 'GET /me') {
    const u = currentUser(event);
    return json(200, u ? { email: u.email, name: u.name } : null);
  }
  return json(404, { error: 'Rota não encontrada' });
};
