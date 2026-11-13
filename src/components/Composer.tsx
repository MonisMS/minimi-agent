import { useEffect, useRef } from 'react';

interface ComposerProps {
  value: string;
  busy: boolean;
  canSend: boolean;
  onChange(value: string): void;
  onSend(): void;
  onStop(): void;
}

export function Composer({ value, busy, canSend, onChange, onSend, onStop }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [canSend]);

  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      <label className="sr-only" htmlFor="message-composer">Message</label>
      <textarea
        ref={ref}
        id="message-composer"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask a question or look something up…"
        rows={2}
        maxLength={20_000}
        disabled={!canSend}
        aria-describedby="composer-hint"
      />
      <div className="composer-actions">
        <span id="composer-hint">Enter to send · Shift+Enter for a new line</span>
        {busy ? (
          <button type="button" className="stop-button" onClick={onStop}>Stop</button>
        ) : (
          <button type="submit" disabled={!canSend || !value.trim()}>Send</button>
        )}
      </div>
    </form>
  );
}
