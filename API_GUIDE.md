# API do ChatGPT Bridge

## Autenticação

Todas as rotas privadas exigem:

```http
Authorization: Bearer <CHATGPT_BRIDGE_API_KEY>
```

## Chat Completions

```http
POST /v1/chat/completions
Content-Type: application/json
```

```json
{
  "model": "gpt-5.6-sol",
  "conversation_id": "id-estavel-do-skmake",
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "Explique este Skript."
    }
  ]
}
```

Modelos aceitos:

- `gpt-5.5`
- `gpt-5.6-sol`
- `gpt-5.6-sol-thinking`

Aliases aceitos:

- `instant`, `flash`
- `medium`, `medio`, `médio`
- `high`, `alto`, `pro`, `specialized`, `especializado`

## Conversas

`conversation_id` associa a conversa do consumidor à URL criada no ChatGPT. Quando o modelo muda, o bridge cria uma nova conversa e importa o histórico recebido na solicitação, impedindo que uma conversa antiga seja aberta com o nível errado.

O cabeçalho `X-ChatGPT-Thread-Url` contém a URL persistida.

## Cancelamento

```http
POST /v1/conversations/:conversationId/cancel
```

Exemplo:

```json
{
  "stopped": true,
  "state": "running"
}
```

`state` pode ser `running`, `queued` ou `idle`.

## Erros relevantes

| Código | Significado |
| --- | --- |
| `CHATGPT_LOGIN_REQUIRED` | O perfil precisa ser conectado novamente. |
| `MODEL_UNAVAILABLE` | O nível não aparece na conta conectada. |
| `MODEL_SELECTOR_NOT_FOUND` | A interface mudou e o seletor não foi localizado. |
| `BRIDGE_QUEUE_FULL` | Há solicitações demais aguardando. |
| `BRIDGE_QUEUE_TIMEOUT` | A solicitação esperou demais na fila. |
| `CHATGPT_TIMEOUT` | A geração ultrapassou o limite configurado. |
| `EMPTY_PROVIDER_RESPONSE` | A interface terminou sem conteúdo extraível. |
