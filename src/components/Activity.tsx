import type { Readiness } from '../../shared/api.js';
import type { RunSession } from '../useRun.js';

const stateLabel: Record<string, string> = {
  received: 'Starting',
  recalling: 'Checking saved conversations',
  generating: 'Writing response',
  researching: 'Searching public sources',
  validating: 'Checking findings',
  completed: 'Complete',
  clarification_required: 'Needs clarification',
  cancelled: 'Stopped',
  failed: 'Could not complete',
  interrupted: 'Interrupted',
};

export function Activity({ readiness, session, error }: {
  readiness: Readiness | null;
  session: RunSession | null;
  error: string | null;
}) {
  return (
    <div className="activity" aria-live="polite">
      <span className={`readiness-dot ${readiness?.capabilities.liveGeneration ? 'ready' : 'offline'}`} />
      <span>{readiness?.capabilities.liveGeneration ? 'Ready' : 'Offline mode'}</span>
      {session && <span className="run-status">{stateLabel[session.state] ?? 'Working'}</span>}
      {error && <span className="inline-error">{error}</span>}
    </div>
  );
}
