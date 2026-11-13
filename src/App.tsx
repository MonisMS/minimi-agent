import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationView, MessageView, Readiness } from '../shared/api.js';
import { ApiError, admitRun, cancelRun, createConversation, getMessages, getReadiness, listConversations } from './api.js';
import { Chat } from './components/Chat.js';
import { Sidebar } from './components/Sidebar.js';
import { useRun } from './useRun.js';

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function App() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const run = useRun();

  const refreshConversations = useCallback(async () => {
    const next = await listConversations();
    setConversations(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getReadiness(), listConversations()])
      .then(([ready, items]) => {
        if (!active) return;
        setReadiness(ready);
        setConversations(items);
        selectedIdRef.current = items[0]?.id ?? null;
        setSelectedId(selectedIdRef.current);
      })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setMessages([]);
    run.detach();
    getMessages(selectedId)
      .then((items) => {
        if (!active) return;
        setMessages(items);
        const pending = [...items].reverse().find((message) =>
          message.role === 'user' && message.runId
          && ['received', 'recalling', 'generating', 'researching', 'validating'].includes(message.runState ?? ''),
        );
        if (pending?.runId) run.connect(selectedId, pending.runId, pending.id);
      })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; run.detach(); };
  }, [selectedId, run.connect, run.detach]);

  const onCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const conversation = await createConversation();
      await refreshConversations();
      setDraft('');
      selectedIdRef.current = conversation.id;
      setSelectedId(conversation.id);
    } catch (reason) {
      setError(messageOf(reason));
      setLoading(false);
    }
  }, [refreshConversations]);

  const onSend = useCallback(async () => {
    if (!selectedId || !draft.trim() || submitting) return;
    const conversationId = selectedId;
    setSubmitting(true);
    setError(null);
    const message = draft;
    const requestKey = crypto.randomUUID();
    try {
      const admitted = await admitRun({
        conversationId,
        message,
        timezone: localTimezone(),
        requestKey,
      });
      if (selectedIdRef.current !== conversationId) return;
      setDraft('');
      run.connect(conversationId, admitted.runId, admitted.questionId);
      const savedMessages = await getMessages(conversationId);
      if (selectedIdRef.current === conversationId) setMessages(savedMessages);
    } catch (reason) {
      if (selectedIdRef.current === conversationId) setError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  }, [selectedId, draft, submitting, run.connect]);

  const onRetry = useCallback(async (question: MessageView) => {
    if (!selectedId || !question.runId || submitting) return;
    const conversationId = selectedId;
    setSubmitting(true);
    setError(null);
    try {
      const admitted = await admitRun({
        conversationId,
        questionId: question.id,
        timezone: localTimezone(),
        requestKey: crypto.randomUUID(),
        retryOfRunId: question.runId,
      });
      if (selectedIdRef.current !== conversationId) return;
      run.connect(conversationId, admitted.runId, admitted.questionId);
      const savedMessages = await getMessages(conversationId);
      if (selectedIdRef.current === conversationId) setMessages(savedMessages);
    } catch (reason) {
      if (selectedIdRef.current === conversationId) setError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  }, [selectedId, submitting, run.connect]);

  const onRecheck = useCallback(async (baselineId: string | null) => {
    if (!selectedId || submitting) return;
    const conversationId = selectedId;
    setSubmitting(true);
    setError(null);
    try {
      const admitted = await admitRun({
        conversationId,
        message: 'Recheck this saved comparison.',
        timezone: localTimezone(),
        requestKey: crypto.randomUUID(),
        ...(baselineId ? { baselineId } : {}),
      });
      if (selectedIdRef.current !== conversationId) return;
      run.connect(conversationId, admitted.runId, admitted.questionId);
      const savedMessages = await getMessages(conversationId);
      if (selectedIdRef.current === conversationId) setMessages(savedMessages);
    } catch (reason) {
      if (selectedIdRef.current === conversationId) setError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  }, [selectedId, submitting, run.connect]);

  const onStop = useCallback(async () => {
    if (!run.session) return;
    const conversationId = run.session.conversationId;
    try {
      await cancelRun(run.session.runId);
    } catch (reason) {
      if (selectedIdRef.current === conversationId) setError(messageOf(reason));
    }
  }, [run.session]);

  const selectedSession = useMemo(
    () => run.session?.conversationId === selectedId ? run.session : null,
    [run.session, selectedId],
  );

  return (
    <div className="app-shell">
      <Sidebar
        conversations={conversations}
        selectedId={selectedId}
        busy={submitting || loading}
        onSelect={(id) => { setDraft(''); selectedIdRef.current = id; setSelectedId(id); }}
        onCreate={() => { void onCreate(); }}
      />
      <Chat
        conversationId={selectedId}
        messages={messages}
        session={selectedSession}
        readiness={readiness}
        error={error}
        draft={draft}
        loading={loading}
        submitting={submitting}
        onDraft={setDraft}
        onSend={() => { void onSend(); }}
        onStop={() => { void onStop(); }}
        onRetry={(question) => { void onRetry(question); }}
        onRecheck={(baselineId) => { void onRecheck(baselineId); }}
      />
    </div>
  );
}
