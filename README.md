# ChatGPT Bridge

Bridge privado que expõe uma API compatível com `POST /v1/chat/completions` e controla uma sessão pessoal do ChatGPT pelo Google Chrome.

O nome do repositório remoto pode continuar sendo `qwen-bridge`; o produto, os arquivos de estado, as variáveis e os logs internos usam o nome ChatGPT Bridge.

## O que esta versão faz

- Usa o Google Chrome original com perfil persistente.
- Exige login manual; não guarda e-mail ou senha no `.env`.
- Cria uma conversa real do ChatGPT para cada `conversation_id`.
- Retoma a URL correta quando o SKMake volta a uma conversa anterior.
- Transmite a resposta incrementalmente por SSE.
- Mantém uma fila serial para impedir que duas conversas disputem a mesma página.
- Permite cancelar uma geração ativa ou ainda na fila.
- Converte parágrafos, listas, links, tabelas e blocos de código da interface para Markdown.
- Conserva a pesquisa privada pelo SearXNG na rota `/v1/search`.

## Níveis disponíveis

O bridge usa somente os níveis visíveis na conta conectada:

| ID da API | Opção selecionada no ChatGPT |
| --- | --- |
| `gpt-5.5` | Instantâneo |
| `gpt-5.6-sol` | Médio |
| `gpt-5.6-sol-thinking` | Alto |

Os aliases `flash`, `medium`, `high`, `pro` e `specialized` são aceitos para facilitar a integração com o SKMake. `pro` e `specialized` usam Alto porque a conta conectada não oferece Pro ou Extra alto.

Se uma opção não existir na interface, a API devolve `MODEL_UNAVAILABLE` em vez de manter a solicitação carregando indefinidamente.

## Instalação na VM

Recomendado: 2 CPUs, 4 GB de RAM, disco persistente e Docker Compose.

```bash
git pull
cp .env.example .env
nano .env
docker rm -f qwen-bridge chatgpt-bridge 2>/dev/null || true
docker compose up -d --build
docker logs -f chatgpt-bridge
```

O Docker instala o Google Chrome original e o executa visualmente dentro do Xvfb. O perfil fica no volume `chatgpt-state`.

Depois que o servidor iniciar, abra:

```text
https://ENDERECO-DO-BRIDGE/setup
```

Informe `CHATGPT_BRIDGE_API_KEY` e conclua o login pela tela remota. A rota `/health` muda para `status: "ok"` quando o campo de mensagem do ChatGPT estiver disponível.

## Variáveis

```env
PORT=3001
CHATGPT_BRIDGE_API_KEY=uma-chave-longa-e-aleatoria
CHATGPT_HEADLESS=false
CHATGPT_BROWSER_CHANNEL=chrome
CHATGPT_STATE_DIR=/data
CHATGPT_GENERATION_TIMEOUT_MS=480000
CHATGPT_POLL_INTERVAL_MS=160
MAX_QUEUE_SIZE=20
QUEUE_TIMEOUT_MS=120000
MAX_BODY_SIZE=2mb
ALLOWED_ORIGIN=https://skmake.vercel.app
SEARXNG_URL=http://searxng:8080
SEARXNG_SECRET=outra-chave-longa-e-aleatoria
```

Não configure credenciais da conta. O login é manual e permanece apenas no perfil persistente do Chrome.

## Variáveis no SKMake

Enquanto o SKMake ainda usa os nomes antigos das variáveis, você pode manter o endereço nelas e apontar os níveis para os novos IDs:

```env
QWEN_BRIDGE_URL=https://ENDERECO-DO-BRIDGE
QWEN_BRIDGE_API_KEY=a-mesma-chave-do-CHATGPT_BRIDGE_API_KEY
QWEN_BRIDGE_MODEL=gpt-5.5
QWEN_BRIDGE_MODEL_HIGH=gpt-5.6-sol-thinking
QWEN_BRIDGE_MODEL_PRO=gpt-5.6-sol-thinking
QWEN_BRIDGE_MODEL_SPECIALIZED=gpt-5.6-sol-thinking
```

O nome dessas variáveis pertence ao SKMake e pode ser migrado separadamente. O bridge não depende delas.

## API

- `POST /v1/chat/completions`: cria ou continua uma conversa.
- `GET /v1/models`: lista os níveis aceitos.
- `POST /v1/conversations/:id/cancel`: cancela uma geração ativa ou na fila.
- `GET /v1/search?q=consulta&limit=7`: pesquisa pelo SearXNG privado.
- `GET /health`: informa login, fila, navegador e pesquisa.
- `GET /setup`: interface protegida para o primeiro login.

Exemplo:

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.6-sol-thinking",
    "conversation_id": "conversa-123",
    "stream": false,
    "messages": [
      {"role": "user", "content": "Crie um sistema de /home com três homes."}
    ]
  }'
```

Para streaming, use `"stream": true`. A resposta segue o formato SSE compatível com Chat Completions.

## Segurança e limitações

- Este projeto automatiza uma interface sujeita a mudanças. Seletores podem precisar de manutenção.
- O Chrome original reduz diferenças de navegador, mas não elimina verificações ou desafios de login.
- O bridge não implementa evasão, stealth, endpoints privados ou extração de cookies.
- Não publique a porta sem HTTPS e autenticação adicional de rede.
- Não envie o volume `chatgpt-state`, o perfil do Chrome ou capturas autenticadas ao GitHub.
- A fila é serial por padrão porque uma única página controla uma única conta.
- O uso deve respeitar os termos e limites da conta conectada.
