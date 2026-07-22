#!/usr/bin/env node

/**
 * TUI Entry Point Loader
 * Handles JSX transpilation and app initialization
 */

import React from 'react';
import { render, Box, Text, useInput } from 'ink';
import axios from 'axios';

// Components inline to avoid .jsx issue
function Layout({ children, title }) {
  return (
    React.createElement(Box, { flexDirection: "column", width: 100, height: 30 },
      React.createElement(Box, {
        borderStyle: "round",
        borderColor: "cyan",
        paddingX: 1,
        paddingY: 0,
        marginBottom: 1
      },
        React.createElement(Text, { bold: true, color: "cyan" },
          `🤖 ${title || 'QWEN TUI'}`
        )
      ),
      React.createElement(Box, { flexDirection: "column", flexGrow: 1, marginBottom: 1 },
        children
      ),
      React.createElement(Box, { borderStyle: "round", borderColor: "gray" },
        React.createElement(Text, { dimColor: true },
          'Ctrl+C para sair'
        )
      )
    )
  );
}

function Chat({ messages }) {
  const getColor = (role) => {
    switch (role) {
      case 'user': return 'cyan';
      case 'assistant': return 'green';
      case 'system': return 'gray';
      default: return 'white';
    }
  };

  const getPrefix = (role) => {
    switch (role) {
      case 'user': return '👤';
      case 'assistant': return '🤖';
      case 'system': return '⚙️ ';
      default: return '•';
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'user': return 'Você';
      case 'assistant': return 'Assistente';
      case 'system': return 'Sistema';
      default: return role;
    }
  };

  return React.createElement(
    Box,
    { flexDirection: "column", flexGrow: 1, overflowY: "hidden" },
    (!messages || messages.length === 0)
      ? React.createElement(Box, {
          borderStyle: "round",
          borderColor: "yellow",
          paddingX: 1,
          paddingY: 1
        },
          React.createElement(Text, { dimColor: true },
            'Nenhuma mensagem ainda. Digite algo para começar...'
          )
        )
      : messages.map((msg, idx) =>
          React.createElement(Box, { key: idx, flexDirection: "column", marginBottom: 0.5 },
            React.createElement(Box, null,
              React.createElement(Text, {
                color: getColor(msg.role),
                bold: true
              },
                `${getPrefix(msg.role)} ${getRoleLabel(msg.role)}:`
              )
            ),
            React.createElement(Box, { paddingX: 2 },
              React.createElement(Text, { wrap: "wrap" }, msg.content)
            )
          )
        )
  );
}

function Input({ value, isLoading }) {
  return React.createElement(
    Box,
    {
      borderStyle: "round",
      borderColor: isLoading ? "yellow" : "cyan",
      paddingX: 1,
      paddingY: 0
    },
    React.createElement(Box, { marginRight: 1 },
      React.createElement(Text, {
        bold: true,
        color: isLoading ? "yellow" : "cyan"
      },
        isLoading ? '⏳' : '> '
      )
    ),
    React.createElement(Text, null, value),
    !isLoading && React.createElement(Text, { color: "gray", dimColor: true }, ' | ')
  );
}

// Main App Component
function App() {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [projectPath] = React.useState(process.env.PROJECT_PATH || '.');

  const handleInput = async (inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      process.exit(0);
    }

    if (key.return) {
      if (!input.trim()) return;
      const userMessage = input;
      setInput('');
      setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
      await sendMessage(userMessage, messages);
      return;
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }

    if (inputChar) {
      setInput(prev => prev + inputChar);
    }
  };

  const sendMessage = async (userMessage, currentMessages) => {
    setIsLoading(true);

    try {
      const response = await axios.post(
        'http://localhost:3001/v1/chat/completions',
        {
          messages: [
            {
              role: 'system',
              content: `Você está ajudando um desenvolvedor no projeto localizado em: ${projectPath}. Responda de forma clara e concisa.`,
            },
            ...currentMessages,
            { role: 'user', content: userMessage },
          ],
          model: 'qwen-mini',
        },
        {
          headers: {
            'Authorization': 'Bearer sk-qwen-local-key-12345',
          },
          timeout: 480000,
        }
      );

      const assistantMessage = response.data.choices?.[0]?.message?.content || 'Sem resposta';
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: assistantMessage },
      ]);

    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Erro desconhecido';
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `❌ ${errorMsg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  useInput(handleInput);

  return React.createElement(
    Layout,
    { title: "TERMINAL QWEN v1.0" },
    React.createElement(Chat, { messages }),
    React.createElement(Input, { value: input, isLoading })
  );
}

render(React.createElement(App));
