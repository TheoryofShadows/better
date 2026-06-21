/**
 * Covers ParseAgent block/summary issue branches and the BlockAnalyzer pattern,
 * issue and suggestion detection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ParseAgent, BlockAnalyzer } from '../agents/parse-agent.js';

describe('ParseAgent', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parse-'));
    const ifs = Array.from({ length: 25 }, (_, i) => `      if (a${i}) { b(); }`).join('\n');
    const pad = Array.from({ length: 110 }, (_, i) => `      // line ${i}`).join('\n');
    await writeFile(join(dir, 'big.ts'), `export class BigClass {\n  run() {\n${ifs}\n${pad}\n  }\n}\n`);
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('summarizes blocks with complexity/doc/length issues and counts classes', async () => {
    const r = await new ParseAgent().run({ patterns: ['**/*.ts'], exclude: [], basePath: dir });
    expect(r.success).toBe(true);
    expect(r.data!.summary.totalClasses).toBeGreaterThanOrEqual(1);
    expect(r.data!.summary.undocumentedCount).toBeGreaterThanOrEqual(1);
    expect(r.data!.summary.highComplexityCount).toBeGreaterThanOrEqual(1);
    const cls = r.data!.codeBlocks.find(b => b.name === 'BigClass')!;
    expect(cls.issues.some(i => i.includes('Missing documentation'))).toBe(true);
    expect(cls.issues.some(i => i.includes('High complexity'))).toBe(true);
    expect(cls.issues.some(i => i.includes('Long function'))).toBe(true);
  });
});

describe('BlockAnalyzer', () => {
  it('detects patterns, issues and suggestions in dense code', async () => {
    const ifs = Array.from({ length: 25 }, (_, i) => `  if (a${i}) { b(); }`).join('\n');
    const code = [
      "import x from 'y';",
      'export const z = 1;',
      'interface I { id: string }',
      '@Component()',
      'class Widget {',
      '  async run() {',
      '    await fetch("/api");',
      '    try { db.query("SELECT 1"); } catch (e) { console.log(e); }',
      '    for (const i of items) { i.forEach(() => {}); }',
      '    const t = new Thing();',
      '    el.addEventListener("click", () => {});',
      '    const [s, setS] = useState(0);',
      '    const j = JSON.parse("{}");',
      '    const c = cache.get(1);',
      '    validate(s);',
      '    logger.info("hi");',
      '    it("works", () => expect(1).toBe(1));',
      '    const magic = 100 + 200 + 300 + 400;',
      '              deeplyNested();',
      '    const long = "' + 'x'.repeat(130) + '";',
      '    // TODO: finish this',
      ifs,
      '    return j;',
      '  }',
      '}'
    ].join('\n');
    const r = await new BlockAnalyzer().run({ code, language: 'typescript' });
    expect(r.success).toBe(true);
    expect(r.data!.patterns.length).toBeGreaterThan(8);
    expect(r.data!.issues).toEqual(expect.arrayContaining(['Very high cyclomatic complexity', 'Deep nesting detected', 'Multiple magic numbers detected', 'Debug statements present', 'Incomplete work markers found']));
    expect(r.data!.issues.some(i => i.includes('exceed 120 characters'))).toBe(true);
    expect(r.data!.suggestions).toEqual(expect.arrayContaining(['Extract magic numbers into named constants', 'Remove or replace console.log with proper logging']));
  });

  it('flags merely-high (not very high) complexity', async () => {
    const ifs = Array.from({ length: 17 }, (_, i) => `if (a${i}) { b(); }`).join('\n');
    const r = await new BlockAnalyzer().run({ code: ifs, language: 'typescript' });
    expect(r.data!.issues).toContain('High cyclomatic complexity');
  });

  it('returns no issues for clean code', async () => {
    const r = await new BlockAnalyzer().run({ code: 'const x = 1;', language: 'typescript' });
    expect(r.data!.issues).toHaveLength(0);
    expect(r.data!.suggestions).toHaveLength(0);
  });
});
