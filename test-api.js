import axios from 'axios';

const testAPI = async () => {
  try {
    const response = await axios.post('http://localhost:3001/v1/chat/completions', {
      model: 'qwen',
      messages: [
        {
          role: 'user',
          content: 'Crie um arquivo HTML chamado test-game.html com um jogo simples de clicker. Use a ferramenta write_file para criar o arquivo.'
        }
      ]
    }, {
      headers: {
        'Authorization': 'Bearer sk-qwen-local-key-12345',
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    console.log('✅ Status:', response.status);
    console.log('\n📝 Resposta completa:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
};

testAPI();
