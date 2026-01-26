/**
 * VisionAgent Tests
 * Tests multi-modal image and diagram analysis
 */

import { VisionAgent, DiagramParser } from '../../src/agents/vision-agent.js';
import type { ParsedFile, CodeBlock } from '../../src/types.js';

describe('VisionAgent', () => {
  let agent: VisionAgent;

  beforeEach(() => {
    agent = new VisionAgent();
  });

  describe('execute', () => {
    it('should analyze images in a directory', async () => {
      const input = {
        context: {
          files: createMockFiles(),
          basePath: '/mock/project'
        }
      };

      const result = await agent.run(input);

      expect(result).toHaveProperty('images');
      expect(result).toHaveProperty('codeLinks');
      expect(result).toHaveProperty('summary');
      expect(Array.isArray(result.images)).toBe(true);
    });

    it('should return empty results when no images found', async () => {
      const input = {
        context: {
          files: [],
          basePath: '/nonexistent/path'
        }
      };

      const result = await agent.run(input);

      expect(result.images).toHaveLength(0);
      expect(result.summary).toContain('No visual documentation found');
    });
  });

  describe('image type inference', () => {
    it('should infer architecture type from filename', () => {
      const agent = new VisionAgent();
      // Access private method through any cast for testing
      const inferType = (agent as any).inferImageType.bind(agent);

      expect(inferType('system-architecture.png')).toBe('architecture');
      expect(inferType('arch-overview.svg')).toBe('architecture');
    });

    it('should infer flowchart type from filename', () => {
      const inferType = (new VisionAgent() as any).inferImageType.bind(new VisionAgent());

      expect(inferType('user-flow.png')).toBe('flowchart');
      expect(inferType('process-workflow.svg')).toBe('flowchart');
      expect(inferType('sequence-diagram.png')).toBe('flowchart');
    });

    it('should infer diagram type from filename', () => {
      const inferType = (new VisionAgent() as any).inferImageType.bind(new VisionAgent());

      expect(inferType('class-diagram.png')).toBe('diagram');
      expect(inferType('uml-diagram.svg')).toBe('diagram');
      expect(inferType('entity-relationship.png')).toBe('diagram');
    });

    it('should infer screenshot type from filename', () => {
      const inferType = (new VisionAgent() as any).inferImageType.bind(new VisionAgent());

      expect(inferType('ui-screenshot.png')).toBe('screenshot');
      expect(inferType('interface-preview.jpg')).toBe('screenshot');
    });

    it('should return unknown for unrecognized patterns', () => {
      const inferType = (new VisionAgent() as any).inferImageType.bind(new VisionAgent());

      expect(inferType('random-image.png')).toBe('unknown');
      expect(inferType('photo123.jpg')).toBe('unknown');
    });
  });

  describe('code linking', () => {
    it('should find code links with high confidence for exact matches', () => {
      const findLinks = (new VisionAgent() as any).findCodeLinks.bind(new VisionAgent());
      const image = {
        path: '/test/diagram.png',
        type: 'diagram' as const,
        elements: [{ name: 'UserService', type: 'class' as const, connections: [] }],
        description: 'Test diagram',
        relatedFiles: []
      };
      const files = createMockFiles();

      const links = findLinks(image, files);

      expect(links.length).toBeGreaterThan(0);
      const exactMatch = links.find((l: any) => l.codeBlock === 'UserService');
      expect(exactMatch?.confidence).toBe(0.85);
    });

    it('should find partial matches with lower confidence', () => {
      const findLinks = (new VisionAgent() as any).findCodeLinks.bind(new VisionAgent());
      const image = {
        path: '/test/diagram.png',
        type: 'diagram' as const,
        elements: [{ name: 'User', type: 'class' as const, connections: [] }],
        description: 'Test diagram',
        relatedFiles: []
      };
      const files = createMockFiles();

      const links = findLinks(image, files);

      const partialMatch = links.find((l: any) => l.codeBlock.includes('User') && l.confidence < 0.85);
      expect(partialMatch).toBeDefined();
    });
  });

  describe('summary generation', () => {
    it('should generate summary with type counts', () => {
      const generateSummary = (new VisionAgent() as any).generateSummary.bind(new VisionAgent());
      const images = [
        { path: '/a.png', type: 'architecture', elements: [], description: '', relatedFiles: [] },
        { path: '/b.png', type: 'architecture', elements: [], description: '', relatedFiles: [] },
        { path: '/c.png', type: 'flowchart', elements: [], description: '', relatedFiles: [] }
      ];

      const summary = generateSummary(images, []);

      expect(summary).toContain('3 visual documentation files');
      expect(summary).toContain('2 architecture images');
      expect(summary).toContain('1 flowchart images');
    });

    it('should include high-confidence links in summary', () => {
      const generateSummary = (new VisionAgent() as any).generateSummary.bind(new VisionAgent());
      const images = [{ path: '/a.png', type: 'diagram', elements: [], description: '', relatedFiles: [] }];
      const links = [
        { imageElement: 'UserService', codeFile: 'src/user.ts', codeBlock: 'UserService', confidence: 0.85 }
      ];

      const summary = generateSummary(images, links);

      expect(summary).toContain('High-confidence matches');
      expect(summary).toContain('UserService');
    });
  });
});

describe('DiagramParser', () => {
  let parser: DiagramParser;

  beforeEach(() => {
    parser = new DiagramParser();
  });

  describe('parseSVG', () => {
    it('should extract text elements from SVG', async () => {
      const svg = `
        <svg>
          <text>UserService</text>
          <text>OrderService</text>
        </svg>
      `;

      const elements = await parser.parseSVG(svg);

      expect(elements.length).toBe(2);
      expect(elements[0].name).toBe('UserService');
      expect(elements[0].type).toBe('text');
    });

    it('should extract shape elements with IDs', async () => {
      const svg = `
        <svg>
          <rect id="user-component" />
          <circle id="database" />
        </svg>
      `;

      const elements = await parser.parseSVG(svg);

      expect(elements.some(e => e.name === 'user-component')).toBe(true);
      expect(elements.some(e => e.name === 'database')).toBe(true);
    });

    it('should ignore short text and numbers', async () => {
      const svg = `
        <svg>
          <text>A</text>
          <text>123</text>
          <text>ValidName</text>
        </svg>
      `;

      const elements = await parser.parseSVG(svg);

      expect(elements.length).toBe(1);
      expect(elements[0].name).toBe('ValidName');
    });
  });

  describe('inferFromFilename', () => {
    it('should infer class diagram structure', () => {
      const result = parser.inferFromFilename('class-diagram.png');

      expect(result.type).toBe('diagram');
      expect(result.elements?.map(e => e.name)).toContain('Class');
      expect(result.elements?.map(e => e.name)).toContain('Interface');
    });

    it('should infer sequence diagram structure', () => {
      const result = parser.inferFromFilename('sequence_diagram.svg');

      expect(result.type).toBe('flowchart');
      expect(result.elements?.map(e => e.name)).toContain('Actor');
      expect(result.elements?.map(e => e.name)).toContain('Message');
    });

    it('should infer component diagram structure', () => {
      const result = parser.inferFromFilename('component-diagram.png');

      expect(result.type).toBe('architecture');
      expect(result.elements?.map(e => e.name)).toContain('Component');
    });

    it('should infer ERD structure', () => {
      const result = parser.inferFromFilename('erd.png');

      expect(result.type).toBe('diagram');
      expect(result.elements?.map(e => e.name)).toContain('Entity');
    });

    it('should return unknown for unrecognized patterns', () => {
      const result = parser.inferFromFilename('random-image.png');

      expect(result.type).toBe('unknown');
      expect(result.elements).toHaveLength(0);
    });
  });
});

// Helper functions

function createMockFiles(): ParsedFile[] {
  const mockBlock: CodeBlock = {
    type: 'class',
    name: 'UserService',
    startLine: 1,
    endLine: 50,
    content: 'class UserService { ... }',
    documentation: 'User service class'
  };

  return [
    {
      info: {
        path: '/mock/src/user-service.ts',
        relativePath: 'src/user-service.ts',
        extension: '.ts',
        language: 'typescript',
        size: 1000,
        lines: 50
      },
      blocks: [mockBlock],
      imports: [],
      exports: [],
      rawContent: 'class UserService { ... }'
    }
  ];
}
