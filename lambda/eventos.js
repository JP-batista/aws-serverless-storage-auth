// Extrai {bucket, key} das notificações do S3 que chegam dentro de mensagens SQS.
exports.s3Objects = event => (event.Records || [])
  .flatMap(msg => JSON.parse(msg.body).Records || []) // o s3:TestEvent não tem Records
  .map(r => ({ bucket: r.s3.bucket.name, key: decodeURIComponent(r.s3.object.key.replace(/\+/g, ' ')) }));
