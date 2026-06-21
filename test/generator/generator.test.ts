/**
 * Documentation generator tests — exercises the real generateDocumentation
 * across all three output formats, writing into a temp directory.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { generateDocumentation } from '../../src/generator/index.js';
import type { ParsedFile, HealthScore } from '../../src/types.js';
import { mkdtemp, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const file: ParsedFile = {
  info: { path: 'a.ts', relativePath: 'a.ts', extension: '.ts', language: 'typescript', size: 50, lines: 5 },
  blocks: [{ type: 'function', name: 'doThing', startLine: 1, endLine: 3, content: 'function doThing() { return 1; }', complexity: 2, parameters: [] }],
  imports: [{ source: './b', items: ['b'], isDefault: false, line: 1 }],
  exports: [{ name: 'doThing', type: 'named', line: 1 }],
  rawContent: 'function doThing() { return 1; }'
};

const health: HealthScore = {
  overall: 72,
  categories: { documentation: 60, complexity: 80, structure: 75, maintainability: 73 },
  issues: [{ severity: 'warning', message: 'Add docs', file: 'a.ts', line: 1, rule: 'doc' }],
  suggestions: ['Document doThing']
};

const dirs: string[] = [];
async function outDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'docu-gen-'));
  dirs.push(d);
  return d;
}
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

describe('generateDocumentation', () => {
  it('generates markdown documentation files', async () => {
    const dir = await outDir();
    const written = await generateDocumentation([file], health, { outputDir: dir, format: 'markdown', generateTOC: true, includeSource: false, projectName: 'Demo' });
    expect(written.length).toBeGreaterThan(0);
    await access(written[0]);
  });

  it('generates JSON documentation', async () => {
    const dir = await outDir();
    const written = await generateDocumentation([file], health, { outputDir: dir, format: 'json', generateTOC: false, includeSource: false });
    expect(written.length).toBeGreaterThan(0);
    await access(written[0]);
  });

  it('generates HTML documentation', async () => {
    const dir = await outDir();
    const written = await generateDocumentation([file], health, { outputDir: dir, format: 'html', generateTOC: true, includeSource: true });
    expect(written.length).toBeGreaterThan(0);
    await access(written[0]);
  });
});
