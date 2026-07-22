# 🚀 Qwen API Gateway Guide

Este projeto agora funciona como um gateway de API compatível com o padrão da OpenAI. Você pode integrar seu agente local em qualquer outro site ou ferramenta (como LangChain, AutoGPT, ou dashboards customizados).

## 🔑 Autenticação

Todas as requisições devem incluir o cabeçalho `Authorization` com a sua chave API configurada no `.env`.

**Exemplo de Cabeçalho:**
```http
Authorization: Bearer sk-qwen-local-key-12345
```

## 📡 Endpoints Disponíveis

### 1. Chat Completions
**URL:** `POST http://localhost:3001/v1/chat/completions`

**Exemplo de Payload:**
```json
{
  "model": "qwen3.6-plus",
  "messages": [
    { "role": "user", "content": "Explique o que é uma API em uma frase curta." }
  ]
}
```

**Exemplo de Resposta (OpenAI Style):**
```json
{
  "id": "chatcmpl-x7a2db8s",
  "object": "chat.completion",
  "created": 1712543000,
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Uma API é um conjunto de regras que permite que diferentes softwares se comuniquem e troquem informações."
      },
      "finish_reason": "stop"
    }
  ]
}
```

## 🛠️ Como usar com `curl`

Execute o comando abaixo no seu terminal para testar a API:

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-qwen-local-key-12345" \
  -d '{
    "model": "qwen3.6-plus",
    "messages": [{"role": "user", "content": "Olá, quem é você?"}]
  }'
```

## ⚠️ Limitações Importantes

- **Fila de Processamento (Queue)**: O sistema processa uma requisição por vez (Sequencial). Se você enviar 5 mensagens simultâneas, elas ficarão na fila e serão respondidas uma após a outra.
- **MVP Stateless**: Esta versão inicial não mantém histórico entre requisições de API (cada mensagem é tratada como um novo chat no backend).
- **Timeout**: O tempo de resposta pode variar entre 10s e 60s dependendo da velocidade de geração do Qwen.

---
*Powered by Playwright & NexusIDE*
