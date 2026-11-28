# Roteiro da demonstração

## Antes de apresentar (faça com antecedência)
1. Abra o Docker Desktop.
2. `npm install`
3. `docker compose up -d`
4. `npm start` (cria a infraestrutura e abre http://localhost:3000). Se a porta 3000 estiver ocupada, no PowerShell: `$env:PORT=3100; npm start`.
5. Envie uma imagem de teste para aquecer as Lambdas, porque a primeira execução de cada uma é mais lenta. Num computador novo, a primeira vez também baixa imagens Docker, então precisa de internet.
6. Tenha à mão uma foto PNG ou JPEG de menos de 3 MB e o arquivo corrompido.

Arquivo corrompido, para mostrar a DLQ (PowerShell):

```powershell
Set-Content corrompida.png "isto nao e uma imagem"
```

## Demonstração

| Passo | O que fazer | O que explicar |
|---|---|---|
| 1 | Criar conta e errar a senha uma vez | API Gateway → Lambda auth → DynamoDB; só o hash é guardado |
| 2 | Entrar | JWT em cookie HttpOnly, validado em cada rota protegida |
| 3 | Enviar `corrompida.png` **primeiro** | O upload responde na hora, mas a falha leva uns 2 minutos para chegar à DLQ |
| 4 | Enviar uma foto e acompanhar o pipeline | S3 → SQS → Lambda → SNS → SQS → Lambda |
| 5 | Comparar e baixar original e miniatura | O download passa pela API, e o navegador não acessa o S3 |
| 6 | Mostrar o aviso de erro e o filtro "Com erro" | 3 tentativas, DLQ, status ERRO, aviso pelo SNS |
| 7 | Mostrar os recursos no terminal | Comandos abaixo |
| 8 | Extra: Swarm | Comandos abaixo |

## Comandos (não precisam do aws CLI)

No PowerShell:

```powershell
$ls = "aws-serverless-storage-auth-localstack-1"
docker exec $ls awslocal s3 ls --recursive s3://meu-bucket-processado
docker exec $ls awslocal dynamodb scan --table-name imagens
docker exec $ls awslocal sqs list-queues
docker exec $ls awslocal sns list-subscriptions
docker exec $ls awslocal lambda list-functions --query "Functions[].FunctionName"
docker exec $ls awslocal apigateway get-resources --rest-api-id cloudlens --query "items[].path"
docker exec $ls awslocal logs filter-log-events --log-group-name /aws/lambda/processa-imagem --query "events[].message" --output text
```

## Docker Swarm

```powershell
docker swarm init          # só se o Swarm ainda não estiver ativo
docker build -t cloudlens-web .
docker stack deploy -c stack.yml cloudlens
docker service ls
docker service ps cloudlens_web
1..9 | ForEach-Object { curl.exe -s -D - -o NUL -H "Connection: close" http://localhost:8088/ | Select-String X-Replica }
docker service scale cloudlens_web=5
docker stack rm cloudlens  # ao terminar
```

## Perguntas prováveis
- **Por que SQS entre o S3 e a Lambda?** A fila segura os pedidos, repete os que falham e manda para a DLQ os que continuam falhando.
- **Qual a diferença entre SQS e SNS aqui?** A fila entrega trabalho a um consumidor. O tópico publica um evento para todos os assinantes. Hoje há um só, e dá para adicionar outros sem mudar quem publica.
- **Por que não há Lambda Authorizer?** No nosso teste com o LocalStack 3.8 gratuito, ele não foi aplicado, então a validação do JWT ficou nas Lambdas.
- **E o Meu Controle?** É a proposta maior. O CloudLens não implementa o Meu Controle, só mostra o mesmo padrão de comunicação.
