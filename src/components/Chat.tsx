import type { MessageView } from '../../shared/api.js';
import type { RunSession } from '../useRun.js';
import { Activity } from './Activity.js';
import { Composer } from './Composer.js';
import { Comparison } from './Comparison.js';

const retryStates = new Set(['failed', 'cancelled', 'interrupted']);

export function Chat({
  conversationId,
  messages,
  session,
  readiness,
  error,
  draft,
  loading,
  submitting,
  onDraft,
  onSend,
  onStop,
  onRetry,
  onRecheck,
}: {
  conversationId: string | null;
  messages: MessageView[];
  session: RunSession | null;
  readiness: import('../../shared/api.js').Readiness | null;
  error: string | null;
  draft: string;
  loading: boolean;
  submitting: boolean;
  onDraft(value: string): void;
  onSend(): void;
  onStop(): void;
  onRetry(question: MessageView): void;
  onRecheck(baselineId: string | null): void;
}) {
  const questionIdsWithAnswer = new Set(messages
    .filter((message) => message.role === 'assistant' && message.runId)
    .map((message) => message.runId));

  return (
    <main className="chat-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Conversation</h1>
        </div>
        <Activity readiness={readiness} session={session} error={error} />
      </header>

      {!conversationId ? (
        <section className="welcome-state">
          {error && <p className="error-banner" role="alert">{error}</p>}
          <p className="eyebrow">A clear record of what you asked</p>
          <h2>Keep the context. Check the evidence.</h2>
          <p>Start a conversation to ask a question, find saved discussions, or research current information.</p>
        </section>
      ) : (
        <>
          <section className="message-list" aria-label="Conversation messages" aria-busy={loading}>
            {loading && <p className="empty-note">Loading saved messages…</p>}
            {!loading && messages.length === 0 && (
              <div className="empty-state"><h2>What would you like to know?</h2><p>Your saved questions and answers will stay in this conversation.</p></div>
            )}
            {messages.map((message) => {
              const retry = message.role === 'user'
                && message.runId
                && retryStates.has(message.runState ?? '')
                && !questionIdsWithAnswer.has(message.runId);
              return (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-label">{message.role === 'user' ? 'You' : 'Minimi'}</div>
                  <div className="message-body">{message.originalText}</div>
                  {retry && <button type="button" className="text-button" onClick={() => onRetry(message)}>Retry this question</button>}
                  {message.role === 'assistant' && message.resultId && <Comparison resultId={message.resultId} onRecheck={onRecheck} />}
                </article>
              );
            })}
            {session?.conversationId === conversationId && !questionIdsWithAnswer.has(session.runId) && (
              <article className="message assistant live-answer" aria-live="polite">
                <div className="message-label">Minimi</div>
                <div className="message-body">{session.text || 'Working on your answer…'}</div>
                {session.error && <p className="error-copy">{session.error}</p>}
              </article>
            )}
          </section>
          <footer className="composer-wrap">
            {error && <p className="error-banner" role="alert">{error}</p>}
            <Composer
              value={draft}
              busy={Boolean(session?.conversationId === conversationId && !['completed', 'clarification_required', 'cancelled', 'failed', 'interrupted'].includes(session.state))}
              canSend={!loading && !submitting && Boolean(conversationId)}
              onChange={onDraft}
              onSend={onSend}
              onStop={onStop}
            />
          </footer>
        </>
      )}
    </main>
  );
}
