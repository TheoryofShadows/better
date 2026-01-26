/**
 * VisionAgent - Multi-Modal Analysis Agent
 * Parses images, diagrams, and visual documentation
 *
 * Few-shot example:
 * ```typescript
 * const visionAgent = new VisionAgent();
 * const result = await visionAgent.run({
 *   filePath: './docs/architecture.png',
 *   context: { files: parsedFiles }
 * });
 * // Returns: { elements: [...], codeLinks: [...], description: '...' }
 * ```
 */

import { BaseAgent } from './base.js';
import { readFile, access, readdir } from 'fs/promises';
import { extname, join, basename, dirname } from 'path';
import type { ParsedFile, CodeBlock } from '../types.js';

export interface VisionInput {
  filePath?: string;
  directory?: string;
  context: VisionContext;
}

export interface VisionContext {
  files: ParsedFile[];
  basePath: string;
}

export interface VisionOutput {
  images: ImageAnalysis[];
  codeLinks: CodeLink[];
  summary: string;
}

export interface ImageAnalysis {
  path: string;
  type: 'diagram' | 'screenshot' | 'flowchart' | 'architecture' | 'unknown';
  elements: DiagramElement[];
  description: string;
  relatedFiles: string[];
}

export interface DiagramElement {
  name: string;
  type: 'class' | 'function' | 'component' | 'service' | 'database' | 'arrow' | 'text';
  connections: string[];
  position?: { x: number; y: number };
}

export interface CodeLink {
  imageElement: string;
  codeFile: string;
  codeBlock: string;
  confidence: number;
}

const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.pdf'];

export class VisionAgent extends BaseAgent<VisionInput, VisionOutput> {
  constructor() {
    super('VisionAgent');
  }

  protected async execute(input: VisionInput): Promise<VisionOutput> {
    this.log('Starting multi-modal analysis');

    const images: ImageAnalysis[] = [];
    const codeLinks: CodeLink[] = [];

    // Find all images to process
    const imagePaths = await this.discoverImages(input);
    this.log(`Found ${imagePaths.length} images to analyze`);

    for (const imagePath of imagePaths) {
      try {
        const analysis = await this.analyzeImage(imagePath, input.context);
        images.push(analysis);

        // Find code links for diagram elements
        const links = this.findCodeLinks(analysis, input.context.files);
        codeLinks.push(...links);
      } catch (error) {
        this.log(`Warning: Could not analyze ${imagePath}: ${error}`);
      }
    }

    // Generate summary
    const summary = this.generateSummary(images, codeLinks);

    return {
      images,
      codeLinks,
      summary
    };
  }

  private async discoverImages(input: VisionInput): Promise<string[]> {
    const paths: string[] = [];

    if (input.filePath) {
      paths.push(input.filePath);
    }

    if (input.directory) {
      const files = await this.scanDirectory(input.directory);
      paths.push(...files);
    }

    // Also scan common documentation directories
    const commonDirs = ['docs', 'images', 'assets', 'diagrams', '.github'];
    for (const dir of commonDirs) {
      try {
        const dirPath = join(input.context.basePath, dir);
        await access(dirPath);
        const files = await this.scanDirectory(dirPath);
        paths.push(...files);
      } catch {
        // Directory doesn't exist, skip
      }
    }

    return [...new Set(paths)];
  }

  private async scanDirectory(dirPath: string): Promise<string[]> {
    const images: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const subImages = await this.scanDirectory(fullPath);
          images.push(...subImages);
        } else if (SUPPORTED_FORMATS.includes(extname(entry.name).toLowerCase())) {
          images.push(fullPath);
        }
      }
    } catch {
      // Directory not accessible
    }

    return images;
  }

  private async analyzeImage(
    imagePath: string,
    context: VisionContext
  ): Promise<ImageAnalysis> {
    const fileName = basename(imagePath).toLowerCase();
    const ext = extname(imagePath).toLowerCase();

    // Determine image type from filename patterns
    const type = this.inferImageType(fileName);

    // Extract elements based on filename and path heuristics
    const elements = this.extractElements(fileName, imagePath, context);

    // Find related files
    const relatedFiles = this.findRelatedFiles(elements, context.files);

    // Generate description
    const description = this.generateDescription(fileName, type, elements);

    return {
      path: imagePath,
      type,
      elements,
      description,
      relatedFiles
    };
  }

  private inferImageType(fileName: string): ImageAnalysis['type'] {
    const patterns: Array<{ pattern: RegExp; type: ImageAnalysis['type'] }> = [
      { pattern: /architect|arch|system|overview/i, type: 'architecture' },
      { pattern: /flow|process|workflow|sequence/i, type: 'flowchart' },
      { pattern: /diagram|uml|class|entity/i, type: 'diagram' },
      { pattern: /screen|ui|interface|screenshot/i, type: 'screenshot' }
    ];

    for (const { pattern, type } of patterns) {
      if (pattern.test(fileName)) {
        return type;
      }
    }

    return 'unknown';
  }

  private extractElements(
    fileName: string,
    filePath: string,
    context: VisionContext
  ): DiagramElement[] {
    const elements: DiagramElement[] = [];

    // Extract potential element names from filename
    const nameParts = fileName
      .replace(/\.[^.]+$/, '') // Remove extension
      .split(/[-_\s]+/) // Split on separators
      .filter(p => p.length > 2);

    for (const part of nameParts) {
      const matchingBlock = this.findMatchingCodeBlock(part, context.files);
      if (matchingBlock) {
        elements.push({
          name: matchingBlock.name,
          type: this.mapBlockType(matchingBlock.type),
          connections: []
        });
      }
    }

    // Try to match directory name to components
    const dirName = basename(dirname(filePath));
    const dirBlock = this.findMatchingCodeBlock(dirName, context.files);
    if (dirBlock) {
      elements.push({
        name: dirBlock.name,
        type: this.mapBlockType(dirBlock.type),
        connections: []
      });
    }

    return elements;
  }

  private mapBlockType(blockType: string): DiagramElement['type'] {
    switch (blockType) {
      case 'class': return 'class';
      case 'function':
      case 'method': return 'function';
      default: return 'component';
    }
  }

  private findMatchingCodeBlock(
    name: string,
    files: ParsedFile[]
  ): CodeBlock | undefined {
    const normalizedName = name.toLowerCase();

    for (const file of files) {
      for (const block of file.blocks) {
        if (block.name.toLowerCase().includes(normalizedName) ||
            normalizedName.includes(block.name.toLowerCase())) {
          return block;
        }
      }
    }

    return undefined;
  }

  private findRelatedFiles(
    elements: DiagramElement[],
    files: ParsedFile[]
  ): string[] {
    const related: string[] = [];

    for (const element of elements) {
      for (const file of files) {
        const hasMatch = file.blocks.some(b =>
          b.name.toLowerCase() === element.name.toLowerCase()
        );
        if (hasMatch && !related.includes(file.info.relativePath)) {
          related.push(file.info.relativePath);
        }
      }
    }

    return related;
  }

  private findCodeLinks(
    image: ImageAnalysis,
    files: ParsedFile[]
  ): CodeLink[] {
    const links: CodeLink[] = [];

    for (const element of image.elements) {
      for (const file of files) {
        for (const block of file.blocks) {
          if (block.name.toLowerCase() === element.name.toLowerCase()) {
            links.push({
              imageElement: element.name,
              codeFile: file.info.relativePath,
              codeBlock: block.name,
              confidence: 0.85
            });
          } else if (block.name.toLowerCase().includes(element.name.toLowerCase())) {
            links.push({
              imageElement: element.name,
              codeFile: file.info.relativePath,
              codeBlock: block.name,
              confidence: 0.6
            });
          }
        }
      }
    }

    return links;
  }

  private generateDescription(
    fileName: string,
    type: ImageAnalysis['type'],
    elements: DiagramElement[]
  ): string {
    const typeDescriptions: Record<ImageAnalysis['type'], string> = {
      architecture: 'System architecture diagram',
      flowchart: 'Process flow diagram',
      diagram: 'Technical diagram',
      screenshot: 'UI screenshot',
      unknown: 'Visual documentation'
    };

    let description = `${typeDescriptions[type]} from ${fileName}.`;

    if (elements.length > 0) {
      description += ` Contains ${elements.length} identifiable elements: `;
      description += elements.slice(0, 5).map(e => e.name).join(', ');
      if (elements.length > 5) {
        description += ` and ${elements.length - 5} more`;
      }
      description += '.';
    }

    return description;
  }

  private generateSummary(
    images: ImageAnalysis[],
    codeLinks: CodeLink[]
  ): string {
    if (images.length === 0) {
      return 'No visual documentation found in the codebase.';
    }

    const typeCounts = new Map<string, number>();
    for (const img of images) {
      typeCounts.set(img.type, (typeCounts.get(img.type) || 0) + 1);
    }

    let summary = `Found ${images.length} visual documentation files:\n`;

    for (const [type, count] of typeCounts) {
      summary += `- ${count} ${type} images\n`;
    }

    if (codeLinks.length > 0) {
      summary += `\nIdentified ${codeLinks.length} links between diagrams and code.`;

      const highConfidence = codeLinks.filter(l => l.confidence >= 0.8);
      if (highConfidence.length > 0) {
        summary += `\nHigh-confidence matches:\n`;
        for (const link of highConfidence.slice(0, 5)) {
          summary += `- ${link.imageElement} → ${link.codeFile}:${link.codeBlock}\n`;
        }
      }
    }

    return summary;
  }
}

/**
 * DiagramParser - Extracts structured data from diagram images
 * Uses pattern matching and heuristics for offline parsing
 */
export class DiagramParser {
  /**
   * Parse SVG diagram and extract elements
   */
  async parseSVG(content: string): Promise<DiagramElement[]> {
    const elements: DiagramElement[] = [];

    // Extract text elements from SVG
    const textMatches = content.matchAll(/<text[^>]*>([^<]+)<\/text>/gi);
    for (const match of textMatches) {
      const text = match[1].trim();
      if (text.length > 1 && !/^\d+$/.test(text)) {
        elements.push({
          name: text,
          type: 'text',
          connections: []
        });
      }
    }

    // Extract rect/circle elements (often represent classes/components)
    const shapeMatches = content.matchAll(/<(rect|circle|ellipse)[^>]*id="([^"]+)"/gi);
    for (const match of shapeMatches) {
      elements.push({
        name: match[2],
        type: 'component',
        connections: []
      });
    }

    // Extract path/line elements (often represent connections)
    const pathCount = (content.match(/<(path|line|polyline)/gi) || []).length;
    if (pathCount > 0) {
      // Infer connections based on proximity (simplified)
      for (let i = 0; i < elements.length - 1; i++) {
        if (elements[i].type !== 'text') {
          elements[i].connections.push(elements[i + 1]?.name || 'next');
        }
      }
    }

    return elements;
  }

  /**
   * Infer diagram structure from filename conventions
   */
  inferFromFilename(filename: string): Partial<ImageAnalysis> {
    const name = filename.replace(/\.[^.]+$/, '');

    // Common diagram naming patterns
    const patterns: Array<{
      pattern: RegExp;
      type: ImageAnalysis['type'];
      elements: string[];
    }> = [
      {
        pattern: /class[_-]?diagram/i,
        type: 'diagram',
        elements: ['Class', 'Interface', 'Inheritance']
      },
      {
        pattern: /sequence[_-]?diagram/i,
        type: 'flowchart',
        elements: ['Actor', 'Message', 'Lifeline']
      },
      {
        pattern: /component[_-]?diagram/i,
        type: 'architecture',
        elements: ['Component', 'Interface', 'Dependency']
      },
      {
        pattern: /data[_-]?flow/i,
        type: 'flowchart',
        elements: ['Process', 'Data Store', 'External Entity']
      },
      {
        pattern: /erd|entity[_-]?relationship/i,
        type: 'diagram',
        elements: ['Entity', 'Relationship', 'Attribute']
      }
    ];

    for (const { pattern, type, elements } of patterns) {
      if (pattern.test(name)) {
        return {
          type,
          elements: elements.map(e => ({
            name: e,
            type: 'component' as const,
            connections: []
          }))
        };
      }
    }

    return { type: 'unknown', elements: [] };
  }
}
