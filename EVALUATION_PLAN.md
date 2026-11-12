# Evaluation and comparative evidence plan

Status: proposed protocol, no tests implemented or run. All thresholds below are engineering targets, not observed results. Freeze the rubric and held-out set before tuning.

## 1. What “better” will mean

We want fewer unsupported changes, more complete dated recall, useful uncertainty and competitive supported-answer latency at a stated cost. More features, more tests and a larger model do not independently establish an improvement.

Report two kinds of comparison separately:

1. Controlled architecture comparison: same model, history, evidence fixtures and budgets; vary memory/verification design.
2. External system comparison: pinned reference implementations in their documented supported configurations. Report actual model/provider/settings differences. If adaptation is needed for fixtures, disclose the adapter and verify it preserves behavior; do not present adapted results as untouched repository performance.

If a reference cannot be run or configured, mark it unavailable with a reason. Do not assign it a failing score. Public repositories are a sampled set, not the entire applicant pool.

## 2. Dataset design

Plan 60 controlled multi-turn scenarios: 40 development and 20 held out. A scenario contains timestamped original turns, timezone, current clock, saved source observations, simulated current search results, expected baseline/member IDs, required comparison dimensions and allowed outcomes. Expand beyond 60 if uncertainty or narrow category counts make results inconclusive.

Partition by vendor/topic and failure pattern, not just surface wording, to reduce leakage. Keep fictional vendors for deterministic numeric fixtures and a separate real-source live suite. Keep expected verdicts hidden from the agent context. Label original-ground-truth errors explicitly.

| Category | Planned cases | Examples |
| --- | ---: | --- |
| Date and baseline recall | 10 | Exact date across threads, same topic on different days, ambiguous weekdays, missing history. |
| Complete context | 8 | Fifth shortlist member, revised list, corrected team size, paraphrases. |
| Temporal boundaries | 6 | Local midnight, DST, leap date, missing year, historical relative phrase. |
| Comparable facts | 12 | Annual/monthly, currency/region, seats/minimums, tax, promotion, usage units, same number on another plan. |
| Change/knowledge status | 8 | Known effective date, unknown change timing, same endpoints, originally wrong answer. |
| Evidence failure | 8 | Missing baseline, stale capture, no result, blocked page, source conflict, unsupported citation. |
| Lifecycle and trust | 8 | Pending extraction, extraction failure, cancelled answer, restart, long-history truncation, injected instructions. |
| Total | 60 | Each scenario can test multiple obligations. |

Include relevant and irrelevant product launches within the context/change categories. Ordinary conversation and fresh research receive a separate smoke suite so pricing-specific tuning does not break general chat.

## 3. Controlled evidence and live evidence

Controlled search fixtures isolate reasoning. They must represent successful and failed acquisition, unknown capture time, conflicting sources and missing qualifiers. The agent sees realistic returned evidence, never evaluator labels.

Live pilot: 12 representative research/recheck tasks across Exa and Tavily, with at least three runs per configuration when budget permits. Capture provider responses once per run, timestamps, returned capture age if available, completeness, latency and billed/request cost. Interleave providers and record wall time because the web changes. For fairness, replay identical captured evidence in reasoning comparisons. Live end-to-end results measure acquisition too and must be reported separately.

Historical snapshot tests are conditional on actual capture availability. Provider support for an as-of parameter is not evidence that a specific historical plan was captured. Do not score an unavailable archive as a fabricated comparison failure if the agent correctly reports uncertainty.

## 4. Baselines and ablations

| Baseline | Purpose |
| --- | --- |
| Current message + search | Quantify what is lost without memory. |
| Full timestamped history + search, where context fits | Strong simple memory baseline. |
| Date + FTS + original-turn expansion | Establish whether structured memory is necessary. |
| Above + retained evidence and structured comparison | Isolate our core proposal. |
| Above + semantic retrieval | Add only if paraphrase recall improves enough. |
| Above + selective claim verification pass | Test whether added support accuracy earns extra latency/cost. |

Keep model version, reasoning settings, token/query ceilings, temperature where supported and evidence allocation equivalent. Record unavoidable differences. Compare against at least the P0 reference systems that can be run, but do not require rewriting every competitor just to force a standardized harness.

## 5. Metrics and scoring

- Baseline retrieval: correct original turn/session ID; exact shortlist set recovery; constraint accuracy; false missing-history rate.
- Verification: supported claim precision, claim/obligation coverage, false-change rate, false-unchanged rate, correct uncertainty and originally-wrong detection.
- Evidence: citation ID validity separately from passage support and correct plan/entity association. Direct quotations require exact stored-passage agreement.
- Speed: first supported answer time, final answer time and progress-event time separately; p50/p95 by task type, timeout and cancellation counts. A “searching” message is not a factual answer.
- Cost: model/search calls, input/output tokens, available billed cost, ingestion/enrichment cost and cost per successful answer.
- Lifecycle: persisted user turn, partial-answer state, immediate raw recall, restart recovery and owner isolation.

Use deterministic evaluation for dates, arithmetic, member sets and state invariants. Use blinded human review of support/relevance for all disputed cases and a representative sample of passing cases. An LLM judge can help triage qualitative cases; it must not be the sole source of support labels. Publish rubric and disagreements.

## 6. Proposed acceptance targets

Critical invariants must have zero failures in the designated adversarial suite: no invented baseline, no missing shortlist item without an unknown, no comparison across incompatible terms, no false known change date, no ID-only citation check presented as semantic support, and no incomplete answer stored as completed memory.

Quality targets across the full held-out suite: at least 95% correct baseline retrieval, 95% exact shortlist recovery, 95% supported claim precision and 90% correct uncertainty classification. Track denominators and category scores; an aggregate must not hide a complete category failure. A small suite cannot establish population-level reliability.

Initial latency targets: local recall p95 under 250 ms on a documented history size/hardware; ordinary chat first supported output p50 under 3 seconds; completed recheck p50 under 20 seconds and p95 under 45 seconds. These are provisional targets subject to model/provider pilot results. The 120-second run ceiling is a failure boundary, not a target.

No fixed monetary target is meaningful before model/provider choice. Freeze a per-evaluation and per-turn budget in DECISIONS.md before live runs. Do not silently increase cost to win the comparison.

To claim a demonstrated improvement: pass critical invariants, show a meaningful held-out support/coverage improvement or lower false conclusions against the strongest runnable relevant baseline, and disclose latency/cost tradeoffs. If evidence is mixed, state the narrower improvement. Never claim “best submission” from this suite.

## 7. Execution and publication protocol after coding approval

1. Freeze dataset/rubric and randomization; record hashes and train/development/holdout boundaries.
2. Pin our commit, reference commits, Node/dependency versions, hardware, model IDs and provider settings.
3. Run deterministic cases, then controlled model cases repeatedly; diagnose development failures only.
4. Run held-out comparison at least three times per model configuration where feasible; report case outcomes and variance, not just best runs.
5. Run interleaved live-provider tasks under the approved cost budget.
6. Review unsupported claims and disagreements; preserve raw traces with sensitive information removed.
7. Write a results report with failures, sample counts, costs, timings, limitations and reproducible commands.
8. After a material change, rerun affected regressions; rerun the full agreed submission checks once the implementation stabilizes.

No evaluation code, fixtures or model calls have been created in this planning phase.
