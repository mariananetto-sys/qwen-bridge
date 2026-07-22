import axios from 'axios';
import fs from 'fs';

const testSimple = async () => {
  try {
    const payload = JSON.parse(fs.readFileSync('./simple-test.json', 'utf-8'));
    
    console.log('📤 Enviando request simples ao Qwen...\n');
    const startTime = Date.now();
    
    const response = await axios.post('http://localhost:3001/v1/chat/completions', payload, {
      headers: {
        'Authorization': 'Bearer sk-qwen-local-key-12345',
        'Content-Type': 'application/json'
      },
      timeout: 120000 //  2 minutos
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Resposta recebida em ${elapsed}s\n`);
    console.log('📝 Resposta completa:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
};

testSimple();
