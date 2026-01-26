/**
 * CI/CD Integration Tests
 * Tests health check integration for CI/CD pipelines
 */

import {
  CICDIntegration,
  formatAsJSON,
  formatAsJUnit,
  formatAsGitHubActions,
  generateBadgeUrl
} from '../../src/integrations/cicd.js';
import type { HealthScore, HealthIssue } from '../../src/types.js';

describe('CICDIntegration', () => {
  let integration: CICDIntegration;

  beforeEach(() => {
    integration = new CICDIntegration();
  });

  describe('runHealthCheck', () => {
    it('should pass when health exceeds threshold', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: true,
        healthThreshold: 60,
        outputFormat: 'json' as const
      };

      const health = createHealthScore(75);
      const result = await integration.runHealthCheck(health, config);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(75);
    });

    it('should fail when health below threshold and failOnLowHealth is true', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: true,
        healthThreshold: 80,
        outputFormat: 'json' as const
      };

      const health = createHealthScore(60);
      const result = await integration.runHealthCheck(health, config);

      expect(result.passed).toBe(false);
      expect(result.score).toBe(60);
    });

    it('should pass when failOnLowHealth is false regardless of score', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: false,
        healthThreshold: 80,
        outputFormat: 'json' as const
      };

      const health = createHealthScore(30);
      const result = await integration.runHealthCheck(health, config);

      expect(result.passed).toBe(true);
    });

    it('should include formatted output', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: true,
        healthThreshold: 60,
        outputFormat: 'json' as const
      };

      const health = createHealthScore(75);
      const result = await integration.runHealthCheck(health, config);

      expect(result.output).toBeTruthy();
      expect(() => JSON.parse(result.output)).not.toThrow();
    });

    it('should include issues in result', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: true,
        healthThreshold: 60,
        outputFormat: 'json' as const
      };

      const health = createHealthScoreWithIssues();
      const result = await integration.runHealthCheck(health, config);

      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('exit codes', () => {
    it('should return exit code 0 on pass', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: true,
        healthThreshold: 60,
        outputFormat: 'json' as const
      };

      const health = createHealthScore(75);
      const result = await integration.runHealthCheck(health, config);

      expect(result.exitCode).toBe(0);
    });

    it('should return exit code 1 on fail', async () => {
      const config = {
        enabled: true,
        failOnLowHealth: true,
        healthThreshold: 80,
        outputFormat: 'json' as const
      };

      const health = createHealthScore(60);
      const result = await integration.runHealthCheck(health, config);

      expect(result.exitCode).toBe(1);
    });
  });
});

describe('formatAsJSON', () => {
  it('should produce valid JSON', () => {
    const health = createHealthScore(75);
    const output = formatAsJSON(health);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should include all health categories', () => {
    const health = createHealthScore(75);
    const output = formatAsJSON(health);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('overall');
    expect(parsed).toHaveProperty('categories');
    expect(parsed.categories).toHaveProperty('documentation');
    expect(parsed.categories).toHaveProperty('complexity');
    expect(parsed.categories).toHaveProperty('structure');
    expect(parsed.categories).toHaveProperty('maintainability');
  });

  it('should include issues array', () => {
    const health = createHealthScoreWithIssues();
    const output = formatAsJSON(health);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('issues');
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it('should include timestamp', () => {
    const health = createHealthScore(75);
    const output = formatAsJSON(health);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('timestamp');
    expect(new Date(parsed.timestamp)).toBeInstanceOf(Date);
  });
});

describe('formatAsJUnit', () => {
  it('should produce valid XML structure', () => {
    const health = createHealthScore(75);
    const output = formatAsJUnit(health);

    expect(output).toContain('<?xml version="1.0"');
    expect(output).toContain('<testsuites');
    expect(output).toContain('</testsuites>');
  });

  it('should include test cases for each category', () => {
    const health = createHealthScore(75);
    const output = formatAsJUnit(health);

    expect(output).toContain('name="documentation"');
    expect(output).toContain('name="complexity"');
    expect(output).toContain('name="structure"');
    expect(output).toContain('name="maintainability"');
  });

  it('should mark failures for low scores', () => {
    const health: HealthScore = {
      overall: 50,
      categories: {
        documentation: 30,
        complexity: 80,
        structure: 40,
        maintainability: 50
      },
      issues: [],
      suggestions: []
    };
    const output = formatAsJUnit(health);

    expect(output).toContain('<failure');
  });

  it('should include issue details as failures', () => {
    const health = createHealthScoreWithIssues();
    const output = formatAsJUnit(health);

    expect(output).toContain('<failure');
    expect(output).toContain('Missing documentation');
  });
});

describe('formatAsGitHubActions', () => {
  it('should produce GitHub Actions workflow commands', () => {
    const health = createHealthScore(75);
    const output = formatAsGitHubActions(health);

    expect(output).toContain('::set-output');
  });

  it('should include health score output', () => {
    const health = createHealthScore(75);
    const output = formatAsGitHubActions(health);

    expect(output).toContain('health-score');
    expect(output).toContain('75');
  });

  it('should include warnings for issues', () => {
    const health = createHealthScoreWithIssues();
    const output = formatAsGitHubActions(health);

    expect(output).toContain('::warning');
  });

  it('should include errors for error-severity issues', () => {
    const health: HealthScore = {
      overall: 50,
      categories: {
        documentation: 50,
        complexity: 50,
        structure: 50,
        maintainability: 50
      },
      issues: [{
        severity: 'error',
        message: 'Critical security issue',
        file: 'src/auth.ts',
        line: 42,
        rule: 'security/no-hardcoded-secrets'
      }],
      suggestions: []
    };
    const output = formatAsGitHubActions(health);

    expect(output).toContain('::error');
    expect(output).toContain('Critical security issue');
  });

  it('should include file annotations', () => {
    const health: HealthScore = {
      overall: 70,
      categories: {
        documentation: 70,
        complexity: 70,
        structure: 70,
        maintainability: 70
      },
      issues: [{
        severity: 'warning',
        message: 'Complex function',
        file: 'src/utils.ts',
        line: 100,
        rule: 'complexity'
      }],
      suggestions: []
    };
    const output = formatAsGitHubActions(health);

    expect(output).toContain('file=src/utils.ts');
    expect(output).toContain('line=100');
  });
});

describe('generateBadgeUrl', () => {
  it('should generate shields.io URL', () => {
    const url = generateBadgeUrl(75);

    expect(url).toContain('shields.io');
    expect(url).toContain('75');
  });

  it('should use green color for high scores', () => {
    const url = generateBadgeUrl(90);

    expect(url).toContain('brightgreen');
  });

  it('should use yellow color for medium scores', () => {
    const url = generateBadgeUrl(65);

    expect(url).toContain('yellow');
  });

  it('should use red color for low scores', () => {
    const url = generateBadgeUrl(40);

    expect(url).toContain('red');
  });

  it('should include DocuMate label', () => {
    const url = generateBadgeUrl(75);

    expect(url).toContain('DocuMate');
  });

  it('should be a valid URL', () => {
    const url = generateBadgeUrl(75);

    expect(() => new URL(url)).not.toThrow();
  });
});

// Helper functions

function createHealthScore(overall: number): HealthScore {
  return {
    overall,
    categories: {
      documentation: overall + 5,
      complexity: overall - 5,
      structure: overall,
      maintainability: overall
    },
    issues: [],
    suggestions: []
  };
}

function createHealthScoreWithIssues(): HealthScore {
  return {
    overall: 60,
    categories: {
      documentation: 50,
      complexity: 70,
      structure: 60,
      maintainability: 60
    },
    issues: [
      {
        severity: 'warning',
        message: 'Missing documentation for function processData',
        file: 'src/processor.ts',
        line: 25,
        rule: 'documentation/require-jsdoc'
      },
      {
        severity: 'info',
        message: 'Consider extracting complex logic',
        file: 'src/utils.ts',
        line: 100,
        rule: 'complexity/max-depth'
      }
    ],
    suggestions: [
      'Add documentation to 5 undocumented functions',
      'Reduce complexity in processor.ts'
    ]
  };
}
