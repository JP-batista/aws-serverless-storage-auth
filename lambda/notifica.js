// Gatilho: SQS fila-notificacoes, assinante do tópico SNS imagem-processada.
// Guarda o aviso no DynamoDB; o app o busca em GET /notifications.
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('./comum');

exports.handler = async event => {
  for (const msg of event.Records || []) {
    const { userId, imageKey, status, occurredAt } = JSON.parse(JSON.parse(msg.body).Message);
    try {
      // O SQS pode entregar a mesma mensagem duas vezes: o id é determinístico.
      await ddb.send(new PutCommand({
        TableName: process.env.NOTIFICATIONS_TABLE,
        Item: { userId, notificationId: `${imageKey}#${status}`, imageKey, status, occurredAt },
        ConditionExpression: 'attribute_not_exists(userId)',
      }));
      console.log(`Aviso registrado: ${imageKey} ${status}`);
    } catch (e) {
      if (e.name !== 'ConditionalCheckFailedException') throw e;
    }
  }
};
