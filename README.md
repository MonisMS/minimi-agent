# Minimi agent — planning repository

Status: PROPOSED — implementation has not started. Prepared 12 November 2026.

Build a fast conversational agent that recovers what was asked and answered, retains the evidence behind recommendations, and rechecks comparable current facts without inventing history or changes.

## Read these documents

1. [SYNTHESIZED_PLAN.md](SYNTHESIZED_PLAN.md): current integrated architecture, gaps addressed, build order and acceptance criteria.
2. [FEATURE_SELECTION.md](FEATURE_SELECTION.md): which reference supplies each pattern, what we adopt/change/defer, and new source findings.
3. [CHAT_BOARD_PLAN.md](CHAT_BOARD_PLAN.md): chat workspace, comparison board, evidence drawer, chart eligibility and error/mobile behavior.
4. [CONTRACTS_AND_BACKLOG.md](CONTRACTS_AND_BACKLOG.md): module boundaries, proposed APIs, state contracts and 22 implementation tasks.
5. [EVALUATION_PLAN.md](EVALUATION_PLAN.md): controlled baselines, held-out tests and meaningful quality/speed evidence.
6. [DECISIONS.md](DECISIONS.md): choices, remaining pre-build checks and the explicit user approval gate.
7. [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md): pinned nine-repository inspection, strengths and evidence limits.
8. [REPOSITORY_REVIEW.md](REPOSITORY_REVIEW.md) and [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md): README research and acquisition inventory.

[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) is the earlier proposal, retained for context and superseded by SYNTHESIZED_PLAN.md where choices differ.

## Current state

- Local repository: Ubuntu-22.04 WSL, `/home/monis/minimi-agent`.
- Initial branch: `codex/planning`.
- Planning documents only; no application scaffold, dependencies, source, tests, or generated demo.
- Nine challenge reference repositories are cloned separately under `/home/monis/minimi-reference-repos`; backend, memory, search, lifecycle and UI paths have been selectively inspected; findings are documented in IMPLEMENTATION_AUDIT.md and FEATURE_SELECTION.md. This is source inspection, not an exhaustive or runtime audit. No public GitHub remote has been created.
- Original input: `C:/Games/MINIMI_COMPLETE_RESEARCH.md`, research dated 11 November 2026.
- README review: 22 repositories retrieved on 12 November 2026. README statements are author claims, not independently established runtime behavior.

## Working agreement

Continue research, source inspection and planning until the user finalizes the implementation plan. Do not scaffold or write application code, test code, package manifests or implementation configuration before explicit user approval. Record approval in DECISIONS.md when it arrives; do not infer approval from silence.

The goal is demonstrably stronger recall, comparison correctness and useful response speed on defined workloads. Neither a document review nor a feature list can establish that we are better than all submissions. Public repositories are references; their actual submission or selection status is unknown.
