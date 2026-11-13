# Validation record

## Offline evidence

The offline evaluator drives existing chat and historical-recheck integration tests with scripted model/search transports. It checks F01–F05 together through the actual recheck executor, plus saved recall (F12), untrusted search text (F19), ordinary conversation, current-fact research, and explicit demo/live namespace isolation (F34). It records individual case results in `data/offline-eval/latest.json`.

The development handoff reports the following results from 13 November 2026 using Node v24.22.3 and npm v11.19.1. They were recorded before publication and were not independently rerun for this push:

- `npm ci`: passed using the repository lockfile; 228 packages installed, 0 reported vulnerabilities.
- `npm run check`: passed typecheck, 146 tests in 16 files, and production build.
- `npm run test:e2e`: passed all 7 browser tests, including the demo namespace smoke case.
- `npm run eval:offline`: passed 6/6 reported cases and 10 protocol/integration assertions; JSON saved to ignored `data/offline-eval/latest.json`.
- `npm start` smoke with a temporary data directory: production server started and `GET /api/readiness` returned 200 in offline mode without credentials.

These are deterministic protocol and scripted-pipeline results. They do not establish real-model reasoning or semantic source support. No held-out set is claimed. The named F06–F35 catalog has additional unit/integration assertions, but this offline evaluator does not turn every catalog case into an independent full-pipeline score.

## Live validation

No OpenAI or Tavily calls were made. The session did not authorize paid/live calls, so live provider behavior, spend, refusals, source support, and answer latency remain unverified. No `eval:live` command is provided because a bounded real-provider evaluation runner is not implemented in this delivery.

## Browser and clean-install evidence

The development results above were recorded against an uncommitted working tree, so no exact tested commit hash was supplied. Internal execution notes are not part of the public file list. Tests, typechecks, builds, browser checks and offline evaluation were intentionally not rerun while preparing the publication commits. Do not treat these earlier reported results as verification of the pushed revision.

## Reporting limits

Do not describe these results as an independent benchmark or evidence of model quality. Supported-answer latency and time to first progress have not been measured. The held-out case count is zero.
