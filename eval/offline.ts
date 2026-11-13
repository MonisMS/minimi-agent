import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface SplitCase {
  id: string;
  split: 'regression' | 'smoke' | 'protocol';
  testTitle: string;
}

interface VitestAssertion {
  ancestorTitles: string[];
  fullName: string;
  status: string;
  failureMessages: string[];
}

interface VitestResult {
  testResults: Array<{ assertionResults?: VitestAssertion[] }>;
  numFailedTests: number;
  numPassedTests: number;
}

const root = process.cwd();
const split = JSON.parse(readFileSync(path.join(root, 'eval/split.json'), 'utf8')) as { cases: SplitCase[] };
const tempFile = path.join(os.tmpdir(), `minimi-offline-${process.pid}.json`);
const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs');
const run = spawnSync(process.execPath, [
  vitestCli, 'run', 'test/recheck.test.ts', 'test/chat.test.ts', 'test/demo.test.ts',
  '--reporter=json', `--outputFile=${tempFile}`,
], { cwd: root, encoding: 'utf8', env: process.env });

if (run.error) throw run.error;
let results: VitestResult;
try {
  results = JSON.parse(readFileSync(tempFile, 'utf8')) as VitestResult;
} catch {
  process.stderr.write(run.stdout);
  process.stderr.write(run.stderr);
  throw new Error('Vitest did not produce the expected JSON evaluation report');
}
unlinkSync(tempFile);

const assertions = results.testResults.flatMap((file) => file.assertionResults ?? []);
const cases = split.cases.map((evaluationCase) => {
  const matched = assertions.find((assertion) => assertion.fullName.includes(evaluationCase.testTitle));
  return {
    id: evaluationCase.id,
    split: evaluationCase.split,
    evidence: evaluationCase.id === 'F34' ? 'namespace integration test' : 'scripted actual-pipeline test',
    status: matched?.status === 'passed' ? 'passed' : 'failed_or_missing',
    test: matched?.fullName ?? evaluationCase.testTitle,
    failures: matched?.failureMessages ?? [],
  };
});
const report = {
  evaluation: 'offline controlled pipeline regression',
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  providerMode: 'scripted model and search; no network calls',
  modelReasoningQuality: 'not measured; scripted transports verify orchestration and deterministic contracts only',
  caseCount: cases.length,
  passed: cases.filter((item) => item.status === 'passed').length,
  failed: cases.filter((item) => item.status !== 'passed').length,
  cases,
  protocolTests: { passed: results.numPassedTests, failed: results.numFailedTests },
  heldOutCases: 0,
};
const outputDir = path.join(root, 'data', 'offline-eval');
mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'latest.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`# Offline evaluation\n\n`);
process.stdout.write(`Runtime: ${report.runtime}; providers: ${report.providerMode}.\n`);
process.stdout.write(`Cases: ${report.passed}/${report.caseCount} passed. Protocol test assertions: ${results.numPassedTests} passed, ${results.numFailedTests} failed.\n`);
process.stdout.write(`Model reasoning quality: ${report.modelReasoningQuality}. Held-out cases: 0.\n\n`);
for (const item of cases) process.stdout.write(`- ${item.id} (${item.split}): ${item.status}\n`);
process.stdout.write(`\nMachine-readable report: ${path.relative(root, reportPath)}\n`);
if (run.status !== 0 || report.failed > 0 || results.numFailedTests > 0) process.exitCode = 1;
