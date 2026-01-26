/**
 * SecurityAgent Tests
 * Tests security scanning and burnout prediction
 */

import { SecurityAgent, BurnoutPredictor } from '../../src/agents/security-agent.js';
import type { ParsedFile, CodeBlock } from '../../src/types.js';

describe('SecurityAgent', () => {
  let agent: SecurityAgent;

  beforeEach(() => {
    agent = new SecurityAgent();
  });

  describe('secret scanning', () => {
    it('should detect AWS credentials', async () => {
      const files = createFilesWithContent('const key = "AKIAIOSFODNN7EXAMPLE";');
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.secrets.length).toBeGreaterThan(0);
      expect(result.secrets[0].type).toBe('aws_credentials');
      expect(result.secrets[0].severity).toBe('critical');
    });

    it('should detect GitHub tokens', async () => {
      const files = createFilesWithContent('const token = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";');
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.secrets.some(s => s.type === 'github_token')).toBe(true);
    });

    it('should detect generic API keys', async () => {
      // Use a clearly fake test pattern that won't trigger push protection
      const files = createFilesWithContent('const API_KEY = "test_key_1234567890abcdef1234567890abcdef";');
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.secrets.some(s => s.type === 'api_key')).toBe(true);
    });

    it('should detect password assignments', async () => {
      const files = createFilesWithContent('const password = "supersecret123";');
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.secrets.some(s => s.type === 'password')).toBe(true);
    });

    it('should not flag environment variable references', async () => {
      const files = createFilesWithContent('const key = process.env.API_KEY;');
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      // Environment variable references should not be flagged as secrets
      const envRefSecrets = result.secrets.filter(s =>
        s.value.includes('process.env')
      );
      expect(envRefSecrets).toHaveLength(0);
    });
  });

  describe('vulnerability scanning', () => {
    it('should detect SQL injection risks', async () => {
      const files = createFilesWithContent(`
        const query = "SELECT * FROM users WHERE id = " + userId;
        db.query(query);
      `);
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.vulnerabilities.some(v => v.type === 'sql_injection')).toBe(true);
    });

    it('should detect command injection risks', async () => {
      const files = createFilesWithContent(`
        const cmd = "ls " + userInput;
        exec(cmd);
      `);
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.vulnerabilities.some(v => v.type === 'command_injection')).toBe(true);
    });

    it('should detect XSS risks with innerHTML', async () => {
      const files = createFilesWithContent(`
        element.innerHTML = userContent;
      `);
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.vulnerabilities.some(v => v.type === 'xss')).toBe(true);
    });

    it('should detect eval usage', async () => {
      const files = createFilesWithContent(`
        const result = eval(userCode);
      `);
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.vulnerabilities.some(v => v.type === 'code_injection')).toBe(true);
    });

    it('should detect path traversal risks', async () => {
      const files = createFilesWithContent(`
        const file = fs.readFileSync(userPath);
      `);
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.vulnerabilities.some(v => v.type === 'path_traversal')).toBe(true);
    });
  });

  describe('severity filtering', () => {
    it('should filter by severity threshold', async () => {
      const files = createFilesWithContent('const password = "test123";');
      const config = { ...defaultConfig(), severityThreshold: 'critical' as const };
      const result = await agent.run({ files, basePath: '/test', config });

      // Only critical issues should be included
      const nonCritical = result.secrets.filter(s => s.severity !== 'critical');
      expect(nonCritical).toHaveLength(0);
    });

    it('should include all severities when threshold is low', async () => {
      const files = createFilesWithContent(`
        const password = "test123";
        const query = "SELECT * FROM users WHERE id = " + id;
      `);
      const config = { ...defaultConfig(), severityThreshold: 'low' as const };
      const result = await agent.run({ files, basePath: '/test', config });

      expect(result.secrets.length + result.vulnerabilities.length).toBeGreaterThan(0);
    });
  });

  describe('health score integration', () => {
    it('should calculate security score', async () => {
      const files = createFilesWithContent('const x = 1;'); // Clean file
      const result = await agent.run({ files, basePath: '/test', config: defaultConfig() });

      expect(result.healthImpact).toHaveProperty('securityScore');
      expect(result.healthImpact.securityScore).toBeGreaterThanOrEqual(0);
      expect(result.healthImpact.securityScore).toBeLessThanOrEqual(100);
    });

    it('should lower score for critical issues', async () => {
      const cleanFiles = createFilesWithContent('const x = 1;');
      const dirtyFiles = createFilesWithContent('const key = "AKIAIOSFODNN7EXAMPLE";');

      const cleanResult = await agent.run({ files: cleanFiles, basePath: '/test', config: defaultConfig() });
      const dirtyResult = await agent.run({ files: dirtyFiles, basePath: '/test', config: defaultConfig() });

      expect(dirtyResult.healthImpact.securityScore).toBeLessThan(cleanResult.healthImpact.securityScore);
    });
  });
});

describe('BurnoutPredictor', () => {
  let predictor: BurnoutPredictor;

  beforeEach(() => {
    predictor = new BurnoutPredictor();
  });

  describe('risk prediction', () => {
    it('should predict low risk for well-documented simple code', async () => {
      const files = createDocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      expect(result.overallRisk).toBeLessThanOrEqual(0.5);
    });

    it('should predict higher risk for complex undocumented code', async () => {
      const files = createComplexUndocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      expect(result.overallRisk).toBeGreaterThan(0.3);
    });

    it('should identify high-risk files', async () => {
      const files = [
        ...createDocumentedFiles(),
        ...createComplexUndocumentedFiles()
      ];
      const result = await predictor.predict({ files, basePath: '/test' });

      expect(result.hotspots.length).toBeGreaterThan(0);
    });
  });

  describe('risk factors', () => {
    it('should include complexity factor', async () => {
      const files = createComplexUndocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      const complexityFactor = result.factors.find(f => f.name === 'High Complexity');
      expect(complexityFactor).toBeDefined();
    });

    it('should include documentation factor', async () => {
      const files = createComplexUndocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      const docFactor = result.factors.find(f => f.name === 'Low Documentation');
      expect(docFactor).toBeDefined();
    });
  });

  describe('recommendations', () => {
    it('should provide actionable recommendations', async () => {
      const files = createComplexUndocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0]).toBeTruthy();
    });

    it('should suggest documentation for undocumented code', async () => {
      const files = createComplexUndocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      const hasDocRecommendation = result.recommendations.some(r =>
        r.toLowerCase().includes('document')
      );
      expect(hasDocRecommendation).toBe(true);
    });
  });

  describe('trend analysis', () => {
    it('should include trend data', async () => {
      const files = createDocumentedFiles();
      const result = await predictor.predict({ files, basePath: '/test' });

      expect(result).toHaveProperty('trend');
      expect(['improving', 'stable', 'declining']).toContain(result.trend);
    });
  });
});

// Helper functions

function defaultConfig() {
  return {
    enabled: true,
    scanSecrets: true,
    scanVulnerabilities: true,
    scanDependencies: true,
    severityThreshold: 'low' as const
  };
}

function createFilesWithContent(content: string): ParsedFile[] {
  return [{
    info: {
      path: '/test/file.ts',
      relativePath: 'file.ts',
      extension: '.ts',
      language: 'typescript',
      size: content.length,
      lines: content.split('\n').length
    },
    blocks: [{
      type: 'variable',
      name: 'content',
      startLine: 1,
      endLine: content.split('\n').length,
      content
    }],
    imports: [],
    exports: [],
    rawContent: content
  }];
}

function createDocumentedFiles(): ParsedFile[] {
  const content = `
/**
 * Simple utility function
 * @param x Input value
 * @returns Doubled value
 */
function double(x: number): number {
  return x * 2;
}
`;
  const block: CodeBlock = {
    type: 'function',
    name: 'double',
    startLine: 1,
    endLine: 9,
    content,
    documentation: 'Simple utility function',
    complexity: 1
  };

  return [{
    info: {
      path: '/test/simple.ts',
      relativePath: 'simple.ts',
      extension: '.ts',
      language: 'typescript',
      size: content.length,
      lines: 9
    },
    blocks: [block],
    imports: [],
    exports: [],
    rawContent: content
  }];
}

function createComplexUndocumentedFiles(): ParsedFile[] {
  const content = `
function processData(data) {
  if (data.type === 'a') {
    if (data.subtype === 'x') {
      for (let i = 0; i < data.items.length; i++) {
        if (data.items[i].active) {
          switch (data.items[i].status) {
            case 1: return handle1(data);
            case 2: return handle2(data);
            case 3: return handle3(data);
            default: return handleDefault(data);
          }
        }
      }
    } else if (data.subtype === 'y') {
      while (data.pending) {
        try {
          processItem(data);
        } catch (e) {
          if (e.retry) continue;
          throw e;
        }
      }
    }
  }
  return null;
}
`;
  const block: CodeBlock = {
    type: 'function',
    name: 'processData',
    startLine: 1,
    endLine: 25,
    content,
    complexity: 15
  };

  return [{
    info: {
      path: '/test/complex.ts',
      relativePath: 'complex.ts',
      extension: '.ts',
      language: 'typescript',
      size: content.length,
      lines: 25
    },
    blocks: [block],
    imports: [],
    exports: [],
    rawContent: content
  }];
}
