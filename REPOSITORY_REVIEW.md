# Repository review and source-inspection plan

Reviewed: 12 November 2026. Scope: README material retrieved through Firecrawl from the public repository landing pages, plus the supplied 11 November research report. At the README-only stage no repositories had been cloned or run. Subsequent cloning and selected source inspection are documented in [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md); runtime evaluation remains unperformed. Some pages included large file trees; README material was separated from page chrome for review. This is a targeted assessment, not an exhaustive audit.

## Evidence levels

- R: README retrieved in this session. Describes the author's advertised behavior; does not establish implementation correctness.
- P: code observation inherited from MINIMI_COMPLETE_RESEARCH.md. Needs fresh source confirmation before we treat it as an established current defect.
- S: independently traced source at a recorded commit. Selected paths in nine clones are now documented in IMPLEMENTATION_AUDIT.md; this is not a full audit.
- X: reproduced execution under documented settings. Not completed in this phase.

The original report contains revision-pinned links. Those are starting points, not necessarily current HEAD. Public names matching the challenge do not establish that a repository was submitted, accepted or shortlisted. No ranking of authors is implied.

## 1. Exact-challenge README review

| Reference | README observations (R) | Why inspect further / question to resolve |
| --- | --- | --- |
| [Thread — Pranay623/minimi-assignment](https://github.com/Pranay623/minimi-assignment#readme) | Node 24+, React, Express/SSE, SQLite original turns/evidence, date/FTS recall, one tool, bounded rounds/queries/model calls, source inspection, cancellation, offline walkthrough and multiple check/eval commands. Explicitly says citation validity does not establish claim support and lexical recall can miss paraphrases. | Highest-value correctness/lifecycle baseline. Trace evidence retention, cross-thread scope, incomplete turns, coverage and semantic support. We need to exceed demonstrated behavior, not merely reproduce its architecture. |
| [Suraj-787/minimi-agent](https://github.com/Suraj-787/minimi-agent#readme) | Node 22+, seeded historical conversations, CLI/web entry points, configurable model providers, Exa/Tavily, fixed-date evaluation and sourced rechecks. | Inspect claim ledger and entity/claim coverage. P reports query mentions may count as entity coverage and Markdown-derived statuses; reproduce before claiming a gap. |
| [Verbatim — BhaveshKukreja29/minimi-hiring-challenge](https://github.com/BhaveshKukreja29/minimi-hiring-challenge#readme) | Hono, React/Vite, Exa, SQLite/Turso, sentence-highlighted citations, temporal recall and end-to-end eval command. Live link notes a backend cold start. | Trace quote-by-reference and sentence identity. Distinguish exact stored quote insertion from semantic support and transformed page text. Inspect freshness and cache policy. |
| [Anu27n/minimi-chat-agent](https://github.com/Anu27n/minimi-chat-agent#readme) | Built-in SQLite/FTS5, date/BM25 recall, small framework-free agent, static UI, SSE, frozen clock, live seed generation and no-network unit tests. README says it searches what was published since the baseline. | Strong small-loop baseline. Check whether current evergreen pricing pages can be excluded by date filters, and whether broad-date retrieval reports truncation. |
| [HarshdipSaha/minimi-chat-agent](https://github.com/HarshdipSaha/minimi-chat-agent#readme) | Exa, streaming, temporal memory, recorded demo exchanges, clock override, 86 advertised unit tests and 11 live multi-day scenarios with repeated runs. | Review numeric figure guard, price context and score rubric. P describes numeric/currency matching without full plan association; test with same-price/different-plan fixtures. Test counts are author-reported. |
| [ashusnapx/minimi-hiring-challenge](https://github.com/ashusnapx/minimi-hiring-challenge#readme) | Application-side recall, ambiguous-weekday handling, background memory extraction, claim ledger, current pages plus dated search, open loops, memory UI and read-only MCP. Advertises nine evaluation scenarios. | Inspect raw-message fallback during pending extraction and preserved claim context. MCP/open loops are outside our initial scope; date ambiguity is directly relevant. |
| [Scout — MORYASSHAN/minimi-agent](https://github.com/MORYASSHAN/minimi-agent#readme) | TypeScript MERN, provider fallback/caching, background extraction, historical clock override, local Mongo download or Atlas, tests with fake services. | Review concurrent fair search allocation and lifecycle interfaces. We prefer less setup infrastructure unless Mongo's benefit is measured. Do not adopt README instructions to ignore install-script warnings. |
| [Daymark — Ahamed1846/minimi-hiring-challenge](https://github.com/Ahamed1846/minimi-hiring-challenge#readme) | Express/SQLite/hosted web search, one-key setup, browser-scoped history, offline/live eval modes and bounded dated context. Documents plaintext local key storage protected by permissions. | Useful minimum-complexity baseline. Trace tool boundaries, dated recall and whether comparable claims/evidence are validated in application code. Our proposed keys stay in server environment configuration. |
| [Divyendra-S/minimi-hiring-challenge](https://github.com/Divyendra-S/minimi-hiring-challenge#readme) | OpenRouter/Tavily, 47 advertised demo chats, JSON history import, immediate dated recall followed by extraction, rebuild command and offline/live evaluations. README now links DESIGN.md. | Inspect original-log/index separation, imported evidence provenance and exact answer expansion. The old report said DESIGN.md was absent from its inspected tree; the current README link alone does not prove the file exists. Verify rather than repeating that older observation as current. |

## 2. Wider systems: README-level triage

These 12 additional READMEs were retrieved. They are architectural references, not complete solutions to the challenge. No vendor/author benchmark number is treated as a controlled comparison.

| Reference | Useful idea | Planned action |
| --- | --- | --- |
| [Morphic](https://github.com/miurla/morphic#readme) | Streamed grounded search, Quick/Adaptive modes, provider interfaces, persisted history. | Selectively inspect bounded researcher and citation flow; skip PostgreSQL/Redis/product infrastructure. |
| [Vane](https://github.com/ItzCrazyKns/Vane#readme) | Speed/quality modes, cited search, SearXNG, local/cloud models and saved search history. | Read researcher architecture if routing remains unresolved; no default Docker/search-engine stack. |
| [Scira](https://github.com/zaidmukaddam/scira#readme) | Multi-query search, cited answers, memory and recurring research among many capabilities. | Inspect only search/citation design if useful; its large tool surface conflicts with our scope. README identifies AGPL licensing; check actual files before any reuse. |
| [Graphiti](https://github.com/getzep/graphiti#readme) | Temporal validity, source episodes, historical queries and hybrid retrieval. | Inspect temporal record/edge model. Borrow the distinction between ingestion and truth time without adopting a graph service. |
| [Mem0](https://github.com/mem0ai/mem0#readme) | Persistent memory, extraction and retrieval; managed/open-source distinctions matter. | Keep as optional experiment, not baseline infrastructure. Check exact version/features before considering substitution. |
| [Mastra](https://github.com/mastra-ai/mastra#readme) | TypeScript agents/workflows, context management, Observational Memory, evals and observability. | Framework alternative only if it materially simplifies our contracts. Current README describes mixed licensing by directory; inspect selected package terms. |
| [Hindsight](https://github.com/vectorize-io/hindsight#readme) | Retain/recall/reflect memory with multiple retrieval approaches. | Selective retrieval-design inspection if paraphrases remain problematic; no initial external memory service. |
| [Letta](https://github.com/letta-ai/letta#readme) | Stateful agents and memory hierarchy/history concepts. | Documentation reference; general harness capabilities exceed our one-tool workload. |
| [SimpleMem](https://github.com/aiming-lab/SimpleMem#readme) | Compact memories and retrieval; current repository spans text and multimodal/evolving variants. | Inspect text-memory normalization only. Never assume compression preserves every comparison qualifier. |
| [Open Deep Research](https://github.com/langchain-ai/open_deep_research#readme) | Research orchestration, configurable model roles and report evaluation. | Defer implementation clone; report-oriented multi-stage Python flow is not our latency baseline. |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs#readme) | Stateful orchestration and durable workflows. | Alternative if plain loop lifecycle becomes hard to maintain; framework is not a comparison-correctness mechanism. |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io#readme) | Retained snapshots, filtered diffs, price/content monitoring. | Snapshot/diff concept reference; defer recurring monitoring and browser service. |

[LongMemEval](https://github.com/xiaowu0162/longmemeval#readme) was also retrieved as an evaluation reference. It provides assistant-side, temporal, knowledge-update and abstention cases, evidence-session/turn annotations and separate retrieval evaluation. Use its separation of retrieval from reading; do not claim it evaluates live pricing changes end to end. Total reviewed: nine challenge repositories plus thirteen architecture/evaluation references = 22.

## 3. Prioritized clone-and-inspect backlog

Reference clones will live in `/home/monis/minimi-reference-repos`, outside our submission repository. Cloning is read-only research; no install, seed, build, live model calls or package scripts are part of that inspection. A clone is not itself an audit. Pin `git rev-parse HEAD`, record branch, retrieval date and license. Inspect original report commits as well as HEAD when behavior differs.

| Priority | Repository | Initial files / paths to locate | Inspection deliverable |
| --- | --- | --- | --- |
| P0 | Pranay623/minimi-assignment | README, DESIGN, server/{agent,memory,db,evidence,search}.ts, docs/EVALUATION.md, docs/VALIDATION.md | Request-to-persistence trace; evidence identity; recall limits; citation and lifecycle invariants. |
| P0 | Suraj-787/minimi-agent | README, DESIGN, src/agent/recheck.ts, src/memory/{reconcile,verifyTable}.ts, eval/ | Claim coverage state machine; status derivation; contradictory evidence behavior. |
| P0 | BhaveshKukreja29/minimi-hiring-challenge | README, DESIGN, server/{search,recall,memory}.ts, shared/, eval/ | Quote identity contract; freshness/caching; extraction/renderer boundary. |
| P0 | HarshdipSaha/minimi-chat-agent | README, DESIGN, src/{figures,search,agent}.ts, evals/, docs/decisions/ | Price validation limitations; eval assertions; latency measurement definitions. |
| P1 | Anu27n/minimi-chat-agent | src/memory/{temporal,retriever,store}.ts, agent loop, search/tavily.ts | Date-window logic, cutoff applicability, full-original expansion and truncation behavior. |
| P1 | ashusnapx/minimi-hiring-challenge | src/{dates,memory,remember,store,chat,search}.ts | Ambiguous dates, immediate-follow-up behavior, async extraction recovery. |
| P1 | Divyendra-S/minimi-hiring-challenge | src/core/memory/{schema,extract,context}.ts, import/reindex paths, DESIGN link | Original-vs-derived memory lifecycle, imported baseline provenance and answer truncation. |
| P2 | MORYASSHAN/minimi-agent | server/search/searchService.ts and current equivalent, agent/memory modules | Fair result allocation, fallback budget and cached recheck policy. |
| P2 | Ahamed1846/minimi-hiring-challenge | src/agent.js and current equivalent, memory, evals/ | Minimum one-key baseline and application/model responsibilities. |
| P1 selective | getzep/graphiti | graphiti_core/edges.py, temporal invalidation tests | Minimal temporal fields worth carrying into SQLite. |
| P1 selective | xiaowu0162/longmemeval | README, evaluation/retrieval scripts, representative data schema | Evidence labels and fair retrieval/reading evaluation contracts. |
| P2 selective | miurla/morphic | lib/agents/researcher.ts and current equivalent, source registry | Bounded research and citation-allocation patterns. |

File paths are leads from the supplied report/READMEs; resolve renamed paths in the pinned checkout rather than assuming existence. Mastra/Hindsight/SimpleMem are conditional inspections, not required clones now.

Suggested manual preparation commands, for later execution:

```sh
mkdir -p /home/monis/minimi-reference-repos
git clone --depth 1 https://github.com/Pranay623/minimi-assignment.git /home/monis/minimi-reference-repos/pranay-thread
git -C /home/monis/minimi-reference-repos/pranay-thread rev-parse HEAD
```

Repeat only for prioritized references. Fetch an older report commit separately when needed. Do not fork a competitor as our submission foundation. Preserve attribution if an idea materially shapes the design; any actual code reuse requires license review and disclosure.

## 4. Required source-audit worksheet

For each P0 repository, complete:

- Commit and license; inspected files with line references.
- Call trace: request → recall → context → tool → evidence → response → persistence.
- What code enforces, what prompts request, and what README only promises.
- One supported strength and one unresolved limitation, with evidence.
- Handling of missing baseline, conflicting source, stale result, same-price/different-plan and incomplete coverage.
- Test/eval assertions: do they measure support, only keywords, or only tool invocation?
- Pattern to adopt, modify or reject, with rationale.
- Whether any earlier reported weakness is fixed at HEAD.

Exit condition: P0 traces and P1 date/async-memory checks inform DECISIONS.md before architecture freeze. Runtime comparison happens later under EVALUATION_PLAN.md, with isolated installs and no shared secrets or private history.

## 5. Research boundaries and next verification

Original report source-code findings remain P-level until reproduced. New README review does not validate those code findings. No conclusion here establishes performance superiority, exact provider freshness, historical snapshot coverage, acceptance status or production readiness.

Before implementation: verify the original brief and current official Node/SQLite, date-library, model-tool-calling and search API documentation. The supplied report links [Exa](https://exa.ai/docs/reference/search.md) and [Tavily](https://docs.tavily.com/sdk/javascript/reference); its feature descriptions are starting hypotheses until the exact request/response contracts are checked. No SDK code or provider-specific implementation has been written.
