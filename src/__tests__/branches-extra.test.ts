/**
 * Final branch-coverage mop-up across the heuristic (no-key) paths of several
 * agents and helpers — each test targets a specific remaining branch.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExplainAgent, ChatAgent } from '../agents/explain-agent.js';
import { PredictAgent } from '../agents/predict-agent.js';
import { SecurityAgent } from '../agents/security-agent.js';
import { VisionAgent } from '../agents/vision-agent.js';
import { OnboardingAgent } from '../agents/onboarding-agent.js';
import { ParseAgent } from '../agents/parse-agent.js';
import { analyzeCodebase } from '../analyzer/index.js';
import { generateDocumentation } from '../generator/index.js';
import { runCICDCheck } from '../integrations/cicd.js';
import { DEFAULT_AGENT_CONFIG } from '../agents/index.js';
import type { ParsedFile, CodeBlock, HealthScore, HealthIssue, OnboardingRole, SecurityConfig, CICDConfig, AnalysisResult } from '../types.js';
import type { AgentContext } from '../agents/types.js';

const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
afterAll(() => { if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey; });

function pf(relativePath: string, blocks: CodeBlock[], extra: Partial<ParsedFile> = {}): ParsedFile {
  return {
    info: { path: relativePath, relativePath, extension: '.ts', language: 'typescript', size: 50, lines: 10 },
    blocks, imports: extra.imports ?? [], exports: extra.exports ?? [], rawContent: extra.rawContent ?? ''
  };
}
const fn = (name: string, e: Partial<CodeBlock> = {}): CodeBlock => ({ type: 'function', name, startLine: 1, endLine: 2, content: `function ${name}(){}`, ...e });

describe('ExplainAgent heuristic branch edges', () => {
  function agent(files: ParsedFile[]) {
    const a = new ExplainAgent();
    a.setContext({ workingDir: '/p', files, config: DEFAULT_AGENT_CONFIG } as AgentContext);
    return a;
  }

  it('uses the empty-name fallback for block purpose and undocumented summaries', async () => {
    const f = pf('a.ts', [fn('get', { complexity: undefined })]); // slice(3) === '' -> 'the value'
    const r = await agent([f]).run({ type: 'block', target: 'get', context: { files: [f], basePath: '/p' }, depth: 'deep' });
    expect(r.data!.explanation.purpose).toContain('the value');
  });

  it('summarizes files without complexity or external imports', async () => {
    const f = pf('plain.ts', [fn('a'), { type: 'class', name: 'C', startLine: 1, endLine: 2, content: '' }], { imports: [{ source: './local', items: ['x'], isDefault: false, line: 1 }], exports: [{ name: 'a', type: 'named', line: 1 }] });
    const r = await agent([f]).run({ type: 'file', target: 'plain.ts', context: { files: [f], basePath: '/p' }, depth: 'deep' });
    expect(r.data!.explanation.complexity.score).toBe(1); // avgComplexity fallback
  });

  it('reports when no complex blocks and all documentation exist', async () => {
    const files = [pf('a.ts', [fn('simple', { complexity: 2, documentation: 'doc' })])];
    const a = agent(files);
    const ctx = { files, basePath: '/p' };
    expect((await a.run({ type: 'query', target: 'find complex code', context: ctx })).data!.explanation.summary).toContain('No overly complex');
    expect((await a.run({ type: 'query', target: 'show undocumented', context: ctx })).data!.explanation.summary).toContain('All code is documented');
  });

  it('sorts multiple complex blocks and multiple dependencies', async () => {
    const files = [pf('a.ts', [fn('c1', { complexity: 20 }), fn('c2', { complexity: 15 })], {
      imports: [
        { source: 'react', items: ['x'], isDefault: false, line: 1 },
        { source: 'lodash', items: ['y'], isDefault: false, line: 2 }
      ]
    })];
    const a = agent(files);
    const ctx = { files, basePath: '/p' };
    expect((await a.run({ type: 'query', target: 'find complex code', context: ctx })).data!.explanation.summary).toContain('c1');
    expect((await a.run({ type: 'query', target: 'list dependencies', context: ctx })).data!.explanation.dependencies.length).toBeGreaterThanOrEqual(2);
  });

  it('relates code while ignoring non-matching imports', async () => {
    const target = pf('svc.ts', [fn('go')], { imports: [{ source: './util', items: ['u'], isDefault: false, line: 1 }] });
    const other = pf('other.ts', [], { imports: [{ source: './svc', items: ['go'], isDefault: false, line: 1 }, { source: 'react', items: ['x'], isDefault: false, line: 2 }] });
    const util = pf('util.ts', [fn('u')]);
    const files = [target, other, util];
    const r = await agent(files).run({ type: 'file', target: 'svc.ts', context: { files, basePath: '/p' } });
    expect(r.data!.relatedCode!.length).toBeGreaterThan(0);
  });

  it('renders block parameters without type or optional flags', async () => {
    const f = pf('a.ts', [fn('m', { parameters: [{ name: 'a' }], returnType: 'void' })]);
    const r = await agent([f]).run({ type: 'block', target: 'm', context: { files: [f], basePath: '/p' }, depth: 'normal' });
    expect(r.data!.explanation.summary).toContain('`a`');
  });
});

describe('ChatAgent explain routing without follow-ups', () => {
  it('handles an explain query that yields no follow-ups', async () => {
    const files = [pf('a.ts', [fn('simple', { complexity: 2, documentation: 'doc' })])];
    const a = new ChatAgent();
    a.setContext({ workingDir: '/p', files, config: DEFAULT_AGENT_CONFIG } as AgentContext);
    const r = await a.run({ role: 'user', content: 'explain complex parts', timestamp: new Date() });
    expect(r.data!.content).toContain('No overly complex');
  });
});

describe('PredictAgent doc-coverage edge', () => {
  it('treats files with no documentable blocks as fully covered', async () => {
    const f = pf('vars.ts', [{ type: 'variable', name: 'x', startLine: 1, endLine: 1, content: '' }]);
    const r = await new PredictAgent().run({ files: [f], basePath: process.cwd(), lookbackDays: 3650 });
    expect(r.success).toBe(true);
    expect(r.data!.trends.complexityTrend).toBe('decreasing');
    expect(r.data!.trends.documentationTrend).toBe('improving');
  });
});

describe('SecurityAgent config toggles and hash comments', () => {
  const base: SecurityConfig = { enabled: true, scanSecrets: true, scanVulnerabilities: true, scanDependencies: true, severityThreshold: 'low' };
  it('skips scans when disabled and ignores hash comments', async () => {
    const f = pf('a.py', [], { rawContent: '# api_key = "abcdefghij1234567890"\nx = 1' });
    const off = await new SecurityAgent().run({ files: [f], basePath: '/p', config: { ...base, scanSecrets: false, scanVulnerabilities: false } });
    expect(off.data!.secrets).toHaveLength(0);
    expect(off.data!.vulnerabilities).toHaveLength(0);
    const on = await new SecurityAgent().run({ files: [f], basePath: '/p', config: base });
    expect(on.data!.secrets).toHaveLength(0); // the only match is on a hash-comment line
  });
});

describe('VisionAgent ignores non-image files', () => {
  it('skips unsupported extensions while scanning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vis-mix-'));
    try {
      await mkdir(join(dir, 'docs'), { recursive: true });
      await writeFile(join(dir, 'docs', 'notes.txt'), 'hello');
      await writeFile(join(dir, 'docs', 'pic.png'), Buffer.from([0x89]));
      const r = await new VisionAgent().run({ directory: dir, context: { files: [], basePath: dir } });
      expect(r.data!.images.every(i => !i.path.endsWith('.txt'))).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('OnboardingAgent sparse-codebase branches', () => {
  it('handles no entry points, no complex modules and no classes', async () => {
    const files = [pf('plain.ts', [fn('doStuff')], { rawContent: 'function doStuff(){}' })];
    const role: OnboardingRole = { name: 'Eng', level: 'senior', focusAreas: ['architecture', 'deep-dive', 'patterns'] };
    const r = await new OnboardingAgent().run({ role, context: { files, basePath: '/p' } });
    expect(r.success).toBe(true);
    expect(r.data!.guide.glossary).toHaveLength(0); // no classes
  });

  it('handles an entry point that has no function block', async () => {
    const files = [pf('index.ts', [{ type: 'class', name: 'App', startLine: 1, endLine: 2, content: '' }])];
    const role: OnboardingRole = { name: 'Eng', level: 'senior', focusAreas: ['architecture'] };
    const r = await new OnboardingAgent().run({ role, context: { files, basePath: '/p' } });
    const arch = r.data!.guide.sections.find(s => s.title === 'Architecture')!;
    expect(arch.codeExamples).toHaveLength(0);
  });
});

describe('ParseAgent low-complexity block', () => {
  it('summarizes a simple undocumented function without issues', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parse-lo-'));
    try {
      await writeFile(join(dir, 'simple.ts'), 'function tiny() { return 1; }\n');
      const r = await new ParseAgent().run({ patterns: ['**/*.ts'], exclude: [], basePath: dir });
      const tiny = r.data!.codeBlocks.find(b => b.name === 'tiny')!;
      expect(tiny.complexity).toBeLessThanOrEqual(15);
      expect(r.data!.summary.highComplexityCount).toBe(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('analyzer clean-codebase branches', () => {
  it('scores a small, fully-documented, shallow codebase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'an-clean-'));
    try {
      await writeFile(join(dir, 'a.ts'), `/** docs */\nexport function a() {\n      const x = 1;\n      return x;\n}\n`);
      await writeFile(join(dir, 'novars.ts'), 'const x = 1;\n');
      const r = await analyzeCodebase({ include: ['**/*.ts'], exclude: [], basePath: dir, minComplexity: 10 });
      expect(r.healthScore.categories.documentation).toBeGreaterThanOrEqual(0);
      expect(r.healthScore.issues.every(i => i.rule !== 'large-file')).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('generator small-issue / no-project branches', () => {
  it('defaults the project name and renders a short issue list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-b-'));
    try {
      const file: ParsedFile = pf('a.ts', [{ type: 'function', name: 'fn', startLine: 1, endLine: 2, content: 'x', complexity: 2, documentation: 'd', parameters: [{ name: 'p', type: 't' }], returnType: 'number' }], { imports: [{ source: 'lib', items: ['l'], isDefault: false, line: 1 }] });
      const issues: HealthIssue[] = [{ severity: 'warning', message: 'm', rule: 'r', file: 'a.ts', line: 1 }];
      const health: HealthScore = { overall: 70, categories: { documentation: 70, complexity: 70, structure: 70, maintainability: 70 }, issues, suggestions: ['s'] };
      const written = await generateDocumentation([file], health, { outputDir: dir, format: 'markdown', generateTOC: false, includeSource: false });
      const readme = await readFile(written[0], 'utf-8');
      expect(readme).toContain('Project Documentation'); // default name
      expect(readme).not.toContain('more issues');
      const api = await readFile(written.find(p => p.endsWith('API.md'))!, 'utf-8');
      expect(api).toContain('## Functions');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('OnboardingAgent empty key-files / glossary rendering', () => {
  it('renders a guide with no key files and no glossary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onb-empty-'));
    try {
      const files = [pf('config/settings.ts', [])]; // config only -> no entry/core/util, no classes
      const role: OnboardingRole = { name: 'X', level: 'junior', focusAreas: [] };
      const r = await new OnboardingAgent().run({ role, context: { files, basePath: '/p' }, outputDir: dir });
      const md = await readFile(r.data!.generatedFiles[0], 'utf-8');
      expect(md).not.toContain('## Key Files');
      expect(md).not.toContain('## Glossary');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('ParseAgent interface and documented/undocumented classes', () => {
  it('summarizes interfaces (no complexity) and both class doc states', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parse-if-'));
    try {
      await writeFile(join(dir, 'm.ts'), `/** docs */\nexport class Documented {}\nexport class Bare {}\nexport interface IShape { id: string }\n`);
      const r = await new ParseAgent().run({ patterns: ['**/*.ts'], exclude: [], basePath: dir });
      const iface = r.data!.codeBlocks.find(b => b.name === 'IShape')!;
      expect(iface.complexity).toBe(1); // interface has no complexity -> `|| 1`
      expect(r.data!.codeBlocks.some(b => b.name === 'Documented' && b.documented)).toBe(true);
      expect(r.data!.codeBlocks.some(b => b.name === 'Bare' && !b.documented)).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('SecurityAgent burnout block without complexity', () => {
  it('handles blocks that have no complexity value', async () => {
    const cfg: SecurityConfig = { enabled: true, scanSecrets: true, scanVulnerabilities: true, scanDependencies: true, severityThreshold: 'low' };
    const f = pf('a.ts', [{ type: 'function', name: 'f', startLine: 1, endLine: 1, content: '' }]); // no complexity
    const r = await new SecurityAgent().run({ files: [f], basePath: '/p', config: cfg });
    expect(r.success).toBe(true);
  });
});

describe('generator language-stats / class-only / param / file-less issue branches', () => {
  function pyFile(): ParsedFile {
    const f = pf('b.py', [{ type: 'class', name: 'D', startLine: 1, endLine: 2, content: 'y', documentation: 'd' }]);
    f.info.language = 'python';
    f.info.extension = '.py';
    return f;
  }

  it('covers multi-language stats and class/interface-only API references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-l-'));
    try {
      const ts = pf('a.ts', [{ type: 'class', name: 'C', startLine: 1, endLine: 2, content: 'x', complexity: 3, documentation: 'd' }, { type: 'interface', name: 'I', startLine: 1, endLine: 2, content: '' }]);
      const health: HealthScore = { overall: 70, categories: { documentation: 70, complexity: 70, structure: 70, maintainability: 70 }, issues: [], suggestions: [] };
      const written = await generateDocumentation([ts, pyFile()], health, { outputDir: dir, format: 'markdown', generateTOC: false, includeSource: false });
      const readme = await readFile(written[0], 'utf-8');
      expect(readme).toContain('| python |'); // two languages -> langStats sort
      const api = await readFile(written.find(p => p.endsWith('API.md'))!, 'utf-8');
      expect(api).toContain('## Classes');
      expect(api).not.toContain('## Functions'); // no functions present
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('covers params with/without optional/default and file-less HTML issues', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-p-'));
    try {
      const ts = pf('a.ts', [{ type: 'function', name: 'fn', startLine: 1, endLine: 2, content: 'x', complexity: 2, documentation: 'd', parameters: [{ name: 'plain' }, { name: 'opt', type: 't', optional: true, defaultValue: '1' }], returnType: 'void' }]);
      const issues: HealthIssue[] = [{ severity: 'error', message: 'no location', rule: 'r' }]; // no file/line
      const health: HealthScore = { overall: 50, categories: { documentation: 50, complexity: 50, structure: 50, maintainability: 50 }, issues, suggestions: [] };
      const md = await generateDocumentation([ts], health, { outputDir: dir, format: 'markdown', generateTOC: false, includeSource: false });
      const api = await readFile(md.find(p => p.endsWith('API.md'))!, 'utf-8');
      expect(api).toContain('| No |'); // plain param: not optional
      const fileDoc = await readFile(md.find(p => p.includes('files'))!, 'utf-8');
      expect(fileDoc).toContain('`plain`');
      const html = await generateDocumentation([ts], health, { outputDir: dir, format: 'html', generateTOC: false, includeSource: false });
      const page = await readFile(html[0], 'utf-8');
      expect(page).toContain('<td>-</td>'); // issue without a file -> '-'
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('cicd passing github-actions output', () => {
  it('renders the passing status with no issues', () => {
    const result: AnalysisResult = {
      files: [], totalFiles: 1, totalLines: 10, languageBreakdown: new Map([['typescript', 1]]),
      healthScore: { overall: 95, categories: { documentation: 90, complexity: 90, structure: 90, maintainability: 90 }, issues: [], suggestions: [] },
      undocumentedBlocks: [], complexBlocks: []
    };
    const cfg: CICDConfig = { enabled: true, failOnLowHealth: true, healthThreshold: 80, outputFormat: 'github-actions' };
    const r = runCICDCheck(result, cfg);
    expect(r.output).toContain('✅ PASSED');
    expect(r.output).not.toContain('::group::Issues Found');
  });
});
