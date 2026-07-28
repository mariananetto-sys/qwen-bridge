# ChatGPT Bridge

Bridge privado que expõe uma API compatível com `POST /v1/chat/completions` e usa uma sessão pessoal do ChatGPT no Google Chrome.

O repositório remoto pode continuar se chamando `qwen-bridge`. O produto, os logs e as variáveis novas usam o nome ChatGPT Bridge.

## Como funciona

- O Google Chrome estável é iniciado diretamente, sem Playwright, Selenium ou WebDriver.
- Uma extensão Manifest V3 instalada localmente controla apenas `chatgpt.com`.
- A extensão se comunica com o Node por WebSocket limitado a `127.0.0.1:3002`.
- O login é manual e fica no perfil persistente do Chrome.
- Cada `conversation_id` do SKMake é associado à conversa correspondente do ChatGPT.
- As respostas são extraídas da interface e transmitidas incrementalmente por SSE.
- A fila é serial para impedir que duas gerações disputem a mesma janela.
- Cancelamento, troca de nível, retomada de conversa e Markdown continuam disponíveis.
- Quando o ChatGPT pesquisa por conta própria, a extensão retransmite a atividade e as fontes pelo mesmo SSE.

O bridge não extrai cookies, não usa endpoints privados do ChatGPT e não tenta esconder automação.

## Níveis

| ID da API | Opção no ChatGPT |
| --- | --- |
| `gpt-5.5` | Instantâneo |
| `gpt-5.6-sol` | Médio |
| `gpt-5.6-sol-thinking` | Alto |

Os aliases seguem o SKMake: `flash` e `medium` usam Instantâneo; `high` usa Médio; `pro` e `specialized` usam Alto.

## Instalação na VM

Recomendado: 2 CPUs, 4 GB de RAM, disco persistente e Docker Compose.

```bash
cd ~/qwen-bridge
git pull
cp .env.example .env
nano .env
docker compose down --remove-orphans
docker compose up -d --build
docker logs -f chatgpt-bridge
```

Na primeira inicialização, o bridge:

1. Empacota e assina a extensão com uma chave criada no volume persistente.
2. Registra o pacote local no Google Chrome para Linux.
3. Abre o Chrome normal em um display virtual.
4. Espera a extensão conectar ao WebSocket local.

A chave de assinatura, o pacote da extensão, o perfil e as conversas ficam no volume `chatgpt-state`.

## Login manual

Não digite senha por uma porta HTTP pública. Use HTTPS ou abra um túnel SSH:

```powershell
gcloud compute ssh instance-20260722-055446 `
  --project=project-cf711618-b4f4-4493-947 `
  --zone=us-central1-a `
  --ssh-flag="-L 3001:localhost:3001"
```

Com o túnel aberto, acesse:

```text
http://localhost:3001/setup
```

Informe `CHATGPT_BRIDGE_API_KEY`, controle o Chrome remoto e faça o login. A rota `/health` retorna `status: "ok"` quando a extensão encontra o campo de mensagem do ChatGPT.

## Variáveis

```env
PORT=3001
CHATGPT_BRIDGE_API_KEY=uma-chave-longa-e-aleatoria
CHATGPT_STATE_DIR=/data
CHATGPT_GENERATION_TIMEOUT_MS=480000
MAX_QUEUE_SIZE=20
QUEUE_TIMEOUT_MS=120000
MAX_BODY_SIZE=2mb
ALLOWED_ORIGIN=https://skmake.vercel.app
```

Variáveis opcionais:

```env
CHATGPT_CHROME_BIN=google-chrome
CHATGPT_CHROME_AUTOSTART=true
CHATGPT_SYSTEM_PROMPT=Prompt personalizado
```

Não coloque e-mail, senha, cookies ou tokens de sessão no `.env`.

## Variáveis no SKMake

Enquanto o SKMake mantiver os nomes antigos:

```env
QWEN_BRIDGE_URL=https://ENDERECO-PROTEGIDO-DO-BRIDGE
QWEN_BRIDGE_API_KEY=a-mesma-chave-do-CHATGPT_BRIDGE_API_KEY
```

O SKMake fixa o mapeamento dos níveis no código, portanto variáveis antigas `QWEN_BRIDGE_MODEL_*` podem ser removidas da Vercel.

## API

- `POST /v1/chat/completions`
- `GET /v1/models`
- `POST /v1/conversations/:id/cancel`
- `GET /health`
- `GET /setup`

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

## Diagnóstico

```bash
docker ps -a
docker logs chatgpt-bridge --tail 150
curl -i http://localhost:3001/health
```

Estados do healthcheck:

- `extension_connecting`: Chrome ou extensão ainda iniciando.
- `login_required`: extensão conectada, mas falta entrar no ChatGPT.
- `ok`: conta conectada e pronta.

## Limitações e segurança

- A interface do ChatGPT pode mudar e exigir atualização dos seletores.
- O bridge não é uma integração oficial da API da OpenAI.
- Não publique `/setup` sem HTTPS ou túnel SSH.
- Não envie o volume, o perfil, a chave da extensão ou capturas autenticadas ao GitHub.
- Uma única janela atende uma geração por vez.
- O uso deve respeitar os termos e limites da conta conectada.
