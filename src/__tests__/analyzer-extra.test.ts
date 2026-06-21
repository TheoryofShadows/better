/**
 * Covers the analyzer health-scoring issue branches (large/crowded files, deep
 * nesting, long functions, high-complexity errors, low-doc/maintainability
 * suggestions), every explainCode pattern, and generateSummary/getScoreBar
 * across score bands and issue/suggestion presence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeCodebase, explainCode, generateSummary } from '../analyzer/index.js';
import type { AnalysisResult, HealthScore } from '../types.js';

describe('analyzeCodebase health issues', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'analyzer-'));
    const funcs = Array.from({ length: 21 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n');
    const ifs = Array.from({ length: 25 }, (_, i) => `  if (a${i} > ${i}) { b(); }`).join('\n');
    const pad = Array.from({ length: 110 }, (_, i) => `  // body line ${i}`).join('\n');
    const huge = `function huge(arg) {\n              deeplyNested();\n${ifs}\n${pad}\n  return arg;\n}`;
    const blanks = '\n'.repeat(420);
    await writeFile(join(dir, 'bad.ts'), funcs + '\n' + huge + '\n' + blanks);
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('flags large, crowded, complex, deeply-nested and long-function issues', async () => {
    const r = await analyzeCodebase({ include: ['**/*.ts'], exclude: [], basePath: dir, minComplexity: 10 });
    const rules = [...new Set(r.healthScore.issues.map(i => i.rule))];
    expect(rules).toEqual(expect.arrayContaining(['missing-documentation', 'high-complexity', 'large-file', 'deep-nesting', 'long-function']));
    expect(r.healthScore.issues.some(i => i.severity === 'error')).toBe(true);
    expect(r.healthScore.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(r.healthScore.categories.documentation).toBeLessThan(50);
  });
});

describe('analyzeCodebase clean / low-maintainability edges', () => {
  it('handles an empty codebase (no matching files)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'an-empty-'));
    try {
      const r = await analyzeCodebase({ include: ['**/*.ts'], exclude: [], basePath: dir, minComplexity: 10 });
      expect(r.totalFiles).toBe(0);
      expect(r.healthScore.categories.structure).toBe(100); // avgFileSize uses the `|| 1` divisor guard
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('scores a codebase with no documentable or complex blocks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'an-novars-'));
    try {
      await writeFile(join(dir, 'consts.ts'), 'const x = 1;\nconst y = 2;\n');
      const r = await analyzeCodebase({ include: ['**/*.ts'], exclude: [], basePath: dir, minComplexity: 10 });
      expect(r.healthScore.categories.documentation).toBe(100); // docRatio fallback (no documentable)
      expect(r.healthScore.issues.every(i => i.rule !== 'large-file')).toBe(true); // no large files
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('penalizes maintainability and sorts multiple complex blocks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'an-maint-'));
    try {
      const nested = Array.from({ length: 18 }, (_, i) => `function fn${i}() {\n          deep${i}();\n}`).join('\n'); // 10-space indent -> level 5 (>4, not >6)
      const ifs = Array.from({ length: 14 }, (_, j) => `  if (a${j}) { b(); }`).join('\n');
      const complex = [0, 1].map(k => `function cx${k}() {\n${ifs}\n}`).join('\n');
      await writeFile(join(dir, 'maint.ts'), nested + '\n' + complex + '\n');
      const r = await analyzeCodebase({ include: ['**/*.ts'], exclude: [], basePath: dir, minComplexity: 10 });
      expect(r.healthScore.categories.maintainability).toBeLessThan(70);
      expect(r.healthScore.suggestions.some(s => /readability/i.test(s))).toBe(true);
      expect(r.complexBlocks.length).toBeGreaterThanOrEqual(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('explainCode', () => {
  it('detects a broad range of patterns', () => {
    const code = `
      import { x } from 'y';
      export class Widget {
        async run() {
          try {
            for (const i of items) { if (i) console.log(i); }
            const r = await fetch('/api');
            const data = JSON.parse('{}');
            db.query('SELECT 1');
            const obj = new Thing();
            element.addEventListener('click', () => {});
            const [s, setS] = useState(0);
            if (!r) throw new Error('x');
            return data;
          } catch (e) { console.error(e); }
        }
      }
      interface Shape { id: string }
      @Component()
      class C {}
    `;
    const out = explainCode(code, 'typescript');
    expect(out).toContain('asynchronous');
    expect(out).toContain('database');
    expect(out).toContain('event listeners');
    expect(out).toContain('decorators');
  });

  it('returns a fallback when nothing is recognized', () => {
    expect(explainCode('const x = 1', 'typescript')).toContain('could not be analyzed');
  });
});

describe('generateSummary', () => {
  const mkResult = (health: HealthScore): AnalysisResult => ({
    files: [], totalFiles: 3, totalLines: 120,
    languageBreakdown: new Map([['typescript', 3]]),
    healthScore: health, undocumentedBlocks: [], complexBlocks: []
  });

  it('renders score bars across colors plus issues and suggestions', () => {
    const health: HealthScore = {
      overall: 85,
      categories: { documentation: 65, complexity: 45, structure: 30, maintainability: 50 },
      issues: [
        { severity: 'error', message: 'boom', file: 'a.ts', line: 3, rule: 'r1' },
        { severity: 'warning', message: 'warn', rule: 'r2' },
        { severity: 'info', message: 'note', file: 'b.ts', line: 1, rule: 'r3' }
      ],
      suggestions: ['Do the thing']
    };
    const out = generateSummary(mkResult(health));
    expect(out).toContain('🟩');
    expect(out).toContain('🟨');
    expect(out).toContain('🟧');
    expect(out).toContain('🟥');
    expect(out).toContain('TOP ISSUES');
    expect(out).toContain('SUGGESTIONS');
    expect(out).toContain('└─ a.ts:3');
  });

  it('omits issue and suggestion sections when empty', () => {
    const health: HealthScore = {
      overall: 90,
      categories: { documentation: 90, complexity: 90, structure: 90, maintainability: 90 },
      issues: [], suggestions: []
    };
    const out = generateSummary(mkResult(health));
    expect(out).not.toContain('TOP ISSUES');
    expect(out).not.toContain('SUGGESTIONS');
  });
});
