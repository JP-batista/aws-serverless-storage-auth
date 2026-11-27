// Servidor web: entrega a página e repassa /api para o API Gateway.
// Não acessa S3, DynamoDB, SQS ou SNS e não guarda estado (pode ter várias réplicas).
const express = require('express');
const os = require('os');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:4566/restapis/cloudlens/dev/_user_request_';
const app = express();

app.use((req, res, next) => { res.set('X-Replica', os.hostname()); next(); });
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  const headers = {};
  for (const h of ['content-type', 'cookie', 'authorization']) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const out = await fetch(API_URL + req.url, {
      method: req.method, headers,
      body: Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined,
    });
    for (const h of ['content-type', 'content-disposition', 'set-cookie']) {
      const v = out.headers.get(h);
      if (v) res.set(h, v);
    }
    res.status(out.status).send(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'API Gateway indisponível' });
  }
});

app.use((err, req, res, next) =>
  res.status(err.status || 500).json({ error: err.status === 413 ? 'Imagem acima de 3 MB' : 'Erro no servidor' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App em http://localhost:${port} (API: ${API_URL})`));
