/**
 * ParseAgent - Specialized agent for parsing and analyzing code
 * Handles AST scanning, complexity analysis, and structure extraction
 */

import { BaseAgent } from './base.js';
import { parseFile, detectLanguage, calculateComplexity } from '../parser/index.js';
import { glob } from 'glob';
import { readFile, stat } from 'fs/promises';
import { resolve, relative, extname } from 'path';
import type { ParsedFile, CodeBlock, Language } from '../types.js';

export interface ParseInput {
  patterns: string[];
  exclude: string[];
  basePath: string;
}

export interface ParseOutput {
  files: ParsedFile[];
  summary: ParseSummary;
  codeBlocks: CodeBlockSummary[];
}

export interface ParseSummary {
  totalFiles: number;
  totalLines: number;
  totalFunctions: number;
  totalClasses: number;
  avgComplexity: number;
  languages: Map<Language, number>;
  undocumentedCount: number;
  highComplexityCount: number;
}

export interface CodeBlockSummary {
  file: string;
  name: string;
  type: string;
  line: number;
  complexity: number;
  documented: boolean;
  issues: string[];
}

export class ParseAgent extends BaseAgent<ParseInput, ParseOutput> {
  constructor() {
    super('ParseAgent');
  }

  protected async execute(input: ParseInput): Promise<ParseOutput> {
    this.log(`Starting parse with patterns: ${input.patterns.join(', ')}`);

    // Discover files
    const files = await this.discoverFiles(input);
    this.log(`Found ${files.length} files to parse`);

    // Parse all files
    const parsedFiles: ParsedFile[] = [];
    const codeBlocks: CodeBlockSummary[] = [];

    for (const filePath of files) {
      try {
        this.log(`Parsing: ${relative(input.basePath, filePath)}`);
        const parsed = await parseFile(filePath, input.basePath);
        parsedFiles.push(parsed);

        // Extract code block summaries
        for (const block of parsed.blocks) {
          codeBlocks.push(this.summarizeBlock(block, parsed.info.relativePath));
        }
        /* v8 ignore start -- parseFile reads UTF-8 from a glob-matched readable file; failure is defensive */
      } catch (error) {
        this.log(`Warning: Could not parse ${filePath}: ${error}`);
      }
      /* v8 ignore stop */
    }

    // Generate summary
    const summary = this.generateSummary(parsedFiles);
    this.log(`Parse complete: ${summary.totalFiles} files, ${summary.totalFunctions} functions`);

    return {
      files: parsedFiles,
      summary,
      codeBlocks
    };
  }

  private async discoverFiles(input: ParseInput): Promise<string[]> {
    const allFiles: string[] = [];

    for (const pattern of input.patterns) {
      const matches = await glob(pattern, {
        cwd: input.basePath,
        absolute: true,
        ignore: input.exclude,
        nodir: true
      });
      allFiles.push(...matches);
    }

    return [...new Set(allFiles)];
  }

  private summarizeBlock(block: CodeBlock, file: string): CodeBlockSummary {
    const issues: string[] = [];

    if (!block.documentation) {
      issues.push('Missing documentation');
    }

    if (block.complexity && block.complexity > 15) {
      issues.push(`High complexity (${block.complexity})`);
    }

    if (block.endLine - block.startLine > 100) {
      issues.push(`Long function (${block.endLine - block.startLine} lines)`);
    }

    return {
      file,
      name: block.name,
      type: block.type,
      line: block.startLine,
      complexity: block.complexity || 1,
      documented: !!block.documentation,
      issues
    };
  }

  private generateSummary(files: ParsedFile[]): ParseSummary {
    const languages = new Map<Language, number>();
    let totalLines = 0;
    let totalFunctions = 0;
    let totalClasses = 0;
    let totalComplexity = 0;
    let complexityCount = 0;
    let undocumentedCount = 0;
    let highComplexityCount = 0;

    for (const file of files) {
      totalLines += file.info.lines;
      languages.set(
        file.info.language,
        (languages.get(file.info.language) || 0) + 1
      );

      for (const block of file.blocks) {
        if (block.type === 'function' || block.type === 'method') {
          totalFunctions++;
          if (!block.documentation) undocumentedCount++;
        }
        if (block.type === 'class') {
          totalClasses++;
          if (!block.documentation) undocumentedCount++;
        }

        if (block.complexity) {
          totalComplexity += block.complexity;
          complexityCount++;
          if (block.complexity > 15) highComplexityCount++;
        }
      }
    }

    return {
      totalFiles: files.length,
      totalLines,
      totalFunctions,
      totalClasses,
      avgComplexity: complexityCount > 0 ? totalComplexity / complexityCount : 0,
      languages,
      undocumentedCount,
      highComplexityCount
    };
  }
}

export interface AnalyzeBlockInput {
  code: string;
  language: Language;
  context?: string;
}

export interface AnalyzeBlockOutput {
  complexity: number;
  patterns: string[];
  issues: string[];
  suggestions: string[];
}

export class BlockAnalyzer extends BaseAgent<AnalyzeBlockInput, AnalyzeBlockOutput> {
  constructor() {
    super('BlockAnalyzer');
  }

  protected async execute(input: AnalyzeBlockInput): Promise<AnalyzeBlockOutput> {
    this.log(`Analyzing ${input.language} code block`);

    const complexity = calculateComplexity(input.code);
    const patterns = this.detectPatterns(input.code, input.language);
    const issues = this.detectIssues(input.code, complexity);
    const suggestions = this.generateSuggestions(issues, complexity);

    return {
      complexity,
      patterns,
      issues,
      suggestions
    };
  }

  private detectPatterns(code: string, language: Language): string[] {
    const patterns: string[] = [];

    const patternChecks = [
      { pattern: /async|await|Promise|Future/, name: 'Asynchronous operations' },
      { pattern: /try\s*\{[\s\S]*catch|except|rescue/, name: 'Error handling' },
      { pattern: /for\s*\(|for\s+\w+\s+in|\.forEach|\.map\(|\.filter\(/, name: 'Iteration' },
      { pattern: /class\s+\w+/, name: 'Class definition' },
      { pattern: /interface\s+\w+|type\s+\w+\s*=/, name: 'Type definition' },
      { pattern: /import|require|from\s+['"]/, name: 'Module imports' },
      { pattern: /export|module\.exports/, name: 'Module exports' },
      { pattern: /fetch\(|axios|http\.|request\(/, name: 'HTTP operations' },
      { pattern: /\.query\(|SELECT|INSERT|UPDATE|DELETE/, name: 'Database operations' },
      { pattern: /useState|useEffect|useCallback/, name: 'React hooks' },
      { pattern: /@(Component|Injectable|Service|Controller)/, name: 'Decorators' },
      { pattern: /new\s+\w+\(|factory|Factory|Builder/, name: 'Object creation' },
      { pattern: /\.on\(|addEventListener|subscribe/, name: 'Event handling' },
      { pattern: /JSON\.parse|JSON\.stringify|json\./, name: 'JSON processing' },
      { pattern: /cache|Cache|memoize|memo/, name: 'Caching' },
      { pattern: /validate|Validator|schema/, name: 'Validation' },
      { pattern: /log\(|logger|Logger|console\./, name: 'Logging' },
      { pattern: /test\(|describe\(|it\(|expect\(/, name: 'Testing' }
    ];

    for (const check of patternChecks) {
      if (check.pattern.test(code)) {
        patterns.push(check.name);
      }
    }

    return patterns;
  }

  private detectIssues(code: string, complexity: number): string[] {
    const issues: string[] = [];

    if (complexity > 20) {
      issues.push('Very high cyclomatic complexity');
    } else if (complexity > 15) {
      issues.push('High cyclomatic complexity');
    }

    // Check for deep nesting
    const maxIndent = this.getMaxIndentation(code);
    if (maxIndent > 5) {
      issues.push('Deep nesting detected');
    }

    // Check for long lines
    const lines = code.split('\n');
    const longLines = lines.filter(l => l.length > 120);
    if (longLines.length > 0) {
      issues.push(`${longLines.length} lines exceed 120 characters`);
    }

    // Check for magic numbers
    const magicNumbers = code.match(/[^a-zA-Z_]\d{2,}[^a-zA-Z_0-9]/g);
    if (magicNumbers && magicNumbers.length > 3) {
      issues.push('Multiple magic numbers detected');
    }

    // Check for console.log in production code
    if (/console\.(log|debug)\(/.test(code)) {
      issues.push('Debug statements present');
    }

    // Check for TODO/FIXME comments
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(code)) {
      issues.push('Incomplete work markers found');
    }

    return issues;
  }

  private generateSuggestions(issues: string[], complexity: number): string[] {
    const suggestions: string[] = [];

    if (issues.includes('Very high cyclomatic complexity') || issues.includes('High cyclomatic complexity')) {
      suggestions.push('Consider extracting complex conditions into helper functions');
      suggestions.push('Use early returns to reduce nesting');
    }

    if (issues.includes('Deep nesting detected')) {
      suggestions.push('Flatten nested conditionals using guard clauses');
      suggestions.push('Consider the strategy pattern for complex branching');
    }

    if (issues.includes('Multiple magic numbers detected')) {
      suggestions.push('Extract magic numbers into named constants');
    }

    if (issues.includes('Debug statements present')) {
      suggestions.push('Remove or replace console.log with proper logging');
    }

    if (complexity > 10) {
      suggestions.push('Consider breaking this into smaller functions');
    }

    return suggestions;
  }

  private getMaxIndentation(code: string): number {
    const lines = code.split('\n');
    let maxIndent = 0;

    for (const line of lines) {
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      const level = Math.floor(indent / 2);
      maxIndent = Math.max(maxIndent, level);
    }

    return maxIndent;
  }
}
