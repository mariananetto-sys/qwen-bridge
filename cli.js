#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import http from 'http';
import { fileURLToPath } from 'url';

// Color codes para terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Converter markdown para texto de terminal
function markdownToTerminal(text) {
  if (!text) return '';
  
  return text
    // Remover headers (# ## ###)
    .replace(/^#{1,6}\s+/gm, '')
    // Converter **bold** para *asteriscos*
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // Converter *italic* para texto normal
    .replace(/\*(.*?)\*/g, '$1')
    // Converter `code` para 'quotes'
    .replace(/`([^`]+)`/g, "'$1'")
    // Converter code blocks ``` ``` 
    .replace(/```[\w]*\n?/g, '')
    // Converter box drawing e emojis de estrutura para ASCII
    .replace(/[│─┌┐└┘├┤┬┴┼]/g, '|')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (m) => {
      const map = { '①':'1','②':'2','③':'3','④':'4','⑤':'5','⑥':'6','⑦':'7','⑧':'8','⑨':'9','⑩':'10' };
      return map[m] || m;
    })
    // Converter listas markdown (- item ou * item) para - item
    .replace(/^[-*]\s+/gm, '- ')
    // Converter listas numeradas (1. item) para 1. item
    .replace(/^\d+\.\s+/gm, (m) => m)
    // Remover links [text](url)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remover imagens ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Limpar linhas vazias excessivas
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function prompt(question) {
  return new Promise(resolve => {
    rl.question(colors.cyan + question + colors.reset, resolve);
  });
}

function print(text, color = 'reset') {
  console.log(colors[color] + text + colors.reset);
}

function printHeader() {
  console.log('\n' + '─'.repeat(50));
  print('     QWEN CODE TERMINAL v1.0', 'cyan');
  console.log('─'.repeat(50) + '\n');
}

async function listDirectories(startPath = os.homedir()) {
  try {
    const items = fs.readdirSync(startPath);
    const dirs = items
      .filter(item => {
        try {
          return fs.statSync(path.join(startPath, item)).isDirectory() && !item.startsWith('.');
        } catch {
          return false;
        }
      })
      .sort();

    return { dirs, currentPath: startPath };
  } catch (err) {
    print(`Erro ao ler diretório: ${err.message}`, 'red');
    return { dirs: [], currentPath: startPath };
  }
}

async function selectFolder() {
  let currentPath = os.homedir();
  let selecting = true;

  while (selecting) {
    printHeader();
    print(`📁 Caminho: ${currentPath}`, 'blue');
    console.log();

    const { dirs } = await listDirectories(currentPath);

    const options = [];
    if (currentPath !== os.homedir()) {
      options.push('⬆️  Voltar para pasta anterior');
    }
    dirs.forEach(dir => {
      options.push(`📁 ${dir}`);
    });
    options.push('✅ Selecionar esta pasta');
    options.push('❌ Cancelar');

    console.log('Opções:');
    options.forEach((opt, i) => {
      print(`  ${i + 1}. ${opt}`, 'dim');
    });
    console.log();

    const choice = await prompt('Escolha (número): ');
    const index = parseInt(choice) - 1;

    if (isNaN(index) || index < 0 || index >= options.length) {
      print('❌ Opção inválida!', 'red');
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }

    const selected = options[index];

    if (selected.startsWith('⬆️')) {
      currentPath = path.dirname(currentPath);
    } else if (selected.startsWith('✅')) {
      return currentPath;
    } else if (selected.startsWith('❌')) {
      return null;
    } else {
      const folderName = selected.replace('📁 ', '');
      currentPath = path.join(currentPath, folderName);
    }
  }
}

async function analyzeProject(projectPath) {
  printHeader();
  print(`📊 Analisando: ${projectPath}`, 'green');
  console.log();

  try {
    // Ler estrutura do projeto
    const analyzeDir = (dir, depth = 0, maxDepth = 3) => {
      if (depth > maxDepth) return [];
      
      const items = fs.readdirSync(dir).sort();
      const results = [];

      items.forEach(item => {
        if (item.startsWith('.')) return;
        const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'venv'];
        if (ignoredDirs.includes(item)) {
          results.push('  '.repeat(depth) + `📦 ${item}/ (ignorado)`);
          return;
        }

        try {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            results.push('  '.repeat(depth) + `📁 ${item}/`);
            results.push(...analyzeDir(fullPath, depth + 1, maxDepth));
          } else {
            const ext = path.extname(item);
            const icon = getFileIcon(ext);
            const size = stat.size > 1024 ? `(${(stat.size / 1024).toFixed(1)}KB)` : `(${stat.size}B)`;
            results.push('  '.repeat(depth) + `${icon} ${item} ${colors.dim}${size}${colors.reset}`);
          }
        } catch {}
      });

      return results;
    };

    const structure = analyzeDir(projectPath);
    print('📂 Estrutura do projeto:', 'cyan');
    structure.slice(0, 25).forEach(line => console.log(line));
    
    if (structure.length > 25) {
      print(`   ... e mais ${structure.length - 25} itens`, 'dim');
    }

    // Ler package.json se existir
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        console.log();
        print('📦 Dependências principais:', 'cyan');
        if (pkg.dependencies) {
          Object.entries(pkg.dependencies)
            .slice(0, 5)
            .forEach(([name, version]) => {
              console.log(`   • ${name}: ${colors.dim}${version}${colors.reset}`);
            });
        }
      } catch {}
    }

    // Contar arquivos
    const countFiles = (dir) => {
      let total = 0;
      try {
        fs.readdirSync(dir).forEach(item => {
          if (item.startsWith('.')) return;
          const ignoredDirs = ['node_modules', '.git', 'dist', 'build'];
          if (ignoredDirs.includes(item)) return;

          const fullPath = path.join(dir, item);
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              total += countFiles(fullPath);
            } else {
              total++;
            }
          } catch {}
        });
      } catch {}
      return total;
    };

    const fileCount = countFiles(projectPath);
    console.log();
    print(`📊 Total de arquivos: ${fileCount}`, 'yellow');

  } catch (err) {
    print(`❌ Erro ao analisar: ${err.message}`, 'red');
  }
}

function getFileIcon(ext) {
  const icons = {
    '.js': '📜',
    '.jsx': '⚛️ ',
    '.ts': '📘',
    '.tsx': '⚛️ ',
    '.py': '🐍',
    '.json': '📋',
    '.css': '🎨',
    '.html': '🌐',
    '.md': '📝',
    '.yml': '⚙️ ',
    '.yaml': '⚙️ ',
  };
  return icons[ext] || '📄';
}

async function chatWithProject(projectPath) {
  printHeader();
  print(`💬 Chat com projeto: ${projectPath}`, 'green');
  print(`Você pode fazer perguntas, pedir para criar arquivos, etc.`, 'dim');
  print(`Digite 'sair' para voltar ao menu.`, 'dim');
  console.log();

  let chatting = true;
  while (chatting) {
    const message = await prompt('Você: ');

    if (message.toLowerCase() === 'sair') {
      break;
    }

    if (!message.trim()) continue;

    print('⏳ Conectando ao servidor...', 'yellow');

    try {
      const response = await sendToServer(message, projectPath);
      console.log();
      
      print('🤖 Assistente:', 'cyan');
      const cleanResponse = markdownToTerminal(response.content || response);
      console.log(cleanResponse);
      console.log();
    } catch (err) {
      print(`❌ Erro: ${err.message}`, 'red');
      console.log();
    }
  }
}

function sendToServer(message, projectPath) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `Você está ajudando um desenvolvedor no projeto localizado em: ${projectPath}. Responda de forma clara e concisa.`,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      model: 'qwen-mini',
    });

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer sk-qwen-local-key-12345',
      },
      timeout: 480000,
    };

    const req = http.request(options, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.message?.content || 'Sem resposta';
          resolve({ content });
        } catch (e) {
          resolve({ content: data || 'Erro ao processar resposta' });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao conectar (8 minutos) - Verifique se o servidor está rodando'));
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  try {
    let running = true;
    while (running) {
      printHeader();
      print('O que deseja fazer?', 'yellow');
      console.log();
      print('  1. 📂 Explorar e analisar um projeto', 'cyan');
      print('  2. 💬 Chat com um projeto', 'cyan');
      print('  3. ❌ Sair', 'red');
      console.log();

      const choice = await prompt('Escolha (1-3): ');

      if (choice === '1') {
        const selectedPath = await selectFolder();
        if (selectedPath) {
          await analyzeProject(selectedPath);
          console.log();
          await prompt('Pressione ENTER para voltar...');
        }
      } else if (choice === '2') {
        const selectedPath = await selectFolder();
        if (selectedPath) {
          await analyzeProject(selectedPath);
          console.log();
          await chatWithProject(selectedPath);
        }
      } else if (choice === '3') {
        print('\n👋 Até logo!', 'green');
        running = false;
      } else {
        print('❌ Opção inválida!', 'red');
      }
    }
  } catch (err) {
    print(`\n❌ Erro: ${err.message}`, 'red');
  } finally {
    rl.close();
    process.exit(0);
  }
}

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  main().catch(err => {
    print(`\n❌ Erro fatal: ${err.message}`, 'red');
    process.exit(1);
  });
}

export { selectFolder, analyzeProject, chatWithProject };
