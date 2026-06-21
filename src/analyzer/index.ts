/**
 * Code Analyzer Module
 * Analyzes codebases and generates health scores
 */

import { glob } from 'glob';
import type {
  ParsedFile,
  AnalysisResult,
  HealthScore,
  HealthIssue,
  CodeBlock,
  Config,
  Language
} from '../types.js';
import { parseFile, calculateComplexity } from '../parser/index.js';

export interface AnalyzerOptions {
  include: string[];
  exclude: string[];
  basePath: string;
  minComplexity: number;
}

export async function analyzeCodebase(options: AnalyzerOptions): Promise<AnalysisResult> {
  const files = await discoverFiles(options);
  const parsedFiles: ParsedFile[] = [];

  for (const filePath of files) {
    try {
      const parsed = await parseFile(filePath, options.basePath);
      parsedFiles.push(parsed);
    } catch (error) {
      /* v8 ignore next 2 -- parseFile reads UTF-8 from a glob-matched readable file; failure is defensive */
      console.error(`Warning: Could not parse ${filePath}`);
    }
  }

  const languageBreakdown = new Map<Language, number>();
  let totalLines = 0;

  for (const file of parsedFiles) {
    totalLines += file.info.lines;
    const count = languageBreakdown.get(file.info.language) || 0;
    languageBreakdown.set(file.info.language, count + 1);
  }

  const undocumentedBlocks = findUndocumentedBlocks(parsedFiles);
  const complexBlocks = findComplexBlocks(parsedFiles, options.minComplexity);
  const healthScore = calculateHealthScore(parsedFiles, undocumentedBlocks, complexBlocks);

  return {
    files: parsedFiles,
    totalFiles: parsedFiles.length,
    totalLines,
    languageBreakdown,
    healthScore,
    undocumentedBlocks,
    complexBlocks
  };
}

async function discoverFiles(options: AnalyzerOptions): Promise<string[]> {
  const allFiles: string[] = [];

  for (const pattern of options.include) {
    const matches = await glob(pattern, {
      cwd: options.basePath,
      absolute: true,
      ignore: options.exclude,
      nodir: true
    });
    allFiles.push(...matches);
  }

  // Deduplicate
  return [...new Set(allFiles)];
}

function findUndocumentedBlocks(files: ParsedFile[]): CodeBlock[] {
  const undocumented: CodeBlock[] = [];

  for (const file of files) {
    for (const block of file.blocks) {
      // Only check functions, methods, and classes
      if (['function', 'method', 'class'].includes(block.type)) {
        if (!block.documentation) {
          undocumented.push(block);
        }
      }
    }
  }

  return undocumented;
}

function findComplexBlocks(files: ParsedFile[], minComplexity: number): CodeBlock[] {
  const complex: CodeBlock[] = [];

  for (const file of files) {
    for (const block of file.blocks) {
      if (block.complexity && block.complexity >= minComplexity) {
        complex.push(block);
      }
    }
  }

  /* v8 ignore next -- complex blocks always have a truthy complexity (filtered above), so `|| 0` is unreachable */
  return complex.sort((a, b) => (b.complexity || 0) - (a.complexity || 0));
}

function calculateHealthScore(
  files: ParsedFile[],
  undocumentedBlocks: CodeBlock[],
  complexBlocks: CodeBlock[]
): HealthScore {
  const issues: HealthIssue[] = [];
  const suggestions: string[] = [];

  // Calculate documentation score
  let totalDocumentable = 0;
  let documented = 0;

  for (const file of files) {
    for (const block of file.blocks) {
      if (['function', 'method', 'class', 'interface'].includes(block.type)) {
        totalDocumentable++;
        if (block.documentation) {
          documented++;
        }
      }
    }
  }

  const docRatio = totalDocumentable > 0 ? documented / totalDocumentable : 1;
  const documentationScore = Math.round(docRatio * 100);

  // Add documentation issues
  for (const block of undocumentedBlocks) {
    issues.push({
      severity: 'warning',
      message: `${block.type} '${block.name}' is not documented`,
      file: files.find(f => f.blocks.includes(block))?.info.relativePath,
      line: block.startLine,
      rule: 'missing-documentation'
    });
  }

  if (documentationScore < 50) {
    suggestions.push('Add documentation to your functions and classes to improve maintainability');
  }

  // Calculate complexity score
  let totalComplexity = 0;
  let blockCount = 0;

  for (const file of files) {
    for (const block of file.blocks) {
      if (block.complexity) {
        totalComplexity += block.complexity;
        blockCount++;
      }
    }
  }

  const avgComplexity = blockCount > 0 ? totalComplexity / blockCount : 0;
  // Score: 100 if avg <= 5, 0 if avg >= 25
  const complexityScore = Math.max(0, Math.min(100, Math.round(100 - (avgComplexity - 5) * 5)));

  // Add complexity issues
  for (const block of complexBlocks) {
    const severity = block.complexity! >= 20 ? 'error' : 'warning';
    issues.push({
      severity,
      message: `${block.type} '${block.name}' has high complexity (${block.complexity})`,
      file: files.find(f => f.blocks.includes(block))?.info.relativePath,
      line: block.startLine,
      rule: 'high-complexity'
    });
  }

  if (complexBlocks.length > 0) {
    suggestions.push('Consider breaking down complex functions into smaller, more focused functions');
  }

  // Calculate structure score
  let structureScore = 100;
  const avgFileSize = files.reduce((sum, f) => sum + f.info.lines, 0) / (files.length || 1);

  // Penalize large files
  const largeFiles = files.filter(f => f.info.lines > 500);
  if (largeFiles.length > 0) {
    structureScore -= largeFiles.length * 5;
    for (const file of largeFiles) {
      issues.push({
        severity: 'info',
        message: `File has ${file.info.lines} lines - consider splitting`,
        file: file.info.relativePath,
        rule: 'large-file'
      });
    }
    suggestions.push('Consider splitting large files into smaller, more focused modules');
  }

  // Check for too many functions in a file
  const crowdedFiles = files.filter(f => f.blocks.length > 20);
  if (crowdedFiles.length > 0) {
    structureScore -= crowdedFiles.length * 3;
    suggestions.push('Some files have many functions - consider organizing into separate modules');
  }

  structureScore = Math.max(0, structureScore);

  // Calculate maintainability score (combination of factors)
  let maintainabilityScore = 100;

  // Check for deeply nested code (simplified heuristic)
  for (const file of files) {
    for (const block of file.blocks) {
      const maxIndent = getMaxIndentation(block.content);
      if (maxIndent > 4) {
        maintainabilityScore -= 2;
        if (maxIndent > 6) {
          issues.push({
            severity: 'warning',
            message: `Deeply nested code in '${block.name}'`,
            file: file.info.relativePath,
            line: block.startLine,
            rule: 'deep-nesting'
          });
        }
      }
    }
  }

  // Check for very long functions
  for (const file of files) {
    for (const block of file.blocks) {
      const lineCount = block.endLine - block.startLine;
      if (lineCount > 100) {
        maintainabilityScore -= 5;
        issues.push({
          severity: 'warning',
          message: `${block.type} '${block.name}' is ${lineCount} lines long`,
          file: file.info.relativePath,
          line: block.startLine,
          rule: 'long-function'
        });
      }
    }
  }

  maintainabilityScore = Math.max(0, maintainabilityScore);

  if (maintainabilityScore < 70) {
    suggestions.push('Reduce nesting levels and function lengths for better readability');
  }

  // Calculate overall score (weighted average)
  const overall = Math.round(
    documentationScore * 0.3 +
    complexityScore * 0.25 +
    structureScore * 0.2 +
    maintainabilityScore * 0.25
  );

  return {
    overall,
    categories: {
      documentation: documentationScore,
      complexity: complexityScore,
      structure: structureScore,
      maintainability: maintainabilityScore
    },
    issues: issues.sort((a, b) => {
      const severityOrder = { error: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    suggestions: [...new Set(suggestions)]
  };
}

function getMaxIndentation(code: string): number {
  const lines = code.split('\n');
  let maxIndent = 0;

  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const level = Math.floor(indent / 2); // Assuming 2-space indent
    maxIndent = Math.max(maxIndent, level);
  }

  return maxIndent;
}

export function explainCode(code: string, language: Language): string {
  const lines = code.split('\n');
  const explanations: string[] = [];

  // Detect what the code does based on patterns
  const patterns = detectPatterns(code, language);

  if (patterns.length === 0) {
    return 'This code block could not be analyzed automatically.';
  }

  explanations.push('This code:');

  for (const pattern of patterns) {
    explanations.push(`  • ${pattern}`);
  }

  // Add complexity assessment
  const complexity = calculateComplexity(code);
  if (complexity > 10) {
    explanations.push('');
    explanations.push(`⚠️ Complexity: ${complexity} (consider simplifying)`);
  }

  return explanations.join('\n');
}

function detectPatterns(code: string, language: Language): string[] {
  const patterns: string[] = [];

  // Common patterns across languages
  if (/async|await|Promise|Future/.test(code)) {
    patterns.push('Uses asynchronous operations');
  }

  if (/try\s*\{[\s\S]*catch|except|rescue/.test(code)) {
    patterns.push('Includes error handling');
  }

  if (/for\s*\(|for\s+\w+\s+in|\.forEach|\.map\(|\.filter\(|\.reduce\(/.test(code)) {
    patterns.push('Iterates over a collection');
  }

  if (/if\s*\(|if\s+[\w\.]/.test(code)) {
    patterns.push('Contains conditional logic');
  }

  if (/class\s+\w+/.test(code)) {
    patterns.push('Defines a class');
  }

  if (/interface\s+\w+|type\s+\w+\s*=/.test(code)) {
    patterns.push('Defines a type/interface');
  }

  if (/import|require|from\s+['"]/.test(code)) {
    patterns.push('Imports external dependencies');
  }

  if (/export|module\.exports/.test(code)) {
    patterns.push('Exports functionality');
  }

  if (/fetch\(|axios|request|http\./.test(code)) {
    patterns.push('Makes HTTP requests');
  }

  if (/\.query\(|SELECT|INSERT|UPDATE|DELETE|\.find\(|\.findOne\(/.test(code)) {
    patterns.push('Performs database operations');
  }

  if (/console\.log|print\(|fmt\.Print|log\./.test(code)) {
    patterns.push('Includes logging/debugging');
  }

  if (/JSON\.parse|JSON\.stringify|json\.loads|json\.dumps/.test(code)) {
    patterns.push('Handles JSON data');
  }

  if (/new\s+\w+\(|Object\.create|factory|Factory/.test(code)) {
    patterns.push('Creates object instances');
  }

  if (/return\s+[\s\S]*?;?$/.test(code)) {
    patterns.push('Returns a value');
  }

  if (/throw\s+|raise\s+|panic\(/.test(code)) {
    patterns.push('May throw errors');
  }

  if (/\.(on|addEventListener|subscribe)\(/.test(code)) {
    patterns.push('Sets up event listeners');
  }

  if (/useState|useEffect|useCallback|useMemo/.test(code)) {
    patterns.push('Uses React hooks');
  }

  if (/@(Component|Injectable|Service|Controller)/.test(code)) {
    patterns.push('Uses decorators (likely Angular/NestJS)');
  }

  return patterns;
}

export function generateSummary(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    CODEBASE ANALYSIS SUMMARY                   ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Overview
  lines.push('📊 OVERVIEW');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  Files analyzed:     ${result.totalFiles}`);
  lines.push(`  Total lines:        ${result.totalLines.toLocaleString()}`);
  lines.push(`  Languages:          ${Array.from(result.languageBreakdown.keys()).join(', ')}`);
  lines.push('');

  // Health Score
  const score = result.healthScore;
  lines.push('🏥 HEALTH SCORE');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  Overall:            ${getScoreBar(score.overall)} ${score.overall}/100`);
  lines.push(`  Documentation:      ${getScoreBar(score.categories.documentation)} ${score.categories.documentation}/100`);
  lines.push(`  Complexity:         ${getScoreBar(score.categories.complexity)} ${score.categories.complexity}/100`);
  lines.push(`  Structure:          ${getScoreBar(score.categories.structure)} ${score.categories.structure}/100`);
  lines.push(`  Maintainability:    ${getScoreBar(score.categories.maintainability)} ${score.categories.maintainability}/100`);
  lines.push('');

  // Issues summary
  const errors = score.issues.filter(i => i.severity === 'error').length;
  const warnings = score.issues.filter(i => i.severity === 'warning').length;
  const infos = score.issues.filter(i => i.severity === 'info').length;

  lines.push('⚠️  ISSUES');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  🔴 Errors:          ${errors}`);
  lines.push(`  🟡 Warnings:        ${warnings}`);
  lines.push(`  🔵 Info:            ${infos}`);
  lines.push('');

  // Top issues
  if (score.issues.length > 0) {
    lines.push('📋 TOP ISSUES');
    lines.push('───────────────────────────────────────────────────────────────');
    for (const issue of score.issues.slice(0, 5)) {
      const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
      lines.push(`  ${icon} ${issue.message}`);
      if (issue.file) {
        lines.push(`     └─ ${issue.file}:${issue.line}`);
      }
    }
    lines.push('');
  }

  // Suggestions
  if (score.suggestions.length > 0) {
    lines.push('💡 SUGGESTIONS');
    lines.push('───────────────────────────────────────────────────────────────');
    for (const suggestion of score.suggestions) {
      lines.push(`  • ${suggestion}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function getScoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  const color = score >= 80 ? '🟩' : score >= 60 ? '🟨' : score >= 40 ? '🟧' : '🟥';
  return color.repeat(filled) + '⬜'.repeat(empty);
}
