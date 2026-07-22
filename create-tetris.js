import axios from 'axios';
import fs from 'fs';

const createTetris = async () => {
  try {
    const payload = JSON.parse(fs.readFileSync('./create-tetris.json', 'utf-8'));
    
    console.log('🎮 Pedindo ao Qwen para criar Tetris...\n');
    const startTime = Date.now();
    
    const response = await axios.post('http://localhost:3001/v1/chat/completions', payload, {
      headers: {
        'Authorization': 'Bearer sk-qwen-local-key-12345',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Resposta recebida em ${elapsed}s\n`);
    
    // Verificar se arquivo foi criado
    if (fs.existsSync('./tetris.html')) {
      const size = fs.statSync('./tetris.html').size;
      console.log(`✅ tetirahungreechs.html foi criado! (${size} bytes)`);
      console.log('\n🎮 Arquivo pronto para jogar!\n');
    } else {
      console.log('❌ Arquivo tetris.html NÃO foi criado');
    }
    
    console.log('📝 Resposta do Qwen:');
    console.log(response.data.choices[0].message.content);
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
};

createTetris();
