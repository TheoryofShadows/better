/**
 * Covers the AI (API-key) branches of ExplainAgent, ChatAgent, FixAgent and
 * VisionAgent using a mocked Anthropic SDK — both the success paths and the
 * error-fallback-to-heuristic paths.
 */

import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create }; }
}));

import { ExplainAgent, ChatAgent } from '../agents/explain-agent.js';
import { FixAgent } from '../agents/fix-agent.js';
import { PredictAgent } from '../agents/predict-agent.js';
import { VisionAgent } from '../agents/vision-agent.js';
import { DEFAULT_AGENT_CONFIG } from '../agents/index.js';
import type { ParsedFile, Language } from '../types.js';
import type { AgentContext } from '../agents/types.js';

const SUPERSET = JSON.stringify({
  summary: 's', purpose: 'p', patterns: ['Pattern'], suggestions: ['Improve'],
  type: 'architecture', description: 'A diagram',
  elements: [{ name: 'UserService', type: 'class', connections: ['DB'] }]
});

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

function fileOf(language: Language, name: string, content: string): ParsedFile {
  return {
    info: { path: `${name}`, relativePath: name, extension: '.' + name.split('.').pop(), language, size: content.length, lines: content.split('\n').length },
    blocks: [{ type: 'function', name: 'doThing', startLine: 1, endLine: 2, content, complexity: 18, parameters: [{ name: 'a', type: 'string' }], returnType: 'void' }],
    imports: [{ source: 'react', items: ['x'], isDefault: false, line: 1 }],
    exports: [{ name: 'doThing', type: 'named', line: 1 }],
    rawContent: content
  };
}

const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
afterAll(() => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});
beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue(textResponse(SUPERSET));
});

const tsFiles: ParsedFile[] = [fileOf('typescript', 'service.ts', 'function doThing(a){ console.log(a); var b = a == 1; }')];
const ctx = { files: tsFiles, basePath: '/p' };
const agentContext: AgentContext = { workingDir: '/p', files: tsFiles, config: DEFAULT_AGENT_CONFIG };

describe('ExplainAgent AI paths', () => {
  it('explains a file via the model', async () => {
    const agent = new ExplainAgent();
    agent.setContext(agentContext);
    const r = await agent.run({ type: 'file', target: 'service.ts', context: ctx, depth: 'normal' });
    expect(r.success).toBe(true);
    expect(r.data!.explanation.summary).toBe('s');
  });

  it('explains a block via the model', async () => {
    const agent = new ExplainAgent();
    agent.setContext(agentContext);
    const r = await agent.run({ type: 'block', target: 'doThing', context: ctx });
    expect(r.data!.explanation.purpose).toBe('p');
  });

  it('answers a generic query via the model', async () => {
    const agent = new ExplainAgent();
    agent.setContext(agentContext);
    const r = await agent.run({ type: 'query', target: 'how does the service work', context: ctx });
    expect(r.success).toBe(true);
  });

  it('falls back to heuristic when the model errors', async () => {
    create.mockRejectedValue(new Error('boom'));
    const agent = new ExplainAgent();
    agent.setContext(agentContext);
    const file = await agent.run({ type: 'file', target: 'service.ts', context: ctx });
    const block = await agent.run({ type: 'block', target: 'doThing', context: ctx });
    const query = await agent.run({ type: 'query', target: 'anything generic', context: ctx });
    expect(file.success && block.success && query.success).toBe(true);
  });
});

describe('ChatAgent AI paths', () => {
  it('answers conversationally via the model', async () => {
    const agent = new ChatAgent();
    agent.setContext(agentContext);
    const r = await agent.run({ role: 'user', content: 'tell me about this repo', timestamp: new Date() });
    expect(r.data!.content).toBe(SUPERSET);
  });

  it('falls back to heuristic when the model errors', async () => {
    create.mockRejectedValue(new Error('boom'));
    const agent = new ChatAgent();
    agent.setContext(agentContext);
    const r = await agent.run({ role: 'user', content: 'explain something', timestamp: new Date() });
    expect(r.success).toBe(true);
  });

  it('serves local commands without the model', async () => {
    const agent = new ChatAgent();
    agent.setContext(agentContext);
    expect((await agent.run({ role: 'user', content: 'help', timestamp: new Date() })).data!.content).toContain('DocuMate');
    expect((await agent.run({ role: 'user', content: 'list files', timestamp: new Date() })).data!.content).toContain('Analyzed Files');
  });
});

describe('FixAgent AI doc generation', () => {
  const langFiles: ParsedFile[] = [
    fileOf('typescript', 'a.ts', 'function doThing(a){}'),
    fileOf('python', 'b.py', 'def do_thing(a): pass'),
    fileOf('java', 'C.java', 'void doThing(String a){}'),
    fileOf('go', 'd.go', 'func DoThing(a string){}'),
    fileOf('ruby', 'e.rb', 'def do_thing(a); end')
  ];

  it('generates documentation suggestions across languages', async () => {
    const agent = new FixAgent();
    const r = await agent.run({ files: langFiles, basePath: process.cwd(), fixes: ['all'], dryRun: true });
    expect(r.success).toBe(true);
    expect(r.data!.suggestions.some(s => s.type === 'documentation')).toBe(true);
  });

  it('strips markdown fences from the model output', async () => {
    create.mockResolvedValue(textResponse('```ts\n/** hi */\n```'));
    const agent = new FixAgent();
    const r = await agent.run({ files: [fileOf('typescript', 'a.ts', 'function doThing(a){}')], basePath: process.cwd(), fixes: ['documentation'], dryRun: true });
    const doc = r.data!.suggestions.find(s => s.type === 'documentation');
    expect(doc!.suggestedCode).not.toContain('```');
  });

  it('falls back to heuristic doc generation on error', async () => {
    create.mockRejectedValue(new Error('boom'));
    const agent = new FixAgent();
    const r = await agent.run({ files: [fileOf('typescript', 'a.ts', 'function doThing(a){}')], basePath: process.cwd(), fixes: ['documentation'], dryRun: true });
    expect(r.data!.suggestions.some(s => s.type === 'documentation')).toBe(true);
  });
});

describe('VisionAgent AI path', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vis-'));
    await writeFile(join(dir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(dir, 'shapes.svg'), '<svg><text>UserService</text></svg>');
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const visionFiles: ParsedFile[] = [{
    info: { path: 'svc.ts', relativePath: 'svc.ts', extension: '.ts', language: 'typescript', size: 10, lines: 1 },
    blocks: [{ type: 'class', name: 'UserService', startLine: 1, endLine: 1, content: '' }],
    imports: [], exports: [], rawContent: ''
  }];

  it('analyzes a raster image via the model', async () => {
    const agent = new VisionAgent();
    agent.setContext(agentContext);
    const r = await agent.run({ filePath: join(dir, 'diagram.png'), context: { files: visionFiles, basePath: dir } });
    const img = r.data!.images.find(i => i.path.endsWith('diagram.png'));
    expect(img!.description).toBe('A diagram');
    expect(img!.elements.some(e => e.name === 'UserService')).toBe(true);
  });

  it('uses the heuristic for SVG and on model error', async () => {
    const agent = new VisionAgent();
    agent.setContext(agentContext);
    const svg = await agent.run({ filePath: join(dir, 'shapes.svg'), context: { files: visionFiles, basePath: dir } });
    expect(svg.success).toBe(true);

    create.mockRejectedValue(new Error('boom'));
    const png = await agent.run({ filePath: join(dir, 'diagram.png'), context: { files: visionFiles, basePath: dir } });
    expect(png.success).toBe(true);
  });

  it('falls back to heuristic on a non-Error rejection', async () => {
    const agent = new VisionAgent();
    agent.setContext(agentContext);
    create.mockRejectedValue('string failure');
    const png = await agent.run({ filePath: join(dir, 'diagram.png'), context: { files: visionFiles, basePath: dir } });
    expect(png.success).toBe(true);
  });
});

describe('AI sub-branches', () => {
  beforeEach(() => { create.mockReset(); create.mockResolvedValue(textResponse(SUPERSET)); });

  it('explains across depths and drops empty AI suggestions', async () => {
    const a = new ExplainAgent();
    a.setContext(agentContext);
    expect((await a.run({ type: 'file', target: 'service.ts', context: ctx, depth: 'shallow' })).success).toBe(true);
    expect((await a.run({ type: 'file', target: 'service.ts', context: ctx, depth: 'deep' })).success).toBe(true);
    create.mockResolvedValue(textResponse(JSON.stringify({ summary: 's', purpose: 'p', patterns: [], suggestions: [] })));
    const r = await a.run({ type: 'file', target: 'service.ts', context: ctx });
    expect(r.data!.explanation.suggestions).toBeUndefined();
  });

  it('falls back when explain file/block reject with non-Error values', async () => {
    const a = new ExplainAgent();
    a.setContext(agentContext);
    create.mockRejectedValue('string failure');
    expect((await a.run({ type: 'file', target: 'service.ts', context: ctx })).success).toBe(true);
    expect((await a.run({ type: 'block', target: 'doThing', context: ctx })).success).toBe(true);
  });

  it('answers a generic query via the model and falls back on error', async () => {
    const a = new ExplainAgent();
    a.setContext(agentContext);
    create.mockResolvedValue(textResponse('AI answer'));
    expect((await a.run({ type: 'query', target: 'overall purpose of the project', context: ctx })).data!.explanation.summary).toBe('AI answer');
    create.mockRejectedValue('boom');
    expect((await a.run({ type: 'query', target: 'overall purpose of the project', context: ctx })).success).toBe(true);
  });

  it('summarizes a large codebase for chat and tolerates non-Error errors', async () => {
    const many = Array.from({ length: 81 }, (_, i) => fileOf('typescript', `f${i}.ts`, 'function g(){}'));
    many[0].blocks = [{ type: 'variable', name: 'x', startLine: 1, endLine: 1, content: '' }];
    const a = new ChatAgent();
    a.setContext({ workingDir: '/p', files: many, config: DEFAULT_AGENT_CONFIG });
    create.mockResolvedValue(textResponse('chat answer'));
    expect((await a.run({ role: 'user', content: 'tell me', timestamp: new Date() })).data!.content).toBe('chat answer');
    create.mockRejectedValue('str');
    expect((await a.run({ role: 'user', content: 'tell me more', timestamp: new Date() })).success).toBe(true);
  });

  it('explains a symbol-less file and a complexity-less block via AI', async () => {
    const a = new ExplainAgent();
    a.setContext(agentContext);
    const noBlocks: ParsedFile = {
      info: { path: 'empty.ts', relativePath: 'empty.ts', extension: '.ts', language: 'typescript', size: 1, lines: 1 },
      blocks: [], imports: [], exports: [], rawContent: ''
    };
    create.mockResolvedValue(textResponse(SUPERSET));
    expect((await a.run({ type: 'file', target: 'empty.ts', context: { files: [noBlocks], basePath: '/p' } })).success).toBe(true);

    const f = fileOf('typescript', 'b.ts', 'function doThing(a){}');
    f.blocks[0].complexity = undefined;
    create.mockResolvedValue(textResponse(JSON.stringify({ summary: 's', purpose: 'p', patterns: [], suggestions: [] })));
    const r = await a.run({ type: 'block', target: 'doThing', context: { files: [f], basePath: '/p' } });
    expect(r.data!.explanation.suggestions).toBeUndefined();
  });

  it('falls back for fix and predict on non-Error rejections', async () => {
    create.mockRejectedValue('str-error');
    const fr = await new FixAgent().run({ files: [fileOf('typescript', 'a.ts', 'function doThing(a){}')], basePath: process.cwd(), fixes: ['documentation'], dryRun: true });
    expect(fr.data!.suggestions.some(s => s.type === 'documentation')).toBe(true);
    const pr = await new PredictAgent().run({ files: [fileOf('typescript', 'a.ts', 'function doThing(a){}')], basePath: process.cwd(), lookbackDays: 3650 });
    expect(pr.success).toBe(true);
  });
});
