/**
 * CI/CD integration tests — exercises the real function-based API in
 * src/integrations/cicd.ts: runCICDCheck, generateBadgeUrl, getCIExitCode.
 */

import { describe, it, expect } from 'vitest';
import { runCICDCheck, generateBadgeUrl, getCIExitCode } from '../../src/integrations/cicd.js';
import type { AnalysisResult } from '../../src/types.js';

function analysis(overall: number): AnalysisResult {
  return {
    files: [],
    totalFiles: 1,
    totalLines: 100,
    languageBreakdown: new Map([['typescript', 1]]),
    healthScore: {
      overall,
      categories: { documentation: overall, complexity: overall, structure: overall, maintainability: overall },
      issues: [
        { severity: 'error', message: 'Critical problem', file: 'a.ts', line: 5, rule: 'no-error' },
        { severity: 'warning', message: 'Minor problem', file: 'b.ts', line: 9, rule: 'no-warn' }
      ],
      suggestions: ['Improve documentation']
    },
    undocumentedBlocks: [],
    complexBlocks: []
  };
}

const cfg = (overrides: Partial<{ outputFormat: 'json' | 'junit' | 'github-actions'; healthThreshold: number; failOnLowHealth: boolean }> = {}) => ({
  enabled: true,
  failOnLowHealth: true,
  healthThreshold: 60,
  outputFormat: 'json' as 'json' | 'junit' | 'github-actions',
  ...overrides
});

describe('runCICDCheck', () => {
  it('passes when health meets the threshold', () => {
    const r = runCICDCheck(analysis(80), cfg());
    expect(r.passed).toBe(true);
    expect(r.healthScore).toBe(80);
    expect(r.threshold).toBe(60);
  });

  it('fails when health is below the threshold', () => {
    const r = runCICDCheck(analysis(40), cfg());
    expect(r.passed).toBe(false);
  });

  it('produces valid JSON output', () => {
    const r = runCICDCheck(analysis(75), cfg({ outputFormat: 'json' }));
    expect(r.format).toBe('json');
    const parsed = JSON.parse(r.output);
    expect(parsed.health.overall).toBe(75);
    expect(parsed.summary.issueCount).toBe(2);
  });

  it('produces JUnit XML output', () => {
    const r = runCICDCheck(analysis(75), cfg({ outputFormat: 'junit' }));
    expect(r.output).toContain('<testsuite');
    expect(r.output).toContain('</testsuite>');
  });

  it('produces GitHub Actions output with annotations', () => {
    const r = runCICDCheck(analysis(40), cfg({ outputFormat: 'github-actions' }));
    expect(r.output).toContain('::');
    expect(Array.isArray(r.annotations)).toBe(true);
    expect(r.annotations!.length).toBeGreaterThan(0);
  });
});

describe('generateBadgeUrl', () => {
  it('uses shields.io with a color tier', () => {
    expect(generateBadgeUrl(95)).toContain('img.shields.io');
    expect(generateBadgeUrl(95)).toContain('brightgreen');
    expect(generateBadgeUrl(65)).toContain('yellow');
    expect(generateBadgeUrl(20)).toContain('red');
  });
});

describe('getCIExitCode', () => {
  it('returns 0 when passed and 1 when failed', () => {
    expect(getCIExitCode(runCICDCheck(analysis(80), cfg()))).toBe(0);
    expect(getCIExitCode(runCICDCheck(analysis(30), cfg()))).toBe(1);
  });
});
