# Feature selection from all nine challenge implementations

Version 0.3 — 12 November 2026. These are best-fit references among inspected paths, not measured rankings. Source revisions are pinned in IMPLEMENTATION_AUDIT.md. Learn the mechanisms and implement an original integrated design; do not transplant entire repositories or combine incompatible persistence/UI frameworks.

## Selection matrix

| Capability | Reference to study first | Implementation inspected | Our choice and gap to fill | Priority |
| --- | --- | --- | --- | --- |
| Durable original history | Thread / Pranay | server/db.ts, server/agent.ts | Keep owner-scoped transactional turns, explicit completion states and restart recovery. Persist the question before network or fallible recall work. | Required |
| Date interpretation | Thread + ashusnapx + Harshdip | server/memory.ts; src/dates.ts + memory.ts; src/context.ts | Use timezone-aware calendar boundaries and retain ambiguous weekday candidates. Resolve against topic/history or ask; do not silently choose another week. | Required |
| Searchable recall | Divyendra + Anu | core/memory/context.ts; memory/retriever.ts | Date + FTS + entity + recent context first, then candidate expansion. Keep semantic/rank-fusion extension compatible; enable after measured need. | Required / semantic conditional |
| Shortlist completeness | Divyendra + Suraj | conversation-completion retrieval; agent/recheck.ts | Expand all original decision members and generate stable per-claim obligations, rather than depend on query mentions or arbitrary memory caps. | Required |
| Saved source evidence | Thread | server/evidence.ts, historical-source replay in agent.ts | Immutable excerpts, timestamps, scoped IDs and old/new observation identity. Add evidence spans for extracted comparison fields. | Required |
| Direct quotations | Verbatim / Bhavesh | search.ts, shared/cite.ts, Answer.tsx | Insert stored spans by reference when quoting. Keep quotation correctness separate from relevance and claim support. Use a standard Markdown renderer around typed citation widgets. | Required, limited scope |
| Fair concurrent search | Scout / MORYASSHAN | search/searchService.ts | Allocate query/results across items before refinement; retain round-robin result fairness. Add an overall deadline and separate live-recheck cache policy. | Required |
| Search attempt coverage | Suraj | recheck.ts, tool integration in agent/index.ts | Adopt code-enforced coverage, but distinguish attempted, evidence acquired, comparable and resolved for every claim. | Required |
| Current state vs dated news | Harshdip + Suraj + ashusnapx | paired rechecks, dated news pass, freshness request | Separate current pricing searches from announcements since baseline. Publication filters must not hide evergreen pricing pages. | Required |
| Fast recall/recheck paths | Divyendra + Anu + Daymark | chat/recheck flow, simple loop, hosted-search agent | Skip web for pure historical recall. Use deterministic first query batches when baseline entities are clear, through the same single search contract. Keep a small loop. | Required |
| Background enrichment | ashusnapx + Divyendra + Scout | remember, memorize/reindex, jobQueue | Respond before optional indexing; persist jobs in SQLite with retry/lease states. Raw history always works immediately. | Required |
| Versioned memory | Suraj + Divyendra | reconcile.ts, memories/context replacement logic | Append corrections with lineage. Separate observation date from evidence-supported validity; never infer effective date from retrieval. | Required |
| Deterministic calculations | Harshdip | figures.ts + agent usage | Keep code-based arithmetic; replace amount-only matches with typed plan/terms comparisons. | Required |
| Evidence inspection | Thread + Verbatim | evidence panel, source-linked quotations | One drawer showing stored passage, source URL, dates and associated claim fields; historical/current labels. | Required |
| Visible memory and forgetting | Suraj + ashusnapx | MemoryPanel, memory/profile controls | Read original source of a remembered fact; forget derived memory with suppression so enrichment does not recreate it. Distinguish forgetting from deleting chat. | Core read view; controls after core correctness |
| Quiet progress | Scout | Activity.tsx | A concise activity line, expandable evidence/search facts, no internal reasoning transcript. | Required |
| Streaming state reconciliation | Divyendra + Thread | useChatStream.ts, stable turn IDs and finalization | Reconcile live and saved messages by IDs; reject stale run events; stop/retry never duplicates a question. | Required |
| Comparison board | Our integration of the above | No equivalent typed board established by this review | Render a persisted verification run as rows with old/new terms, outcome and evidence. The board and chat use the same outcomes. | Required |
| Charts | Our derived presentation | Existing references supply evidence/figures patterns, not proof of valid trends | Render only aligned numeric values. Two observations become a before/after view, never a continuous trend. | Optional after board |
| Demo and setup | Thread + Daymark + Divyendra | separate walkthrough, readiness UI, import/demo | Clearly separate fictional offline walkthrough from live data. Show missing-key status without exposing credentials. | Required |
| Evaluation | Thread rubric + Harshdip repeat runs + Verbatim quote checks | docs/EVALUATION.md; evals/run.ts; eval/run.ts | Keep deterministic checks, repeated model runs and independent passage-support review. Do not equate keyword matches or resolvable citations with correctness. | Required |
| Open loops / reminders | ashusnapx | stored loop/profile extraction | Useful later; do not add recurring background monitoring to the first submission. | Deferred |
| Provider fallbacks / model rotation | Scout + Verbatim | fallback, cache and retry code | One configured default first. Add bounded fallback only after availability/latency evidence justifies it. | Deferred |

## Additional findings from the deeper pass

### Thread

Recall explicitly returns a truncation indicator and uses local-zone calendar interpretation; its UI already links citations to an evidence panel and exposes remembered context. These are reusable product patterns, not new differentiators. Preserve immutable history and bounded context, but make completeness of the selected decision independent of candidate count limits.

Sources: [memory.ts](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/server/memory.ts), [Answer.tsx](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/src/Answer.tsx), [App.tsx](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/src/App.tsx).

### Divyendra

The chat generator persists stopped output with a stopped marker and avoids duplicate saves. Client reconciliation retains streamed messages until the same IDs appear in refetched history. Extraction validates structured memories and known source references; on failure, memorize saves an empty result, while a rebuild command is documented. We should preserve a distinct failed/retryable extraction state instead of making an unsuccessful extraction look like a successful empty extraction. These are observations of the inspected flow, not runtime tests.

Sources: [chat.ts](https://github.com/Divyendra-S/minimi-hiring-challenge/blob/cd87d43d632e6cf3ed9954645cc480bc7251504c/src/core/chat.ts), [extract.ts](https://github.com/Divyendra-S/minimi-hiring-challenge/blob/cd87d43d632e6cf3ed9954645cc480bc7251504c/src/core/memory/extract.ts), [useChatStream.ts](https://github.com/Divyendra-S/minimi-hiring-challenge/blob/cd87d43d632e6cf3ed9954645cc480bc7251504c/src/client/useChatStream.ts).

### Suraj

There are safeguards beyond query coverage: source/vendor checks, dated-release checks, status contradictions, a Why drawer and memory history/forget controls. Some checks record problems after streaming; write.ts separately restricts ledger updates for unsupported rows. Therefore it would be inaccurate to say this implementation has no evidence checks. Our improvement is earlier structured validation and stable claim identity, rather than adding the first checks.

Sources: [answerChecks.ts](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/src/agent/answerChecks.ts), [write.ts](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/src/memory/write.ts), [WhyDrawer.tsx](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/web/src/components/WhyDrawer.tsx), [MemoryPanel.tsx](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/web/src/components/MemoryPanel.tsx).

### Scout

The queue has bounded concurrency and retries but stores pending jobs in process memory. Its drain accounting can see no active/pending work while a delayed retry is still scheduled. For our small local app, a SQLite job table is sufficient to make pending retries visible and restartable. Its agent can enqueue enrichment for aborted output; our factual indexing will explicitly exclude incomplete answers. Whether its enricher already filters those requires separate tracing; do not claim confirmed contamination.

Sources: [jobQueue.ts](https://github.com/MORYASSHAN/minimi-agent/blob/bb7e69338b66945cdb898f80c948859910f42131/server/lib/jobQueue.ts), [agent.ts](https://github.com/MORYASSHAN/minimi-agent/blob/bb7e69338b66945cdb898f80c948859910f42131/server/agent/agent.ts), [Activity.tsx](https://github.com/MORYASSHAN/minimi-agent/blob/bb7e69338b66945cdb898f80c948859910f42131/client/components/Activity.tsx).

### Anu

The async-generator loop is cleanly separated from HTTP and runs independent tool calls concurrently. It saves the combined question/answer exchange only after completion; a failed turn does not reach that save. Adopt its modularity, but persist the question immediately and mark answer completion separately. Date helpers use local Date operations; our public API will require the user's IANA zone explicitly.

Sources: [agent.ts](https://github.com/Anu27n/minimi-chat-agent/blob/2379946e65ecdd55dbad80c4123fd4ad3de1c718/src/agent/agent.ts), [temporal.ts](https://github.com/Anu27n/minimi-chat-agent/blob/2379946e65ecdd55dbad80c4123fd4ad3de1c718/src/memory/temporal.ts).

### ashusnapx, Verbatim, Harshdip and Daymark

ashusnapx recall pairs original messages even without extracted claims, supporting the immediate raw-history fallback we want; dated/topic selection remains capped. Verbatim's renderer resolves stored sentences and builds highlighted text-fragment links, but its hand-written block parser is narrow for rich comparison tables. Harshdip handles alternative weekday interpretations using topic matches, but summarized earlier answers are clipped. Daymark expands nearby turns around recall anchors and transactionally maintains its FTS rows on deletion; source records in the inspected store contain citation metadata, not a preserved full historical evidence contract.

Sources: [ashusnapx memory.ts](https://github.com/ashusnapx/minimi-hiring-challenge/blob/73426811c85aa2fea99591ec5776d6642bb5e802/src/memory.ts), [Verbatim Answer.tsx](https://github.com/BhaveshKukreja29/minimi-hiring-challenge/blob/143503c45d340e96440df47a867758cf7300d01d/web/src/components/Answer.tsx), [Harshdip context.ts](https://github.com/HarshdipSaha/minimi-chat-agent/blob/ed9b56d652026edf22e98c8206cfa42b8becd2c8/src/context.ts), [Daymark memory.js](https://github.com/Ahamed1846/minimi-hiring-challenge/blob/f7055fb129a74e17aa49398c3964458086421eb5/src/memory.js).

## Integration rule

Use one owner model, one SQLite log, one evidence registry, one run state machine, one streaming event vocabulary and one typed comparison result. A feature is included only if it fits those contracts and has a corresponding acceptance scenario. This avoids reproducing nine different architectures inside one application.

Source inspection supports these decisions; it does not establish which implementation wins on runtime quality. No dependency installs, reference execution or code copying occurred.
