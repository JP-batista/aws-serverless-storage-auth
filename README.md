# Atividades #1, #2 e #3 – LocalStack (S3 + DynamoDB + Lambda)

App web (Node/Express) com:
- **Atividade 1**: upload de imagens para um bucket **S3** (`meu-bucket`), listagem e download (acessível só logado).
- **Atividade 2**: cadastro e login de usuários no **DynamoDB** (tabela `usuarios`, senha com bcrypt).
- **Atividade 3**: função **Lambda** `processa-imagem` acionada pelo upload no `meu-bucket`. Ela gera uma miniatura (300 px, escala de cinza) e grava em `meu-bucket-processado`. A tela mostra a original e a processada lado a lado.

```
Navegador ──► Express (:3000) ──► DynamoDB  (usuarios)
                     │
                     └──► S3 meu-bucket ──(ObjectCreated)──► Lambda processa-imagem ──► S3 meu-bucket-processado
```

## Como rodar
```bash
docker compose up -d        # sobe o LocalStack em :4566 (precisa do Docker Desktop aberto)
npm install                 # instala também as dependências da Lambda (pasta lambda/)
npm start                   # http://localhost:3000
```
Na inicialização o app cria os buckets e a tabela, empacota a pasta `lambda/` num .zip, publica a função e configura a notificação do S3.

## Conferir via CLI
```bash
aws --endpoint-url=http://localhost:4566 s3 ls s3://meu-bucket
aws --endpoint-url=http://localhost:4566 s3 ls s3://meu-bucket-processado
aws --endpoint-url=http://localhost:4566 dynamodb scan --table-name usuarios
aws --endpoint-url=http://localhost:4566 lambda list-functions
aws --endpoint-url=http://localhost:4566 s3api get-bucket-notification-configuration --bucket meu-bucket
aws --endpoint-url=http://localhost:4566 logs tail /aws/lambda/processa-imagem
```
