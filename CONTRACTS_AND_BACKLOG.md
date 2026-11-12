# Module contracts and implementation backlog

Version 0.3 — specifications only. File/module names below are a future map, not files to scaffold before approval. All packages remain subject to SYNTHESIZED_PLAN.md's approval gate.

## 1. Future responsibility map

| Responsibility | Inputs | Outputs / invariant | Primary reference |
| --- | --- | --- | --- |
| HTTP/session boundary | Owner cookie/session, body, timezone, request key | Scoped request or validation error; no client-supplied owner escalation | Thread |
| Run coordinator | Question, task path, budgets, abort signal | Idempotent lifecycle and ordered events; exactly one final state | Thread + Anu |
| Date resolver | Text, injected clock, IANA zone | Calendar windows, ambiguity, endpoint vs historical anchors | Thread + ashusnapx + Harshdip |
| Recall service | Scoped question/windows/recent context | Candidate IDs, match reasons, counts and omission metadata | Anu + Divyendra |
| Baseline expander | Candidate originals and decision references | Complete member set, constraints, original spans and saved evidence | Divyendra |
| Search service | Purpose-tagged bounded batch | Per-query outcomes and raw observations with acquisition metadata | Scout + ashusnapx |
| Evidence registry | Provider observations, owner/run | Stable scoped source IDs and immutable stored text | Thread + Verbatim |
| Claim extraction | Original/current passages and schema | Proposed typed fields with passage references, unknowns and conflicts | Suraj + Divyendra |
| Verification engine | Obligations and validated fields | Comparable outcomes, reason codes, code-derived totals | Suraj + Harshdip, strengthened |
| Answer presenter | Validated outcomes and supported relevance explanation | Chat summary, comparison rows and optional chart series from one result | Our integration |
| Enrichment worker | Durable job/turn version | Derived memories or explicit retryable/permanent/empty completion | ashusnapx + Divyendra + Scout |
| Browser run state | Ordered events + persisted state | Correct active turn, stable IDs, no stale-event merge or duplicates | Divyendra + Thread |

No module privately creates a second source registry, reads unscoped history or changes a verdict by parsing rendered Markdown. Interfaces use application-owned records rather than provider response objects.

## 2. Proposed HTTP surface

Exact response serialization will be frozen before coding. These routes describe the intended contract, not an existing API.

| Route | Request / response responsibility |
| --- | --- |
| GET /api/readiness | Configuration booleans, supported mode labels and non-secret startup problems. |
| GET/POST /api/conversations | Scoped paginated listing / create conversation. |
| GET /api/conversations/:id/messages | Ordered persisted turns, completion states and references. |
| POST /api/runs | Conversation ID, message or existing question ID, timezone, client request key; returns SSE with allocated IDs. Reject incompatible message/question combinations. |
| POST /api/runs/:id/cancel | Idempotent owner-scoped cancellation request. |
| GET /api/runs/:id | Server-authoritative lifecycle, partial/final answer and result IDs for reconnect reconciliation. |
| GET /api/verifications/:id | Persisted baseline, constraints, obligations, observations and validated outcomes; chart eligibility derived here. |
| POST /api/verifications/:id/recheck | All/unresolved scope; creates a linked new run, preserves old result. |
| GET /api/evidence/:id | Saved passage and metadata in the owner's namespace. Never arbitrary server-side URL fetch. |
| GET /api/memory | Paginated derived memory with original provenance and replacement/indexing status. |
| POST /api/memory/:id/forget | Suppress derived lineage; preserve chat; pending/rebuilt extraction must honor suppression. |
| DELETE /api/conversations/:id | Scoped transaction removes log/index/job data and invalidates dependent references. |

Local identity isolates browser workspaces; it is not a claim of production authentication. A future hosted deployment needs an explicit identity/session design. Server configuration is not written through a general browser key-storage dialog in the first implementation.

## 3. Run and obligation states

Run states: received → recalling → needs-clarification OR researching/generating → validating → completed. Any active state can become cancelled/failed; deadline exhaustion can yield a completed partial-coverage answer only when its explicit unknowns and stored state are consistent. Resume clarification as a linked request with the selected baseline.

Obligation fields, rather than one overloaded status:

- Identity: run ID, original member ID, plan ID if known, attribute and baseline claim ID.
- Acquisition: unattempted/attempted, query IDs, usable observation IDs, failure codes.
- Comparability: pending/compatible/incompatible/insufficient; missing/mismatched dimensions.
- Resolution: unresolved/resolved; outcome and supported timing.

Completeness is the count of obligations or members meeting a named criterion. UI labels explicitly say which count. Five attempted searches cannot be presented as five verified prices.

## 4. Result record requirements

Each comparison outcome references its baseline claim, baseline evidence, current evidence, relevant dimensions, validated extracted spans, verdict and reason codes. Calculation records include formula kind, operands, units, rounding policy and assumptions. Unsupported fields remain absent/unknown and cannot become zero.

Suggested reason codes: missing_saved_baseline, historical_evidence_missing, current_evidence_missing, capture_age_unknown, plan_mismatch, commitment_mismatch, currency_mismatch, quantity_or_minimum_unknown, usage_not_comparable, conflicting_sources, effective_date_unknown and budget_exhausted. They map to plain user language; raw codes do not appear in ordinary chat.

Source URLs, quote spans and numeric field references must resolve to actual observations in owner scope. A support screening success does not imply full semantic proof. Qualitative launch relevance includes the dated passage plus the remembered constraint it affects.

## 5. Concrete backlog after approval

| Task | Depends on | Work and exit condition |
| --- | --- | --- |
| T01 Requirements freeze | Planning | Confirm brief/tool boundary, exact stack contracts, deadline, model/provider candidate and budget; record user approval. |
| T02 Owner/log schema | T01 | Migrations and scoped repository operations; no orphan searchable rows on deletion. |
| T03 Run lifecycle | T02 | Persist question first, idempotent request keys, cancel/deadline/finalization and interrupted-run recovery. |
| T04 Minimal transport/UI | T03 | Readiness, chat, SSE, stop and persisted history; no duplicate turns on retry. |
| T05 Calendar windows | T02 | Inject clock and zone; explicit/relative dates, invalid dates, DST and ambiguous weekdays. |
| T06 Candidate retrieval | T05 | Date/FTS/entity/recent union with scope counts and reasons. |
| T07 Baseline expansion | T06 | Original turns, full decision membership, revisions and constraints; cap omissions cannot silently remove members. |
| T08 Search adapter | T01/T03 | Runtime-validated single-tool contract; content/freshness metadata and abort support. |
| T09 Search scheduling | T08 | Fair batches, per-item allocation, deduplication, deadline and query budget. |
| T10 Evidence store | T02/T08 | Immutable observations and span references; safe citation links; no cross-owner resolution. |
| T11 Claim extraction | T07/T10 | Typed dimensions and supporting spans; reject malformed or unresolved references. |
| T12 Obligation tracker | T07/T09 | Stable claim IDs and distinct attempt/evidence/comparability/resolution states. |
| T13 Comparison engine | T11/T12 | Compatible pricing math, temporal verdict rules, unknown/conflict handling. |
| T14 Validated presentation | T13 | Board rows and summary from outcomes; no Markdown table parsed back into business state. |
| T15 Evidence/original drawer | T04/T07/T10 | Saved evidence and original exchange accessible from both chat and board. |
| T16 Board interaction | T14/T15 | Filters, saved runs, unresolved recheck, reload and mobile/keyboard behavior. |
| T17 Durable enrichment | T02/T07 | Job leases/retries, complete-empty vs failure, pending raw recall and idempotent rebuild. |
| T18 Memory control | T17 | Provenance/history view, suppression on forgetting and transactional deletion across indexes/jobs. |
| T19 Evaluation | T05–T18 incrementally | Meaningful regression fixtures plus held-out reasoning and separate live acquisition protocol. |
| T20 Conditional retrieval | T19 | Add semantic ranking only for established misses; measure held-out gain and ingestion/latency cost. |
| T21 Conditional charts | T13/T16 | Eligibility-based before/after visualization with table alternative; no invented values/history. |
| T22 Submission | Core + T19 | Clean install/start, setup docs, one-page DESIGN, attribution, labeled walkthrough and video. |

T20/T21 can be cut under deadline pressure. T03/T07/T10/T12/T13 and meaningful evaluation are central to the proposed advantage. Build one vertical slice early after approval: original question → remembered decision → one recheck → saved outcome → inspectable board. Then generalize across all members and failure cases before visual polish.

## 6. First review milestone after coding begins

Before adding optional features, demonstrate a three-step scripted journey against controlled evidence:

1. A saved five-member decision with exact constraints survives restart and is recalled in a new conversation.
2. Current evidence includes a valid change, incompatible billing, same observed value, a corrected old error and an unavailable source.
3. Chat, board and evidence drawer agree; each item is represented; Stop/retry/reload do not duplicate history or upgrade incomplete text to facts.

This milestone is a concrete reviewable result. It must not be substituted for the wider held-out evaluation or described as a guarantee of selection.
