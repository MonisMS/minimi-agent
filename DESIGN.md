# Design overview

Minimi is a local-first conversational research assistant. The browser talks to a loopback Express API. The API stores original user and assistant turns in SQLite and scopes every repository operation by owner and namespace. React renders saved chats, recheck results, and evidence excerpts.

## Request path

1. The API admits a run idempotently and saves the question before work begins.
2. One run executor resolves relevant conversation history and chooses ordinary chat, historical recall, or recheck.
3. Model and search transports share the run's bounded budget. Search observations are retained with exact text and date metadata.
4. Recheck extraction produces typed candidates. Pure comparison rules check source support, comparable terms, dates, and decimal arithmetic.
5. The result and final answer are committed with the run's terminal state before completion events are sent.

The model can request only `web_search`. SQLite recall and arithmetic remain application code. Missing evidence, incompatible terms, and unknown dates remain explicit unresolved states.

## Boundaries

The `live` namespace is the default. The demo/test composition can select `demo` explicitly; it uses an isolated store/namespace and scripted services. It is never selected as a fallback by normal startup. Provider credentials are read only by the server. Deterministic tests do not contact providers.

SQLite and original conversation text are the source of truth. Derived decision snapshots, evidence observations, and verification results keep scoped lineage to their source messages. This version does not add embeddings, background indexing, a dashboard, or additional providers.

## Known gaps

Lifecycle race/deletion/restart hardening remains incomplete. Offline scripted cases establish selected pipeline behavior but do not measure real-model reasoning quality. Live quality, source-support review, cost, and latency remain unverified.
