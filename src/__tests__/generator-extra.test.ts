/**
 * Drives generateDocumentation across all three formats with inputs crafted to
 * exercise every template branch: TOC on/off, includeSource on/off, present vs
 * absent imports/exports/docs/params/returns/complexity, every API-reference
 * block type, all health-emoji/grade/complexity/severity/byte thresholds, and
 * the issues-present vs issues-empty paths.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import { generateDocumentation, GeneratorOptions } from '../generator/index.js';
import type { ParsedFile, HealthScore, CodeBlock, HealthIssue } from '../types.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const dirs: string[] = [];
async function outDir() { const d = await mkdtemp(join(tmpdir(), 'gen-x-')); dirs.push(d); return d; }
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

function blk(extra: Partial<CodeBlock>): CodeBlock {
  return { type: 'function', name: 'b', startLine: 1, endLine: 2, content: 'code()', ...extra };
}

function file(relativePath: string, size: number, blocks: CodeBlock[], withDeps: boolean): ParsedFile {
  return {
    info: { path: relativePath, relativePath, extension: '.ts', language: 'typescript', size, lines: 10 },
    blocks,
    imports: withDeps ? [{ source: './x', items: ['x'], isDefault: false, line: 1 }] : [],
    exports: withDeps ? [{ name: 'b', type: 'named', line: 1 }] : [],
    rawContent: 'code()'
  };
}

function health(overall: number, issues: HealthIssue[], suggestions: string[]): HealthScore {
  return {
    overall,
    categories: { documentation: 85, complexity: 65, structure: 45, maintainability: 30 },
    issues,
    suggestions
  };
}

const md = (dir: string, opts: Partial<GeneratorOptions>): GeneratorOptions => ({
  outputDir: dir, format: 'markdown', generateTOC: true, includeSource: true, projectName: 'Demo', ...opts
});

describe('generateDocumentation markdown (rich)', () => {
  it('covers every block type, dependency, and health threshold', async () => {
    const richBlocks: CodeBlock[] = [
      blk({ type: 'function', name: 'fn', complexity: 3, documentation: 'docs', parameters: [{ name: 'a', type: 'string', optional: true, defaultValue: '1' }], returnType: 'number' }),
      blk({ type: 'method', name: 'mth', complexity: 8 }),
      blk({ type: 'class', name: 'Cls', complexity: 15, documentation: 'class docs' }),
      blk({ type: 'class', name: 'Bare' }),
      blk({ type: 'interface', name: 'Iface', documentation: 'iface docs' }),
      blk({ type: 'interface', name: 'IBare' }),
      blk({ type: 'type', name: 'T' }),
      blk({ type: 'function', name: 'veryComplex', complexity: 25 })
    ];
    const files = [
      file('small.ts', 50, richBlocks, true),
      file('kilo.ts', 5000, [blk({ type: 'function', name: 'noDocs' })], false),
      file('mega.ts', 2_000_000, [blk({ type: 'function', name: 'huge', complexity: 12 })], false),
      file('empty.ts', 10, [], true)
    ];
    const issues: HealthIssue[] = Array.from({ length: 12 }, (_, i) => ({
      severity: (['error', 'warning', 'info'] as const)[i % 3],
      message: 'issue ' + i,
      rule: 'rule' + i,
      file: i % 2 === 0 ? 'small.ts' : undefined,
      line: i
    } as HealthIssue));

    const dir = await outDir();
    const written = await generateDocumentation(files, health(85, issues, ['Improve docs']), md(dir, {}));
    const readme = await readFile(written[0], 'utf-8');
    expect(readme).toContain('Table of Contents');
    expect(readme).toContain('and 2 more issues');

    const api = await readFile(written.find(p => p.endsWith('API.md'))!, 'utf-8');
    expect(api).toContain('## Classes');
    expect(api).toContain('## Interfaces');
    expect(api).toContain('## Functions');

    const fileDoc = await readFile(written.find(p => p.includes('small'))!, 'utf-8');
    expect(fileDoc).toContain('Source Code'); // includeSource
    expect(fileDoc).toContain('## Imports');
    expect(fileDoc).toContain('(optional)');

    const health1 = await readFile(written.find(p => p.endsWith('HEALTH.md'))!, 'utf-8');
    expect(health1).toContain('Grade: B');
    expect(health1).toMatch(/Errors|Warnings|Infos/);
  });
});

describe('generateDocumentation markdown (sparse)', () => {
  it('covers TOC-off, includeSource-off, no deps/docs, and empty health', async () => {
    const dir = await outDir();
    const f = file('plain.ts', 30, [blk({ type: 'function', name: 'plain' })], false);
    const written = await generateDocumentation([f], health(95, [], []), md(dir, { generateTOC: false, includeSource: false }));
    const readme = await readFile(written[0], 'utf-8');
    expect(readme).not.toContain('Table of Contents');
    const fileDoc = await readFile(written.find(p => p.includes('plain'))!, 'utf-8');
    expect(fileDoc).toContain('No documentation found');
    expect(fileDoc).not.toContain('Source Code');
    const healthDoc = await readFile(written.find(p => p.endsWith('HEALTH.md'))!, 'utf-8');
    expect(healthDoc).toContain('No issues found');
    expect(healthDoc).toContain('Grade: A');
    expect(healthDoc).toContain('No suggestions');
  });

  it.each([[75, 'Grade: C'], [65, 'Grade: D'], [55, 'Grade: F']])('renders grade for score %i', async (score, grade) => {
    const dir = await outDir();
    const f = file('g.ts', 30, [blk({ type: 'function', name: 'g' })], false);
    const written = await generateDocumentation([f], health(score, [], []), md(dir, {}));
    const healthDoc = await readFile(written.find(p => p.endsWith('HEALTH.md'))!, 'utf-8');
    expect(healthDoc).toContain(grade);
  });
});

describe('generateDocumentation json + html', () => {
  it('writes JSON', async () => {
    const dir = await outDir();
    const written = await generateDocumentation([file('a.ts', 50, [blk({ type: 'function', name: 'fn', parameters: [{ name: 'p' }], returnType: 'void', complexity: 2, documentation: 'd' })], true)], health(70, [], []), { outputDir: dir, format: 'json', generateTOC: false, includeSource: false });
    const json = JSON.parse(await readFile(written[0], 'utf-8'));
    expect(json.files[0].blocks[0].documented).toBe(true);
  });

  it('writes HTML with issues', async () => {
    const dir = await outDir();
    const issues: HealthIssue[] = [{ severity: 'error', message: 'm', rule: 'r', file: 'a.ts', line: 2 }];
    const written = await generateDocumentation([file('a.ts', 50, [blk({ type: 'class', name: 'C' })], true)], health(50, issues, []), { outputDir: dir, format: 'html', generateTOC: false, includeSource: false });
    const html = await readFile(written[0], 'utf-8');
    expect(html).toContain('<h2>Issues</h2>');
  });

  it('writes HTML without issues', async () => {
    const dir = await outDir();
    const written = await generateDocumentation([file('a.ts', 50, [blk({ type: 'function', name: 'fn' })], true)], health(50, [], []), { outputDir: dir, format: 'html', generateTOC: false, includeSource: false });
    const html = await readFile(written[0], 'utf-8');
    expect(html).not.toContain('<h2>Issues</h2>');
  });
});
