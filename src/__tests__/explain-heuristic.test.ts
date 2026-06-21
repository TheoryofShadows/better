/**
 * Exercises the ExplainAgent and ChatAgent heuristic (no-key) paths: file/block/
 * line/query explanation across depths, every file-purpose and block-purpose
 * branch, pattern detection, related-code and follow-up generation, the query
 * router, and the ChatAgent local commands + heuristic responder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExplainAgent, ChatAgent } from '../agents/explain-agent.js';
import { DEFAULT_AGENT_CONFIG } from '../agents/index.js';
import type { ParsedFile, CodeBlock, Language, ImportInfo, ExportInfo } from '../types.js';
import type { AgentContext } from '../agents/types.js';

const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
afterAll(() => { if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey; });

function mkFile(relativePath: string, opts: Partial<{
  blocks: CodeBlock[]; imports: ImportInfo[]; exports: ExportInfo[]; rawContent: string; lines: number; language: Language;
}> = {}): ParsedFile {
  return {
    info: { path: relativePath, relativePath, extension: '.ts', language: opts.language ?? 'typescript', size: 100, lines: opts.lines ?? 10 },
    blocks: opts.blocks ?? [],
    imports: opts.imports ?? [],
    exports: opts.exports ?? [],
    rawContent: opts.rawContent ?? ''
  };
}

const fn = (name: string, extra: Partial<CodeBlock> = {}): CodeBlock =>
  ({ type: 'function', name, startLine: 1, endLine: 2, content: `function ${name}(){}`, ...extra });

function agentFor(files: ParsedFile[]): ExplainAgent {
  const a = new ExplainAgent();
  const ctx: AgentContext = { workingDir: '/p', files, config: DEFAULT_AGENT_CONFIG };
  a.setContext(ctx);
  return a;
}

describe('ExplainAgent file explanation', () => {
  it('infers purpose from many filename conventions', async () => {
    const names: Array<[string, string]> = [
      ['user.test.ts', 'test cases'], ['util.ts', 'utility'], ['config.ts', 'configuration'],
      ['types.ts', 'type definitions'], ['Button.component.ts', 'UI component'], ['auth.service.ts', 'service layer'],
      ['home.controller.ts', 'request routing'], ['user.model.ts', 'data models'], ['useThing.hook.ts', 'custom hooks'],
      ['auth.middleware.ts', 'middleware'], ['app.router.ts', 'application routes'], ['client.api.ts', 'API endpoints'],
      ['app.store.ts', 'application state']
    ];
    for (const [name, expected] of names) {
      const f = mkFile(name, { blocks: [fn('x')] });
      const r = await agentFor([f]).run({ type: 'file', target: name, context: { files: [f], basePath: '/p' } });
      expect(r.data!.explanation.purpose.toLowerCase()).toContain(expected.toLowerCase());
    }
  });

  it('infers purpose from content shape', async () => {
    const single = mkFile('a.ts', { blocks: [{ type: 'class', name: 'Solo', startLine: 1, endLine: 2, content: '' }] });
    expect((await agentFor([single]).run({ type: 'file', target: 'a.ts', context: { files: [single], basePath: '/p' } })).data!.explanation.purpose).toContain('Solo class');

    const funcs = mkFile('b.ts', { blocks: [fn('f1'), fn('f2')] });
    expect((await agentFor([funcs]).run({ type: 'file', target: 'b.ts', context: { files: [funcs], basePath: '/p' } })).data!.explanation.purpose).toContain('collection of functions');

    const ifaces = mkFile('c.ts', { blocks: [{ type: 'interface', name: 'I', startLine: 1, endLine: 2, content: '' }] });
    expect((await agentFor([ifaces]).run({ type: 'file', target: 'c.ts', context: { files: [ifaces], basePath: '/p' } })).data!.explanation.purpose).toContain('interfaces and types');

    const def = mkFile('d.ts', { blocks: [{ type: 'class', name: 'A', startLine: 1, endLine: 2, content: '' }, { type: 'class', name: 'B', startLine: 1, endLine: 2, content: '' }], exports: [{ name: 'A', type: 'default', line: 1 }] });
    expect((await agentFor([def]).run({ type: 'file', target: 'd.ts', context: { files: [def], basePath: '/p' } })).data!.explanation.purpose).toContain('main functionality');

    const fallback = mkFile('e.ts', { blocks: [{ type: 'variable', name: 'v', startLine: 1, endLine: 2, content: '' }] });
    expect((await agentFor([fallback]).run({ type: 'file', target: 'e.ts', context: { files: [fallback], basePath: '/p' } })).data!.explanation.purpose).toContain('functionality for the application');
  });

  it('builds normal and deep summaries, patterns, suggestions and related code', async () => {
    const blocks: CodeBlock[] = [
      { type: 'class', name: 'Cls', startLine: 1, endLine: 5, content: 'x', complexity: 3, documentation: 'docs here', parameters: [{ name: 'a', type: 'string', optional: true }] },
      ...Array.from({ length: 16 }, (_, i) => fn('fn' + i, { complexity: i === 0 ? 25 : i === 1 ? 18 : i === 2 ? 13 : i === 3 ? 8 : 2 })),
      { type: 'interface', name: 'Iface', startLine: 1, endLine: 2, content: '' }
    ];
    const raw = 'async function x(){ try { await fetch("u"); JSON.parse("{}"); } catch(e){} } class A extends B implements C {} new Promise(()=>{}); process.env.X; EventEmitter; getInstance(); Factory(); obj.pipe(); useMemo(); arr.map(a=>a).filter(b=>b);';
    const fileA = mkFile('a.ts', { blocks, imports: [{ source: 'react', items: ['useState'], isDefault: false, line: 1 }, { source: './b', items: ['helper'], isDefault: false, line: 2 }], exports: [{ name: 'Cls', type: 'named', line: 1 }], rawContent: raw, lines: 350 });
    const fileB = mkFile('b.ts', { imports: [{ source: './a', items: ['Cls'], isDefault: false, line: 1 }] });
    const agent = agentFor([fileA, fileB]);

    const normal = await agent.run({ type: 'file', target: 'a.ts', context: { files: [fileA, fileB], basePath: '/p' }, depth: 'normal' });
    expect(normal.data!.explanation.summary).toContain('**Functions:**');
    expect(normal.data!.explanation.summary).toContain('+11 more');
    expect(normal.data!.explanation.patterns).toEqual(expect.arrayContaining(['Asynchronous Programming', 'Error Handling', 'Class Inheritance']));
    expect(normal.data!.explanation.suggestions!.length).toBeGreaterThanOrEqual(3);
    expect(normal.data!.relatedCode!.length).toBeGreaterThanOrEqual(1);
    expect(normal.data!.followUp!.length).toBeGreaterThan(0);

    const deep = await agent.run({ type: 'file', target: 'a.ts', context: { files: [fileA, fileB], basePath: '/p' }, depth: 'deep' });
    expect(deep.data!.explanation.summary).toContain('Detailed Analysis');

    const shallow = await agent.run({ type: 'file', target: 'a.ts', context: { files: [fileA, fileB], basePath: '/p' }, depth: 'shallow' });
    expect(shallow.data!.explanation.summary).toContain('code blocks');
  });

  it('throws when the file is missing', async () => {
    const r = await agentFor([]).run({ type: 'file', target: 'nope.ts', context: { files: [], basePath: '/p' } });
    expect(r.success).toBe(false);
    expect(r.error).toContain('File not found');
  });
});

describe('ExplainAgent block + line explanation', () => {
  const prefixes = ['getX', 'setX', 'isX', 'createX', 'deleteX', 'updateX', 'handleX', 'renderX', 'parseX', 'validateX', 'fetchX', 'saveX', 'plain'];
  it('infers block purpose for every prefix and renders depths', async () => {
    for (const name of prefixes) {
      const blk = fn(name, { complexity: 4, documentation: 'd', parameters: [{ name: 'p', type: 't', optional: true }], returnType: 'void' });
      const f = mkFile('a.ts', { blocks: [blk] });
      const agent = agentFor([f]);
      expect((await agent.run({ type: 'block', target: name, context: { files: [f], basePath: '/p' }, depth: 'normal' })).success).toBe(true);
      expect((await agent.run({ type: 'block', target: name, context: { files: [f], basePath: '/p' }, depth: 'shallow' })).data!.explanation.summary).toContain(name);
      expect((await agent.run({ type: 'block', target: name, context: { files: [f], basePath: '/p' }, depth: 'deep' })).data!.explanation.summary).toContain('Location');
    }
  });

  it('detects block patterns and dependencies', async () => {
    const helper = fn('helper');
    const main = fn('main', { content: 'async function main(){ try { for(const x of y){} if(a){}else{} arr.map(z=>z); return new Promise(()=>{}); throw new Error(); const t = a ? b : c; const n = a ?? b; Object.keys(o); helper(); useState(); } catch(e){} }' });
    const f = mkFile('a.ts', { blocks: [main, helper], imports: [{ source: 'react', items: ['useState'], isDefault: false, line: 1 }] });
    const r = await agentFor([f]).run({ type: 'block', target: 'main', context: { files: [f], basePath: '/p' }, depth: 'normal' });
    expect(r.data!.explanation.patterns).toEqual(expect.arrayContaining(['Async/Await', 'Error Handling', 'Iteration']));
    expect(r.data!.explanation.dependencies).toEqual(expect.arrayContaining(['helper']));
  });

  it('throws when the block is missing', async () => {
    const f = mkFile('a.ts', { blocks: [] });
    const r = await agentFor([f]).run({ type: 'block', target: 'ghost', context: { files: [f], basePath: '/p' } });
    expect(r.error).toContain('Block not found');
  });

  it('explains a line inside and outside a block, and errors on missing file', async () => {
    const f = mkFile('a.ts', { blocks: [fn('inside', { startLine: 1, endLine: 5, content: 'if(a){}else{}' })] });
    const agent = agentFor([f]);
    expect((await agent.run({ type: 'line', target: 'a.ts:3', context: { files: [f], basePath: '/p' } })).data!.explanation.summary).toContain("inside");
    expect((await agent.run({ type: 'line', target: 'a.ts:99', context: { files: [f], basePath: '/p' } })).data!.explanation.summary).toContain('outside');
    expect((await agent.run({ type: 'line', target: 'zzz.ts:1', context: { files: [f], basePath: '/p' } })).error).toContain('File not found');
  });

  it('rejects an unknown explanation type', async () => {
    const r = await agentFor([]).run({ type: 'bogus' as never, target: 'x', context: { files: [], basePath: '/p' } });
    expect(r.error).toContain('Unknown explanation type');
  });
});

describe('ExplainAgent query router', () => {
  const files = [
    mkFile('zebra.ts', { blocks: [fn('alpha', { complexity: 20, documentation: 'd' })] }),
    mkFile('plain.ts', { blocks: [fn('beta')], imports: [{ source: 'lodash', items: ['map'], isDefault: false, line: 1 }] })
  ];
  const ctx = { files, basePath: '/p' };
  const run = (q: string) => agentFor(files).run({ type: 'query', target: q, context: ctx });

  it('routes complexity, documentation, dependency and test queries', async () => {
    expect((await run('find complex code')).data!.explanation.purpose).toContain('Complexity');
    expect((await run('show undocumented')).data!.explanation.purpose).toContain('Documentation');
    expect((await run('what dependencies')).data!.explanation.purpose).toContain('Dependency');
    expect((await run('where are the tests')).data!.explanation.purpose).toContain('Test');
  });

  it('handles generic queries matching blocks, files, or nothing', async () => {
    expect((await run('beta thing')).data!.explanation.summary).toContain('relevant code blocks');
    expect((await run('zebra')).data!.explanation.summary).toContain('relevant files');
    expect((await run('xqzwv')).data!.explanation.summary).toContain('No directly relevant');
  });
});

describe('ChatAgent (no key)', () => {
  const files = Array.from({ length: 12 }, (_, i) => mkFile(`f${i}.ts`, { blocks: [fn('fn' + i)] }));
  const ctx: AgentContext = { workingDir: '/p', files, config: DEFAULT_AGENT_CONFIG };

  function chat(withContext = true): ChatAgent {
    const a = new ChatAgent();
    if (withContext) a.setContext(ctx);
    return a;
  }
  const msg = (content: string) => ({ role: 'user' as const, content, timestamp: new Date() });

  it('serves help and file listing locally', async () => {
    expect((await chat().run(msg('help'))).data!.content).toContain('DocuMate Chat Commands');
    const list = (await chat().run(msg('list files'))).data!.content;
    expect(list).toContain('Analyzed Files');
    expect(list).toContain('and 2 more');
  });

  it('answers explain-style questions via the heuristic responder', async () => {
    const r = await chat().run(msg('explain the codebase'));
    expect(r.data!.content.length).toBeGreaterThan(0);
  });

  it('returns a generic prompt for unrecognized input', async () => {
    const r = await chat().run(msg('good morning'));
    expect(r.data!.content).toContain('Try these commands');
  });

  it('reports missing context for explain queries without a loaded codebase', async () => {
    const r = await chat(false).run(msg('explain something'));
    expect(r.data!.content).toContain('No codebase context');
  });

  it('creates and retrieves sessions', () => {
    const a = chat();
    const id = a.createSession({ files, basePath: '/p' });
    expect(a.getSession(id)?.context.files.length).toBe(12);
  });

  it('reports no files when listing without context', async () => {
    const r = await chat(false).run(msg('list files'));
    expect(r.data!.content).toContain('No files loaded');
  });
});
