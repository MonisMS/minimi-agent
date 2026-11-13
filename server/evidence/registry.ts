import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import {
  DomainValidationError,
  idSchema,
  sourceObservationSchema,
  type SourceObservation,
  type Span,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import { insertObservation, type InsertObservationInput } from '../db/evidence.js';
import type { Scope } from '../db/conversations.js';
import { validateEvidenceSpan } from './spans.js';

const MAX_EVIDENCE_TEXT_UNITS = 8000;
const DENIED_HOST_SUFFIXES = [
  '.localhost', '.local', '.localdomain', '.internal', '.test', '.example', '.invalid',
];
const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
  [0xe0000000, 4], [0xf0000000, 4],
];

export interface RegisterObservationInput {
  runId: string;
  queryId: string;
  originalUrl: string;
  title: string;
  evidenceText: string;
  textTruncated?: boolean;
  providerCaptureAt?: string | null;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  effectiveAtSpan?: Span | null;
  effectiveAtQuote?: string | null;
  provider: string;
  freshnessRequested?: string | null;
  freshnessMetadata?: Record<string, unknown> | null;
}

function ipv4ToNumber(host: string): number {
  return host.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function isInIpv4Range(host: string, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(host) & mask) === (network & mask);
}

function isExternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return !PRIVATE_IPV4_RANGES.some(([network, prefix]) => isInIpv4Range(host, network, prefix));
  }
  if (ipVersion === 6) {
    // Public IPv6 unicast is within 2000::/3; exclude the documentation block.
    const groups = host.split(':');
    const first = Number.parseInt(groups[0] || '0', 16);
    const publicUnicast = (first & 0xe000) === 0x2000;
    return publicUnicast && !host.startsWith('2001:db8:');
  }
  return host.includes('.') && !DENIED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function canonicalizeExternalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainValidationError('invalid_evidence_url', 'Evidence URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DomainValidationError('unsafe_evidence_url', 'Evidence URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new DomainValidationError('unsafe_evidence_url', 'Evidence URL cannot contain credentials');
  }
  if (!isExternalHost(url.hostname)) {
    throw new DomainValidationError('unsafe_evidence_url', 'Evidence URL must point to an external host');
  }
  // Keep query parameters and fragments: both can identify a product or pricing section.
  return url.toString();
}

function boundedEvidenceText(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_EVIDENCE_TEXT_UNITS) return { text: value, truncated: false };
  let end = MAX_EVIDENCE_TEXT_UNITS;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: value.slice(0, end), truncated: true };
}

export function registerObservation(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  conversationId: string,
  input: RegisterObservationInput,
): SourceObservation {
  const canonicalUrl = canonicalizeExternalUrl(input.originalUrl);
  idSchema.parse(conversationId);
  idSchema.parse(input.runId);
  idSchema.parse(input.queryId);
  const bounded = boundedEvidenceText(input.evidenceText);
  const effectiveAtSpan = input.effectiveAtSpan ?? null;
  if (effectiveAtSpan) {
    if (input.effectiveAtQuote == null) {
      throw new DomainValidationError('span_quote_required', 'A quote is required for an effective-date span');
    }
    validateEvidenceSpan({ exactEvidenceText: bounded.text }, effectiveAtSpan, input.effectiveAtQuote);
  } else if (input.effectiveAtQuote != null) {
    throw new DomainValidationError('span_missing', 'A quote cannot be provided without a span');
  }

  const observation: SourceObservation = sourceObservationSchema.parse({
    id: randomUUID(),
    ownerId: scope.ownerId,
    namespace: scope.namespace,
    runId: input.runId,
    queryId: input.queryId,
    originalUrl: input.originalUrl,
    safeCanonicalUrl: canonicalUrl,
    title: input.title,
    exactEvidenceText: bounded.text,
    contentHash: createHash('sha256').update(bounded.text, 'utf8').digest('hex'),
    textTruncated: Boolean(input.textTruncated) || bounded.truncated,
    retrievedAt: clock.now().toISOString(),
    providerCaptureAt: input.providerCaptureAt ?? null,
    publishedAt: input.publishedAt ?? null,
    effectiveAt: input.effectiveAt ?? null,
    effectiveAtSpan,
    provider: input.provider,
    freshnessRequested: input.freshnessRequested ?? null,
    freshnessMetadata: input.freshnessMetadata ?? null,
  });

  const row: InsertObservationInput = { ...observation, conversationId };
  return insertObservation(database, scope, row);
}
