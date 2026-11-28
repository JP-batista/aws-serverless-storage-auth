# CloudLens: pipeline de imagens serverless no LocalStack

Uma galeria de imagens feita com API Gateway, Lambda, DynamoDB, S3, SQS e SNS, tudo rodando na sua máquina.

```
Navegador ─► servidor web ─► API Gateway ─┬─► Lambda auth ─────► DynamoDB (usuarios)
                                          └─► Lambda arquivos ─► S3 meu-bucket + DynamoDB (imagens)

S3 ─► SQS fila-processamento ─► Lambda processa-imagem ─► S3 meu-bucket-processado
              │ 3 falhas                    │
              ▼                             ▼
             DLQ ─► Lambda registra-falha ─► SNS imagem-processada
                                             └─► SQS fila-notificacoes ─► Lambda notifica ─► DynamoDB (notificacoes)
```

- [Definição e arquitetura](docs/arquitetura.md) ([PDF](docs/arquitetura.pdf))
- [Roteiro da demonstração e Docker Swarm](docs/roteiro-demo.md)

## Como rodar
Precisa de Node.js 18 ou mais novo e do Docker Desktop aberto.

```bash
npm install            # instala também as dependências das Lambdas
docker compose up -d   # LocalStack em :4566
npm start              # faz o deploy e abre http://localhost:3000
```

| Comando | O que faz |
|---|---|
| `npm run deploy` | Cria ou atualiza a infraestrutura |
| `npm run web` | Sobe só o servidor web |
| `npm test` | Teste de ponta a ponta (com o servidor no ar; leva alguns minutos) |

Para outra porta, defina `PORT`. No teste, defina `BASE` (ex.: `BASE=http://localhost:8088`).

Um novo deploy troca o segredo do JWT, então é preciso entrar de novo. Para manter o mesmo, defina `JWT_SECRET`.

## Estrutura
| Caminho | Conteúdo |
|---|---|
| `lambda/` | As 5 funções e o código compartilhado |
| `deploy.js` | Infraestrutura no LocalStack |
| `server.js`, `public/` | Servidor web (sem estado) e interface |
| `Dockerfile`, `stack.yml` | Servidor web no Docker Swarm |
| `tests/e2e.js` | Teste de ponta a ponta |
