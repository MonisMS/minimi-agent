# Minimi agent — planning repository

Status: PROPOSED — implementation has not started. Prepared 12 November 2026.

Build a fast conversational agent that recovers what was asked and answered, retains the evidence behind recommendations, and rechecks comparable current facts without inventing history or changes.

## Read these documents

1. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): architecture, contracts, build order, acceptance criteria, scope.
2. [REPOSITORY_REVIEW.md](REPOSITORY_REVIEW.md): newly reviewed READMEs, source boundaries, and prioritized clone/inspection tasks.
3. [EVALUATION_PLAN.md](EVALUATION_PLAN.md): how to demonstrate improvements fairly.
4. [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md): pinned source findings from nine cloned references and revised differentiation.
5. [DECISIONS.md](DECISIONS.md): provisional choices, unresolved questions, and the implementation approval gate.

## Current state

- Local repository: Ubuntu-22.04 WSL, `/home/monis/minimi-agent`.
- Initial branch: `codex/planning`.
- Planning documents only; no application scaffold, dependencies, source, tests, or generated demo.
- Nine challenge reference repositories are cloned separately under `/home/monis/minimi-reference-repos`; selected implementation paths have been inspected and documented in IMPLEMENTATION_AUDIT.md. No public GitHub remote has been created.
- Original input: `C:/Games/MINIMI_COMPLETE_RESEARCH.md`, research dated 11 November 2026.
- README review: 22 repositories retrieved on 12 November 2026. README statements are author claims, not independently established runtime behavior.

## Working agreement

Continue research, source inspection and planning until the user finalizes the implementation plan. Do not scaffold or write application code, test code, package manifests or implementation configuration before explicit user approval. Record approval in DECISIONS.md when it arrives; do not infer approval from silence.

The goal is demonstrably stronger recall, comparison correctness and useful response speed on defined workloads. Neither a document review nor a feature list can establish that we are better than all submissions. Public repositories are references; their actual submission or selection status is unknown.
