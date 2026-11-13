import { expect, test } from '@playwright/test';

const conversationId = '10000000-0000-4000-8000-000000000001';
const questionId = '10000000-0000-4000-8000-000000000002';
const answerId = '10000000-0000-4000-8000-000000000003';
const runId = '10000000-0000-4000-8000-000000000004';
const resultId = '10000000-0000-4000-8000-000000000005';
const baselineId = '10000000-0000-4000-8000-000000000006';
const observationId = '10000000-0000-4000-8000-000000000007';
const ids = Array.from({ length: 5 }, (_, index) => `option-${index + 1}`);
const vendors = ['Aster', 'Birch', 'Cedar', 'Dune', 'Elm'];
const originalText = 'We propose Aster, Birch, Cedar, Dune, and Elm for a 20 seat team with a $500 budget in the US.';
const span = (start: number, endExclusive: number) => ({ start, endExclusive });
const evidenceText = 'Aster CRM Pro costs USD 24 per seat monthly. Price changes effective 2026-10-01.';

const members = ids.map((memberId, index) => ({
  memberId, vendor: vendors[index], product: 'CRM', plan: 'Pro', aliases: [], sourceSpan: span(0, originalText.length),
}));
const constraints = { teamSize: 20, budget: { amountDecimal: '500', currency: 'USD' }, region: 'US', sourceSpans: [span(0, originalText.length)] };
const observation = {
  id: observationId, ownerId: '10000000-0000-4000-8000-000000000008', namespace: 'live', runId,
  queryId: '10000000-0000-4000-8000-000000000009', originalUrl: 'https://example.com/pricing?plan=pro&region=us',
  safeCanonicalUrl: 'https://example.com/pricing?plan=pro&region=us', title: 'Aster Pro pricing',
  exactEvidenceText: evidenceText, contentHash: 'a'.repeat(64),
  textTruncated: false, retrievedAt: '2026-11-13T10:00:00Z', providerCaptureAt: null, publishedAt: null,
  effectiveAt: '2026-10-01T00:00:00Z', effectiveAtSpan: span(evidenceText.indexOf('2026-10-01'), evidenceText.indexOf('2026-10-01') + 10), provider: 'tavily',
  freshnessRequested: null, freshnessMetadata: null,
};
const result = {
  id: resultId, runId, baselineSnapshotId: baselineId, constraints, members,
  obligations: members.map((member, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, runId, memberId: member.memberId,
    attribute: 'price', baselineClaimId: `claim-${index}`, acquisition: 'attempted',
    observationIds: index === 0 ? [observationId] : [], comparability: index === 0 ? 'compatible' : 'insufficient',
    missingDimensions: index === 0 ? [] : ['current_evidence'], mismatchedDimensions: [],
    resolution: index === 0 ? 'resolved' : 'unresolved', outcomeId: index === 0 ? '30000000-0000-4000-8000-000000000001' : null,
  })),
  outcomes: [{
    id: '30000000-0000-4000-8000-000000000001', obligationId: '20000000-0000-4000-8000-000000000001',
    verdict: 'confirmed_change', reasonCodes: [], supportingObservationIds: [observationId], summary: 'A supported transition is dated 2026-10-01 after the baseline.',
    priceTotals: {
      baseline: { quantity: 20, monthlyEquivalent: '400.00', annualCommitment: '4800.00', monthlyEquivalentLabel: 'USD / seat / month', annualCommitmentLabel: 'USD / seat / year' },
      current: { quantity: 20, monthlyEquivalent: '480.00', annualCommitment: '5760.00', monthlyEquivalentLabel: 'USD / seat / month', annualCommitmentLabel: 'USD / seat / year' },
      monthlyDelta: '80.00',
    },
  }],
  unresolvedReasons: ['missing_current_evidence'],
  searchCounts: { attempted: 10, succeeded: 8, empty: 2, failed: 0, cancelled: 0 },
  coverageCounts: { requested: 5, attempted: 5, resolved: 1, unresolved: 4 },
  checkedAt: '2026-11-13T10:01:00Z', summary: '1 of 5 price checks resolved; 4 remain unresolved.',
};
const original = {
  id: answerId, conversationId, ownerId: observation.ownerId, namespace: 'live', role: 'assistant', originalText,
  createdAt: '2026-10-01T12:00:00Z', timezone: 'Asia/Kolkata', runId, answerState: 'complete', sourceObservationIds: [],
};
const response = {
  result,
  baselineSnapshot: {
    id: baselineId, originalMessageId: answerId, originalSpan: span(0, originalText.length), state: 'assistant_proposed',
    revision: 2, supersedesId: '10000000-0000-4000-8000-000000000010', members, constraints, validatedAt: '2026-10-01T12:01:00Z',
  },
  baselineOriginal: original,
  observations: [observation],
};

test('saved comparison shows all members, retained evidence, original exchange, and starts a new baseline-linked run', async ({ page }) => {
  const question = {
    id: questionId, conversationId, ownerId: observation.ownerId, namespace: 'live', role: 'user',
    originalText: 'Which CRM should our team choose?', createdAt: '2026-10-01T11:59:00Z', timezone: 'Asia/Kolkata',
    runId, answerState: null, sourceObservationIds: [], runState: 'completed', resultId: null,
  };
  const answer = { ...original, resultId, runState: 'completed' };
  await page.route('**/api/readiness', (route) => route.fulfill({ json: {
    ok: true, mode: 'offline', model: null, configured: { openai: false, tavily: false },
    capabilities: { liveGeneration: false, search: false }, notes: [],
  } }));
  await page.route('**/api/conversations', (route) => route.fulfill({ json: { conversations: [{
    id: conversationId, namespace: 'live', generation: 1, title: 'CRM selection',
    createdAt: '2026-10-01T11:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
  }] } }));
  await page.route(`**/api/conversations/${conversationId}/messages`, (route) => route.fulfill({ json: { messages: [question, answer] } }));
  await page.route(`**/api/results/${resultId}`, (route) => route.fulfill({ json: response }));
  await page.route('**/api/runs', async (route) => {
    const body = route.request().postDataJSON() as { message: string; baselineId: string };
    expect(body.message).toBe('Recheck this saved comparison.');
    expect(body.baselineId).toBe(baselineId);
    await route.fulfill({ json: {
      runId: '40000000-0000-4000-8000-000000000001', questionId: '40000000-0000-4000-8000-000000000002',
      answerId: null, conversationId, state: 'received', version: 0, eventSeq: 0, existing: false,
    } });
  });
  await page.route('**/api/runs/*/events', (route) => route.abort());

  await page.goto('/');
  await page.getByRole('button', { name: 'View saved comparison' }).click();
  await expect(page.getByText('Obligations resolved: 1 / 5')).toBeVisible();
  await expect(page.getByRole('rowheader')).toHaveCount(5);
  await expect(page.getByText('Aster · CRM · Pro')).toBeVisible();
  await expect(page.getByText('Elm · CRM · Pro')).toBeVisible();
  await expect(page.getByRole('cell', { name: /480\.00 USD \/ seat \/ month/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Baseline: 400\.00/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Monthly delta: 80\.00/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Unknown' }).first()).toBeVisible();

  const evidenceButton = page.getByRole('button', { name: 'Current: Aster Pro pricing' });
  await evidenceButton.click();
  const evidenceDialog = page.getByRole('dialog', { name: 'Evidence' });
  await expect(evidenceDialog.locator('blockquote')).toContainText('2026-10-01');
  await expect(evidenceDialog.getByRole('link', { name: /Open current source page/ })).toHaveAttribute('href', observation.originalUrl);
  await page.keyboard.press('Escape');
  await expect(evidenceDialog).toHaveCount(0);
  await expect(evidenceButton).toBeFocused();

  await page.getByRole('button', { name: /Original decision/ }).click();
  const baselineDialog = page.getByRole('dialog', { name: 'Saved baseline' });
  await expect(baselineDialog.getByText('Revision 2')).toBeVisible();
  await expect(baselineDialog.getByText('Which CRM should our team choose?')).toBeVisible();
  await expect(baselineDialog.getByText(originalText)).toBeVisible();
  await expect(baselineDialog.getByText('All saved options (5)')).toBeVisible();
  await baselineDialog.getByRole('button', { name: 'Close saved baseline' }).click();

  await page.getByRole('button', { name: 'Recheck' }).click();
  await expect(page.getByText('Starting')).toBeVisible();
});
