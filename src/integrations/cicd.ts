/**
 * CI/CD Integration Module
 * Provides health checks and reporting for CI/CD pipelines
 *
 * Supports: GitHub Actions, Jenkins, GitLab CI, CircleCI
 */

import type { HealthScore, CICDConfig, AnalysisResult } from '../types.js';

export interface CICDResult {
  passed: boolean;
  healthScore: number;
  threshold: number;
  format: CICDConfig['outputFormat'];
  output: string;
  annotations?: Annotation[];
}

export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title: string;
}

export interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  time: number;
  testcases: JUnitTestCase[];
}

export interface JUnitTestCase {
  name: string;
  classname: string;
  time: number;
  failure?: {
    message: string;
    type: string;
    content: string;
  };
}

/**
 * Run CI/CD health check and generate output
 */
export function runCICDCheck(
  result: AnalysisResult,
  config: CICDConfig
): CICDResult {
  const passed = result.healthScore.overall >= config.healthThreshold;

  let output: string;
  let annotations: Annotation[] | undefined;

  switch (config.outputFormat) {
    case 'junit':
      output = generateJUnitOutput(result, config);
      break;
    case 'github-actions':
      output = generateGitHubActionsOutput(result, config);
      annotations = generateGitHubAnnotations(result);
      break;
    case 'json':
    default:
      output = generateJSONOutput(result, config);
      break;
  }

  return {
    passed,
    healthScore: result.healthScore.overall,
    threshold: config.healthThreshold,
    format: config.outputFormat,
    output,
    annotations
  };
}

/**
 * Generate JSON output for generic CI systems
 */
function generateJSONOutput(result: AnalysisResult, config: CICDConfig): string {
  const output = {
    timestamp: new Date().toISOString(),
    passed: result.healthScore.overall >= config.healthThreshold,
    health: {
      overall: result.healthScore.overall,
      threshold: config.healthThreshold,
      categories: result.healthScore.categories
    },
    summary: {
      totalFiles: result.totalFiles,
      totalLines: result.totalLines,
      issueCount: result.healthScore.issues.length,
      criticalIssues: result.healthScore.issues.filter(i => i.severity === 'error').length,
      warnings: result.healthScore.issues.filter(i => i.severity === 'warning').length
    },
    issues: result.healthScore.issues.slice(0, 20).map(issue => ({
      severity: issue.severity,
      message: issue.message,
      file: issue.file,
      line: issue.line,
      rule: issue.rule
    }))
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Generate JUnit XML output for Jenkins and similar systems
 */
function generateJUnitOutput(result: AnalysisResult, config: CICDConfig): string {
  const passed = result.healthScore.overall >= config.healthThreshold;

  const testcases: JUnitTestCase[] = [];

  // Health score test
  testcases.push({
    name: 'Health Score Check',
    classname: 'DocuMate.HealthCheck',
    time: 0.1,
    failure: passed ? undefined : {
      message: `Health score ${result.healthScore.overall} is below threshold ${config.healthThreshold}`,
      type: 'AssertionError',
      content: `Expected: >= ${config.healthThreshold}\nActual: ${result.healthScore.overall}`
    }
  });

  // Category tests
  for (const [category, score] of Object.entries(result.healthScore.categories)) {
    const categoryThreshold = config.healthThreshold - 10;
    testcases.push({
      name: `${category} Score`,
      classname: 'DocuMate.CategoryCheck',
      time: 0.05,
      failure: score < categoryThreshold ? {
        message: `${category} score ${score} is below threshold`,
        type: 'AssertionError',
        content: `Score: ${score}`
      } : undefined
    });
  }

  // Issue tests
  const errorIssues = result.healthScore.issues.filter(i => i.severity === 'error');
  for (const issue of errorIssues.slice(0, 10)) {
    testcases.push({
      name: `Issue: ${issue.rule}`,
      classname: `DocuMate.Issues.${issue.file?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}`,
      time: 0.01,
      failure: {
        message: issue.message,
        type: 'CodeQualityError',
        content: `File: ${issue.file || 'N/A'}\nLine: ${issue.line || 'N/A'}`
      }
    });
  }

  const failures = testcases.filter(t => t.failure).length;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuite name="DocuMate" tests="${testcases.length}" failures="${failures}" errors="0" time="1">\n`;

  for (const tc of testcases) {
    xml += `  <testcase name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}" time="${tc.time}">\n`;
    if (tc.failure) {
      xml += `    <failure message="${escapeXml(tc.failure.message)}" type="${tc.failure.type}">\n`;
      xml += `      ${escapeXml(tc.failure.content)}\n`;
      xml += `    </failure>\n`;
    }
    xml += `  </testcase>\n`;
  }

  xml += '</testsuite>\n';

  return xml;
}

/**
 * Generate GitHub Actions output format
 */
function generateGitHubActionsOutput(result: AnalysisResult, config: CICDConfig): string {
  const lines: string[] = [];
  const passed = result.healthScore.overall >= config.healthThreshold;

  // Set output variables
  lines.push(`::set-output name=health_score::${result.healthScore.overall}`);
  lines.push(`::set-output name=passed::${passed}`);
  lines.push(`::set-output name=total_issues::${result.healthScore.issues.length}`);

  // Summary group
  lines.push('::group::DocuMate Health Check Summary');
  lines.push(`Health Score: ${result.healthScore.overall}/100 (threshold: ${config.healthThreshold})`);
  lines.push(`Status: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
  lines.push('');
  lines.push('Categories:');
  for (const [category, score] of Object.entries(result.healthScore.categories)) {
    const icon = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
    lines.push(`  ${icon} ${category}: ${score}/100`);
  }
  lines.push('::endgroup::');

  // Issues
  if (result.healthScore.issues.length > 0) {
    lines.push('::group::Issues Found');
    for (const issue of result.healthScore.issues.slice(0, 20)) {
      const level = issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'notice';
      if (issue.file && issue.line) {
        lines.push(`::${level} file=${issue.file},line=${issue.line}::${issue.message}`);
      } else {
        lines.push(`::${level}::${issue.message}`);
      }
    }
    lines.push('::endgroup::');
  }

  // Job summary (for GitHub Actions)
  lines.push('');
  lines.push('### DocuMate Health Report');
  lines.push('');
  lines.push(`| Metric | Score |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Overall | ${result.healthScore.overall}/100 |`);
  for (const [category, score] of Object.entries(result.healthScore.categories)) {
    lines.push(`| ${category} | ${score}/100 |`);
  }

  return lines.join('\n');
}

/**
 * Generate GitHub check annotations
 */
function generateGitHubAnnotations(result: AnalysisResult): Annotation[] {
  return result.healthScore.issues
    .filter(issue => issue.file && issue.line)
    .slice(0, 50)
    .map(issue => ({
      path: issue.file!,
      start_line: issue.line!,
      end_line: issue.line!,
      annotation_level: issue.severity === 'error' ? 'failure' : issue.severity === 'warning' ? 'warning' : 'notice',
      message: issue.message,
      title: issue.rule
    }));
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate CI badge URL
 */
export function generateBadgeUrl(score: number): string {
  const color = score >= 80 ? 'brightgreen' : score >= 60 ? 'yellow' : score >= 40 ? 'orange' : 'red';
  return `https://img.shields.io/badge/DocuMate%20Health-${score}%25-${color}`;
}

/**
 * Exit code for CI
 */
export function getCIExitCode(result: CICDResult): number {
  return result.passed ? 0 : 1;
}
