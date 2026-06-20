/**
 * SecurityAgent tests — exercises the real shipped API:
 * SecurityAgent extends BaseAgent, so run() returns AgentResult<SecurityOutput>
 * with the findings under result.data. Inputs are crafted to match the actual
 * secret/vulnerability regexes in src/agents/security-agent.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityAgent } from '../../src/agents/security-agent.js';
import type { ParsedFile } from '../../src/types.js';

function fileWith(content: string): ParsedFile {
  return {
    info: {
      path: '/test/file.ts',
      relativePath: 'file.ts',
      extension: '.ts',
      language: 'typescript',
      size: content.length,
      lines: content.split('\n').length
    },
    blocks: [{ type: 'variable', name: 'x', startLine: 1, endLine: 1, content, complexity: 1 }],
    imports: [],
    exports: [],
    rawContent: content
  };
}

const config = {
  enabled: true,
  scanSecrets: true,
  scanVulnerabilities: true,
  scanDependencies: true,
  severityThreshold: 'low' as const
};

describe('SecurityAgent', () => {
  let agent: SecurityAgent;
  beforeEach(() => { agent = new SecurityAgent(); });

  describe('secret scanning', () => {
    it('detects AWS credentials as critical', async () => {
      const res = await agent.run({ files: [fileWith('const key = "AKIAIOSFODNN7EXAMPLE";')], basePath: '/test', config });
      expect(res.success).toBe(true);
      const aws = res.data!.secrets.find(s => s.type === 'aws_credentials');
      expect(aws).toBeDefined();
      expect(aws!.severity).toBe('critical');
    });

    it('detects GitHub tokens', async () => {
      const res = await agent.run({ files: [fileWith(`const token = "ghp_${'a'.repeat(36)}";`)], basePath: '/test', config });
      expect(res.data!.secrets.some(s => s.type === 'github_token')).toBe(true);
    });

    it('detects generic API keys', async () => {
      const res = await agent.run({ files: [fileWith('const api_key = "abcdef1234567890abcdef";')], basePath: '/test', config });
      expect(res.data!.secrets.some(s => s.type === 'api_key')).toBe(true);
    });

    it('detects password assignments', async () => {
      const res = await agent.run({ files: [fileWith('const password = "supersecret123";')], basePath: '/test', config });
      expect(res.data!.secrets.some(s => s.type === 'password')).toBe(true);
    });

    it('does not flag environment variable references', async () => {
      const res = await agent.run({ files: [fileWith('const key = process.env.API_KEY;')], basePath: '/test', config });
      expect(res.data!.secrets).toHaveLength(0);
    });
  });

  describe('vulnerability scanning', () => {
    it('detects SQL injection via interpolation', async () => {
      const res = await agent.run({ files: [fileWith('db.query(`SELECT * FROM users WHERE id = ${userId}`);')], basePath: '/test', config });
      expect(res.data!.vulnerabilities.some(v => v.type === 'sql_injection')).toBe(true);
    });

    it('detects command injection', async () => {
      const res = await agent.run({ files: [fileWith('exec(`ls ${userInput}`);')], basePath: '/test', config });
      expect(res.data!.vulnerabilities.some(v => v.type === 'command_injection')).toBe(true);
    });

    it('detects XSS via innerHTML', async () => {
      const res = await agent.run({ files: [fileWith('element.innerHTML = userInput;')], basePath: '/test', config });
      expect(res.data!.vulnerabilities.some(v => v.type === 'xss')).toBe(true);
    });

    it('flags insecure Math.random', async () => {
      const res = await agent.run({ files: [fileWith('const r = Math.random();')], basePath: '/test', config });
      expect(res.data!.vulnerabilities.some(v => v.type === 'insecure_random')).toBe(true);
    });
  });

  describe('severity filtering', () => {
    it('excludes low-severity findings at a critical threshold', async () => {
      const res = await agent.run({
        files: [fileWith('const r = Math.random();')],
        basePath: '/test',
        config: { ...config, severityThreshold: 'critical' as const }
      });
      // insecure_random is low severity and must be filtered out.
      expect(res.data!.vulnerabilities.every(v => v.severity === 'critical')).toBe(true);
    });

    it('includes findings when threshold is low', async () => {
      const res = await agent.run({ files: [fileWith('const key = "AKIAIOSFODNN7EXAMPLE";')], basePath: '/test', config });
      expect(res.data!.secrets.length + res.data!.vulnerabilities.length).toBeGreaterThan(0);
    });
  });

  describe('summary', () => {
    it('reports totals and an overall risk level', async () => {
      const res = await agent.run({ files: [fileWith('const key = "AKIAIOSFODNN7EXAMPLE";')], basePath: '/test', config });
      const summary = res.data!.summary;
      expect(summary.totalSecrets).toBeGreaterThan(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(summary.overallRisk);
    });
  });

  describe('burnout analysis', () => {
    it('is included in the output with the expected shape', async () => {
      const res = await agent.run({ files: [fileWith('const x = 1;')], basePath: '/test', config });
      const burnout = res.data!.burnoutAnalysis;
      expect(['low', 'medium', 'high', 'critical']).toContain(burnout.riskLevel);
      expect(typeof burnout.score).toBe('number');
      expect(Array.isArray(burnout.factors)).toBe(true);
      expect(Array.isArray(burnout.recommendations)).toBe(true);
    });
  });
});
