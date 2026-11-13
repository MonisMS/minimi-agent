import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerificationResultResponse } from '../../shared/api.js';
import type { SourceObservation, VerificationOutcome } from '../../shared/domain.js';
import { getVerificationResult } from '../api.js';
import { BaselineDrawer } from './BaselineDrawer.js';
import { EvidenceDrawer } from './EvidenceDrawer.js';

const verdictLabels: Record<string, string> = {
  confirmed_change: 'Confirmed change', earlier_answer_wrong: 'Earlier answer was wrong',
  same_observed: 'Same at observed endpoints', different_now_timing_unknown: 'Different now · timing unknown',
  cannot_compare: 'Cannot compare', no_saved_baseline: 'No saved baseline',
};
const humanize = (value: string) => value.replaceAll('_', ' ');
const amount = (value: string | null | undefined) => value ?? 'Unknown';

export function Comparison({ resultId, onRecheck }: { resultId: string; onRecheck(baselineId: string | null): void }) {
  const [expanded, setExpanded] = useState(false);
  const [response, setResponse] = useState<VerificationResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeObservation, setActiveObservation] = useState<SourceObservation | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const requestedRef = useRef(false);

  const closeEvidence = useCallback(() => setActiveObservation(null), []);
  const closeBaseline = useCallback(() => setShowBaseline(false), []);

  useEffect(() => {
    if (!expanded || response || loading || error || requestedRef.current) return;
    requestedRef.current = true;
    setLoading(true);
    getVerificationResult(resultId).then(setResponse)
      .catch(() => setError('Could not load the saved comparison.'))
      .finally(() => setLoading(false));
  }, [error, expanded, response, resultId]);

  return (
    <section className="comparison-shell">
      <div className="comparison-actions">
        <button type="button" className="text-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Hide saved comparison' : 'View saved comparison'}
        </button>
        <button type="button" className="text-button" disabled={!response} onClick={() => onRecheck(response?.result.baselineSnapshotId ?? null)}>Recheck</button>
      </div>
      {expanded && loading && <p>Loading saved comparison…</p>}
      {expanded && error && <p role="alert">{error}</p>}
      {expanded && response && <>
        <div className="result-summary" aria-label="Comparison coverage">
          <p>{response.result.summary}</p>
          <span>Searches attempted: {response.result.searchCounts.attempted}</span>
          <span>Searches succeeded: {response.result.searchCounts.succeeded}</span>
          <span>Obligations resolved: {response.result.coverageCounts.resolved} / {response.result.coverageCounts.requested}</span>
          <span>Unresolved: {response.result.coverageCounts.unresolved}</span>
        </div>
        <div className="comparison-baseline">
          <button type="button" className="original-chip" onClick={() => setShowBaseline(true)}>Original decision · {response.baselineOriginal?.createdAt ? new Date(response.baselineOriginal.createdAt).toLocaleDateString() : 'Unknown date'}</button>
          <span>Constraints: team {response.result.constraints?.teamSize ?? 'unknown'}, budget {response.result.constraints?.budget ? `${response.result.constraints.budget.currency} ${response.result.constraints.budget.amountDecimal}` : 'unknown'}, region {response.result.constraints?.region ?? 'unknown'}</span>
        </div>
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <caption className="sr-only">Persisted comparison outcomes for all original options</caption>
            <thead><tr><th scope="col">Original option</th><th scope="col">Result</th><th scope="col">Monthly equivalent</th><th scope="col">Annual commitment</th><th scope="col">Evidence</th></tr></thead>
            <tbody>{response.result.members.map((member) => {
              const obligations = response.result.obligations.filter((item) => item.memberId === member.memberId);
              const outcomes = obligations.map((item) => response.result.outcomes.find((outcome) => outcome.obligationId === item.id)).filter((item): item is VerificationOutcome => Boolean(item));
              const outcome = outcomes[0];
              const totals = outcome?.priceTotals;
              const observationIds = [...new Set([...obligations.flatMap((item) => item.observationIds), ...outcomes.flatMap((item) => item.supportingObservationIds)])];
              const observations = response.observations.filter((item) => observationIds.includes(item.id));
              return <tr key={member.memberId}>
                <th scope="row">{[member.vendor, member.product, member.plan].filter(Boolean).join(' · ') || member.aliases.join(', ') || 'Unnamed option'}</th>
                <td><strong className={`status-label ${outcome?.verdict ?? 'unknown'}`}>{verdictLabels[outcome?.verdict ?? ''] ?? 'Unresolved'}</strong>
                  {outcomes.map((item) => <p className="outcome-copy" key={item.id}>{item.summary}</p>)}
                  {obligations.flatMap((item) => [...item.missingDimensions, ...item.mismatchedDimensions]).length > 0 && <p className="reason-copy">{[...new Set(obligations.flatMap((item) => [...item.missingDimensions, ...item.mismatchedDimensions]))].map(humanize).join('; ')}</p>}
                  {outcomes.flatMap((item) => item.reasonCodes).length > 0 && <p className="reason-copy">{[...new Set(outcomes.flatMap((item) => item.reasonCodes))].map(humanize).join('; ')}</p>}
                </td>
                <td><div className="price-pair"><span>Baseline: {amount(totals?.baseline?.monthlyEquivalent)}</span><small>{totals?.baseline?.monthlyEquivalentLabel ?? 'Unknown'}</small><span>Current: {amount(totals?.current?.monthlyEquivalent)}</span><small>{totals?.current?.monthlyEquivalentLabel ?? 'Unknown'}</small>{totals?.monthlyDelta != null && <span>Monthly delta: {totals.monthlyDelta}</span>}</div></td>
                <td><div className="price-pair"><span>Baseline: {amount(totals?.baseline?.annualCommitment)}</span><small>{totals?.baseline?.annualCommitmentLabel ?? 'Unknown'}</small><span>Current: {amount(totals?.current?.annualCommitment)}</span><small>{totals?.current?.annualCommitmentLabel ?? 'Unknown'}</small></div></td>
                <td>{observations.length ? <ul className="evidence-links">{observations.map((observation) => <li key={observation.id}><button type="button" className="text-button" onClick={() => setActiveObservation(observation)}>{response.baselineOriginal?.sourceObservationIds.includes(observation.id) ? 'Original' : 'Current'}: {observation.title || 'Saved evidence'}</button><small>Published {observation.publishedAt ? new Date(observation.publishedAt).toLocaleDateString() : 'date unknown'}</small></li>)}</ul> : <span>None saved</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <EvidenceDrawer observation={activeObservation} onClose={closeEvidence} />
        {showBaseline && <BaselineDrawer response={response} onClose={closeBaseline} />}
      </>}
    </section>
  );
}
