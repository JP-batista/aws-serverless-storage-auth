// Atividade 3: função Lambda acionada por upload no S3.
// Lê a imagem enviada em `meu-bucket`, gera uma miniatura em escala de cinza
// e grava o resultado em `meu-bucket-processado` com o mesmo nome (.png).
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const Jimp = require('jimp');

// Dentro do LocalStack o endpoint vem em AWS_ENDPOINT_URL (ou LOCALSTACK_HOSTNAME).
const endpoint = process.env.AWS_ENDPOINT_URL
  || (process.env.LOCALSTACK_HOSTNAME ? `http://${process.env.LOCALSTACK_HOSTNAME}:${process.env.EDGE_PORT || 4566}` : undefined);
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', endpoint, forcePathStyle: true });
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'meu-bucket-processado';
const THUMB_WIDTH = 300;

exports.handler = async (event) => {
  const results = [];
  for (const record of event.Records || []) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    console.log(`Processando s3://${bucket}/${key}`);

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const input = Buffer.from(await obj.Body.transformToByteArray());

    const image = await Jimp.read(input);
    const { width, height } = image.bitmap;
    image.resize(Math.min(THUMB_WIDTH, width), Jimp.AUTO).greyscale();
    const output = await image.getBufferAsync(Jimp.MIME_PNG);

    const outKey = key.replace(/\.[^.]+$/, '') + '.png';
    await s3.send(new PutObjectCommand({
      Bucket: OUTPUT_BUCKET, Key: outKey, Body: output, ContentType: 'image/png',
      Metadata: { origem: key, 'tamanho-original': `${width}x${height}` },
    }));
    console.log(`Resultado salvo em s3://${OUTPUT_BUCKET}/${outKey}`);
    results.push({ input: key, output: outKey });
  }
  return { processed: results };
};
