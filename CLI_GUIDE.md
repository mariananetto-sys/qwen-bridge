# 🤖 Qwen Code Terminal v1.0

Um CLI interativo que funciona direto no terminal do seu computador. Sem bugues do Continue, sem precisar abrir interfaces fancy. Seleciona a pasta que você quer e conversa com a IA direto no terminal.

## ⚡ Como Começar

### Passo 1: Abra dois terminais

Terminal 1 - Rodar o servidor:
```bash
npm run server
```

Terminal 2 - Rodar o CLI:
```bash
npm run cli
```

## 📋 O que Você Pode Fazer

### 1️⃣ **Explorar Projetos** 
- Navega pelas pastas do seu PC
- Vê toda a estrutura de arquivos
- Mostra as dependências (se tiver package.json)
- Conta o total de arquivos

### 2️⃣ **Chat em Tempo Real**
- Seleciona um projeto
- Conversa com a IA sobre o código
- Peça para criar/modificar arquivos
- A IA tem contexto completo do seu projeto

## 🎮 Como Usar

### Menu Principal
```
╠════════════════════════════════════════╣
║     🤖 Qwen Code Terminal v1.0       ║
╠════════════════════════════════════════╣

O que deseja fazer?

  1. 📂 Explorar e analisar um projeto
  2. 💬 Chat com um projeto
  3. ❌ Sair

Escolha (1-3):
```

### Navegando Pastas

Quando escolhe explorar, você vê:
```
📁 Caminho: C:\Users\lucas\Downloads

Opções:
  1. ⬆️  Voltar para pasta anterior
  2. 📁 htmls antigravity etc
  3. 📁 projetos
  4. ✅ Selecionar esta pasta
  5. ❌ Cancelar

Escolha (número):
```

Você digita o número e:
- **Números de pasta** = entra nela
- **"Selecionar"** = escolhe e mostra análise
- **"Voltar"** = sobe um nível
- **"Cancelar"** = cancela tudo

### Análise do Projeto

Quando seleciona uma pasta, vê:
- 📂 Estrutura completa (até 25 arquivos/pastas)
- 📦 Dependências principais do package.json
- 📊 Total de arquivos

### Chat

Depois vê um prompt:
```
Você:
```

Digite o que quer:
```
Crie um arquivo test.js com um teste simples
```

A IA responde:
```
🤖 Assistente:
Aqui está um test.js simples...
[resposta formatada]
```

Para sair do chat, digite `sair`.

## 🎯 Exemplos de Comando

```
"Qual é a estrutura deste projeto?"
"Crie um arquivo .env com as variáveis de exemplo"
"Explique o que faz a função X"
"Adicione um novo endpoint POST em /api/users"
"Corrija o erro na linha 42 de app.js"
```

## 🛠️ Características

✅ **Interface colorida e clara**
- Emojis para tudo
- Cores para diferenciar opções
- Fácil de ler e navegar

✅ **Zero bugs de Continue**
- Roda no terminal nativo
- Sem interface web bugado
- Direto do seu shell

✅ **Contexto completo**
- A IA vê toda estrutura do projeto
- Entende pack.json, dependências, etc
- Respostas mais inteligentes

✅ **Rápido e responsivo**
- Sem delays de interface
- Aparece tudo no mesmo terminal
- Timeout de 45 segundos por resposta

## ⚙️ Requisitos

- Node.js 16+ instalado
- Servidor rodando (`npm run server`)
- Conexão com Qwen (via Playwright)

## 🐛 Se Algo Der Errado

### "Erro ao conectar"
→ Verifique se `npm run server` está rodando em outro terminal
→ Verifique se a porta 3001 está livre

### "Timeout ao conectar"
→ O servidor pode estar processando outra request
→ Aguarde um pouco e tente novamente
→ Se persistir, reinicie o servidor

### "Opção inválida"
→ Digite um número que existe na lista
→ Verifique o intervalo (1-3, 1-5, etc)

### Terminal congela
→ Pressione Ctrl+C para sair
→ Feche o terminal e abra outro

## 📝 Arquivos Criados

```
cli.js              <- O programa principal da CLI
package.json        <- Atualizado com script "cli"
CLI_GUIDE.md        <- Este arquivo
```

## 🔄 Fluxo Típico

1. Abra terminal 1: `npm run server`
2. Abra terminal 2: `npm run cli`
3. Escolha opção 1 ou 2
4. Navegue até sua pasta
5. Veja análise ou comece chat
6. Converse com a IA sobre seu projeto
7. Digite `sair` para voltar ao menu

## 💡 Dicas

- Use números, não texto (digita "1", não "explorar")
- O CLI ignora automaticamente node_modules, .git, etc
- Máximo 25 arquivos/pastas mostrados por vez
- Máximo 45 segundos de timeout por resposta
- Se ficar muito lento, é culpa do servidor, não da CLI

---

**Qwen Code Terminal v1.0** - Feito para você, desenvolvedor! 🎉

