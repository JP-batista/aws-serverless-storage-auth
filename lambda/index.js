// Atividade 3: processa a imagem enviada ao S3.
// Gatilho: SQS fila-processamento (que recebe o evento ObjectCreated do S3).
// Gera uma miniatura em escala de cinza, grava no bucket de saída,
// marca a imagem como PRONTA no DynamoDB e publica o evento no SNS.
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const Jimp = require('jimp');
const { s3, finish } = require('./comum');
const { s3Objects } = require('./eventos');

const THUMB_WIDTH = 300;

// Se algo falhar, o erro sobe: a mensagem volta à fila e, após 3 tentativas, vai para a DLQ.
exports.handler = async event => {
  for (const { bucket, key } of s3Objects(event)) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const image = await Jimp.read(Buffer.from(await obj.Body.transformToByteArray()));
    image.resize(Math.min(THUMB_WIDTH, image.bitmap.width), Jimp.AUTO).greyscale();

    const [owner, name] = key.split('/');
    const thumbKey = name + '.png';
    await s3.send(new PutObjectCommand({
      Bucket: process.env.OUTPUT_BUCKET, Key: `${owner}/${thumbKey}`,
      Body: await image.getBufferAsync(Jimp.MIME_PNG), ContentType: 'image/png',
    }));
    await finish({ owner, key: name, status: 'PRONTA', thumbKey });
    console.log(`PRONTA: ${key}`);
  }
};
