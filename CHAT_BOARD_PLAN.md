# Chat workspace, comparison board and chart plan

> Version 0.4 scope review: [LEAN_IMPLEMENTATION_PLAN.md](LEAN_IMPLEMENTATION_PLAN.md) and [E2E_DESIGN_REVIEW.md](E2E_DESIGN_REVIEW.md) take precedence. This document preserves earlier design/source context; its optional and product features are not all approved MVP requirements.


Version 0.3 — planning only. “Chart board” is covered here as both a chat workspace and an evidence-backed comparison board, with charts only where the data supports them. This is a behavior specification, not an implemented UI or a visual mockup.

## 1. Primary workspace

```text
Conversations       Chat / selected conversation            Evidence drawer
New chat            Original question + answer              Selected claim
Search history      Remembered baseline chip                Old passage + date
Date groups         Quiet activity line                     Current passage + date
Saved checks        Recheck answer                          URL and billing terms
Memory              Comparison preview → Open board         Missing/conflicting terms
                    Composer + Stop / Send
```

Desktop: sidebar, readable central column, evidence drawer opened on demand. Tablet/mobile: sidebar and drawer become overlays; comparison rows become stacked cards with old/current labels. No mandatory three-column squeeze or horizontal scrolling for the entire chat.

Reference patterns: Thread's evidence and remembered-context panel, Scout's quiet expandable activity, Divyendra's message-ID reconciliation, Verbatim's stored quote preview and Suraj's memory history. These influence behavior; their visual styles have not been independently browser-tested in this review.

## 2. Conversation behavior

- Empty state explains three useful tasks: new research, recalling a past discussion, checking whether an old recommendation still holds.
- Missing-key state shows what's required and how to configure it server-side. Offline walkthrough is visibly separate; no fake live answer is substituted.
- Show the resolved baseline date and key constraints in a compact chip. Selecting it opens the original exchange, not an extracted summary alone.
- Progress says what is happening: finding history, checking current sources, comparing terms. Expandable activity shows actual lookup/search facts, not hidden chain-of-thought.
- Send creates a stable question/run ID. Stop preserves the question and any clearly labeled incomplete display text. Retry links a new attempt to that question.
- Do not auto-scroll a user away from older content. Offer a new-content indicator while they inspect history.

## 3. Comparison board

The board opens from a recheck answer and is backed by its persisted verification run. Its header shows original decision date, checked-at time, original team constraints and coverage wording such as “4 of 5 items have comparable price evidence.” A search count is not a verification count.

| Column | Meaning |
| --- | --- |
| Item and plan | Exact member of the recovered decision, with stable identity. |
| Previous observation | Saved value, relevant terms, date and historical evidence indicator. |
| Current observation | Current value, relevant terms, checked/capture date where known. |
| Outcome | Confirmed change, different now/timing unknown, same observed value, earlier answer wrong, or cannot compare. |
| Team impact | Code-computed total/delta only if prerequisites hold. |
| Evidence / gap | Open supporting excerpts or explain the missing/conflicting term. |

Price, usage limit and release obligations are separate within an item. A verified price does not automatically verify the product's limits or launches. Status text always accompanies color. Filter unresolved and changed items, but preserve total coverage in the header so filtering cannot hide missing work.

Actions: inspect original discussion, inspect old/new source, recheck all, recheck unresolved. Each recheck creates a new saved run. A history selector revisits older checks; current values never overwrite historical observations.

If the baseline is ambiguous, the board stays in “Choose original discussion” state with dated candidates. If no saved baseline exists, show that limitation and offer a new comparison; do not quietly call a newly invented shortlist the historical one.

## 4. Scenario calculations

The original team size stays visible. An optional quantity input, after the core board works, computes a separate “What if the team had 25 seats?” scenario from already supported price formulas. It does not edit past constraints or imply a newly verified quote. Changing billing commitment requires corresponding evidence; it is not just a visual toggle.

Do not display a cheapest/best badge when relevant prices are incomparable, missing or exclude material usage costs. Explain whether a recommendation changes and what remains unknown.

## 5. Charts

The first useful chart is grouped before/after bars for comparable monthly-equivalent or annual team cost, with the original billing commitment plainly labeled. Monthly-equivalent values from annual commitments are allowed as explicitly labeled arithmetic when both comparison sides have aligned commitment terms; do not compare an annual commitment against a flexible monthly plan as a price increase.

Eligibility rules:

- Same relevant currency, plan/unit, quantity and pricing assumptions; formulas supported by evidence.
- Unknown values are shown as unknown, not zero; blocked rows explain why no bar is drawn.
- Two observations support a before/after comparison, not a continuous trend line.
- More dated observations can form a sparse observation chart with gaps; never invent intermediate dates or prices.
- Hover/focus shows terms and source; a readable data table remains available.
- No numerical confidence percentage, invented savings, interpolated history or unsupported currency conversion.

Implement this only after the table and validators pass. A clear table is sufficient for the first reliable submission; the chart is a bounded enhancement, not a new analytics subsystem.

## 6. Evidence and memory inspection

Evidence drawer: claim text, original/current labels, exact stored passage with relevant spans, URL/title, retrieved/captured/published/effective dates only when known, and missing qualifiers. A historical citation opens the saved observation first; the live page is a separate external link because its content may have changed.

Quote rendering inserts stored passages by ID. Browser text-fragment highlighting is optional convenience and may fail after page changes. It is not our source-of-truth mechanism.

Memory view: decisions, constraints and derived claims grouped by topic/date, with links to original turns and replacement history. Distinguish “you stated,” “assistant proposed” and “source observed.” Forgetting derived memory and deleting original history have different actions and clear effects. Do not expose internal extraction instructions or provider keys.

## 7. Error and lifecycle states

| State | User-visible behavior |
| --- | --- |
| Missing configuration | Actionable setup notice; live input unavailable where needed; labeled offline walkthrough remains available. |
| Recall ambiguous | Show dated candidates and one focused clarification; don't fetch unrelated alternatives. |
| Search partially failed | Preserve good rows and explicit unresolved rows; allow retry of unresolved work. |
| Source conflict | Show the conflict and relevant terms; no forced binary verdict. |
| Stop/disconnect | Keep question, label partial output; reload reconciles actual server state by run ID. |
| Extraction pending/failed | Chat still works from originals; memory inspector can expose indexing state without making it a normal-flow hurdle. |
| Deleted source chat | Baseline/evidence links become unavailable; stale board cannot silently expose deleted content. |
| Late event from another run | Ignore it; no answer text or evidence attaches to the wrong conversation. |

## 8. UI acceptance checklist

- Keyboard can send, stop, open/close drawer, choose a baseline and inspect every comparison row.
- Focus returns to the invoking control after overlays close; Escape and accessible dialog labels work.
- Status uses text and suitable live-region announcements without announcing every streamed token.
- Narrow screens show readable cards and evidence, including long URLs and plan names.
- Reload after completion shows exactly the same saved outcomes; streamed and persisted turns never duplicate.
- Chart/table/chat numeric values come from the same result object and agree exactly.
- Fictional walkthrough cannot enter live recall or evaluation results.
- Screenshot/layout and browser behavior verification happen after implementation approval; none is claimed now.
