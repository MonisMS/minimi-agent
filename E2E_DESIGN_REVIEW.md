# End-to-end design review and scope reduction

Version 0.4 — 12 November 2026. This is a paper walkthrough of the proposed design, not an executed prototype or runtime test. The user requested an end-to-end plan review, not permission to start coding. No application/test code or dependencies were created.

The review found genuine inconsistencies in our own plan. Borrowing a good feature from each reference had grown into more product and infrastructure than the challenge requires. The recommended correction is LEAN_IMPLEMENTATION_PLAN.md. Earlier implementation, synthesis, UI and backlog documents are research context where they conflict with version 0.4.

## 1. What would break or was underspecified

“Break” below means the previous contract could produce inconsistent behavior, not that an implemented system has failed a test.

| ID | Trigger and affected feature | Why v0.3 is insufficient | Required correction |
| --- | --- | --- | --- |
| D01 | Ask “those five” immediately after the first answer | Exact membership was promised while decision extraction could be asynchronous; raw recall existed but did not specify when a complete baseline became trusted. | Keep full original answer/source records immediately. Validate a structured recommendation snapshot when available; otherwise perform bounded on-demand baseline extraction from originals before search. If membership remains ambiguous, clarify. |
| D02 | User says “we chose three” after five suggestions | A product list can be mistaken for a confirmed user decision; later memory replacement can erase which set was meant. | Store provenance and state: assistant-proposed, user-shortlisted, user-selected. Append revisions. Require the current reference to resolve which set is under review. |
| D03 | Live-recheck output streams and later fails validation | Token streaming and validation-before-conclusions were both promised, without a distinct recheck rendering path. | Rechecks stream progress, then persisted validated rows and deterministic summary. Ordinary chat may stream text normally. Do not stream speculative recheck conclusions. |
| D04 | Baseline extraction, research, typed extraction, repair, final narrative and critic all run | A four-model-call ceiling did not explicitly include every auxiliary call. | A single per-run ledger counts all synchronous model work. Use deterministic search planning and result presentation; optional work must fit the same remaining budget. Enrichment is separately accounted, never free. |
| D05 | Five vendors × price, limits and releases | Twelve queries cannot guarantee every claim has adequate evidence. Earlier coverage wording could imply exhaustive verification. | Separate member accounting from claim resolution. Allocate queries fairly; leave explicit unresolved outcomes. Scope each recheck to requested attributes, not all known facts. |
| D06 | Search returns $25 for the wrong plan | A schema and valid source span can still encode a mistaken association. | Validate prerequisites and text references, screen product/plan identity, and evaluate semantic support independently. Unknown/conflicting support blocks a confident verdict; schema validity is not truth. |
| D07 | Old and current prices differ, but no dated transition exists | Observed dates alone cannot establish that the price changed after the original discussion. | Say “different now; timing unknown.” “Earlier answer wrong” requires reliable evidence of the historical state, not merely contradiction today. |
| D08 | Same amount appears but plan was renamed or bundled | Stable IDs alone do not establish cross-time plan equivalence. | Keep plan names and terms as observed. Require explicit evidence for a rename/equivalence mapping; otherwise cannot compare. No automatic alias merge based on text similarity. |
| D09 | Stop races with completion, or two tabs submit concurrently | Owner/run IDs do not settle finalization races, history order or duplicate-request behavior. | Compare-and-set terminal state, unique request keys, one active generation per conversation in MVP, stale event rejection. A duplicate key returns/reconciles the existing run; it does not start another provider call. |
| D10 | User deletes a chat while a job or recheck is running | Transactional delete alone does not stop an active worker from recreating derived data or persisting evidence afterward. | Cancel dependent runs/jobs, use conversation deletion generation/tombstone checks on writes, invalidate dependent result references, then remove data. Keep no payload-bearing orphan copies. |
| D11 | Job retries after a restart or successful empty extraction | A generic queue was specified but deduplication, failure vs empty and ownership checks were not precise enough. | One small SQLite indexing-job mechanism, leased/idempotent by original turn + extractor version; distinct complete-empty/retryable/permanent states. No factual extraction from incomplete answers. |
| D12 | Board assumes the model stored valid outcomes, then disconnected before saving | Streaming and persistence order could create a visible result that vanishes on reload. | Persist validated outcomes transactionally before emitting completed rows/result ID. If writing fails, show failure; do not claim the result was saved. |
| D13 | Same field lacks capture date or current page is inaccessible | A “fresh” boolean obscures which freshness guarantees the application actually knows. | Record request/observation/capture metadata separately; display unknown capture age honestly. Missing current acquisition is unresolved, not unchanged. No promise of historical archive coverage. |
| D14 | Use full-entity database/embeddings for a small internship workload | Canonical identity, alias resolution, graph-like memory and embeddings add migrations/ingestion work without established need. | Scope stable comparison identities to original decision/member/plan records. FTS/date/recent retrieval first; richer entity resolution only after measured misses. |
| D15 | Broad live run reaches its timeout during finalization | One overall deadline did not reserve time for validation/persistence or specify partial outcomes. | Stop new acquisitions before the hard limit. Finalize validated partial coverage with explicit unknowns when possible; otherwise retain failed/interrupted state and recover on restart. Never silently upgrade draft rows. |

## 2. Features that have not earned their place

These are proposed features, not copied implementation. No third-party application code has been copied.

| Feature / influence | Cost it introduces | Verdict for first submission | Evidence needed to earn it back |
| --- | --- | --- | --- |
| Standalone comparison dashboard with its own navigation | More state, routes, saved selectors, responsive layouts and synchronization | Remove separate dashboard; keep an expandable inline comparison table. | Repeated user workflows require cross-run navigation beyond chat links. |
| Price charts, sliders and what-if team-size scenarios | Eligibility rules, formula scenarios, accessibility and misleading-history risk | Remove from MVP. Table already communicates the relevant before/after facts. | User task benefits from visualization and enough comparable observations/formulas exist. |
| General memory editor, per-fact forgetting and suppression lineage | Reindex resurrection semantics, cascades and ambiguous user expectations | Defer. Keep original-history inspection and scoped chat deletion. | User needs editable derived memory beyond normal conversational corrections. |
| Full profile/open-loop extraction from ashusnapx | Extra model calls, storage and UI outside dated recommendation checks | Defer. Preserve constraints in original decisions. | Evidence that core use cases require durable unrelated profile/open-loop behavior. |
| Semantic embeddings/rank fusion from Divyendra | Model startup/download or service cost, new index lifecycle | Defer; retain extension point only. | Held-out paraphrase retrieval misses that simpler expansion cannot solve, with measurable improvement. |
| Universal exact-quote renderer/text-fragment links from Verbatim | Another rendering syntax and browser/page-change edge cases | Remove universal quotation syntax. Show exact stored excerpts in the source drawer. | Direct quotations become a meaningful frequent output requirement. |
| Generic multi-type background job platform | Scheduling/leases/retries for hypothetical future tasks | Reduce to one durable indexing-job type. | A second real asynchronous task needs shared machinery. |
| Pre-fetch old source URLs outside search from Divyendra | Additional acquisition path and unclear one-tool/provider boundary | Do not add a separate fetch path. Reuse one search/content adapter. | Confirmed allowed boundary and measured round-trip benefit unavailable through the existing adapter. |
| Multiple model/search fallback chains from Scout/Verbatim | Tail latency, provider differences and hidden cost | Defer. One model and one search default with explicit failure. | Availability data shows fallback is worth its latency and complexity. |
| Always-on critique/reverification | More calls for already straightforward answers | Remove universal pass; allow only targeted repair/support review within budget. | Reduced unsupported conclusions on held-out cases exceeds added latency/cost. |
| Automatic historical archive reconstruction | Uncertain archive coverage and another failure mode | Defer from core. Say historical support is missing when it is. | Missing baselines are common and a verified provider route has adequate coverage. |
| Rich launch monitoring and automatic decision updates | Broad research scope and subjective relevance over time | Keep user-requested release checking only. No monitoring. | Explicit product requirement after ordinary rechecks work. |
| Benchmark every cloned application | Configuration adapters, credentials, model differences and high review cost | Start with internal baselines plus one strongest runnable reference. | Additional references answer a concrete unresolved comparative question. |

What remains indispensable: original history, date-aware recall, preserved evidence, complete item accounting, comparable typed values, explicit uncertainty, bounded search, correct lifecycle, a clear chat/table/source UI and meaningful evaluation.

## 3. Walkthrough A — first conversation and saved baseline

Input: “Shortlist five CRM tools for a 20-person sales team.” All product names/amounts below are fictional fixtures, not market research.

1. Persist the original question and run ID before fallible work. No prior saved decision exists.
2. Research current options using the single search contract. Register returned excerpts immediately as observations; do not claim the provider captured them today unless that metadata is available.
3. Produce the recommendation. Save original answer and evidence. If the response includes a structured member/constraint snapshot, validate its spans and completeness before storing it as assistant-proposed.
4. Keep all five original members with distinct local IDs; the team size remains linked to its original user statement. This is not automatically a user-confirmed purchase decision.
5. Finalize atomically; optional index extraction runs later. If it fails, raw history/evidence still exist.

Expected stored fact: the assistant proposed A–E under stated constraints, supported by particular observed evidence. Not: the user selected all five, or each claim was historically proven beyond the saved support.

If extraction was not ready, the next recheck reads the original answer and performs on-demand baseline interpretation within the run budget. If it cannot recover all five reliably, clarification is safer than an invented set.

## 4. Walkthrough B — recheck five vendors

Input in a new chat: “Are the prices from Monday still correct?” Recall resolves the intended Monday and the A–E proposal. If two Mondays match, pause for one baseline clarification before billable research.

| Item | Controlled baseline/current evidence | Expected outcome |
| --- | --- | --- |
| A | Old $20/user/month annual commitment; new $24 on identical terms; official notice places change after Monday | Confirmed change; for 20 seats, monthly-equivalent $400 → $480, +$80; annual commitment $4,800 → $5,760. Label these as base-plan subtotals under an annual commitment, not final billed totals; tax is unknown. |
| B | Old $20 annual-commitment rate; new $25 flexible monthly rate only | Cannot compare a price change. Present the terms mismatch; no percentage increase. |
| C | Old and current $30 with matching terms, but no complete intervening history | Same observed value. Do not claim the price never changed. |
| D | Old answer said $40; reliable historical evidence shows $45 at/before that answer; current $45 | Earlier answer was wrong. Without that historical evidence, do not use this verdict. |
| E | Historical value saved, current page unavailable | Current verification unresolved; preserve E as a visible row. |

Process: create five price obligations → fairly allocated current-state searches → extract evidence-linked fields → request dated timing evidence only where needed → validate math/outcomes → commit result → emit table and summary → link sources/original answer.

The answer must say one confirmed change, one original error, one same observation and two unresolved comparisons. It must not summarize this as “only one price changed; everything else is unchanged.” Coverage counts specify whether they count attempted items, comparable observations or resolved requested obligations.

No chart, memory editor, embeddings, profile service or agent swarm is needed for this journey.

## 5. Other end-to-end paths

| Journey | Planning result / required behavior |
| --- | --- |
| “What did I ask on 3 November?” | Original questions/answers by date, no current search. Broader date lookup exposes omitted scope. |
| “Those sales apps” with weak lexical overlap | Expand current-thread references and nearby original decision first. If unresolved, ask; record a retrieval miss for later semantic evaluation. |
| “We picked B and C; now our team is 25” | Append user-selected two-member revision and new constraint. Historical Monday check still uses 20 unless user requests a current-scenario comparison. |
| “Any major launches since Monday?” | Separate release obligations from prices; require dated release evidence and relate significance to the remembered use case. No-results means no dated evidence found. |
| Current price exists but no historical excerpt | Report what the assistant said and what current evidence supports; do not convert the old statement into a verified historical baseline. |
| Provider output malformed or model final schema invalid | One bounded repair only if budget remains; otherwise save failure or explicit unresolved results, not a fabricated success. |
| Stop just as final result commits | Whichever valid compare-and-set terminal transition wins is authoritative; client reconciles run state. A completed committed result can remain completed despite a late cancellation request. |
| Two tabs submit to same conversation | MVP accepts one active generation; reject/queue the second explicitly. Other conversations remain isolated. |
| Same client request repeated after disconnect | Return the original run ID/state; do not reissue model/search calls. Resume by saved state lookup, not automatic replay. |
| Delete source chat during indexing/recheck | Cancel dependent work, block stale-generation writes, remove payload/index data, invalidate saved dependent references. |
| Restart while provider call is in flight | Persisted question survives; run becomes interrupted. No automatic billable restart; derived indexing jobs recover independently. |
| Ordinary question unrelated to pricing | Small normal conversational path remains usable; comparison schema does not constrain every answer into a product table. |

## 6. Budget walkthrough

Prior plan ambiguity: model-directed search planning plus baseline extraction plus final extraction plus narrative generation plus critic could exceed four calls before a single retry.

Revised recheck path:

- Optional call 1: recover/normalize baseline from originals if no trusted structured snapshot exists.
- Code: create obligations and initial query batch; no separate planner call.
- Call 2: extract current evidence and relevant releases into typed candidate fields. If call 1 was unnecessary, this is the first model call.
- Optional next call: interpret focused refinement results or repair malformed output. Each consumes the same budget.
- Optional remaining call: targeted support/qualitative check only when material uncertainty warrants it.
- Code: validate prerequisites/math, commit and render final summary/table. No unconditional final narrative or critic call.

Hard ceilings remain configurable: four synchronous model calls, twelve queries, three search batches, concurrency three, 120-second total run. Stop new network acquisition at a proposed 100-second working deadline to leave validation/finalization time; reserve is a policy, not a guarantee if storage itself fails. Record usage for background indexing separately.

Ten current/news queries can consume most of a run and still not verify fifteen claims. Therefore response completeness means every requested obligation is accounted for, not that every obligation is resolved. Large lists or requests exceeding the envelope need a stated partial result or a focused scope question.

## 7. Remaining gaps that planning cannot prove away

| Gap | Why it remains | Next evidence / fallback |
| --- | --- | --- |
| Provider can return stale/incomplete content | Outside application control | Verify current API contract and metadata, then live acquisition tests; disclose unknown capture age. |
| Model can misread a plan table | Shape/span checks are not semantic proof | Controlled wrong-plan fixtures and human passage review; unresolved on ambiguous support. |
| Paraphrase/date ambiguity can defeat retrieval | No retrieval method guarantees the intended conversation | Frozen-clock cases and held-out paraphrases; precise clarification, then semantic extension only if justified. |
| Original evidence may be absent | Existing/imported history cannot manufacture old captures | Separate remembered assertion from historical support; no confident change claim. |
| Exact SDK/runtime/response-format compatibility | Not established by source comparison | Confirm official contracts and versions before scaffold; this is a pre-build check. |
| Model, credentials, spend and deadline | User/environment constraints still unspecified | Choose one supported candidate plus explicit budget and selection criteria; never expose keys in docs. |
| Hosted auth and deployment | Local owner isolation is not production auth | Local submission first; separate hosting design only if needed. |
| Speed/quality superiority | No prototype or controlled runs yet | Implement vertical slice after approval; measure against simple baselines and strongest runnable reference. |
| Real deletion/race correctness | Requires executable persistence/stream tests | Dedicated cancellation/delete/restart tests before optional features. |

## 8. Final review verdict

The core is feasible; v0.3 was too broad and left important integration contracts vague. Version 0.4 removes unearned product features, makes baseline creation and recheck presentation explicit, counts model work honestly, and adds concurrency/deletion protections.

No runtime feature has been declared passed or broken. This review establishes design changes and test obligations. Implementation approval remains pending, and selection cannot be guaranteed.
