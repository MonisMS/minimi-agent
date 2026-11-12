# Minimi agent — planning repository

Status: PROPOSED — implementation has not started. Prepared 12 November 2026.

Build a fast conversational agent that recovers what was asked and answered, retains the evidence behind recommendations, and rechecks comparable current facts without inventing history or changes.

## Read these documents

1. [LEAN_IMPLEMENTATION_PLAN.md](LEAN_IMPLEMENTATION_PLAN.md): current version 0.4 end-to-end plan, reduced scope, sequencing and acceptance gates.
2. [E2E_DESIGN_REVIEW.md](E2E_DESIGN_REVIEW.md): paper walkthrough, 15 design failure conditions, removed features and remaining gaps.
3. [EVALUATION_PLAN.md](EVALUATION_PLAN.md): evaluation methods; version 0.4 scope corrections in section 9 take precedence.
4. [DECISIONS.md](DECISIONS.md): current choices, unresolved pre-build inputs and user approval gate.
5. [FEATURE_SELECTION.md](FEATURE_SELECTION.md) and [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md): source evidence and reference influences; not a mandatory feature list.
6. [REPOSITORY_REVIEW.md](REPOSITORY_REVIEW.md) and [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md): README research and acquisition inventory.

Earlier design context: [SYNTHESIZED_PLAN.md](SYNTHESIZED_PLAN.md), [CHAT_BOARD_PLAN.md](CHAT_BOARD_PLAN.md), [CONTRACTS_AND_BACKLOG.md](CONTRACTS_AND_BACKLOG.md) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Their scope is superseded by version 0.4 where it differs. Planned charts, sliders, standalone dashboard and general memory editing are not first-submission requirements.

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
