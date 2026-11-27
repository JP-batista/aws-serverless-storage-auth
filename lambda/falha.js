// Gatilho: SQS fila-processamento-dlq. Mensagem que falhou 3 vezes vira status ERRO.
const { finish } = require('./comum');
const { s3Objects } = require('./eventos');

exports.handler = async event => {
  for (const { key } of s3Objects(event)) {
    const [owner, name] = key.split('/');
    await finish({ owner, key: name, status: 'ERRO' });
    console.log(`ERRO: ${key}`);
  }
};
