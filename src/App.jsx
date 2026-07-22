import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './App.css';

const socket = io('http://localhost:3001');

// Componente para Blocos de Código Formatados (O Cubo)
const CodeBlock = ({ inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return <code className="inline-code" {...props}>{children}</code>;
  }

  return (
    <div className="code-container">
      <div className="code-header">
        <span className="code-lang">{match ? match[1] : 'text'}</span>
        <button className="copy-btn" onClick={handleCopy}>
          {copied ? '✅ Copiado!' : '📋 Copiar'}
        </button>
      </div>
      <SyntaxHighlighter
        children={String(children).replace(/\n$/, '')}
        style={vscDarkPlus}
        language={match ? match[1] : 'text'}
        PreTag="div"
        className="syntax-highlighter"
        {...props}
      />
    </div>
  );
};

// Componente para o efeito de máquina de escrever
const Typewriter = ({ text, speed = 2, onComplete }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev) => prev + text[index]);
        setIndex((prev) => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else if (onComplete) {
      onComplete();
    }
  }, [index, text, speed, onComplete]);

  return (
    <div className="markdown-content">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{ code: CodeBlock }}
      >
        {displayedText}
      </ReactMarkdown>
    </div>
  );
};

function App() {
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Olá! Sou o Qwen. Como posso ajudar você hoje?' }
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentModel, setCurrentModel] = useState('Qwen3.6-Plus');
  const [showModels, setShowModels] = useState(false);
  const [history, setHistory] = useState([]);
  const messagesEndRef = useRef(null);

  const models = ['Qwen3.6-Plus', 'Qwen3.5-Plus', 'Qwen3.5-Omni-Plus'];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  useEffect(() => {
    socket.on('status', (data) => {
      setIsReady(data.ready);
      if (data.currentModel) setCurrentModel(data.currentModel);
    });

    socket.on('thinking', (value) => {
      setIsThinking(value);
    });

    socket.on('response', (data) => {
      setMessages(prev => [...prev, { role: 'ai', text: data.text, animated: false }]);
      // Atualiza histórico após resposta
      socket.emit('fetch_history');
    });

    socket.on('history', (data) => {
      setHistory(data);
    });

    socket.on('status', (data) => {
      setIsReady(data.ready);
      if (data.currentModel) setCurrentModel(data.currentModel);
      if (data.chatSelected) {
        // Quando um chat é selecionado, poderíamos limpar e recarregar, 
        // mas aqui vamos apenas aguardar a próxima interação ou carregar um resumo
        setMessages([{ role: 'ai', text: `Conversa "${data.chatSelected}" carregada. Como posso continuar?` }]);
      }
    });

    // Busca inicial
    socket.emit('fetch_history');

    socket.on('error', (msg) => {
      alert(msg);
    });

    return () => {
      socket.off('status');
      socket.off('thinking');
      socket.off('response');
      socket.off('error');
    };
  }, []);

  const handleSend = () => {
    if (!input.trim() || !isReady || isThinking) return;

    setMessages(prev => [...prev, { role: 'user', text: input }]);
    socket.emit('ask', { message: input });
    setInput('');
  };

  const handleNewChat = () => {
    setMessages([{ role: 'ai', text: 'Olá! Sou o Qwen. Como posso ajudar você hoje?' }]);
    setIsReady(false);
    socket.emit('new_chat');
  };

  const handleModelChange = (model) => {
    setCurrentModel(model);
    setShowModels(false);
    setIsReady(false);
    socket.emit('switch_model', { model });
  };

  const handleSelectChat = (title) => {
    setIsReady(false);
    socket.emit('select_chat', { title });
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">Qwen Mini</div>
        <button className="new-chat-btn" onClick={handleNewChat}>
          <span>+</span> Novo Chat
        </button>

        <div className="model-selector-container">
          <div className="model-label">Modelo</div>
          <div className="model-current" onClick={() => setShowModels(!showModels)}>
            {currentModel}
            <span className={`chevron ${showModels ? 'open' : ''}`}>▼</span>
          </div>
          {showModels && (
            <div className="model-options">
              {models.map(m => (
                <div 
                  key={m} 
                  className={`model-option ${currentModel === m ? 'active' : ''}`}
                  onClick={() => handleModelChange(m)}
                >
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="history-section">
          <div className="history-header">
            <span>Histórico</span>
            <button className="sync-btn" onClick={() => socket.emit('fetch_history')}>🔄</button>
          </div>
          <div className="history-list">
            {history.map((chat, idx) => (
              <div 
                key={idx} 
                className="history-item"
                onClick={() => handleSelectChat(chat.title)}
                title={chat.title}
              >
                <span className="history-icon">💬</span>
                <span className="history-title">{chat.title}</span>
              </div>
            ))}
            {history.length === 0 && <div className="history-empty">Nenhum chat encontrado</div>}
          </div>
        </div>

        <div style={{marginTop: 'auto', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
          Status: {isReady ? '🟢 Pronto' : '🟡 Conectando...'}
        </div>
      </aside>

      <main className="chat-main">
        <div className="messages-list">
          {messages.map((msg, i) => (
            <div key={i} className={`message-item ${msg.role === 'user' ? 'user-message' : ''}`}>
              <div className={`avatar ${msg.role === 'ai' ? 'ai' : ''}`}>
                {msg.role === 'ai' ? '🤖' : '👤'}
              </div>
              <div className="message-content">
                {msg.role === 'ai' && i === messages.length - 1 && !msg.animated ? (
                  <Typewriter 
                    text={msg.text} 
                    onComplete={() => {
                      const newMessages = [...messages];
                      newMessages[i].animated = true;
                      setMessages(newMessages);
                    }} 
                  />
                ) : (
                  <div className="markdown-content">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{ code: CodeBlock }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isThinking && (
            <div className="message-item">
              <div className="avatar ai">🤖</div>
              <div className="message-content thinking">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            <input 
              type="text" 
              placeholder={isReady ? "Pergunte algo ao Qwen..." : "Aguardando conexão..."} 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              disabled={!isReady || isThinking}
            />
            <button 
              className="send-btn" 
              onClick={handleSend}
              disabled={!isReady || isThinking || !input.trim()}
            >
              🚀
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
