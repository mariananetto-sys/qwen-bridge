#!/usr/bin/env node

import readline from 'readline';

console.log('\n🤖 Qwen Code Terminal v1.0\n');
console.log('Menu:');
console.log('1. Explorar projeto');
console.log('2. Chat com projeto');
console.log('3. Sair\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Escolha uma opção: ', (answer) => {
  console.log(`Você escolheu: ${answer}`);
  rl.close();
});
