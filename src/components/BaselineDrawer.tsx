import { useEffect, useRef, useState } from 'react';
import type { MessageView, VerificationResultResponse } from '../../shared/api.js';
import { getMessages } from '../api.js';

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : date.toLocaleString();
}

export function BaselineDrawer({ response, onClose }: {
  response: VerificationResultResponse;
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [exchange, setExchange] = useState<MessageView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const snapshot = response.baselineSnapshot;
  const original = response.baselineOriginal;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!original) return;
    let active = true;
    getMessages(original.conversationId).then((messages) => {
      if (!active) return;
      const relevant = messages.filter((message) => message.id === original.id ||
        (original.runId !== null && message.runId === original.runId));
      setExchange(relevant);
    }).catch(() => { if (active) setLoadError('The saved exchange could not be loaded.'); });
    return () => { active = false; };
  }, [original]);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="baseline-title">
        <div className="drawer-heading">
          <div><p className="eyebrow">Original decision</p><h2 id="baseline-title">Saved baseline</h2></div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close saved baseline">×</button>
        </div>
        {snapshot && <p className="revision-label">{snapshot.state.replaceAll('_', ' ')} · Revision {snapshot.revision}</p>}
        <p className="baseline-date">{dateLabel(original?.createdAt)}</p>
        {!original ? <p>No saved original message is available.</p> : (
          <div className="saved-exchange">
            {loadError && <p role="alert">{loadError}</p>}
            {(exchange.length ? exchange : [original]).map((message) => (
              <article className={`saved-turn ${message.role}`} key={message.id}>
                <strong>{message.role === 'user' ? 'You' : 'Minimi'}</strong>
                <p>{message.originalText}</p>
                <small>{dateLabel(message.createdAt)}</small>
              </article>
            ))}
          </div>
        )}
        {snapshot && <>
          <h3>Recorded constraints</h3>
          <ul className="constraint-list">
            <li>Team size: {snapshot.constraints.teamSize ?? 'Unknown'}</li>
            <li>Budget: {snapshot.constraints.budget ? `${snapshot.constraints.budget.currency} ${snapshot.constraints.budget.amountDecimal}` : 'Unknown'}</li>
            <li>Region: {snapshot.constraints.region ?? 'Unknown'}</li>
          </ul>
          <h3>All saved options ({response.result.members.length})</h3>
          <ul className="member-list">{response.result.members.map((member) => <li key={member.memberId}>
            {[member.vendor, member.product, member.plan].filter(Boolean).join(' · ') || member.aliases.join(', ')}
          </li>)}</ul>
        </>}
      </section>
    </div>
  );
}
