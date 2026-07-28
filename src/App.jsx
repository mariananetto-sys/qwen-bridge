import { useEffect, useState } from "react";
import "./App.css";

const levels = [
  { id: "gpt-5.5", name: "Instantâneo", description: "Respostas rápidas para tarefas diretas." },
  { id: "gpt-5.6-sol", name: "Médio", description: "Raciocínio equilibrado para trabalho cotidiano." },
  { id: "gpt-5.6-sol-thinking", name: "Alto", description: "Mais tempo de raciocínio para pedidos complexos." },
];

function Mark({ ready }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="8" />
      <path d="M10 11.5h12M10 16h12M10 20.5h7" />
      <circle className={ready ? "mark-ready" : ""} cx="23" cy="22" r="2.5" />
    </svg>
  );
}

function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/health", { cache: "no-store" });
        const data = await response.json();
        if (active) {
          setHealth(data);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };
    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const ready = health?.browserReady === true;
  const status = error
    ? "Servidor inacessível"
    : ready
      ? "Conta conectada"
      : "Login necessário";

  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ChatGPT Bridge">
          <span className="brand-mark"><Mark ready={ready} /></span>
          <span>ChatGPT Bridge</span>
        </a>
        <a className="setup-link" href="/setup">Abrir conexão</a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Bridge privado · Chrome persistente</p>
          <h1>Uma sessão do ChatGPT conectada ao SKMake.</h1>
        </div>
        <div className="hero-status" aria-live="polite">
          <span className={`status-line ${ready ? "ready" : ""}`}>{status}</span>
          <dl>
            <div>
              <dt>Em execução</dt>
              <dd>{health?.activeGenerations ?? "—"}</dd>
            </div>
            <div>
              <dt>Na fila</dt>
              <dd>{health?.queuedGenerations ?? "—"}</dd>
            </div>
            <div>
              <dt>Navegador</dt>
              <dd>{health?.browserChannel ?? "Chrome"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="levels" aria-labelledby="levels-title">
        <div className="section-heading">
          <p className="eyebrow">Níveis expostos</p>
          <h2 id="levels-title">Somente o que existe na conta.</h2>
        </div>
        <div className="level-list">
          {levels.map((level, index) => (
            <article className="level" key={level.id} style={{ "--delay": `${index * 80}ms` }}>
              <span className="level-index">0{index + 1}</span>
              <div>
                <h3>{level.name}</h3>
                <p>{level.description}</p>
              </div>
              <code>{level.id}</code>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
