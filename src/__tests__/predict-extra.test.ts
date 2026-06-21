/**
 * Covers PredictAgent: every debt factor + risk level, the heuristic and AI
 * recommendation paths (success / error / empty fallbacks), trend analysis
 * branches, the empty-input summary, and the git-history error fallback.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create }; } }));

import { PredictAgent } from '../agents/predict-agent.js';
import type { ParsedFile, CodeBlock } from '../types.js';

function block(extra: Partial<CodeBlock> = {}): CodeBlock {
  return { type: 'function', name: 'f', startLine: 1, endLine: 1, content: 'x', complexity: 1, ...extra };
}

function makeFile(relativePath: string, lines: number, blocks: CodeBlock[]): ParsedFile {
  return {
    info: { path: '/p/' + relativePath, relativePath, extension: '.ts', language: 'typescript', size: 10, lines },
    blocks, imports: [], exports: [], rawContent: ''
  };
}

const nested = ' '.repeat(12) + 'deeplyNested();';

// critical: complexity>15, doc<0.3, lines>500, funcCount>20, deep nesting
const fileCritical = makeFile('crit.ts', 600, [
  ...Array.from({ length: 21 }, () => block({ complexity: 30 })),
  block({ complexity: 30, content: nested })
]);
// high: complexity>15 + large file only
const fileHigh = makeFile('high.ts', 600, [block({ complexity: 30, documentation: 'd' })]);
// medium: moderate complexity (>10) + growing file (>300) + incomplete docs (<0.6)
const fileMedium = makeFile('med.ts', 350, [block({ complexity: 12, documentation: 'd' }), block({ complexity: 12 })]);
// low: nothing
const fileLow = makeFile('low.ts', 50, [block({ complexity: 5, documentation: 'd' })]);

const prevKey = process.env.ANTHROPIC_API_KEY;

describe('PredictAgent heuristic paths (no key)', () => {
  beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterAll(() => { if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey; });

  it('classifies every risk level with matching recommendations', async () => {
    const r = await new PredictAgent().run({ files: [fileCritical, fileHigh, fileMedium, fileLow], basePath: process.cwd(), lookbackDays: 3650 });
    expect(r.success).toBe(true);
    const byFile = (f: string) => r.data!.predictions.find(p => p.file === f)!;
    expect(byFile('crit.ts').riskLevel).toBe('critical');
    expect(byFile('crit.ts').recommendation).toContain('Immediate refactoring');
    expect(byFile('high.ts').riskLevel).toBe('high');
    expect(byFile('high.ts').recommendation).toContain('Priority:');
    expect(byFile('med.ts').riskLevel).toBe('medium');
    expect(byFile('med.ts').recommendation).toContain('Schedule maintenance');
    expect(byFile('low.ts').riskLevel).toBe('low');
    expect(byFile('low.ts').recommendation).toContain('Low risk');
    const factorNames = byFile('crit.ts').factors.map(f => f.name);
    expect(factorNames).toEqual(expect.arrayContaining(['High Complexity', 'Poor Documentation', 'Large File', 'High Function Count', 'Deep Nesting']));
    expect(byFile('med.ts').factors.map(f => f.name)).toEqual(expect.arrayContaining(['Moderate Complexity', 'Incomplete Documentation', 'Growing File']));
    expect(r.data!.summary.criticalRiskFiles).toBe(1);
  });

  it('derives increasing/declining trends from high-debt files', async () => {
    const t = (await new PredictAgent().run({ files: [fileCritical], basePath: process.cwd(), lookbackDays: 3650 })).data!.trends;
    expect(t.complexityTrend).toBe('increasing');
    expect(t.documentationTrend).toBe('declining');
  });

  it('derives decreasing/improving trends from low-debt files', async () => {
    const t = (await new PredictAgent().run({ files: [fileLow], basePath: process.cwd(), lookbackDays: 3650 })).data!.trends;
    expect(t.complexityTrend).toBe('decreasing');
    expect(t.documentationTrend).toBe('improving');
  });

  it('derives stable trends from mid-range files', async () => {
    const t = (await new PredictAgent().run({ files: [fileMedium], basePath: process.cwd(), lookbackDays: 3650 })).data!.trends;
    expect(t.complexityTrend).toBe('stable');
    expect(t.documentationTrend).toBe('stable');
  });

  it('handles an empty file set', async () => {
    const r = await new PredictAgent().run({ files: [], basePath: process.cwd() });
    expect(r.data!.summary.totalFilesAnalyzed).toBe(0);
    expect(r.data!.summary.avgPredictedDebtIncrease).toBe(0);
    expect(r.data!.trends.churnRate).toBe(0);
  });

  it('falls back to empty history outside a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'predict-nogit-'));
    try {
      const r = await new PredictAgent().run({ files: [fileLow], basePath: dir });
      expect(r.success).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PredictAgent AI recommendation path', () => {
  beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  beforeEach(() => { create.mockReset(); });

  it('uses the model recommendation when available', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'AI: split this module.' }] });
    const r = await new PredictAgent().run({ files: [fileHigh], basePath: process.cwd(), lookbackDays: 3650 });
    expect(r.data!.predictions[0].recommendation).toBe('AI: split this module.');
  });

  it('falls back to heuristic when the model returns empty text', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    const r = await new PredictAgent().run({ files: [fileHigh], basePath: process.cwd(), lookbackDays: 3650 });
    expect(r.data!.predictions[0].recommendation).toContain('Priority:');
  });

  it('falls back to heuristic when the model errors', async () => {
    create.mockRejectedValue(new Error('boom'));
    const r = await new PredictAgent().run({ files: [fileCritical], basePath: process.cwd(), lookbackDays: 3650 });
    expect(r.data!.predictions[0].recommendation).toContain('Immediate refactoring');
  });
});
