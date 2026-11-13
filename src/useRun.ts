import { useCallback, useEffect, useRef, useState } from 'react';
import { eventEnvelopeSchema, type EventEnvelope } from '../shared/events.js';
import type { RunState } from '../shared/domain.js';

export interface RunSession {
  conversationId: string;
  runId: string;
  questionId: string;
  text: string;
  state: RunState;
  error: string | null;
  lastSeq: number;
}

function terminal(state: RunState): boolean {
  return ['completed', 'clarification_required', 'cancelled', 'failed', 'interrupted'].includes(state);
}

export function useRun() {
  const [session, setSession] = useState<RunSession | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const generationRef = useRef(0);

  const detach = useCallback(() => {
    generationRef.current += 1;
    sourceRef.current?.close();
    sourceRef.current = null;
    setSession(null);
  }, []);

  const connect = useCallback((conversationId: string, runId: string, questionId: string) => {
    generationRef.current += 1;
    const generation = generationRef.current;
    sourceRef.current?.close();
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    sourceRef.current = source;
    setSession({
      conversationId, runId, questionId, text: '', state: 'received', error: null, lastSeq: -1,
    });

    const handle = (message: MessageEvent<string>) => {
      if (generation !== generationRef.current) return;
      let event: EventEnvelope;
      try {
        event = eventEnvelopeSchema.parse(JSON.parse(message.data) as unknown);
      } catch {
        return;
      }
      if (event.runId !== runId || event.conversationId !== conversationId) return;
      setSession((current) => {
        if (generation !== generationRef.current) return current;
        if (!current || current.runId !== runId || current.conversationId !== conversationId) return current;
        if (event.seq < current.lastSeq || (event.type !== 'snapshot' && event.seq <= current.lastSeq)) return current;
        if (event.type === 'snapshot') {
          return {
            ...current,
            text: event.payload.answerText ?? '',
            state: event.payload.run.state,
            lastSeq: Math.max(current.lastSeq, event.seq),
          };
        }
        if (event.type === 'answer_delta') {
          return { ...current, text: current.text + event.payload.text, lastSeq: event.seq };
        }
        if (event.type === 'status') {
          return { ...current, state: event.payload.state, lastSeq: event.seq };
        }
        if (event.type === 'error') {
          return { ...current, error: event.payload.userMessage, lastSeq: event.seq };
        }
        if (event.type === 'done') {
          return { ...current, state: event.payload.state, lastSeq: event.seq };
        }
        return { ...current, lastSeq: event.seq };
      });
      if (event.type === 'done') {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      }
    };

    const eventTypes = ['snapshot', 'status', 'recall', 'search', 'sources', 'answer_delta', 'result_ready', 'done', 'error'];
    for (const type of eventTypes) source.addEventListener(type, handle as EventListener);
    return () => {
      if (generation === generationRef.current) {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      }
    };
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    sourceRef.current?.close();
  }, []);

  const isActive = session !== null && !terminal(session.state);
  return { session, isActive, connect, detach };
}

