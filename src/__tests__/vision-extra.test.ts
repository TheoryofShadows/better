/**
 * Covers the VisionAgent heuristic discovery/analysis pipeline (directory
 * recursion, common-dir scanning, element extraction, code linking, summary)
 * and the DiagramParser SVG/filename helpers — all offline (no API key).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { VisionAgent, DiagramParser } from '../agents/vision-agent.js';
import type { ParsedFile, CodeBlock, Language } from '../types.js';

const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
afterAll(() => { if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey; });

function fileWith(relativePath: string, blocks: CodeBlock[], language: Language = 'typescript'): ParsedFile {
  return {
    info: { path: relativePath, relativePath, extension: '.ts', language, size: 10, lines: 5 },
    blocks, imports: [], exports: [], rawContent: ''
  };
}
const blk = (name: string, type: CodeBlock['type'] = 'function'): CodeBlock =>
  ({ type, name, startLine: 1, endLine: 1, content: '' });

describe('VisionAgent heuristic pipeline', () => {
  let base: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'vision-'));
    await mkdir(join(base, 'docs', 'sub'), { recursive: true });
    await mkdir(join(base, 'assets'), { recursive: true });
    const png = Buffer.from([0x89, 0x50]);
    await writeFile(join(base, 'docs', 'architecture-alpha-bravo-charlie-delta-echo-foxtrot-golf.png'), png);
    await writeFile(join(base, 'docs', 'class-diagram.png'), png);
    await writeFile(join(base, 'docs', 'random.png'), png);
    await writeFile(join(base, 'docs', 'sub', 'flow-process.svg'), '<svg></svg>');
    await writeFile(join(base, 'assets', 'ui-screenshot.png'), png);
  });
  afterAll(async () => { await rm(base, { recursive: true, force: true }); });

  const files: ParsedFile[] = [
    fileWith('docs.ts', [blk('docs')]),
    fileWith('alpha.ts', [blk('alpha', 'class')]),
    fileWith('bravo.ts', [blk('bravo', 'function')]),
    fileWith('charlie.ts', [blk('charlie', 'method')]),
    fileWith('delta.ts', [blk('delta', 'interface')]),
    fileWith('echo.ts', [blk('echo')]),
    fileWith('foxtrot.ts', [blk('foxtrot')]),
    fileWith('golf.ts', [blk('golf')]),
    fileWith('alphaHelper.ts', [blk('alphaHelper')])
  ];

  it('discovers, analyzes and links images across the tree', async () => {
    const bigImage = join(base, 'docs', 'architecture-alpha-bravo-charlie-delta-echo-foxtrot-golf.png');
    const r = await new VisionAgent().run({ directory: base, filePath: bigImage, context: { files, basePath: base } });
    expect(r.success).toBe(true);
    const big = r.data!.images.find(i => i.path === bigImage)!;
    expect(big.type).toBe('architecture');
    expect(big.elements.length).toBeGreaterThan(5);
    expect(big.description).toContain('more'); // >5 elements branch
    expect(big.relatedFiles.length).toBeGreaterThan(0);

    const types = [...new Set(r.data!.images.map(i => i.type))];
    expect(types).toEqual(expect.arrayContaining(['architecture', 'flowchart', 'diagram', 'screenshot', 'unknown']));

    // exact (0.85) and partial (0.6) code links both present
    expect(r.data!.codeLinks.some(l => l.confidence === 0.85)).toBe(true);
    expect(r.data!.codeLinks.some(l => l.confidence === 0.6)).toBe(true);
    expect(r.data!.summary).toContain('High-confidence matches');
  });

  it('summarizes the absence of images', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'vision-empty-'));
    try {
      const r = await new VisionAgent().run({ context: { files, basePath: empty } });
      expect(r.data!.summary).toContain('No visual documentation');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('DiagramParser', () => {
  it('parses SVG text, shapes and connections', async () => {
    const svg = `<svg>
      <text>UserService</text>
      <text>42</text>
      <text>X</text>
      <rect id="Database"/>
      <circle id="Cache"/>
      <path d="M0 0"/>
      <line x1="0"/>
    </svg>`;
    const elements = await new DiagramParser().parseSVG(svg);
    expect(elements.some(e => e.name === 'UserService' && e.type === 'text')).toBe(true);
    expect(elements.some(e => e.name === 'Database' && e.type === 'component')).toBe(true);
    expect(elements.some(e => e.connections.length > 0)).toBe(true); // path-inferred connections
    expect(elements.find(e => e.name === '42')).toBeUndefined(); // numeric skipped
  });

  it('infers structure from filename conventions', () => {
    const p = new DiagramParser();
    expect(p.inferFromFilename('class-diagram.svg').type).toBe('diagram');
    expect(p.inferFromFilename('sequence_diagram.png').type).toBe('flowchart');
    expect(p.inferFromFilename('component-diagram.svg').type).toBe('architecture');
    expect(p.inferFromFilename('data_flow.png').type).toBe('flowchart');
    expect(p.inferFromFilename('erd.png').type).toBe('diagram');
    expect(p.inferFromFilename('whatever.png').type).toBe('unknown');
  });
});
