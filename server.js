const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const {
  S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand,
  ListObjectsV2Command, GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ENDPOINT = process.env.AWS_ENDPOINT || 'http://localhost:4566';
const cfg = {
  region: 'us-east-1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client({ ...cfg, forcePathStyle: true });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(cfg));
const BUCKET = 'meu-bucket';
const TABLE = 'usuarios';

const app = express();
app.use(express.json());
app.use(session({ secret: 'dev-secret', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const auth = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ error: 'Não autenticado' });

// ---------- Atividade 2: contas e autenticação (DynamoDB) ----------
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || password.length < 4)
    return res.status(400).json({ error: 'Informe email e senha (mín. 4 caracteres)' });
  const id = email.trim().toLowerCase();
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { email: id, name: name || id, passwordHash: await bcrypt.hash(password, 10), createdAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(email)',
    }));
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return res.status(409).json({ error: 'Email já cadastrado' });
    console.error(e); res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email: (email || '').trim().toLowerCase() } }));
    if (!Item || !(await bcrypt.compare(password || '', Item.passwordHash)))
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    req.session.user = { email: Item.email, name: Item.name };
    res.json(req.session.user);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro no login' }); }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json(req.session.user || null));

// ---------- Atividade 1: upload/listagem/download de imagens (S3) ----------
app.post('/api/files', auth, upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f || !f.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Envie um arquivo de imagem' });
  const key = `${Date.now()}-${f.originalname.replace(/[^\w.\-]/g, '_')}`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: f.buffer, ContentType: f.mimetype }));
    res.status(201).json({ key });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro no upload' }); }
});

app.get('/api/files', auth, async (req, res) => {
  try {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
    res.json((out.Contents || []).map(o => ({ key: o.Key, size: o.Size, lastModified: o.LastModified })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao listar' }); }
});

app.get('/api/files/:key', auth, async (req, res) => {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: req.params.key }));
    res.set('Content-Type', out.ContentType);
    if (req.query.download) res.attachment(req.params.key);
    out.Body.pipe(res);
  } catch (e) { res.status(404).json({ error: 'Arquivo não encontrado' }); }
});

// ---------- Inicialização: cria bucket e tabela se não existirem ----------
async function init() {
  try { await s3.send(new HeadBucketCommand({ Bucket: BUCKET })); }
  catch { await s3.send(new CreateBucketCommand({ Bucket: BUCKET })); }
  try { await ddb.send(new DescribeTableCommand({ TableName: TABLE })); }
  catch {
    await ddb.send(new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
  }
}

init()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`App em http://localhost:${port} (LocalStack: ${ENDPOINT})`));
  })
  .catch(e => { console.error('Falha ao conectar no LocalStack. Ele está rodando?', e.message); process.exit(1); });
