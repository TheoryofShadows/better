/**
 * Covers the CI/CD failure branches across all three output formats (JUnit,
 * GitHub Actions, JSON), issues with and without file/line, every severity,
 * annotation levels, badge colors and exit codes.
 */

import { describe, it, expect } from 'vitest';
import { runCICDCheck, generateBadgeUrl, getCIExitCode } from '../integrations/cicd.js';
import type { AnalysisResult, CICDConfig, HealthScore, HealthIssue } from '../types.js';

function result(overall: number, issues: HealthIssue[]): AnalysisResult {
  const health: HealthScore = {
    overall,
    categories: { documentation: 85, complexity: 65, structure: 30, maintainability: 75 },
    issues, suggestions: []
  };
  return { files: [], totalFiles: 2, totalLines: 100, languageBreakdown: new Map([['typescript', 2]]), healthScore: health, undocumentedBlocks: [], complexBlocks: [] };
}

const issues: HealthIssue[] = [
  { severity: 'error', message: 'err with loc', file: 'a.ts', line: 5, rule: 'e1' },
  { severity: 'error', message: 'err no loc', rule: 'e2' },
  { severity: 'warning', message: 'warn', file: 'b.ts', line: 2, rule: 'w1' },
  { severity: 'info', message: 'info', file: 'c.ts', line: 1, rule: 'i1' }
];

const cfg = (outputFormat: CICDConfig['outputFormat']): CICDConfig => ({
  enabled: true, failOnLowHealth: true, healthThreshold: 80, outputFormat
});

describe('runCICDCheck failing scenarios', () => {
  it('produces JUnit XML with health, category and issue failures', () => {
    const r = runCICDCheck(result(50, issues), cfg('junit'));
    expect(r.passed).toBe(false);
    expect(r.output).toContain('below threshold');
    expect(r.output).toContain('CodeQualityError');
    expect(r.output).toContain('DocuMate.Issues.a_ts');
    expect(r.output).toContain('Line: N/A'); // error issue without a location
  });

  it('produces GitHub Actions output with annotations for each severity', () => {
    const r = runCICDCheck(result(50, issues), cfg('github-actions'));
    expect(r.output).toContain('❌ FAILED');
    expect(r.output).toContain('🟢'); // documentation 85
    expect(r.output).toContain('🟡'); // complexity 65
    expect(r.output).toContain('🔴'); // structure 30
    expect(r.output).toContain('::error file=a.ts,line=5::');
    expect(r.output).toContain('::error::err no loc'); // no file/line branch
    const levels = (r.annotations ?? []).map(a => a.annotation_level);
    expect(levels).toEqual(expect.arrayContaining(['failure', 'warning', 'notice']));
  });

  it('produces JSON output and passes when above threshold', () => {
    const pass = runCICDCheck(result(95, []), cfg('json'));
    expect(pass.passed).toBe(true);
    expect(JSON.parse(pass.output).passed).toBe(true);
  });
});

describe('helpers', () => {
  it('maps scores to badge colors', () => {
    expect(generateBadgeUrl(85)).toContain('brightgreen');
    expect(generateBadgeUrl(65)).toContain('yellow');
    expect(generateBadgeUrl(45)).toContain('orange');
    expect(generateBadgeUrl(30)).toContain('red');
  });

  it('maps pass/fail to exit codes', () => {
    expect(getCIExitCode({ passed: true } as never)).toBe(0);
    expect(getCIExitCode({ passed: false } as never)).toBe(1);
  });
});
