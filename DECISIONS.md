# Decisions, open questions and approval gate

12 November 2026. Status: DRAFT. The user has authorized repository creation and detailed planning, and explicitly prohibited implementation until the plan is finalized.

> Current proposal: [LEAN_IMPLEMENTATION_PLAN.md](LEAN_IMPLEMENTATION_PLAN.md) and [E2E_DESIGN_REVIEW.md](E2E_DESIGN_REVIEW.md), version 0.4. These supersede conflicting earlier scope. Approval remains NOT GIVEN; the latest request authorized a plan-level walkthrough, not implementation.

## 1. Provisional architecture decisions

| Decision | Proposed choice | Alternative / condition to reconsider |
| --- | --- | --- |
| Submission foundation | Original compact TypeScript agent | Do not base the submission on a competitor fork. |
| Orchestration | Plain bounded model loop | Mastra/LangGraph.js only if the source review shows material lifecycle/maintainability benefit. |
| Memory | SQLite originals + FTS/date/entity indexes | Embeddings only after measured misses; memory service only after a controlled benefit. |
| Evidence | Immutable returned content and metadata | URL-only memory cannot reconstruct old support. |
| Verification | Structured obligations and comparable dimensions | Prompt-only or Markdown-parsed verdicts are weaker enforcement boundaries. |
| Tools | Only model-callable web_search | Application recall stays internal; no separately callable browser/fetch/memory tool. |
| Search default | Provisionally Tavily, Exa comparison candidate | Verify current contracts and run the proposed provider pilot after approval; no blanket superiority claim. |
| Model default | Undecided configurable primary model | Choose after accuracy/latency/cost evidence; avoid unconditional extra planner/critic calls. |
| UI | React/Vite chat, inline expandable comparison table and evidence/original drawer | No standalone dashboard, charts or scenario sliders in MVP. |
| Background work | One optional durable indexing-job type; raw recall works immediately | On-demand baseline interpretation is part of the synchronous run budget when structured memory is absent. |
| Scope | Reliable recall, evidence-linked rechecks and lifecycle correctness first | Also defer charts, scenarios, memory editing/forgetting, profiles, embeddings and archives; keep scoped chat deletion. |

## 2. Alternatives deliberately deferred

- Entire history on every turn: retain as an evaluation baseline, but context/cost grow with history.
- Summaries as authoritative memory: can omit exact shortlist members and pricing qualifiers.
- Graph database as default: infrastructure cost before evidence of a retrieval requirement.
- Several search fallbacks: availability can improve while latency/freshness becomes unpredictable.
- Autonomous research swarm: adds orchestration/model calls before the core comparison task is solved.
- Exact-string/numeric comparison alone: matching a price does not establish the same plan or terms.
- Universal post-answer critic: evaluate selective verification rather than add fixed cost to casual chat.

## 3. Open questions to resolve during finalization

1. What is the actual submission deadline and available focused time? This changes phase scope, not correctness requirements.
2. Which model/search credentials are available, and what is the acceptable evaluation spend? No secrets belong in this document.
3. Should a hosted demo be part of submission, or is local run sufficient? Deployment requires a separate scoped plan if requested.
4. Which Node/SQLite driver and date-library versions meet the required behavior and clean-install contract?
5. Does current source review substantiate or revise the inherited report's claimed limitations?
6. What exact ambiguous-date clarification policy, comparison schema and evidence adequacy rubric will we freeze?
7. Can the brief's one-tool interpretation and required deliverables be confirmed from current original pages?

Routine implementation choices can be proposed and documented without repeated permission requests. The explicit user-required implementation gate remains mandatory.

## 4. Planning completion checklist

- [x] Read supplied consolidated research.
- [x] Initialize a local WSL Git repository on `codex/planning`.
- [x] Retrieve and review README material for nine challenge repositories and thirteen architectural/evaluation references.
- [x] Write detailed architecture, storage, recall, verification, lifecycle and UI plan.
- [x] Write prioritized clone-and-inspect backlog with specific files and questions.
- [x] Define evaluation baselines, failure scenarios, metrics and proposed acceptance targets.
- [x] Clone all nine challenge references and document selected source traces, pinned revisions and revised differentiation in IMPLEMENTATION_AUDIT.md.
- [x] Deepen selected date, async-memory, lifecycle, queue, safeguards and UI paths across all nine references; record findings and source links in FEATURE_SELECTION.md.
- [x] Map reference patterns to our modules, define gap remedies, chat/board behavior, APIs and a 22-task build backlog.
- [ ] Validate remaining provider/dependency contracts and unresolved source questions before architecture freeze; source review is not exhaustive.
- [ ] Confirm original brief and exact current dependency/provider contracts.
- [ ] Resolve deadline, credentials/budget, model/provider selection procedure and any scope changes.
- [ ] Review the proposed plan with the user and record explicit approval.

README review and document preparation are complete. Selected source review is now completed in IMPLEMENTATION_AUDIT.md; remaining deeper audit items are explicitly pending. Model/provider pilots need implementation or an agreed external harness, so exact performance-based selection cannot honestly be finalized from README inspection alone. Approve a default candidate plus a measured selection rule at freeze, then allow substitution only within those agreed criteria.

## 5. Explicit implementation gate

Approval status: NOT GIVEN.

Before writing application/test code or scaffolding, the user must explicitly approve the finalized implementation plan. Record the approval message/date, chosen scope and approved first phase here. Until then only research and planning proceed.

This gate comes directly from the user's instruction: “we will not write a single line of code until we finalize our implementation.” It is not an additional permission requirement invented by a skill.

## 6. Submission checklist for later

- Public original GitHub repository, attribution and appropriate license.
- Fresh checkout follows npm install / npm run dev without a hidden service requirement.
- Server-only keys documented in .env.example; no secrets committed.
- One model-callable search tool; ordinary conversation still works.
- Dated cross-chat recall, complete shortlist recovery, retained evidence, current verification and explicit uncertainty.
- Tests and evaluation report with reproducible settings, supported claims and honest limitations.
- One-page DESIGN.md, distinct from this detailed internal plan.
- One-minute video demonstrating remembered baseline, current recheck and inspectable evidence.
- Next-week priorities informed by measured failures.

## 7. End-to-end paper review — version 0.4

- [x] Walk through first recommendation, immediate follow-up, five-item recheck, historical recall, revisions and requested launches.
- [x] Record 15 design failure conditions, including baseline extraction timing, validation/streaming conflict, budget accounting, cancellation races and delete-while-working.
- [x] Remove unearned MVP features and replace the broad 22-task scope with six delivery stages and explicit acceptance gates.
- [x] Define one synchronous call ledger and deterministic recheck presentation; separate unsuccessful indexing from a valid empty extraction.
- [ ] Prove these behaviors through implementation and executable tests after user approval. No runtime test has been run.

Remaining user/environment inputs are deadline, available credentials/provider budget and any hosting requirement. Remaining technical pre-build checks are original brief and exact runtime/model/search contracts. Selection and runtime superiority remain unproven.