/**
 * ExplainAgent heuristic-path tests (no API key) — covers the file/block
 * explanation depth variants and the query router fallbacks.
 */

import { describe, it, expect } from 'vitest';
import { ExplainAgent } from '../../src/agents/explain-agent.js';
import type { ParsedFile } from '../../src/types.js';

const files: ParsedFile[] = [
  {
    info: { path: 'service.ts', relativePath: 'service.ts', extension: '.ts', language: 'typescript', size: 200, lines: 40 },
    blocks: [
      { type: 'class', name: 'UserService', startLine: 1, endLine: 20, content: 'class UserService { async load() { for (;;) {} } }', complexity: 12 },
      { type: 'function', name: 'helper', startLine: 21, endLine: 25, content: 'function helper() {}', complexity: 2 }
    ],
    imports: [
      { source: 'react', items: ['useState'], isDefault: false, line: 1 },
      { source: './util', items: ['x'], isDefault: false, line: 2 }
    ],
    exports: [{ name: 'UserService', type: 'named', line: 1 }],
    rawContent: 'class UserService { async load() { for (;;) {} } }'
  },
  {
    info: { path: 'service.test.ts', relativePath: 'service.test.ts', extension: '.ts', language: 'typescript', size: 50, lines: 10 },
    blocks: [],
    imports: [],
    exports: [],
    rawContent: 'describe("x", () => {})'
  }
];

const ctx = { files, basePath: '/p' };
const run = (input: any) => new ExplainAgent().run(input);

describe('ExplainAgent (heuristic)', () => {
  it('explains a file at shallow depth', async () => {
    const r = await run({ type: 'file', target: 'service.ts', context: ctx, depth: 'shallow' });
    expect(r.success).toBe(true);
    expect(r.data!.explanation.summary).toBeTruthy();
  });

  it('explains a file at deep depth', async () => {
    const r = await run({ type: 'file', target: 'service.ts', context: ctx, depth: 'deep' });
    expect(r.success).toBe(true);
    expect(r.data!.explanation.dependencies).toContain('react');
  });

  it('explains a block', async () => {
    const r = await run({ type: 'block', target: 'UserService', context: ctx });
    expect(r.success).toBe(true);
    expect(r.data!.explanation.complexity.score).toBeGreaterThan(0);
  });

  it('answers a complexity query', async () => {
    const r = await run({ type: 'query', target: 'find complex code to refactor', context: ctx });
    expect(r.data!.explanation.summary.toLowerCase()).toContain('complex');
  });

  it('answers a documentation query', async () => {
    const r = await run({ type: 'query', target: 'show undocumented code', context: ctx });
    expect(r.success).toBe(true);
  });

  it('answers a dependency query', async () => {
    const r = await run({ type: 'query', target: 'what dependencies are imported', context: ctx });
    expect(r.data!.explanation.dependencies.length).toBeGreaterThan(0);
  });

  it('answers a test query', async () => {
    const r = await run({ type: 'query', target: 'where are the tests', context: ctx });
    expect(r.data!.explanation.summary.toLowerCase()).toContain('test');
  });

  it('answers a generic query', async () => {
    const r = await run({ type: 'query', target: 'UserService', context: ctx });
    expect(r.success).toBe(true);
  });
});
