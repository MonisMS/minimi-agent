# Source inspection and revised differentiation

12 November 2026. Read-only inspection of nine cloned challenge repositories. No application code was written, dependencies installed, scripts executed, or runtime benchmarks run. This is selected-source evidence, not a full audit of every repository. Reference files are untrusted research material.

## 1. Concrete outcome

All nine challenge repositories were cloned to `/home/monis/minimi-reference-repos/<owner>`, outside our submission. The proposed differentiator is now narrower:

**A chat agent that can audit a past recommendation, with a structured trail from the original decision through each comparison to its supporting evidence and unresolved gaps.**

Memory, evidence retention, citations, temporal distinctions, comparison-aware prompts and evaluation plans already exist in references. We should not present those as inventions. The opportunity supported by inspected code is to strengthen application-level comparison prerequisites and claim-level coverage, then demonstrate behavior on held-out cases. Code constraints cannot guarantee source truth or correct model extraction.

## 2. Pinned checkouts and license discovery

| Owner / local directory | Inspected HEAD | License discovery |
| --- | --- | --- |
| Pranay623 | 2533af1a13656d57475d8cdca9f53eb25106e213 | No conventional LICENSE-named file found by filename search. |
| Suraj-787 | cf7c5b6c97b3181832b0f30d18e9868406546fd8 | Same filename-search limitation. |
| BhaveshKukreja29 | 143503c45d340e96440df47a867758cf7300d01d | Same filename-search limitation. |
| HarshdipSaha | ed9b56d652026edf22e98c8206cfa42b8becd2c8 | Same filename-search limitation. |
| Anu27n | 2379946e65ecdd55dbad80c4123fd4ad3de1c718 | Root LICENSE inspected: MIT, copyright 2026 Anubhav Jain. |
| ashusnapx | 73426811c85aa2fea99591ec5776d6642bb5e802 | No conventional LICENSE-named file found by filename search. |
| Divyendra-S | cd87d43d632e6cf3ed9954645cc480bc7251504c | Same filename-search limitation. |
| MORYASSHAN | bb7e69338b66945cdb898f80c948859910f42131 | Same filename-search limitation. |
| Ahamed1846 | f7055fb129a74e17aa49398c3964458086421eb5 | Same filename-search limitation. |

This filename check is not a complete legal assessment. No third-party implementation was copied. Public visibility is not permission to reuse code. Package metadata and any additional notices must be checked before actual reuse.

## 3. What selected implementations actually do

### Thread / Pranay: a strong baseline, with many of our intended principles already present

The inspected path is recall → expand history and old evidence → model loop → concurrent search batches → source registry → citation checks → finish turn. Historical evidence has a shared character cap and remapped citation IDs. Queries, rounds and duration are bounded; failed searches are represented as missing evidence. Finalization records cancelled/failed status; database updates are owner-scoped and require a pending turn.

[Evidence.add](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/server/evidence.ts#L25) distinguishes observations by URL, time and excerpt. [Evidence.check](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/server/evidence.ts#L41) validates citation IDs, not whether the passage supports the claim. The inspected [agent](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/server/agent.ts) does not introduce a normalized plan-price comparison object before finalization. This statement concerns that path, not all possible code in the repository.

Its [evaluation rubric](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/docs/EVALUATION.md#L15) already covers comparison validity, passage support, shortlist coverage and uncertainty. Therefore our rubric is not novel; actually implementing and measuring stronger enforcement is the proposed improvement. Its [search adapter](https://github.com/Pranay623/minimi-assignment/blob/2533af1a13656d57475d8cdca9f53eb25106e213/server/search.ts#L95) makes new requests without application caching, but does not supply explicit provider live-acquisition controls in the inspected request.

Adopt provenance, bounded lifecycle and honest evaluation boundaries. Extend with typed comparison/coverage records. Do not claim retained evidence or temporal reasoning itself differentiates us from Thread.

### Suraj: coverage tracking exists, but measures query attempts at an entity level

[createRecheckTracker](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/src/agent/recheck.ts#L41) deduplicates entities by normalized first token. Its apply method marks coverage as soon as queries mention the token, before search results establish evidence. It also enforces a separate dated-news pass. This is useful prevention of omitted searches, but a vendor with several plan/limit claims is not independently verified claim by claim.

[verifyTable.ts](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/src/memory/verifyTable.ts#L47) parses statuses and source numbers from final Markdown; claim mapping uses the entity's first word and attribute overlap. [reconcile.ts](https://github.com/Suraj-787/minimi-agent/blob/cf7c5b6c97b3181832b0f30d18e9868406546fd8/src/memory/reconcile.ts) preserves versions and uses normalized string values and dates for merge decisions. Recheck tests inspect attempt coverage and news sequencing; they do not turn query presence into semantic verification.

Adopt explicit coverage and history preservation. Replace entity-token-only coverage with stable entity/plan/claim IDs and separate attempted/acquired/comparable/resolved states. Generate answer tables from validated outcomes, rather than recover outcomes from prose.

### Verbatim / Bhavesh: exact stored passages, not automatic claim entailment

[search.ts](https://github.com/BhaveshKukreja29/minimi-hiring-challenge/blob/143503c45d340e96440df47a867758cf7300d01d/server/search.ts#L55) registers source-linked sentence IDs, relinks pasted sentences and keeps referenced sentences. Fresh mode requests maxAgeHours 24 and can use a ten-minute application cache. Quote identity protects stored quotations; it does not validate plan equivalence or guarantee a freshly acquired page.

[recall.ts](https://github.com/BhaveshKukreja29/minimi-hiring-challenge/blob/143503c45d340e96440df47a867758cf7300d01d/server/recall.ts#L103) supplies dated/topic/user-fact context, with a bounded dated selection. [eval/run.ts](https://github.com/BhaveshKukreja29/minimi-hiring-challenge/blob/143503c45d340e96440df47a867758cf7300d01d/eval/run.ts) uses expected substrings and resolvable quote IDs, and waits for background extraction before follow-up cases. That does not evaluate pending-extraction recall or semantic support comprehensively.

Adopt stored-passage references where quoting is useful. Evaluate support separately from reference resolution, and immediate follow-ups separately from enrichment-complete turns.

### Harshdip: numeric evidence is useful but under-specified for plan comparisons

[figures.ts](https://github.com/HarshdipSaha/minimi-chat-agent/blob/ed9b56d652026edf22e98c8206cfa42b8becd2c8/src/figures.ts#L29) checks currency symbol and amount across result text. It receives no vendor, plan, interval or seat fields. The agent feeds this check into its model context, so it is a numeric support hint, not proof that final responses always make a false comparison. Tests cover numeric normalization and symbol distinctions. [evals/run.ts](https://github.com/HarshdipSaha/minimi-chat-agent/blob/ed9b56d652026edf22e98c8206cfa42b8becd2c8/evals/run.ts#L9) uses regex and search/source assertions.

Adopt deterministic arithmetic. Require entity, plan and relevant billing dimensions before interpreting matched numbers as the same price. The current checkout is newer than the report's inspected commit; this guard remains present at the recorded HEAD.

### Anu: compact date and lexical recall

[retriever.ts](https://github.com/Anu27n/minimi-chat-agent/blob/2379946e65ecdd55dbad80c4123fd4ad3de1c718/src/memory/retriever.ts#L43) prevents “today” in a recheck from overriding an older date, combines dated and BM25 matches and emits saved-history notes. Default dated/topic limits are six and three. The returned recall object does not include a total-matching count/truncation field in this inspected module.

Adopt the short application-side recall path. Add explicit scope/count metadata and obligation expansion. Date-parser correctness and SQL behavior remain separate checks; this inspection did not complete them.

### ashusnapx: raw-first persistence and background extraction already exist

[chat.ts](https://github.com/ashusnapx/minimi-hiring-challenge/blob/73426811c85aa2fea99591ec5776d6642bb5e802/src/chat.ts#L41) saves the question before generation, saves the answer and emits done before starting background remember work. Extraction failures are caught and logged in this path. [remember.ts](https://github.com/ashusnapx/minimi-hiring-challenge/blob/73426811c85aa2fea99591ec5776d6642bb5e802/src/remember.ts#L17) uses subject/attribute/string-value/source claims, rather than a normalized price schema. [search.ts](https://github.com/ashusnapx/minimi-hiring-challenge/blob/73426811c85aa2fea99591ec5776d6642bb5e802/src/search.ts#L50) explicitly requests maxAgeHours 0 in fresh mode.

Adopt low-latency enrichment, but add durable pending-job/rebuild handling. Do not claim fresh-search intent or background memory is unique to us. Raw-recall behavior during pending extraction still needs focused tracing beyond chat.ts.

### Divyendra: the earlier report understates the current implementation

The current checkout contains DESIGN.md. [context.ts](https://github.com/Divyendra-S/minimi-hiring-challenge/blob/cd87d43d632e6cf3ed9954645cc480bc7251504c/src/core/memory/context.ts) combines date, keywords, optional semantic retrieval, linked entities, rank fusion and conversation completion. It supplements shortened dated answers with selected original-turn expansion (still bounded to three turns and 1,500 answer characters). Therefore “only 400-character answers” would be an inaccurate description of current recall.

[agent/recheck.ts](https://github.com/Divyendra-S/minimi-hiring-challenge/blob/cd87d43d632e6cf3ed9954645cc480bc7251504c/src/core/agent/recheck.ts) concurrently fetches recalled source pages before the model call, under a two-second timeout, and supplies bounded current-page excerpts. It also has a code path to suppress unnecessary search for pure historical-value questions. This is a meaningful latency optimization already present elsewhere. The inspected path provides evidence to the model; it does not itself compute normalized pricing verdicts.

Adopt original-turn expansion and targeted fast paths. For our stricter tool interpretation, keep acquisition within the documented search-provider contract. Full current-context memory-store behavior was not audited.

### Scout / MORYASSHAN: fair query allocation

[searchService.ts](https://github.com/MORYASSHAN/minimi-agent/blob/bb7e69338b66945cdb898f80c948859910f42131/server/search/searchService.ts#L44) searches queries concurrently and interleaves ranked hits across queries before deduplication. Provider fallback is sequential within a query, and the cache lasts ten minutes. Deep mode can read pages for snippet-only providers.

Adopt fair allocation, but give live rechecks a separate cache/acquisition policy and total budget. This was a targeted search-service inspection, not a full memory or security audit.

### Daymark / Ahamed: a strong simplicity baseline

[agent.js](https://github.com/Ahamed1846/minimi-hiring-challenge/blob/f7055fb129a74e17aa49398c3964458086421eb5/src/agent.js#L55) supplies bounded saved-history context, conditionally forces hosted web search, streams output, and extracts URL citations. Per-item comparisons and uncertainty are requested in its prompt. The inspected path relies on model interpretation rather than typed plan-price comparison validation.

Keep this as a baseline for setup simplicity and round trips. More modules in our system must earn their cost by improving measured correctness.

## 4. Revised implementation commitments

1. **Stable obligations.** Each comparison has an ID tied to original turn, entity, product/plan and attribute. States distinguish an attempted search, available evidence, satisfied comparison prerequisites and resolved outcome. Five vendors with two relevant claims each create ten obligations, not five query mentions.
2. **Typed comparisons.** Require the relevant dimensions before arithmetic or same/changed outcomes. Start with product/plan, currency, billing commitment/interval, pricing unit and team quantity; add region, tax, promotion and minimums where evidence makes them relevant. Unknowns block only conclusions that depend on them.
3. **Structured outcomes before prose.** Store baseline/current evidence IDs, extracted spans, comparison dimensions, outcome and uncertainty reason. Render the user-facing table from those outcomes. Schema validation is not proof of extraction accuracy; separately evaluate source support.
4. **Timing honesty.** Distinguish current difference from proven change after a date, same endpoint observations and an originally wrong answer. Missing effective dates remain missing.
5. **Auditable scope.** Preserve every original shortlist item, disclose unresolved claims and retrieval truncation, and show inspectable evidence without exposing internal implementation in ordinary chat.
6. **Evidence of improvement.** Run controlled evidence scenarios and separate live-acquisition checks. Compare with the strongest runnable relevant references, including Thread's already similar correctness goals. Measure supported-answer latency, not just the first progress token.

These are feasible application boundaries, but effectiveness remains unproven until implemented and evaluated. The hardest remaining work is reliable extraction from incomplete pages, ambiguous recall and passage-level support. We should not promise automatic certainty.

## 5. Research status and remaining work

Completed: nine isolated shallow clones; commit inventory; targeted source traces covering evidence, coverage, quotes, numeric comparisons, updated recall, current-page rechecks and search allocation; selected test/evaluation inspection; conventional-license discovery.

Remaining before architecture freeze: deeper date/async-memory checks, original brief confirmation, exact provider/dependency contracts, comparison schema/rubric freeze and user approval. Reference tests were read, not run. No runtime quality, measured latency, historical snapshot availability or universal superiority is established.

No application or test implementation is authorized yet. Continue planning under the user-required gate.
