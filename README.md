# QwenMiniChat Bridge

Bridge privado e compatível com `POST /v1/chat/completions` que conecta o Chat do SKMake a uma sessão persistente em `chat.qwen.ai` por meio do Playwright.

O bridge não acessa arquivos do projeto. O SKMake envia apenas o contexto selecionado e o pedido atual. Cada conversa do SKMake é associada ao seu próprio chat no Qwen. O relay browser→Node entrega SSE incremental real e permite até três conversas simultâneas por padrão. A pesquisa web usa um SearXNG privado no mesmo Docker, sem conta ou chave de serviço de busca.

## Instalação na máquina Google

Requisitos recomendados: Ubuntu, 2 CPUs, 4 GB de RAM e disco persistente.

```bash
npm ci
npx playwright install --with-deps chromium
cp .env.example .env
npm run server
```

Configure no `.env` uma chave longa em `QWEN_API_KEY`, as credenciais da conta Qwen, `QWEN_HEADLESS=true`, o domínio do SKMake em `ALLOWED_ORIGIN` e uma chave aleatória em `SEARXNG_SECRET`. No Linux, você pode gerar essa última com `openssl rand -hex 32`.

Os arquivos `server/auth.json` e `server/conversations.json` contêm, respectivamente, a sessão autenticada e o mapa local de conversas. Eles devem permanecer em disco persistente, nunca entrar no Git e ter acesso restrito ao usuário do serviço.

Com Docker Compose, mantenha o estado em um volume persistente e inicie também o buscador privado:

```bash
docker rm -f qwen-bridge 2>/dev/null || true
docker compose up -d --build
```

O Compose reutiliza o volume existente `qwen-state`, preservando login e conversas. Somente a porta `3001` é publicada. O SearXNG permanece na rede interna e sua rota `/v1/search` exige a mesma autenticação privada do bridge.

## Variáveis do SKMake na Vercel

```env
QWEN_BRIDGE_URL=https://qwen.seu-dominio.com
QWEN_BRIDGE_API_KEY=a-mesma-chave-do-QWEN_API_KEY
QWEN_BRIDGE_MODEL=qwen3.7-plus
QWEN_BRIDGE_MODEL_HIGH=qwen3.7-plus
QWEN_BRIDGE_MODEL_PRO=qwen3.7-max
QWEN_BRIDGE_MODEL_SPECIALIZED=qwen3.8-max-preview
```

Execute também `npm run db:deploy:turso` no projeto SKMake para adicionar os campos que guardam a URL externa da conversa.

## API

- `POST /v1/chat/completions`: cria ou continua uma conversa.
- `GET /v1/models`: lista os nomes aceitos pelo bridge.
- `GET /v1/search?q=consulta&limit=7`: pesquisa a web pelo SearXNG privado.
- `GET /health`: informa navegador, gerações simultâneas e disponibilidade.
- `POST /v1/conversations/:id/cancel`: tenta interromper a geração atual.

Extensões aceitas no corpo de chat:

```json
{
  "conversation_id": "id-da-conversa-skmake",
  "reasoning_effort": "adaptive"
}
```

`conversation_id` é a identidade persistente usada pelo bridge. A resposta devolve a URL atual em `X-Qwen-Thread-Url`; o estado local guarda também o último `parentId` do Qwen para continuar no ponto correto.
