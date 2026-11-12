import { useEffect, useState } from 'react';

interface Readiness {
  ok: boolean;
  mode: 'live' | 'offline';
  model: string | null;
  configured: {
    openai: boolean;
    tavily: boolean;
  };
  capabilities: {
    liveGeneration: boolean;
    search: boolean;
  };
  notes: string[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; readiness: Readiness }
  | { status: 'error'; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    fetch('/api/readiness')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Readiness request failed with status ${response.status}`);
        }
        return (await response.json()) as Readiness;
      })
      .then((readiness) => {
        if (active) setState({ status: 'ready', readiness });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Readiness request failed',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <header>
        <h1>Minimi agent</h1>
        <p className="subtitle">Durable, date-aware research with inspectable evidence.</p>
      </header>

      <section className="panel" aria-live="polite">
        <h2>Readiness</h2>
        {state.status === 'loading' && <p>Checking local configuration…</p>}
        {state.status === 'error' && <p className="error">{state.message}</p>}
        {state.status === 'ready' && (
          <>
            <dl>
              <div>
                <dt>Mode</dt>
                <dd>{state.readiness.mode}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{state.readiness.model ?? 'not configured'}</dd>
              </div>
              <div>
                <dt>OpenAI</dt>
                <dd>{state.readiness.configured.openai ? 'configured' : 'missing'}</dd>
              </div>
              <div>
                <dt>Tavily</dt>
                <dd>{state.readiness.configured.tavily ? 'configured' : 'missing'}</dd>
              </div>
              <div>
                <dt>Live generation</dt>
                <dd>{state.readiness.capabilities.liveGeneration ? 'available' : 'unavailable'}</dd>
              </div>
            </dl>
            {state.readiness.notes.length > 0 && (
              <ul className="notes">
                {state.readiness.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="panel muted">
        <h2>Chat</h2>
        <p>Chat is not available in this checkpoint. No answer is generated or fabricated.</p>
      </section>
    </main>
  );
}
