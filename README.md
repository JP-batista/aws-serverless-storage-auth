# Atividades #1 e #2 – LocalStack (S3 + DynamoDB)

App web (Node/Express) com:
- **Atividade 2**: cadastro e login de usuários no **DynamoDB** (tabela `usuarios`, senha com bcrypt).
- **Atividade 1**: upload de imagens para um bucket **S3** (`meu-bucket`), listagem e download (acessível só logado).

## Como rodar
```bash
docker compose up -d        # sobe o LocalStack em :4566
npm install
npm start                   # http://localhost:3000
```
Bucket e tabela são criados automaticamente na inicialização.

## Conferir via CLI
```bash
aws --endpoint-url=http://localhost:4566 s3 ls s3://meu-bucket
aws --endpoint-url=http://localhost:4566 dynamodb scan --table-name usuarios
```
