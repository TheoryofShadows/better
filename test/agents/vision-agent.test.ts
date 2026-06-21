/**
 * VisionAgent tests — heuristic (no API key) path and the DiagramParser.
 * run() returns AgentResult<VisionOutput>, so output is under result.data.
 * Private heuristics are exercised directly to keep the fallback path covered.
 */

import { describe, it, expect } from 'vitest';
import { VisionAgent, DiagramParser } from '../../src/agents/vision-agent.js';
import type { ParsedFile } from '../../src/types.js';

function fileWithBlock(name: string): ParsedFile {
  return {
    info: { path: `${name}.ts`, relativePath: `${name}.ts`, extension: '.ts', language: 'typescript', size: 10, lines: 1 },
    blocks: [{ type: 'class', name, startLine: 1, endLine: 1, content: '' }],
    imports: [],
    exports: [],
    rawContent: ''
  };
}

describe('VisionAgent', () => {
  describe('execute', () => {
    it('returns empty analysis when no images are found', async () => {
      const agent = new VisionAgent();
      const result = await agent.run({ directory: '/nonexistent-xyz', context: { files: [], basePath: '/nonexistent-xyz' } });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data!.images)).toBe(true);
      expect(result.data!.images).toHaveLength(0);
      expect(result.data!.summary).toContain('No visual documentation found');
    });
  });

  describe('image type inference (heuristic)', () => {
    const infer = (name: string) => (new VisionAgent() as any).inferImageType(name);

    it('infers architecture', () => { expect(infer('system-architecture.png')).toBe('architecture'); });
    it('infers flowchart', () => { expect(infer('user-flow.png')).toBe('flowchart'); });
    it('infers diagram', () => { expect(infer('class-diagram.png')).toBe('diagram'); });
    it('infers screenshot', () => { expect(infer('login-screenshot.png')).toBe('screenshot'); });
    it('returns unknown for unrecognized names', () => { expect(infer('photo.png')).toBe('unknown'); });
  });

  describe('code linking (heuristic)', () => {
    it('links a diagram element to a matching code block with high confidence', () => {
      const agent = new VisionAgent() as any;
      const image = {
        path: 'x.png',
        type: 'diagram' as const,
        elements: [{ name: 'UserService', type: 'class' as const, connections: [] }],
        description: '',
        relatedFiles: []
      };
      const links = agent.findCodeLinks(image, [fileWithBlock('UserService')]);
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].confidence).toBe(0.85);
    });
  });
});

describe('DiagramParser', () => {
  const parser = new DiagramParser();

  describe('parseSVG', () => {
    it('extracts text elements and ignores bare numbers', async () => {
      const elements = await parser.parseSVG('<svg><text>UserService</text><text>5</text></svg>');
      expect(elements.some(e => e.name === 'UserService' && e.type === 'text')).toBe(true);
      expect(elements.some(e => e.name === '5')).toBe(false);
    });

    it('extracts shape elements with ids', async () => {
      const elements = await parser.parseSVG('<svg><rect id="AuthModule" /></svg>');
      expect(elements.some(e => e.name === 'AuthModule' && e.type === 'component')).toBe(true);
    });
  });

  describe('inferFromFilename', () => {
    it('infers a class diagram', () => { expect(parser.inferFromFilename('class-diagram.png').type).toBe('diagram'); });
    it('infers a sequence diagram', () => { expect(parser.inferFromFilename('sequence_diagram.svg').type).toBe('flowchart'); });
    it('returns unknown for unrecognized names', () => { expect(parser.inferFromFilename('photo.png').type).toBe('unknown'); });
  });
});
