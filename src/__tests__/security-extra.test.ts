/**
 * Exercises the remaining SecurityAgent branches: every secret/vulnerability
 * pattern, all code smells, the comment/skip-file guards, secret masking, and
 * each burnout factor + risk level + recommendation.
 */

import { describe, it, expect } from 'vitest';
import { SecurityAgent } from '../agents/security-agent.js';
import type { ParsedFile, CodeBlock, SecurityConfig } from '../types.js';
import type { GitHistoryInfo } from '../agents/security-agent.js';

const config: SecurityConfig = {
  enabled: true,
  scanSecrets: true,
  scanVulnerabilities: true,
  scanDependencies: true,
  severityThreshold: 'low'
};

function fileWith(content: string, relativePath = 'file.ts', lines?: number, blocks: CodeBlock[] = []): ParsedFile {
  return {
    info: { path: '/p/' + relativePath, relativePath, extension: '.ts', language: 'typescript', size: content.length, lines: lines ?? content.split('\n').length },
    blocks,
    imports: [],
    exports: [],
    rawContent: content
  };
}

const run = (files: ParsedFile[], extra: Partial<Parameters<SecurityAgent['run']>[0]> = {}) =>
  new SecurityAgent().run({ files, basePath: '/p', config, ...extra });

describe('SecurityAgent secret patterns', () => {
  const ghp = 'ghp_' + 'a'.repeat(36);
  const pat = 'github_pat_' + 'b'.repeat(22) + '_' + 'c'.repeat(59);
  const content = [
    '// password = "thisisacomment"',
    'const aws2 = "abcdefghijklmnopqrstuvwxyz0123456789ABCD"; aws_secret_access_key = "abcdefghijklmnopqrstuvwxyz0123456789ABCD"',
    `const g = "${ghp}";`,
    `const pat = "${pat}";`,
    'const k = "api_key=abcdefghij1234567890";',
    'const k2 = "apikey=abcdefghij1234567890";',
    'const tok = "bearer a";',
    'const at = "access_token=abc.def-ghi";',
    'password = "supersecret1";',
    'passwd = "supersecret1";',
    '-----BEGIN RSA PRIVATE KEY-----',
    'const m = "mongodb://u:p@host/db";',
    'const pg = "postgres://u:p@host/db";',
    'const my = "mysql://u:p@host/db";',
    'secret = "0123456789abcd";'
  ].join('\n');

  it('detects each secret type and masks short/long matches', async () => {
    const r = await run([fileWith(content)]);
    const types = new Set(r.data!.secrets.map(s => s.type));
    for (const t of ['aws_credentials', 'github_token', 'api_key', 'token', 'password', 'private_key', 'connection_string', 'generic_secret']) {
      expect(types.has(t as never)).toBe(true);
    }
    expect(r.data!.secrets.some(s => s.pattern === '***')).toBe(true); // bearer a -> short mask
    expect(r.data!.secrets.some(s => s.pattern.includes('***') && s.pattern !== '***')).toBe(true);
    expect(r.data!.secrets.every(s => s.recommendation.length > 0)).toBe(true);
  });
});

describe('SecurityAgent vulnerability patterns + code smells', () => {
  const content = [
    'db.query(`SELECT * FROM users WHERE id = ${id}`)',
    'connection.execute("SELECT " + name + " FROM t")',
    'element.innerHTML = userInput',
    'document.write("x")',
    'exec(`rm ${userInput}`)',
    'spawn("sh " + cmd)',
    'readFile(req.query.path)',
    'res.redirect(req.body.next)',
    'console.log("token=" + token)',
    'username = "admin"; password = "secret12";',
    'eval("danger")',
    '/* eslint-disable no-console */',
    '// TODO: fix the auth check here'
  ].join('\n');

  it('detects each vulnerability type and code smell', async () => {
    const r = await run([fileWith(content)]);
    const vtypes = new Set(r.data!.vulnerabilities.map(v => v.type));
    for (const t of ['sql_injection', 'xss', 'command_injection', 'path_traversal', 'insecure_random', 'open_redirect', 'sensitive_data_exposure', 'hardcoded_credentials']) {
      // insecure_random is not in this content; assert the rest
      if (t !== 'insecure_random') expect(vtypes.has(t as never)).toBe(true);
    }
    const smells = new Set(r.data!.codeSmells.map(s => s.type));
    expect(smells.has('eval-usage')).toBe(true);
    expect(smells.has('disabled-linting')).toBe(true);
    expect(smells.has('security-todo')).toBe(true);
  });

  it('skips generated/vendored files', async () => {
    const r = await run([fileWith('const k = "AKIAIOSFODNN7EXAMPLE";', 'node_modules/dep.ts')]);
    expect(r.data!.secrets).toHaveLength(0);
  });
});

describe('SecurityAgent summary risk levels', () => {
  it('reports high when the worst finding is high', async () => {
    const r = await run([fileWith('const k = "api_key=abcdefghij1234567890";')]);
    expect(r.data!.summary.overallRisk).toBe('high');
  });
  it('reports medium when the worst finding is medium', async () => {
    const r = await run([fileWith('document.write("x")')]);
    expect(r.data!.summary.overallRisk).toBe('medium');
  });
  it('reports low when only low findings exist', async () => {
    const r = await run([fileWith('const r = Math.random();')]);
    expect(r.data!.summary.overallRisk).toBe('low');
  });
});

describe('SecurityAgent burnout analysis', () => {
  const undoc = (complexity?: number): CodeBlock => ({ type: 'function', name: 'f', startLine: 1, endLine: 1, content: '', complexity });
  const doc = (complexity = 1): CodeBlock => ({ type: 'function', name: 'g', startLine: 1, endLine: 1, content: '', complexity, documentation: 'doc' });
  const git = (n: number, opts: { hour: number; day?: number; lines: number }): GitHistoryInfo[] =>
    Array.from({ length: n }, () => ({ author: 'a', date: new Date(2024, 0, opts.day === 6 ? 6 : 1, opts.hour), filesChanged: 1, linesChanged: opts.lines }));

  it('returns low risk with healthy inputs', async () => {
    const r = await run([fileWith('const x=1;', 'a.ts', 10, [doc()])]);
    expect(r.data!.burnoutAnalysis.riskLevel).toBe('low');
    expect(r.data!.burnoutAnalysis.factors).toHaveLength(0);
  });

  it('flags off-hours work as medium risk', async () => {
    const r = await run([fileWith('const x=1;', 'a.ts', 10, [doc()])], { gitHistory: git(10, { hour: 2, lines: 10 }) });
    expect(r.data!.burnoutAnalysis.factors.some(f => f.name === 'Off-Hours Work')).toBe(true);
    expect(r.data!.burnoutAnalysis.riskLevel).toBe('medium');
  });

  it('flags complexity, sprawl and rushed commits as high risk', async () => {
    const files = Array.from({ length: 6 }, (_, i) => fileWith('x', `big${i}.ts`, 600, [doc(30)]));
    const r = await run(files, { gitHistory: git(10, { hour: 12, lines: 600 }), healthScore: { overall: 80, maintainability: 80, documentation: 80, complexity: 80, testCoverage: 80, issues: [] } });
    const names = r.data!.burnoutAnalysis.factors.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(['High Code Complexity', 'Code Sprawl', 'Rushed Development']));
    expect(names).not.toContain('Off-Hours Work');
    expect(r.data!.burnoutAnalysis.riskLevel).toBe('high');
  });

  it('combines every factor into critical risk with recommendations', async () => {
    const files = Array.from({ length: 6 }, (_, i) => fileWith('x', `big${i}.ts`, 600, [undoc(30)]));
    const r = await run(files, {
      gitHistory: git(10, { hour: 2, lines: 600 }),
      healthScore: { overall: 30, maintainability: 30, documentation: 30, complexity: 30, testCoverage: 30, issues: [] }
    });
    const ba = r.data!.burnoutAnalysis;
    const names = ba.factors.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(['High Code Complexity', 'Poor Documentation', 'High Technical Debt', 'Rushed Development', 'Off-Hours Work', 'Code Sprawl']));
    expect(ba.riskLevel).toBe('critical');
    expect(ba.recommendations).toContain('Consider a team retrospective focused on sustainable pace');
  });
});
