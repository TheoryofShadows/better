/**
 * ExplainAgent - Context-Aware Code Explanation Agent
 * Provides intelligent code explanations with zoom in/out capabilities
 */

import { BaseAgent } from './base.js';
import { isLLMAvailable, llmComplete, llmCompleteJSON } from './llm.js';
import type { ParsedFile, CodeBlock, Language } from '../types.js';
import type { CodeExplanation, ChatMessage, ChatSession } from './types.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

export interface ExplainInput {
  type: 'file' | 'block' | 'line' | 'query';
  target: string;
  context?: ExplainContext;
  depth?: 'shallow' | 'normal' | 'deep';
}

export interface ExplainContext {
  files: ParsedFile[];
  basePath: string;
  relatedFiles?: string[];
}

export interface ExplainOutput {
  explanation: CodeExplanation;
  relatedCode?: RelatedCode[];
  followUp?: string[];
}

export interface RelatedCode {
  file: string;
  block: string;
  relationship: string;
}

/**
 * Build a compact, token-bounded textual summary of the codebase for use as
 * LLM context (file list grouped by language, with each file's defined symbols).
 */
function summarizeCodebase(files: ParsedFile[], maxFiles = 80): string {
  const lines: string[] = [`${files.length} files analyzed.`];
  for (const file of files.slice(0, maxFiles)) {
    const symbols = file.blocks
      .filter(b => ['class', 'function', 'method', 'interface', 'type'].includes(b.type))
      .map(b => b.name)
      .slice(0, 12)
      .join(', ');
    lines.push(`- ${file.info.relativePath} [${file.info.language}]${symbols ? `: ${symbols}` : ''}`);
  }
  if (files.length > maxFiles) {
    lines.push(`...and ${files.length - maxFiles} more files`);
  }
  return lines.join('\n');
}

export class ExplainAgent extends BaseAgent<ExplainInput, ExplainOutput> {
  constructor() {
    super('ExplainAgent');
  }

  protected async execute(input: ExplainInput): Promise<ExplainOutput> {
    this.log(`Explaining ${input.type}: ${input.target}`);

    switch (input.type) {
      case 'file':
        return this.explainFile(input.target, input.context!, input.depth || 'normal');
      case 'block':
        return this.explainBlock(input.target, input.context!, input.depth || 'normal');
      case 'line':
        return this.explainLine(input.target, input.context!);
      case 'query':
        return this.answerQuery(input.target, input.context!);
      default:
        throw new Error(`Unknown explanation type: ${input.type}`);
    }
  }

  private async explainFile(
    filePath: string,
    context: ExplainContext,
    depth: 'shallow' | 'normal' | 'deep'
  ): Promise<ExplainOutput> {
    const file = context.files.find(f =>
      f.info.relativePath === filePath || f.info.path === filePath
    );

    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Build explanation based on depth (AI when available, heuristic otherwise)
    let explanation: CodeExplanation;
    if (isLLMAvailable()) {
      try {
        explanation = await this.buildFileExplanationAI(file, depth);
      } catch (error) {
        this.log(`AI explanation failed for '${filePath}', using heuristic: ${error instanceof Error ? error.message : error}`);
        explanation = this.buildFileExplanation(file, depth);
      }
    } else {
      explanation = this.buildFileExplanation(file, depth);
    }
    const relatedCode = this.findRelatedCode(file, context.files);
    const followUp = this.generateFollowUpQuestions(file);

    return {
      explanation,
      relatedCode,
      followUp
    };
  }

  private buildFileExplanation(
    file: ParsedFile,
    depth: 'shallow' | 'normal' | 'deep'
  ): CodeExplanation {
    const { blocks, imports, exports, info } = file;

    // Determine file purpose
    const purpose = this.inferFilePurpose(file);

    // Detect patterns
    const patterns = this.detectFilePatterns(file);

    // Get dependencies
    const dependencies = imports.map(i => i.source);

    // Calculate complexity
    const complexities = blocks
      .filter(b => b.complexity !== undefined)
      .map(b => b.complexity!);
    const avgComplexity = complexities.length > 0
      ? complexities.reduce((a, b) => a + b, 0) / complexities.length
      : 1;

    // Build summary based on depth
    let summary: string;

    if (depth === 'shallow') {
      summary = `${info.relativePath} is a ${info.language} file with ${blocks.length} code blocks. ${purpose}`;
    } else if (depth === 'normal') {
      summary = this.buildNormalSummary(file, purpose);
    } else {
      summary = this.buildDeepSummary(file, purpose);
    }

    // Generate suggestions
    const suggestions = this.generateSuggestions(file);

    return {
      summary,
      purpose,
      patterns,
      dependencies,
      complexity: {
        score: avgComplexity,
        assessment: this.assessComplexity(avgComplexity)
      },
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
  }

  private avgComplexity(blocks: CodeBlock[]): number {
    const complexities = blocks
      .filter(b => b.complexity !== undefined)
      .map(b => b.complexity!);
    return complexities.length > 0
      ? complexities.reduce((a, b) => a + b, 0) / complexities.length
      : 1;
  }

  private async buildFileExplanationAI(
    file: ParsedFile,
    depth: 'shallow' | 'normal' | 'deep'
  ): Promise<CodeExplanation> {
    const score = this.avgComplexity(file.blocks);
    const detail = depth === 'shallow'
      ? 'Keep the summary to one or two sentences.'
      : depth === 'deep'
        ? 'Give a thorough summary covering the main blocks, control flow, and notable design choices.'
        : 'Give a clear paragraph-length summary.';

    const system =
      'You are a senior engineer explaining a source file to a teammate. ' +
      'Base every statement on the actual code provided — never invent behavior. ' +
      `${detail} Respond with JSON matching the schema.`;

    const prompt =
      `File: ${file.info.relativePath} (${file.info.language})\n` +
      `Defined symbols: ${file.blocks.map(b => `${b.type} ${b.name}`).join(', ') || 'none'}\n\n` +
      'Source:\n```' + file.info.language + '\n' + file.rawContent.slice(0, 12000) + '\n```';

    const ai = await llmCompleteJSON<{
      summary: string;
      purpose: string;
      patterns: string[];
      suggestions: string[];
    }>({
      system,
      prompt,
      maxTokens: 2048,
      model: this.context?.config.aiModel,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          purpose: { type: 'string' },
          patterns: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } }
        },
        required: ['summary', 'purpose', 'patterns', 'suggestions']
      }
    });

    return {
      summary: ai.summary,
      purpose: ai.purpose,
      patterns: ai.patterns,
      // Dependencies and complexity stay deterministic (measured, not guessed).
      dependencies: file.imports.map(i => i.source),
      complexity: { score, assessment: this.assessComplexity(score) },
      suggestions: ai.suggestions.length > 0 ? ai.suggestions : undefined
    };
  }

  private async buildBlockExplanationAI(
    block: CodeBlock,
    file: ParsedFile
  ): Promise<CodeExplanation> {
    const score = block.complexity || 1;

    const system =
      'You are a senior engineer explaining one code block to a teammate. ' +
      'Base every statement on the actual code provided — never invent behavior. ' +
      'Respond with JSON matching the schema.';

    const prompt =
      `${block.type} "${block.name}" in ${file.info.relativePath} (${file.info.language}):\n\n` +
      '```' + file.info.language + '\n' + block.content.slice(0, 8000) + '\n```';

    const ai = await llmCompleteJSON<{
      summary: string;
      purpose: string;
      patterns: string[];
      suggestions: string[];
    }>({
      system,
      prompt,
      maxTokens: 1536,
      model: this.context?.config.aiModel,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          purpose: { type: 'string' },
          patterns: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } }
        },
        required: ['summary', 'purpose', 'patterns', 'suggestions']
      }
    });

    return {
      summary: ai.summary,
      purpose: ai.purpose,
      patterns: ai.patterns,
      dependencies: this.extractBlockDependencies(block, file),
      complexity: { score, assessment: this.assessComplexity(score) },
      suggestions: ai.suggestions.length > 0 ? ai.suggestions : undefined
    };
  }

  private inferFilePurpose(file: ParsedFile): string {
    const { blocks, info, exports } = file;
    const fileName = info.relativePath.toLowerCase();

    // Check file name patterns
    if (fileName.includes('test') || fileName.includes('spec')) {
      return 'This file contains test cases.';
    }
    if (fileName.includes('util') || fileName.includes('helper')) {
      return 'This file provides utility functions.';
    }
    if (fileName.includes('config')) {
      return 'This file defines configuration settings.';
    }
    if (fileName.includes('type') || fileName.includes('interface')) {
      return 'This file defines type definitions.';
    }
    if (fileName.includes('component')) {
      return 'This file defines a UI component.';
    }
    if (fileName.includes('service')) {
      return 'This file implements a service layer.';
    }
    if (fileName.includes('controller')) {
      return 'This file handles request routing and control flow.';
    }
    if (fileName.includes('model')) {
      return 'This file defines data models.';
    }
    if (fileName.includes('hook')) {
      return 'This file defines custom hooks.';
    }
    if (fileName.includes('middleware')) {
      return 'This file defines middleware functions.';
    }
    if (fileName.includes('route') || fileName.includes('router')) {
      return 'This file defines application routes.';
    }
    if (fileName.includes('api')) {
      return 'This file provides API endpoints or client functions.';
    }
    if (fileName.includes('store') || fileName.includes('state')) {
      return 'This file manages application state.';
    }

    // Analyze content patterns
    const hasClasses = blocks.some(b => b.type === 'class');
    const hasOnlyFunctions = blocks.every(b =>
      b.type === 'function' || b.type === 'method' || b.type === 'type' || b.type === 'interface'
    );
    const hasInterfaces = blocks.some(b => b.type === 'interface' || b.type === 'type');

    if (hasClasses && blocks.filter(b => b.type === 'class').length === 1) {
      const className = blocks.find(b => b.type === 'class')?.name;
      return `This file defines the ${className} class.`;
    }

    if (hasOnlyFunctions && !hasInterfaces) {
      return 'This file provides a collection of functions.';
    }

    if (hasInterfaces && !hasClasses) {
      return 'This file defines interfaces and types.';
    }

    // Analyze exports
    if (exports.length === 1 && exports[0].type === 'default') {
      return `This file exports ${exports[0].name} as its main functionality.`;
    }

    return 'This file provides functionality for the application.';
  }

  private detectFilePatterns(file: ParsedFile): string[] {
    const patterns: string[] = [];
    const content = file.rawContent;

    const patternChecks = [
      { pattern: /useState|useEffect|useCallback|useMemo|useRef/, name: 'React Hooks' },
      { pattern: /async|await/, name: 'Asynchronous Programming' },
      { pattern: /class\s+\w+\s+extends\s+\w+/, name: 'Class Inheritance' },
      { pattern: /implements\s+\w+/, name: 'Interface Implementation' },
      { pattern: /new\s+Promise/, name: 'Promise Creation' },
      { pattern: /Observable|Subject|BehaviorSubject/, name: 'RxJS/Reactive' },
      { pattern: /@(Injectable|Component|Module|Controller)/, name: 'Dependency Injection' },
      { pattern: /export\s+default\s+function/, name: 'Default Function Export' },
      { pattern: /export\s+\*\s+from/, name: 'Re-exports' },
      { pattern: /\.map\(.*\.filter\(|\.filter\(.*\.map\(/, name: 'Functional Composition' },
      { pattern: /try\s*\{[\s\S]*catch/, name: 'Error Handling' },
      { pattern: /JSON\.parse|JSON\.stringify/, name: 'JSON Processing' },
      { pattern: /fetch\(|axios|http\./, name: 'HTTP Requests' },
      { pattern: /\.query\(|\.findOne\(|\.find\(/, name: 'Database Operations' },
      { pattern: /process\.env/, name: 'Environment Variables' },
      { pattern: /EventEmitter|\.emit\(|\.on\(/, name: 'Event-Driven' },
      { pattern: /singleton|getInstance/, name: 'Singleton Pattern' },
      { pattern: /factory|Factory|create\w+/, name: 'Factory Pattern' },
      { pattern: /\.pipe\(/, name: 'Pipeline/Stream Processing' },
      { pattern: /memo\(|useMemo|memoize/, name: 'Memoization' }
    ];

    for (const check of patternChecks) {
      if (check.pattern.test(content)) {
        patterns.push(check.name);
      }
    }

    return patterns;
  }

  private buildNormalSummary(file: ParsedFile, purpose: string): string {
    const { blocks, imports, exports, info } = file;

    const lines = [purpose, ''];

    // Describe structure
    const classes = blocks.filter(b => b.type === 'class');
    const functions = blocks.filter(b => b.type === 'function' || b.type === 'method');
    const types = blocks.filter(b => b.type === 'interface' || b.type === 'type');

    if (classes.length > 0) {
      lines.push(`**Classes:** ${classes.map(c => c.name).join(', ')}`);
    }
    if (functions.length > 0) {
      const topFuncs = functions.slice(0, 5).map(f => f.name);
      lines.push(`**Functions:** ${topFuncs.join(', ')}${functions.length > 5 ? ` (+${functions.length - 5} more)` : ''}`);
    }
    if (types.length > 0) {
      lines.push(`**Types:** ${types.map(t => t.name).join(', ')}`);
    }

    // Describe dependencies
    if (imports.length > 0) {
      const externalImports = imports.filter(i => !i.source.startsWith('.'));
      if (externalImports.length > 0) {
        lines.push(`**External Dependencies:** ${externalImports.map(i => i.source).slice(0, 5).join(', ')}`);
      }
    }

    // Describe exports
    if (exports.length > 0) {
      lines.push(`**Exports:** ${exports.map(e => e.name).join(', ')}`);
    }

    return lines.join('\n');
  }

  private buildDeepSummary(file: ParsedFile, purpose: string): string {
    const lines = [this.buildNormalSummary(file, purpose), ''];
    const { blocks } = file;

    lines.push('### Detailed Analysis\n');

    // Analyze each major block
    for (const block of blocks.filter(b => b.type === 'class' || b.type === 'function')) {
      lines.push(`#### ${block.type}: ${block.name}`);

      if (block.documentation) {
        lines.push(`*Documentation:* ${block.documentation.slice(0, 100)}...`);
      } else {
        lines.push('*No documentation*');
      }

      if (block.complexity) {
        lines.push(`*Complexity:* ${block.complexity} (${this.assessComplexity(block.complexity)})`);
      }

      if (block.parameters && block.parameters.length > 0) {
        lines.push(`*Parameters:* ${block.parameters.map(p => p.name).join(', ')}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private assessComplexity(score: number): string {
    if (score <= 5) return 'Simple - easy to understand';
    if (score <= 10) return 'Moderate - reasonable complexity';
    if (score <= 15) return 'Complex - may need attention';
    if (score <= 20) return 'High - consider refactoring';
    return 'Very High - needs refactoring';
  }

  private findRelatedCode(file: ParsedFile, allFiles: ParsedFile[]): RelatedCode[] {
    const related: RelatedCode[] = [];

    // Find files that import from this file
    for (const otherFile of allFiles) {
      if (otherFile === file) continue;

      for (const imp of otherFile.imports) {
        if (imp.source.includes(file.info.relativePath.replace(/\.[^.]+$/, ''))) {
          related.push({
            file: otherFile.info.relativePath,
            block: imp.items.join(', '),
            relationship: 'imports from this file'
          });
        }
      }
    }

    // Find files that this file imports from
    for (const imp of file.imports) {
      if (imp.source.startsWith('.')) {
        const targetFile = allFiles.find(f =>
          f.info.relativePath.includes(imp.source.replace(/^\.\//, ''))
        );
        if (targetFile) {
          related.push({
            file: targetFile.info.relativePath,
            block: imp.items.join(', '),
            relationship: 'imported by this file'
          });
        }
      }
    }

    return related.slice(0, 10);
  }

  private generateFollowUpQuestions(file: ParsedFile): string[] {
    const questions: string[] = [];
    const { blocks } = file;

    // Suggest exploring complex functions
    const complexBlocks = blocks.filter(b => b.complexity && b.complexity > 10);
    if (complexBlocks.length > 0) {
      questions.push(`What does the ${complexBlocks[0].name} function do?`);
    }

    // Suggest exploring undocumented code
    const undocumented = blocks.filter(b => !b.documentation && b.type === 'function');
    if (undocumented.length > 0) {
      questions.push(`Can you explain ${undocumented[0].name}?`);
    }

    // General questions
    questions.push('What are the main dependencies?');
    questions.push('How is this file used in the codebase?');
    questions.push('What could be improved in this file?');

    return questions.slice(0, 5);
  }

  private generateSuggestions(file: ParsedFile): string[] {
    const suggestions: string[] = [];
    const { blocks, info } = file;

    // Check documentation
    const undocumented = blocks.filter(b =>
      !b.documentation && ['function', 'method', 'class'].includes(b.type)
    );
    if (undocumented.length > 0) {
      suggestions.push(`Add documentation to ${undocumented.length} undocumented items`);
    }

    // Check complexity
    const complex = blocks.filter(b => b.complexity && b.complexity > 15);
    if (complex.length > 0) {
      suggestions.push(`Refactor ${complex.length} complex functions`);
    }

    // Check file size
    if (info.lines > 300) {
      suggestions.push('Consider splitting this file into smaller modules');
    }

    // Check function count
    const funcCount = blocks.filter(b => b.type === 'function' || b.type === 'method').length;
    if (funcCount > 15) {
      suggestions.push('Group related functions into separate modules');
    }

    return suggestions;
  }

  private async explainBlock(
    blockIdentifier: string,
    context: ExplainContext,
    depth: 'shallow' | 'normal' | 'deep'
  ): Promise<ExplainOutput> {
    // Find the block across all files
    let targetBlock: CodeBlock | undefined;
    let targetFile: ParsedFile | undefined;

    for (const file of context.files) {
      const block = file.blocks.find(b => b.name === blockIdentifier);
      if (block) {
        targetBlock = block;
        targetFile = file;
        break;
      }
    }

    if (!targetBlock || !targetFile) {
      throw new Error(`Block not found: ${blockIdentifier}`);
    }

    let explanation: CodeExplanation;
    if (isLLMAvailable()) {
      try {
        explanation = await this.buildBlockExplanationAI(targetBlock, targetFile);
      } catch (error) {
        this.log(`AI block explanation failed for '${blockIdentifier}', using heuristic: ${error instanceof Error ? error.message : error}`);
        explanation = this.buildBlockExplanation(targetBlock, targetFile, depth);
      }
    } else {
      explanation = this.buildBlockExplanation(targetBlock, targetFile, depth);
    }

    return {
      explanation,
      followUp: [
        `Show me the full code of ${blockIdentifier}`,
        `What functions call ${blockIdentifier}?`,
        `What dependencies does ${blockIdentifier} have?`
      ]
    };
  }

  private buildBlockExplanation(
    block: CodeBlock,
    file: ParsedFile,
    depth: 'shallow' | 'normal' | 'deep'
  ): CodeExplanation {
    const patterns = this.detectBlockPatterns(block.content);

    return {
      summary: this.buildBlockSummary(block, depth),
      purpose: this.inferBlockPurpose(block),
      patterns,
      dependencies: this.extractBlockDependencies(block, file),
      complexity: {
        score: block.complexity || 1,
        assessment: this.assessComplexity(block.complexity || 1)
      }
    };
  }

  private buildBlockSummary(block: CodeBlock, depth: 'shallow' | 'normal' | 'deep'): string {
    if (depth === 'shallow') {
      return `${block.type} '${block.name}' (lines ${block.startLine}-${block.endLine})`;
    }

    let summary = `**${block.type}: ${block.name}**\n\n`;

    if (block.documentation) {
      summary += `*Documentation:* ${block.documentation}\n\n`;
    }

    if (block.parameters && block.parameters.length > 0) {
      summary += '**Parameters:**\n';
      for (const param of block.parameters) {
        summary += `- \`${param.name}\`${param.type ? `: ${param.type}` : ''}${param.optional ? ' (optional)' : ''}\n`;
      }
      summary += '\n';
    }

    if (block.returnType) {
      summary += `**Returns:** \`${block.returnType}\`\n`;
    }

    if (depth === 'deep') {
      summary += `\n**Location:** ${block.startLine}-${block.endLine} (${block.endLine - block.startLine + 1} lines)\n`;
      summary += `**Complexity:** ${block.complexity || 'N/A'}\n`;
    }

    return summary;
  }

  private inferBlockPurpose(block: CodeBlock): string {
    const name = block.name;

    // Use the same inference logic as FixAgent
    if (name.startsWith('get')) return `Retrieves ${this.camelToWords(name.slice(3))}`;
    if (name.startsWith('set')) return `Sets ${this.camelToWords(name.slice(3))}`;
    if (name.startsWith('is') || name.startsWith('has')) return `Checks a condition`;
    if (name.startsWith('create')) return `Creates a new instance`;
    if (name.startsWith('delete') || name.startsWith('remove')) return `Removes data`;
    if (name.startsWith('update')) return `Updates existing data`;
    if (name.startsWith('handle')) return `Handles an event or action`;
    if (name.startsWith('render')) return `Renders UI elements`;
    if (name.startsWith('parse')) return `Parses input data`;
    if (name.startsWith('validate')) return `Validates input`;
    if (name.startsWith('fetch') || name.startsWith('load')) return `Loads data`;
    if (name.startsWith('save') || name.startsWith('store')) return `Persists data`;

    return `Implements ${this.camelToWords(name)} functionality`;
  }

  private camelToWords(str: string): string {
    if (!str) return 'the value';
    return str.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  }

  private detectBlockPatterns(content: string): string[] {
    const patterns: string[] = [];

    const checks = [
      { pattern: /async|await/, name: 'Async/Await' },
      { pattern: /try[\s\S]*catch/, name: 'Error Handling' },
      { pattern: /for\s*\(|for\s+\w+\s+in|\.forEach/, name: 'Iteration' },
      { pattern: /if\s*\([\s\S]*else/, name: 'Conditional Logic' },
      { pattern: /\.map\(|\.filter\(|\.reduce\(/, name: 'Functional Array Methods' },
      { pattern: /return\s+new\s+Promise/, name: 'Promise Creation' },
      { pattern: /throw\s+new/, name: 'Error Throwing' },
      { pattern: /\?\s*[^:]+\s*:/, name: 'Ternary Operator' },
      { pattern: /\?\?|\.?\?\./, name: 'Nullish Coalescing/Optional Chaining' },
      { pattern: /Object\.(keys|values|entries)/, name: 'Object Iteration' }
    ];

    for (const check of checks) {
      if (check.pattern.test(content)) {
        patterns.push(check.name);
      }
    }

    return patterns;
  }

  private extractBlockDependencies(block: CodeBlock, file: ParsedFile): string[] {
    const deps: string[] = [];

    // Find references to other blocks in the same file
    for (const otherBlock of file.blocks) {
      if (otherBlock === block) continue;
      if (block.content.includes(otherBlock.name + '(')) {
        deps.push(otherBlock.name);
      }
    }

    // Find imported items used in the block
    for (const imp of file.imports) {
      for (const item of imp.items) {
        if (block.content.includes(item)) {
          deps.push(`${item} (from ${imp.source})`);
        }
      }
    }

    return deps;
  }

  private async explainLine(lineSpec: string, context: ExplainContext): Promise<ExplainOutput> {
    const [filePath, lineStr] = lineSpec.split(':');
    const lineNum = parseInt(lineStr, 10);

    const file = context.files.find(f => f.info.relativePath === filePath);
    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Find the block containing this line
    const containingBlock = file.blocks.find(b =>
      b.startLine <= lineNum && b.endLine >= lineNum
    );

    const explanation: CodeExplanation = {
      summary: containingBlock
        ? `Line ${lineNum} is inside ${containingBlock.type} '${containingBlock.name}'`
        : `Line ${lineNum} is outside any code block`,
      purpose: containingBlock?.documentation || 'No documentation available',
      patterns: containingBlock ? this.detectBlockPatterns(containingBlock.content) : [],
      dependencies: [],
      complexity: {
        score: containingBlock?.complexity || 1,
        assessment: 'N/A for single line'
      }
    };

    return { explanation };
  }

  private async answerQuery(query: string, context: ExplainContext): Promise<ExplainOutput> {
    const queryLower = query.toLowerCase();

    // Route to appropriate handler based on query
    if (queryLower.includes('complex') || queryLower.includes('refactor')) {
      return this.answerComplexityQuery(context);
    }

    if (queryLower.includes('undocument') || queryLower.includes('document')) {
      return this.answerDocumentationQuery(context);
    }

    if (queryLower.includes('depend') || queryLower.includes('import')) {
      return this.answerDependencyQuery(context);
    }

    if (queryLower.includes('test')) {
      return this.answerTestQuery(context);
    }

    // Generic query handling
    if (isLLMAvailable()) {
      try {
        return await this.answerGenericQueryAI(query, context);
      } catch (error) {
        this.log(`AI query answer failed, using heuristic: ${error instanceof Error ? error.message : error}`);
      }
    }
    return this.answerGenericQuery(query, context);
  }

  private async answerGenericQueryAI(query: string, context: ExplainContext): Promise<ExplainOutput> {
    const system =
      'You are DocuMate, an assistant that answers questions about a specific codebase. ' +
      'Use only the provided codebase summary; be concise and specific, and if the summary ' +
      'is insufficient say what file the user should look at. Answer in markdown prose.';

    const prompt =
      `Codebase summary:\n${summarizeCodebase(context.files)}\n\n` +
      `Question: ${query}`;

    const answer = await llmComplete({
      system,
      prompt,
      maxTokens: 2048,
      model: this.context?.config.aiModel
    });

    return {
      explanation: {
        summary: answer,
        purpose: 'Query result',
        patterns: [],
        dependencies: [],
        complexity: { score: 0, assessment: 'N/A' }
      },
      followUp: [
        'Show me all files',
        'What does this codebase do?',
        'Find complex code'
      ]
    };
  }

  private answerComplexityQuery(context: ExplainContext): ExplainOutput {
    const complexBlocks: Array<{ file: string; block: CodeBlock }> = [];

    for (const file of context.files) {
      for (const block of file.blocks) {
        if (block.complexity && block.complexity > 10) {
          complexBlocks.push({ file: file.info.relativePath, block });
        }
      }
    }

    /* v8 ignore next -- collected blocks always have a truthy complexity (filtered above), so `|| 0` is unreachable */
    complexBlocks.sort((a, b) => (b.block.complexity || 0) - (a.block.complexity || 0));

    const summary = complexBlocks.length > 0
      ? `Found ${complexBlocks.length} complex code blocks:\n\n` +
        complexBlocks.slice(0, 10).map(({ file, block }) =>
          `- **${block.name}** in \`${file}\` (complexity: ${block.complexity})`
        ).join('\n')
      : 'No overly complex code blocks found.';

    return {
      explanation: {
        summary,
        purpose: 'Complexity analysis of the codebase',
        patterns: ['Code Quality Analysis'],
        dependencies: [],
        complexity: { score: 0, assessment: 'N/A' }
      },
      followUp: complexBlocks.length > 0
        ? [`Explain ${complexBlocks[0].block.name}`, 'How can I reduce complexity?']
        : []
    };
  }

  private answerDocumentationQuery(context: ExplainContext): ExplainOutput {
    const undocumented: Array<{ file: string; block: CodeBlock }> = [];

    for (const file of context.files) {
      for (const block of file.blocks) {
        if (!block.documentation && ['function', 'method', 'class'].includes(block.type)) {
          undocumented.push({ file: file.info.relativePath, block });
        }
      }
    }

    const summary = undocumented.length > 0
      ? `Found ${undocumented.length} undocumented items:\n\n` +
        undocumented.slice(0, 10).map(({ file, block }) =>
          `- **${block.type}** \`${block.name}\` in \`${file}\``
        ).join('\n')
      : 'All code is documented!';

    return {
      explanation: {
        summary,
        purpose: 'Documentation coverage analysis',
        patterns: ['Documentation Analysis'],
        dependencies: [],
        complexity: { score: 0, assessment: 'N/A' }
      },
      followUp: ['Generate documentation for all', 'Show documentation coverage percentage']
    };
  }

  private answerDependencyQuery(context: ExplainContext): ExplainOutput {
    const deps = new Map<string, number>();

    for (const file of context.files) {
      for (const imp of file.imports) {
        if (!imp.source.startsWith('.')) {
          deps.set(imp.source, (deps.get(imp.source) || 0) + 1);
        }
      }
    }

    const sortedDeps = [...deps.entries()].sort((a, b) => b[1] - a[1]);

    const summary = `External dependencies (${sortedDeps.length} packages):\n\n` +
      sortedDeps.slice(0, 15).map(([name, count]) =>
        `- **${name}** (used in ${count} files)`
      ).join('\n');

    return {
      explanation: {
        summary,
        purpose: 'Dependency analysis',
        patterns: ['Dependency Analysis'],
        dependencies: sortedDeps.map(([name]) => name),
        complexity: { score: 0, assessment: 'N/A' }
      }
    };
  }

  private answerTestQuery(context: ExplainContext): ExplainOutput {
    const testFiles = context.files.filter(f =>
      f.info.relativePath.includes('test') || f.info.relativePath.includes('spec')
    );

    const summary = testFiles.length > 0
      ? `Found ${testFiles.length} test files:\n\n` +
        testFiles.map(f => `- \`${f.info.relativePath}\``).join('\n')
      : 'No test files found in the analyzed codebase.';

    return {
      explanation: {
        summary,
        purpose: 'Test file analysis',
        patterns: ['Testing'],
        dependencies: [],
        complexity: { score: 0, assessment: 'N/A' }
      },
      followUp: testFiles.length > 0
        ? ['Show test coverage', 'What functions are not tested?']
        : ['How do I add tests?']
    };
  }

  private answerGenericQuery(query: string, context: ExplainContext): ExplainOutput {
    // Search for relevant code
    const queryTerms = query.toLowerCase().split(/\s+/);
    const relevantFiles: ParsedFile[] = [];
    const relevantBlocks: Array<{ file: string; block: CodeBlock }> = [];

    for (const file of context.files) {
      const fileRelevance = queryTerms.filter(term =>
        file.info.relativePath.toLowerCase().includes(term)
      ).length;

      if (fileRelevance > 0) {
        relevantFiles.push(file);
      }

      for (const block of file.blocks) {
        const blockRelevance = queryTerms.filter(term =>
          block.name.toLowerCase().includes(term) ||
          (block.documentation && block.documentation.toLowerCase().includes(term))
        ).length;

        if (blockRelevance > 0) {
          relevantBlocks.push({ file: file.info.relativePath, block });
        }
      }
    }

    let summary = `Query: "${query}"\n\n`;

    if (relevantBlocks.length > 0) {
      summary += `Found ${relevantBlocks.length} relevant code blocks:\n\n`;
      summary += relevantBlocks.slice(0, 5).map(({ file, block }) =>
        `- **${block.name}** (${block.type}) in \`${file}\``
      ).join('\n');
    } else if (relevantFiles.length > 0) {
      summary += `Found ${relevantFiles.length} relevant files:\n\n`;
      summary += relevantFiles.slice(0, 5).map(f =>
        `- \`${f.info.relativePath}\``
      ).join('\n');
    } else {
      summary += 'No directly relevant code found. Try rephrasing your query or exploring specific files.';
    }

    return {
      explanation: {
        summary,
        purpose: 'Query result',
        patterns: [],
        dependencies: [],
        complexity: { score: 0, assessment: 'N/A' }
      },
      followUp: [
        'Show me all files',
        'What does this codebase do?',
        'Find complex code'
      ]
    };
  }
}

export class ChatAgent extends BaseAgent<ChatMessage, ChatMessage> {
  private sessions: Map<string, ChatSession> = new Map();
  private explainAgent: ExplainAgent;

  constructor() {
    super('ChatAgent');
    this.explainAgent = new ExplainAgent();
  }

  public createSession(context: ExplainContext): string {
    const id = `chat-${Date.now()}`;
    this.sessions.set(id, {
      id,
      messages: [{
        role: 'system',
        content: 'You are DocuMate, an AI assistant helping developers understand their codebase.',
        timestamp: new Date()
      }],
      context: {
        workingDir: context.basePath,
        files: context.files,
        config: {
          maxIterations: 10,
          timeout: 30000,
          sandboxed: true,
          autoFix: false,
          createPRs: false
        }
      }
    });
    return id;
  }

  public getSession(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  protected async execute(input: ChatMessage): Promise<ChatMessage> {
    const query = input.content.toLowerCase();

    // Fast local commands that never need the model.
    if (query.includes('help') || query === '?') {
      return { role: 'assistant', content: this.getHelpMessage(), timestamp: new Date() };
    }
    if ((query.includes('files') || query.includes('list')) && !query.includes('explain')) {
      return { role: 'assistant', content: this.listFiles(), timestamp: new Date() };
    }

    // Real AI conversation when a key is configured and context is loaded.
    if (isLLMAvailable() && this.context?.files) {
      try {
        const content = await this.chatAI(input.content);
        return { role: 'assistant', content, timestamp: new Date() };
      } catch (error) {
        this.log(`AI chat failed, using heuristic: ${error instanceof Error ? error.message : error}`);
      }
    }

    return { role: 'assistant', content: await this.respondHeuristic(input), timestamp: new Date() };
  }

  private async chatAI(message: string): Promise<string> {
    const system =
      'You are DocuMate, an AI assistant that helps developers understand THIS codebase. ' +
      'Answer using the provided codebase summary. Be concise, concrete, and reference ' +
      'specific files or symbols. If something is not covered by the summary, say which ' +
      'file the user should open. Use markdown.\n\n' +
      `Codebase summary:\n${summarizeCodebase(this.context!.files)}`;

    return llmComplete({
      system,
      prompt: message,
      maxTokens: 2048,
      model: this.context!.config.aiModel
    });
  }

  private async respondHeuristic(input: ChatMessage): Promise<string> {
    const query = input.content.toLowerCase();
    let responseContent: string;

    if (query.includes('explain') || query.includes('what does') || query.includes('how does')) {
      const context = this.context ? {
        files: this.context.files!,
        basePath: this.context.workingDir
      } : undefined;

      if (context) {
        this.explainAgent.setContext(this.context!);
        const result = await this.explainAgent.run({
          type: 'query',
          target: input.content,
          context
        });

        /* v8 ignore next -- answerQuery always resolves successfully, so this is never false */
        if (result.success && result.data) {
          responseContent = result.data.explanation.summary;
          if (result.data.followUp && result.data.followUp.length > 0) {
            responseContent += '\n\n**You might also ask:**\n' +
              result.data.followUp.map(q => `- ${q}`).join('\n');
          }
        } else {
          /* v8 ignore next -- answerQuery always resolves successfully; defensive only */
          responseContent = 'I could not find relevant information for your query.';
        }
      } else {
        responseContent = 'No codebase context available. Please run analysis first.';
      }
      /* v8 ignore start -- help/files queries are handled earlier in execute(), never reaching here */
    } else if (query.includes('help') || query === '?') {
      responseContent = this.getHelpMessage();
    } else if (query.includes('files') || query.includes('list')) {
      responseContent = this.listFiles();
      /* v8 ignore stop */
    } else {
      // Generic response with suggestions
      responseContent = `I understand you're asking about: "${input.content}"\n\n` +
        'Try these commands:\n' +
        '- "explain [file/function]" - Get detailed explanations\n' +
        '- "find complex code" - Locate complex functions\n' +
        '- "show undocumented" - Find undocumented code\n' +
        '- "list files" - See all analyzed files';
    }

    return responseContent;
  }

  private getHelpMessage(): string {
    return `**DocuMate Chat Commands**

**Exploration:**
- \`explain <file>\` - Explain a specific file
- \`explain <function>\` - Explain a function
- \`list files\` - List all analyzed files
- \`find <query>\` - Search the codebase

**Analysis:**
- \`show complex\` - Find complex code
- \`show undocumented\` - Find undocumented code
- \`show dependencies\` - List external dependencies
- \`health\` - Show codebase health

**Actions:**
- \`generate docs\` - Generate documentation
- \`suggest fixes\` - Get improvement suggestions

Type any question to get started!`;
  }

  private listFiles(): string {
    if (!this.context?.files) {
      return 'No files loaded. Run analysis first.';
    }

    const files = this.context.files;
    const byLanguage = new Map<string, string[]>();

    for (const file of files) {
      const lang = file.info.language;
      const list = byLanguage.get(lang) || [];
      list.push(file.info.relativePath);
      byLanguage.set(lang, list);
    }

    let response = `**Analyzed Files (${files.length} total)**\n\n`;

    for (const [lang, fileList] of byLanguage) {
      response += `**${lang}** (${fileList.length}):\n`;
      response += fileList.slice(0, 10).map(f => `- \`${f}\``).join('\n');
      if (fileList.length > 10) {
        response += `\n- ...and ${fileList.length - 10} more`;
      }
      response += '\n\n';
    }

    return response;
  }
}
