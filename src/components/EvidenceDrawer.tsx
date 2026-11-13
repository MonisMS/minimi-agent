import { useEffect, useRef } from 'react';
import type { SourceObservation } from '../../shared/domain.js';

function knownDate(value: string | null): string {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : date.toLocaleString();
}

export function EvidenceDrawer({ observation, onClose }: {
  observation: SourceObservation | null;
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!observation) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const focusable = dialog?.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previousFocusRef.current?.focus();
    };
  }, [observation, onClose]);

  if (!observation) return null;
  const effectiveExcerpt = observation.effectiveAtSpan
    ? observation.exactEvidenceText.slice(observation.effectiveAtSpan.start, observation.effectiveAtSpan.endExclusive)
    : null;

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <div className="drawer-heading">
          <div><p className="eyebrow">Saved source capture</p><h2 id="evidence-title">Evidence</h2></div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close evidence">×</button>
        </div>
        <h3>{observation.title || 'Untitled source'}</h3>
        <dl className="evidence-dates">
          <div><dt>Published</dt><dd>{knownDate(observation.publishedAt)}</dd></div>
          <div><dt>Captured</dt><dd>{knownDate(observation.providerCaptureAt ?? observation.retrievedAt)}</dd></div>
          <div><dt>Effective</dt><dd>{knownDate(observation.effectiveAt)}</dd></div>
        </dl>
        {effectiveExcerpt && <blockquote><strong>Effective date evidence:</strong> {effectiveExcerpt}</blockquote>}
        <pre className="evidence-excerpt">{observation.exactEvidenceText}</pre>
        <a className="source-link" href={observation.originalUrl} target="_blank" rel="noreferrer">Open current source page ↗</a>
        <p className="drawer-note">The excerpt above is the saved capture used for this result. The link opens the live page, which may have changed.</p>
      </section>
    </div>
  );
}
