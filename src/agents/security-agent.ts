/**
 * SecurityAgent - Code Security Scanner and Burnout Predictor
 * Detects secrets, vulnerabilities, and predicts team burnout risk
 *
 * Few-shot example:
 * ```typescript
 * const agent = new SecurityAgent();
 * const result = await agent.run({
 *   files: parsedFiles,
 *   basePath: '/project',
 *   config: { scanSecrets: true, scanVulnerabilities: true }
 * });
 * // Returns: { secrets: [...], vulnerabilities: [...], burnoutRisk: 'medium' }
 * ```
 */

import { BaseAgent } from './base.js';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import type { ParsedFile, SecurityConfig, HealthScore } from '../types.js';

export interface SecurityInput {
  files: ParsedFile[];
  basePath: string;
  config: SecurityConfig;
  gitHistory?: GitHistoryInfo[];
  healthScore?: HealthScore;
}

export interface GitHistoryInfo {
  author: string;
  date: Date;
  filesChanged: number;
  linesChanged: number;
}

export interface SecurityOutput {
  secrets: SecretFinding[];
  vulnerabilities: VulnerabilityFinding[];
  codeSmells: CodeSmell[];
  burnoutAnalysis: BurnoutAnalysis;
  summary: SecuritySummary;
}

export interface SecretFinding {
  file: string;
  line: number;
  type: SecretType;
  severity: Severity;
  pattern: string;
  recommendation: string;
}

export type SecretType =
  | 'api_key'
  | 'password'
  | 'token'
  | 'private_key'
  | 'connection_string'
  | 'aws_credentials'
  | 'github_token'
  | 'generic_secret';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface VulnerabilityFinding {
  file: string;
  line: number;
  type: VulnerabilityType;
  severity: Severity;
  description: string;
  cwe?: string;
  recommendation: string;
}

export type VulnerabilityType =
  | 'sql_injection'
  | 'xss'
  | 'command_injection'
  | 'path_traversal'
  | 'insecure_random'
  | 'hardcoded_credentials'
  | 'insecure_deserialization'
  | 'open_redirect'
  | 'sensitive_data_exposure'
  | 'broken_auth';

export interface CodeSmell {
  file: string;
  line: number;
  type: string;
  description: string;
  impact: 'security' | 'maintainability' | 'performance';
}

export interface BurnoutAnalysis {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  factors: BurnoutFactor[];
  recommendations: string[];
}

export interface BurnoutFactor {
  name: string;
  impact: number;
  description: string;
}

export interface SecuritySummary {
  totalSecrets: number;
  totalVulnerabilities: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  overallRisk: Severity;
}

const SECRET_PATTERNS: Array<{
  type: SecretType;
  pattern: RegExp;
  severity: Severity;
}> = [
  // AWS
  { type: 'aws_credentials', pattern: /AKIA[0-9A-Z]{16}/g, severity: 'critical' },
  { type: 'aws_credentials', pattern: /aws_secret_access_key\s*[=:]\s*["']?[\w/+=]{40}["']?/gi, severity: 'critical' },

  // GitHub
  { type: 'github_token', pattern: /ghp_[a-zA-Z0-9]{36}/g, severity: 'critical' },
  { type: 'github_token', pattern: /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g, severity: 'critical' },

  // API Keys
  { type: 'api_key', pattern: /api[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9]{20,}["']?/gi, severity: 'high' },
  { type: 'api_key', pattern: /apikey\s*[=:]\s*["']?[a-zA-Z0-9]{20,}["']?/gi, severity: 'high' },

  // Tokens
  { type: 'token', pattern: /bearer\s+[a-zA-Z0-9\-_.]+/gi, severity: 'high' },
  { type: 'token', pattern: /access[_-]?token\s*[=:]\s*["']?[a-zA-Z0-9\-_.]+["']?/gi, severity: 'high' },

  // Passwords
  { type: 'password', pattern: /password\s*[=:]\s*["'][^"']{8,}["']/gi, severity: 'critical' },
  { type: 'password', pattern: /passwd\s*[=:]\s*["'][^"']{8,}["']/gi, severity: 'critical' },

  // Private Keys
  { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, severity: 'critical' },

  // Connection Strings
  { type: 'connection_string', pattern: /mongodb(\+srv)?:\/\/[^\s"']+/gi, severity: 'high' },
  { type: 'connection_string', pattern: /postgres:\/\/[^\s"']+/gi, severity: 'high' },
  { type: 'connection_string', pattern: /mysql:\/\/[^\s"']+/gi, severity: 'high' },

  // Generic secrets
  { type: 'generic_secret', pattern: /secret\s*[=:]\s*["'][^"']{10,}["']/gi, severity: 'medium' }
];

const VULNERABILITY_PATTERNS: Array<{
  type: VulnerabilityType;
  pattern: RegExp;
  severity: Severity;
  cwe: string;
  description: string;
}> = [
  // SQL Injection
  {
    type: 'sql_injection',
    pattern: /query\s*\(\s*["'`]SELECT.*\$\{/gi,
    severity: 'critical',
    cwe: 'CWE-89',
    description: 'Potential SQL injection via string interpolation'
  },
  {
    type: 'sql_injection',
    pattern: /execute\s*\(\s*["'`].*\+.*\)/gi,
    severity: 'critical',
    cwe: 'CWE-89',
    description: 'Potential SQL injection via string concatenation'
  },

  // XSS
  {
    type: 'xss',
    pattern: /innerHTML\s*=\s*[^"']*(?:user|input|param|query)/gi,
    severity: 'high',
    cwe: 'CWE-79',
    description: 'Potential XSS via innerHTML with user input'
  },
  {
    type: 'xss',
    pattern: /document\.write\s*\(/gi,
    severity: 'medium',
    cwe: 'CWE-79',
    description: 'Unsafe use of document.write'
  },

  // Command Injection
  {
    type: 'command_injection',
    pattern: /exec\s*\(\s*["'`].*\$\{/gi,
    severity: 'critical',
    cwe: 'CWE-78',
    description: 'Potential command injection'
  },
  {
    type: 'command_injection',
    pattern: /spawn\s*\(\s*["'`].*\+/gi,
    severity: 'critical',
    cwe: 'CWE-78',
    description: 'Potential command injection in spawn'
  },

  // Path Traversal
  {
    type: 'path_traversal',
    pattern: /readFile\s*\(\s*(?:req\.|user|input|params)/gi,
    severity: 'high',
    cwe: 'CWE-22',
    description: 'Potential path traversal in file read'
  },

  // Insecure Random
  {
    type: 'insecure_random',
    pattern: /Math\.random\s*\(\)/g,
    severity: 'low',
    cwe: 'CWE-330',
    description: 'Math.random is not cryptographically secure'
  },

  // Hardcoded Credentials
  {
    type: 'hardcoded_credentials',
    pattern: /(?:username|user)\s*[=:]\s*["'][a-zA-Z0-9]+["'].*(?:password|passwd)\s*[=:]\s*["']/gi,
    severity: 'critical',
    cwe: 'CWE-798',
    description: 'Hardcoded credentials detected'
  },

  // Open Redirect
  {
    type: 'open_redirect',
    pattern: /redirect\s*\(\s*(?:req\.|user|input|query)/gi,
    severity: 'medium',
    cwe: 'CWE-601',
    description: 'Potential open redirect vulnerability'
  },

  // Sensitive Data Exposure
  {
    type: 'sensitive_data_exposure',
    pattern: /console\.log\s*\(.*(?:password|token|secret|key|credential)/gi,
    severity: 'medium',
    cwe: 'CWE-532',
    description: 'Sensitive data may be logged'
  }
];

export class SecurityAgent extends BaseAgent<SecurityInput, SecurityOutput> {
  constructor() {
    super('SecurityAgent');
  }

  protected async execute(input: SecurityInput): Promise<SecurityOutput> {
    this.log('Starting security analysis');

    const secrets: SecretFinding[] = [];
    const vulnerabilities: VulnerabilityFinding[] = [];
    const codeSmells: CodeSmell[] = [];

    // Scan each file
    for (const file of input.files) {
      if (this.shouldSkipFile(file.info.relativePath)) {
        continue;
      }

      // Scan for secrets
      if (input.config.scanSecrets) {
        const fileSecrets = this.scanForSecrets(file);
        secrets.push(...fileSecrets);
      }

      // Scan for vulnerabilities
      if (input.config.scanVulnerabilities) {
        const fileVulns = this.scanForVulnerabilities(file);
        vulnerabilities.push(...fileVulns);
      }

      // Detect code smells
      const smells = this.detectCodeSmells(file);
      codeSmells.push(...smells);
    }

    // Filter by severity threshold
    const threshold = input.config.severityThreshold;
    const filteredSecrets = this.filterBySeverity(secrets, threshold);
    const filteredVulns = this.filterBySeverity(vulnerabilities, threshold);

    // Analyze burnout risk
    const burnoutAnalysis = this.analyzeBurnoutRisk(
      input.files,
      input.gitHistory,
      input.healthScore
    );

    // Generate summary
    const summary = this.generateSummary(filteredSecrets, filteredVulns);

    this.log(`Found ${secrets.length} secrets, ${vulnerabilities.length} vulnerabilities`);
    this.log(`Burnout risk: ${burnoutAnalysis.riskLevel}`);

    return {
      secrets: filteredSecrets,
      vulnerabilities: filteredVulns,
      codeSmells,
      burnoutAnalysis,
      summary
    };
  }

  private shouldSkipFile(path: string): boolean {
    const skipPatterns = [
      /node_modules/,
      /\.min\./,
      /dist\//,
      /build\//,
      /\.test\./,
      /\.spec\./,
      /package-lock\.json/,
      /yarn\.lock/
    ];

    return skipPatterns.some(p => p.test(path));
  }

  private scanForSecrets(file: ParsedFile): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = file.rawContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
        continue;
      }

      for (const { type, pattern, severity } of SECRET_PATTERNS) {
        const regex = new RegExp(pattern);
        if (regex.test(line)) {
          findings.push({
            file: file.info.relativePath,
            line: i + 1,
            type,
            severity,
            pattern: this.maskSecret(line.match(regex)?.[0] || ''),
            recommendation: this.getSecretRecommendation(type)
          });
        }
      }
    }

    return findings;
  }

  private maskSecret(secret: string): string {
    if (secret.length <= 8) {
      return '***';
    }
    return secret.slice(0, 4) + '***' + secret.slice(-4);
  }

  private getSecretRecommendation(type: SecretType): string {
    const recommendations: Record<SecretType, string> = {
      api_key: 'Move API key to environment variables or a secrets manager',
      password: 'Never hardcode passwords. Use environment variables or a vault',
      token: 'Store tokens securely using environment variables',
      private_key: 'Never commit private keys. Use a secrets manager',
      connection_string: 'Store connection strings in environment variables',
      aws_credentials: 'Use IAM roles or AWS Secrets Manager instead',
      github_token: 'Use GitHub Secrets or environment variables',
      generic_secret: 'Review and move sensitive data to secure storage'
    };

    return recommendations[type];
  }

  private scanForVulnerabilities(file: ParsedFile): VulnerabilityFinding[] {
    const findings: VulnerabilityFinding[] = [];
    const lines = file.rawContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const vuln of VULNERABILITY_PATTERNS) {
        const regex = new RegExp(vuln.pattern);
        if (regex.test(line)) {
          findings.push({
            file: file.info.relativePath,
            line: i + 1,
            type: vuln.type,
            severity: vuln.severity,
            description: vuln.description,
            cwe: vuln.cwe,
            recommendation: this.getVulnRecommendation(vuln.type)
          });
        }
      }
    }

    return findings;
  }

  private getVulnRecommendation(type: VulnerabilityType): string {
    const recommendations: Record<VulnerabilityType, string> = {
      sql_injection: 'Use parameterized queries or an ORM',
      xss: 'Sanitize user input and use safe DOM manipulation methods',
      command_injection: 'Avoid shell commands or sanitize all inputs',
      path_traversal: 'Validate and sanitize file paths',
      insecure_random: 'Use crypto.randomBytes() for security-sensitive values',
      hardcoded_credentials: 'Move credentials to environment variables',
      insecure_deserialization: 'Validate serialized data before deserializing',
      open_redirect: 'Validate redirect URLs against a whitelist',
      sensitive_data_exposure: 'Remove sensitive data from logs',
      broken_auth: 'Implement proper authentication checks'
    };

    return recommendations[type];
  }

  private detectCodeSmells(file: ParsedFile): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const content = file.rawContent;

    // Detect eval usage
    if (/\beval\s*\(/.test(content)) {
      const match = content.match(/\beval\s*\(/);
      const line = content.slice(0, match?.index || 0).split('\n').length;
      smells.push({
        file: file.info.relativePath,
        line,
        type: 'eval-usage',
        description: 'Use of eval() is dangerous and should be avoided',
        impact: 'security'
      });
    }

    // Detect disabled eslint rules
    if (/eslint-disable/.test(content)) {
      smells.push({
        file: file.info.relativePath,
        line: 1,
        type: 'disabled-linting',
        description: 'ESLint rules are disabled in this file',
        impact: 'maintainability'
      });
    }

    // Detect TODO/FIXME in security-sensitive areas
    const todoMatches = content.matchAll(/(?:TODO|FIXME).*(?:security|auth|password|token)/gi);
    for (const match of todoMatches) {
      const line = content.slice(0, match.index || 0).split('\n').length;
      smells.push({
        file: file.info.relativePath,
        line,
        type: 'security-todo',
        description: 'Unresolved security-related TODO',
        impact: 'security'
      });
    }

    return smells;
  }

  private filterBySeverity<T extends { severity: Severity }>(
    items: T[],
    threshold: Severity
  ): T[] {
    const severityOrder: Record<Severity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3
    };

    const thresholdLevel = severityOrder[threshold];
    return items.filter(item => severityOrder[item.severity] <= thresholdLevel);
  }

  private analyzeBurnoutRisk(
    files: ParsedFile[],
    gitHistory?: GitHistoryInfo[],
    healthScore?: HealthScore
  ): BurnoutAnalysis {
    const factors: BurnoutFactor[] = [];
    let totalImpact = 0;

    // Factor 1: Code complexity
    let totalComplexity = 0;
    let complexCount = 0;
    for (const file of files) {
      for (const block of file.blocks) {
        if (block.complexity) {
          totalComplexity += block.complexity;
          complexCount++;
        }
      }
    }
    const avgComplexity = complexCount > 0 ? totalComplexity / complexCount : 0;

    if (avgComplexity > 15) {
      const impact = Math.min(30, (avgComplexity - 15) * 2);
      factors.push({
        name: 'High Code Complexity',
        impact,
        description: `Average complexity of ${avgComplexity.toFixed(1)} increases cognitive load`
      });
      totalImpact += impact;
    }

    // Factor 2: Documentation coverage
    let documented = 0;
    let documentable = 0;
    for (const file of files) {
      for (const block of file.blocks) {
        if (['function', 'method', 'class'].includes(block.type)) {
          documentable++;
          if (block.documentation) documented++;
        }
      }
    }
    const docRatio = documentable > 0 ? documented / documentable : 1;

    if (docRatio < 0.5) {
      const impact = Math.round((1 - docRatio) * 25);
      factors.push({
        name: 'Poor Documentation',
        impact,
        description: `Only ${(docRatio * 100).toFixed(0)}% documented - increases ramp-up time`
      });
      totalImpact += impact;
    }

    // Factor 3: Technical debt (from health score)
    if (healthScore && healthScore.overall < 60) {
      const impact = Math.round((60 - healthScore.overall) * 0.5);
      factors.push({
        name: 'High Technical Debt',
        impact,
        description: `Health score of ${healthScore.overall} indicates accumulated debt`
      });
      totalImpact += impact;
    }

    // Factor 4: Git history indicators
    if (gitHistory && gitHistory.length > 0) {
      // Check for frequent large commits (indicator of rushed work)
      const largeCommits = gitHistory.filter(h => h.linesChanged > 500);
      if (largeCommits.length > gitHistory.length * 0.3) {
        factors.push({
          name: 'Rushed Development',
          impact: 15,
          description: 'Many large commits suggest rushed development cycles'
        });
        totalImpact += 15;
      }

      // Check for weekend/night work
      const offHoursCommits = gitHistory.filter(h => {
        const hour = h.date.getHours();
        const day = h.date.getDay();
        return hour < 8 || hour > 20 || day === 0 || day === 6;
      });
      if (offHoursCommits.length > gitHistory.length * 0.2) {
        factors.push({
          name: 'Off-Hours Work',
          impact: 20,
          description: 'Significant work outside normal hours detected'
        });
        totalImpact += 20;
      }
    }

    // Factor 5: File size and sprawl
    const largeFiles = files.filter(f => f.info.lines > 500);
    if (largeFiles.length > 5) {
      factors.push({
        name: 'Code Sprawl',
        impact: 10,
        description: `${largeFiles.length} large files (>500 lines) increase maintenance burden`
      });
      totalImpact += 10;
    }

    // Calculate risk level
    let riskLevel: BurnoutAnalysis['riskLevel'];
    if (totalImpact >= 60) {
      riskLevel = 'critical';
    } else if (totalImpact >= 40) {
      riskLevel = 'high';
    } else if (totalImpact >= 20) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    // Generate recommendations
    const recommendations = this.generateBurnoutRecommendations(factors, riskLevel);

    return {
      riskLevel,
      score: totalImpact,
      factors,
      recommendations
    };
  }

  private generateBurnoutRecommendations(
    factors: BurnoutFactor[],
    riskLevel: BurnoutAnalysis['riskLevel']
  ): string[] {
    const recommendations: string[] = [];

    for (const factor of factors) {
      switch (factor.name) {
        case 'High Code Complexity':
          recommendations.push('Prioritize refactoring complex functions into smaller units');
          break;
        case 'Poor Documentation':
          recommendations.push('Implement documentation sprints or pair documentation sessions');
          break;
        case 'High Technical Debt':
          recommendations.push('Allocate 20% of sprint capacity to debt reduction');
          break;
        case 'Rushed Development':
          recommendations.push('Review sprint planning - smaller, more focused tasks');
          break;
        case 'Off-Hours Work':
          recommendations.push('Enforce work-life boundaries and review deadlines');
          break;
        case 'Code Sprawl':
          recommendations.push('Schedule modularization of large files');
          break;
      }
    }

    if (riskLevel === 'critical' || riskLevel === 'high') {
      recommendations.push('Consider a team retrospective focused on sustainable pace');
      recommendations.push('Review project timeline and resource allocation');
    }

    return [...new Set(recommendations)];
  }

  private generateSummary(
    secrets: SecretFinding[],
    vulnerabilities: VulnerabilityFinding[]
  ): SecuritySummary {
    const allItems = [
      ...secrets.map(s => ({ severity: s.severity })),
      ...vulnerabilities.map(v => ({ severity: v.severity }))
    ];

    const criticalIssues = allItems.filter(i => i.severity === 'critical').length;
    const highIssues = allItems.filter(i => i.severity === 'high').length;
    const mediumIssues = allItems.filter(i => i.severity === 'medium').length;
    const lowIssues = allItems.filter(i => i.severity === 'low').length;

    let overallRisk: Severity = 'low';
    if (criticalIssues > 0) {
      overallRisk = 'critical';
    } else if (highIssues > 0) {
      overallRisk = 'high';
    } else if (mediumIssues > 0) {
      overallRisk = 'medium';
    }

    return {
      totalSecrets: secrets.length,
      totalVulnerabilities: vulnerabilities.length,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      overallRisk
    };
  }
}
