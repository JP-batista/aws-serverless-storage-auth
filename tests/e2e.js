// Teste de ponta a ponta. Requer LocalStack no ar, deploy feito e o servidor web rodando.
// Uso: npm test   (BASE=http://localhost:8088 npm test para testar o Swarm)
const assert = require('assert');
const path = require('path');
const Jimp = require(path.join(__dirname, '..', 'lambda', 'node_modules', 'jimp'));

const BASE = process.env.BASE || 'http://localhost:3000';
const run = Date.now();

async function call(url, { cookie, body, method = body ? 'POST' : 'GET' } = {}) {
  const r = await fetch(BASE + '/api' + url, {
    method, headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { cookie }) },
    body: body && JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const isJson = r.headers.get('content-type')?.includes('json');
  return { status: r.status, headers: r.headers, buf, data: isJson ? JSON.parse(buf) : null };
}
const ok = msg => console.log('  ok  ' + msg);

async function waitFor(what, fn, seconds) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await new Promise(r => setTimeout(r, 2000))) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error('Tempo esgotado: ' + what);
}

async function newUser(tag) {
  const email = `${tag}-${run}@teste.com`, password = 'senha123';
  assert.strictEqual((await call('/register', { body: { email, password, name: tag } })).status, 201);
  const login = await call('/login', { body: { email, password } });
  assert.strictEqual(login.status, 200);
  return { email, password, cookie: login.headers.get('set-cookie').split(';')[0] };
}

(async () => {
  const ana = await newUser('ana');
  ok('cadastro e login');
  assert.strictEqual((await call('/register', { body: { email: ana.email, password: ana.password } })).status, 409);
  assert.strictEqual((await call('/login', { body: { email: ana.email, password: 'errada' } })).status, 401);
  ok('email repetido 409 e senha errada 401');
  assert.strictEqual((await call('/me', { cookie: ana.cookie })).data.email, ana.email);
  assert.strictEqual((await call('/files')).status, 401);
  assert.strictEqual((await call('/files', { cookie: ana.cookie.slice(0, -3) + 'xxx' })).status, 401);
  ok('sem token e com token adulterado: 401');

  const png = await new Jimp(800, 500, 0x1e8c78ff).getBufferAsync(Jimp.MIME_PNG);
  const send = (name, type, buf) => call('/files', { cookie: ana.cookie, body: { name, type, data: buf.toString('base64') } });
  assert.strictEqual((await send('a.webp', 'image/webp', png)).status, 415);
  assert.strictEqual((await send('grande.png', 'image/png', Buffer.alloc(3 * 1024 * 1024 + 1))).status, 413);
  ok('WebP 415 e acima de 3 MB 413');

  const up = await send('foto.png', 'image/png', png);
  assert.strictEqual(up.status, 201, JSON.stringify(up.data));
  const key = up.data.key;
  const find = async k => (await call('/files', { cookie: ana.cookie })).data.find(f => f.key === k);
  const done = await waitFor('processamento', async () => { const f = await find(key); return f.status === 'PRONTA' && f; }, 90);
  ok('S3 -> SQS -> Lambda: status PRONTA');

  const original = await call('/files/' + key + '?download=1', { cookie: ana.cookie });
  assert.strictEqual(original.status, 200);
  assert.ok(original.buf.equals(png), 'download diferente do original');
  assert.match(original.headers.get('content-disposition'), /attachment/);
  const thumb = await Jimp.read((await call('/processed/' + done.processed, { cookie: ana.cookie })).buf);
  assert.strictEqual(thumb.bitmap.width, 300);
  ok('download idêntico ao original e miniatura de 300 px');

  const hasNotice = (k, status) => async () =>
    (await call('/notifications', { cookie: ana.cookie })).data.some(n => n.key === k && n.status === status);
  await waitFor('aviso', hasNotice(key, 'PRONTA'), 60);
  ok('SNS -> SQS -> Lambda notifica: aviso recebido');

  const bia = await newUser('bia');
  assert.deepStrictEqual((await call('/files', { cookie: bia.cookie })).data, []);
  assert.strictEqual((await call('/files/' + key, { cookie: bia.cookie })).status, 404);
  ok('outro usuário não vê nem baixa');

  console.log('  ... forçando falha (arquivo corrompido), leva cerca de 2 minutos');
  const bad = (await send('corrompida.png', 'image/png', Buffer.from('isto nao e uma imagem'))).data.key;
  await waitFor('DLQ', async () => (await find(bad)).status === 'ERRO', 240);
  await waitFor('aviso de erro', hasNotice(bad, 'ERRO'), 60);
  ok('3 tentativas -> DLQ -> status ERRO e aviso');

  const out = await call('/logout', { cookie: ana.cookie, method: 'POST' });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  ok('logout limpa o cookie');
  console.log('TODOS OS TESTES PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
