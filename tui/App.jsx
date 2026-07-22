#!/usr/bin/env node

import React, { useState, useEffect } from 'react';
import { render, Box } from 'ink';
import axios from 'axios';
import Layout from './components/Layout.js';
import Chat from './components/Chat.js';
import Input from './components/Input.js';

/**
 * App Component
 * Main TUI application connecting to Qwen backend
 */
function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projectPath, setProjectPath] = useState(process.env.PROJECT_PATH || '.');
  const [error, setError] = useState(null);

  // Handle keyboard input
  const handleInput = async (inputChar, key) => {
    // Exit on Ctrl+C
    if (key.ctrl && inputChar === 'c') {
      process.exit(0);
    }

    // Send message on Enter
    if (key.return) {
      if (!input.trim()) return;

      const userMessage = input;
      setInput('');
      setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
      
      await sendMessage(userMessage);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }

    // Regular character input
    if (inputChar) {
      setInput(prev => prev + inputChar);
    }
  };

  // Send message to backend
  const sendMessage = async (userMessage) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.post(
        'http://localhost:3001/v1/chat/completions',
        {
          messages: [
            {
              role: 'system',
              content: `Você está ajudando um desenvolvedor no projeto localizado em: ${projectPath}. Responda de forma clara e concisa.`,
            },
            ...messages,
            { role: 'user', content: userMessage },
          ],
          model: 'qwen-mini',
        },
        {
          headers: {
            'Authorization': 'Bearer sk-qwen-local-key-12345',
          },
          timeout: 480000, // 8 minutes
        }
      );

      const assistantMessage = response.data.choices?.[0]?.message?.content || 'No response';
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: assistantMessage },
      ]);

    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Unknown error';
      setError(`Error: ${errorMsg}`);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `❌ ${errorMsg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Use keyboard input hook from ink
  const { useInput } = require('ink');
  useInput(handleInput);

  return (
    <Layout title="QWEN TUI v1.0">
      <Chat messages={messages} />
      <Input value={input} isLoading={isLoading} />
    </Layout>
  );
}

render(<App />);
