# API do ChatGPT Bridge

## Autenticação

As rotas privadas exigem:

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

Modelos:

- `gpt-5.5`
- `gpt-5.6-sol`
- `gpt-5.6-sol-thinking`

Aliases:

- `instant`, `flash`
- `medium`, `medio`, `médio`
- `high`, `alto`, `pro`, `specialized`, `especializado`

## Conversas

`conversation_id` associa a conversa do consumidor à URL criada no ChatGPT. Quando o nível muda, o bridge cria outra conversa e importa o histórico recebido, evitando abrir uma conversa antiga no nível errado.

O cabeçalho `X-ChatGPT-Thread-Url` informa a URL conhecida no início da resposta. A associação definitiva é persistida quando a interface fornece a nova URL.

## Streaming

Com `"stream": true`, a API responde usando SSE no formato de Chat Completions:

```text
data: {"object":"chat.completion.chunk",...}

data: [DONE]
```

## Cancelamento

```http
POST /v1/conversations/:conversationId/cancel
```

Resposta:

```json
{
  "stopped": true,
  "state": "running"
}
```

`state` pode ser `running`, `queued` ou `idle`.

## Healthcheck

```http
GET /health
```

Estados:

- `extension_connecting`
- `login_required`
- `ok`

O payload também informa fila, geração ativa, conexão da extensão e SearXNG.

## Erros relevantes

| Código | Significado |
| --- | --- |
| `CHATGPT_EXTENSION_DISCONNECTED` | Chrome ou extensão ainda não conectou. |
| `CHATGPT_LOGIN_REQUIRED` | O perfil precisa de login. |
| `CHATGPT_GENERATION_BUSY` | Outra resposta ainda está em andamento. |
| `CHATGPT_INTERFACE_TIMEOUT` | O campo ou seletor não apareceu a tempo. |
| `CHATGPT_NAVIGATION_TIMEOUT` | A conversa não abriu a tempo. |
| `MODEL_UNAVAILABLE` | O nível não aparece na conta. |
| `MODEL_SELECTOR_NOT_FOUND` | O seletor de nível mudou. |
| `BRIDGE_QUEUE_FULL` | Há solicitações demais aguardando. |
| `BRIDGE_QUEUE_TIMEOUT` | A solicitação esperou demais na fila. |
| `CHATGPT_TIMEOUT` | A geração ultrapassou o limite. |
| `EMPTY_PROVIDER_RESPONSE` | A interface terminou sem conteúdo extraível. |
