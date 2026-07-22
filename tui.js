#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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
  print('     SELETOR DE PROJETO - TERMINAL QWEN', 'cyan');
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
      options.push('⬆️  Voltar');
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

    // Check for special options FIRST (they have emojis that would break path joining)
    if (selected.startsWith('⬆️')) {
      currentPath = path.dirname(currentPath);
    } else if (selected.startsWith('✅')) {
      return currentPath;
    } else if (selected.startsWith('❌')) {
      return null;
    } else {
      // It's a folder - remove only the folder emoji
      const folderName = selected.replace('📁 ', '');
      currentPath = path.join(currentPath, folderName);
    }
  }
}

async function main() {
  try {
    printHeader();
    print('Selecione um projeto para analisar', 'yellow');
    console.log();

    const selectedPath = await selectFolder();
    rl.close();

    if (!selectedPath) {
      print('\n👋 Cancelado', 'yellow');
      process.exit(0);
    }

    print(`\n🚀 Iniciando terminal com projeto: ${selectedPath}`, 'green');
    console.log();

    // Start the TUI app with the project path
    const appProcess = spawn('node', [path.join(__dirname, 'tui', 'App.js')], {
      cwd: __dirname,
      env: {
        ...process.env,
        PROJECT_PATH: selectedPath,
      },
      stdio: 'inherit',
    });

    appProcess.on('exit', (code) => {
      process.exit(code);
    });
  } catch (err) {
    print(`\n❌ Error: ${err.message}`, 'red');
    process.exit(1);
  }
}

main();
