/**
 * FixAgent - Automated Code Fix and PR Creation Agent
 * Generates documentation, refactors code, and creates pull requests
 */

import { BaseAgent } from './base.js';
import { Octokit } from '@octokit/rest';
import simpleGit, { SimpleGit } from 'simple-git';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, basename } from 'path';
import { createPatch } from 'diff';
import type { ParsedFile, CodeBlock, Language } from '../types.js';
import type { FixSuggestion, PRInfo } from './types.js';

export interface FixInput {
  files: ParsedFile[];
  basePath: string;
  fixes: FixType[];
  dryRun?: boolean;
  createPR?: boolean;
  githubToken?: string;
  repoOwner?: string;
  repoName?: string;
}

export type FixType = 'documentation' | 'complexity' | 'style' | 'all';

export interface FixOutput {
  suggestions: FixSuggestion[];
  appliedFixes: AppliedFix[];
  pr?: PRInfo;
  summary: FixSummary;
}

export interface AppliedFix {
  file: string;
  line: number;
  type: FixType;
  description: string;
  diff: string;
}

export interface FixSummary {
  totalSuggestions: number;
  appliedFixes: number;
  skippedFixes: number;
  filesModified: number;
}

export class FixAgent extends BaseAgent<FixInput, FixOutput> {
  private git: SimpleGit | null = null;
  private octokit: Octokit | null = null;

  constructor() {
    super('FixAgent');
  }

  protected async execute(input: FixInput): Promise<FixOutput> {
    this.log('Starting automated fix analysis');

    // Initialize git
    this.git = simpleGit(input.basePath);

    // Initialize GitHub if token provided
    if (input.githubToken) {
      this.octokit = new Octokit({ auth: input.githubToken });
    }

    // Generate all fix suggestions
    const suggestions = await this.generateSuggestions(input.files, input.fixes);
    this.log(`Generated ${suggestions.length} fix suggestions`);

    const appliedFixes: AppliedFix[] = [];
    const modifiedFiles = new Set<string>();

    if (!input.dryRun) {
      // Create a new branch for fixes
      const branchName = `documate/auto-fix-${Date.now()}`;
      await this.createBranch(branchName);

      // Apply fixes
      for (const suggestion of suggestions) {
        try {
          const applied = await this.applyFix(suggestion, input.basePath);
          if (applied) {
            appliedFixes.push(applied);
            modifiedFiles.add(suggestion.file);
          }
        } catch (error) {
          this.log(`Warning: Could not apply fix to ${suggestion.file}: ${error}`);
        }
      }

      // Commit changes
      if (appliedFixes.length > 0) {
        await this.commitChanges(appliedFixes);
        this.log(`Committed ${appliedFixes.length} fixes`);
      }

      // Create PR if requested
      let pr: PRInfo | undefined;
      if (input.createPR && this.octokit && input.repoOwner && input.repoName) {
        pr = await this.createPullRequest(
          input.repoOwner,
          input.repoName,
          branchName,
          appliedFixes
        );
      }

      return {
        suggestions,
        appliedFixes,
        pr,
        summary: {
          totalSuggestions: suggestions.length,
          appliedFixes: appliedFixes.length,
          skippedFixes: suggestions.length - appliedFixes.length,
          filesModified: modifiedFiles.size
        }
      };
    }

    // Dry run - just return suggestions
    return {
      suggestions,
      appliedFixes: [],
      summary: {
        totalSuggestions: suggestions.length,
        appliedFixes: 0,
        skippedFixes: suggestions.length,
        filesModified: 0
      }
    };
  }

  private async generateSuggestions(
    files: ParsedFile[],
    fixTypes: FixType[]
  ): Promise<FixSuggestion[]> {
    const suggestions: FixSuggestion[] = [];
    const shouldFix = (type: FixType) =>
      fixTypes.includes('all') || fixTypes.includes(type);

    for (const file of files) {
      for (const block of file.blocks) {
        // Documentation fixes
        if (shouldFix('documentation') && !block.documentation) {
          if (['function', 'method', 'class', 'interface'].includes(block.type)) {
            const doc = this.generateDocumentation(block, file.info.language);
            suggestions.push({
              file: file.info.relativePath,
              line: block.startLine,
              type: 'documentation',
              description: `Add documentation to ${block.type} '${block.name}'`,
              originalCode: block.content.split('\n')[0],
              suggestedCode: doc + '\n' + block.content.split('\n')[0],
              confidence: 0.9
            });
          }
        }

        // Complexity fixes (suggestions only - too risky to auto-apply)
        if (shouldFix('complexity') && block.complexity && block.complexity > 15) {
          suggestions.push({
            file: file.info.relativePath,
            line: block.startLine,
            type: 'complexity',
            description: `Consider refactoring '${block.name}' (complexity: ${block.complexity})`,
            originalCode: this.truncateCode(block.content),
            suggestedCode: this.suggestRefactoring(block),
            confidence: 0.6
          });
        }

        // Style fixes
        if (shouldFix('style')) {
          const styleIssues = this.detectStyleIssues(block.content);
          for (const issue of styleIssues) {
            suggestions.push({
              file: file.info.relativePath,
              line: block.startLine + issue.lineOffset,
              type: 'style',
              description: issue.description,
              originalCode: issue.original,
              suggestedCode: issue.suggested,
              confidence: 0.8
            });
          }
        }
      }
    }

    // Sort by confidence (highest first)
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  private generateDocumentation(block: CodeBlock, language: Language): string {
    const params = block.parameters || [];
    const returnType = block.returnType;

    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.generateJSDoc(block, params, returnType);
      case 'python':
        return this.generatePythonDocstring(block, params, returnType);
      case 'java':
        return this.generateJavadoc(block, params, returnType);
      case 'go':
        return this.generateGoDoc(block);
      default:
        return this.generateGenericDoc(block);
    }
  }

  private generateJSDoc(
    block: CodeBlock,
    params: Array<{ name: string; type?: string; optional?: boolean }>,
    returnType?: string
  ): string {
    const lines = ['/**'];
    lines.push(` * ${this.inferDescription(block)}`);

    if (params.length > 0) {
      lines.push(' *');
      for (const param of params) {
        const type = param.type || 'any';
        const opt = param.optional ? ' [optional]' : '';
        lines.push(` * @param {${type}} ${param.name}${opt} - Description needed`);
      }
    }

    if (returnType && returnType !== 'void') {
      lines.push(` * @returns {${returnType}} Description needed`);
    }

    lines.push(' */');
    return lines.join('\n');
  }

  private generatePythonDocstring(
    block: CodeBlock,
    params: Array<{ name: string; type?: string }>,
    returnType?: string
  ): string {
    const lines = ['    """'];
    lines.push(`    ${this.inferDescription(block)}`);

    if (params.length > 0) {
      lines.push('');
      lines.push('    Args:');
      for (const param of params) {
        const type = param.type ? ` (${param.type})` : '';
        lines.push(`        ${param.name}${type}: Description needed`);
      }
    }

    if (returnType && returnType !== 'None') {
      lines.push('');
      lines.push('    Returns:');
      lines.push(`        ${returnType}: Description needed`);
    }

    lines.push('    """');
    return lines.join('\n');
  }

  private generateJavadoc(
    block: CodeBlock,
    params: Array<{ name: string; type?: string }>,
    returnType?: string
  ): string {
    const lines = ['/**'];
    lines.push(` * ${this.inferDescription(block)}`);

    if (params.length > 0) {
      lines.push(' *');
      for (const param of params) {
        lines.push(` * @param ${param.name} Description needed`);
      }
    }

    if (returnType && returnType !== 'void') {
      lines.push(` * @return Description needed`);
    }

    lines.push(' */');
    return lines.join('\n');
  }

  private generateGoDoc(block: CodeBlock): string {
    return `// ${block.name} - ${this.inferDescription(block)}`;
  }

  private generateGenericDoc(block: CodeBlock): string {
    return `// ${this.inferDescription(block)}`;
  }

  private inferDescription(block: CodeBlock): string {
    const name = block.name;

    // Common patterns
    if (name.startsWith('get')) {
      return `Retrieves ${this.camelToWords(name.slice(3))}`;
    }
    if (name.startsWith('set')) {
      return `Sets ${this.camelToWords(name.slice(3))}`;
    }
    if (name.startsWith('is') || name.startsWith('has') || name.startsWith('can')) {
      return `Checks if ${this.camelToWords(name.slice(2))}`;
    }
    if (name.startsWith('create') || name.startsWith('make')) {
      return `Creates ${this.camelToWords(name.slice(name.startsWith('create') ? 6 : 4))}`;
    }
    if (name.startsWith('delete') || name.startsWith('remove')) {
      return `Removes ${this.camelToWords(name.slice(6))}`;
    }
    if (name.startsWith('update')) {
      return `Updates ${this.camelToWords(name.slice(6))}`;
    }
    if (name.startsWith('handle')) {
      return `Handles ${this.camelToWords(name.slice(6))}`;
    }
    if (name.startsWith('on')) {
      return `Event handler for ${this.camelToWords(name.slice(2))}`;
    }
    if (name.startsWith('render')) {
      return `Renders ${this.camelToWords(name.slice(6))}`;
    }
    if (name.startsWith('parse')) {
      return `Parses ${this.camelToWords(name.slice(5))}`;
    }
    if (name.startsWith('validate')) {
      return `Validates ${this.camelToWords(name.slice(8))}`;
    }
    if (name.startsWith('fetch') || name.startsWith('load')) {
      return `Fetches ${this.camelToWords(name.slice(name.startsWith('fetch') ? 5 : 4))}`;
    }
    if (name.startsWith('save') || name.startsWith('store')) {
      return `Saves ${this.camelToWords(name.slice(4))}`;
    }
    if (name.startsWith('init') || name.startsWith('setup')) {
      return `Initializes ${this.camelToWords(name.slice(name.startsWith('init') ? 4 : 5))}`;
    }

    // Default description
    return `${this.camelToWords(name)} - TODO: Add description`;
  }

  private camelToWords(str: string): string {
    if (!str) return 'the value';
    return str
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
  }

  private truncateCode(code: string, maxLines: number = 5): string {
    const lines = code.split('\n');
    if (lines.length <= maxLines) return code;
    return lines.slice(0, maxLines).join('\n') + '\n// ...';
  }

  private suggestRefactoring(block: CodeBlock): string {
    // Generate a high-level refactoring suggestion
    const suggestions = [
      '// Suggested refactoring:',
      '// 1. Extract helper functions for complex conditions',
      '// 2. Use early returns to reduce nesting',
      '// 3. Consider breaking into smaller, focused functions',
      '// 4. Apply the Single Responsibility Principle'
    ];

    if (block.complexity && block.complexity > 20) {
      suggestions.push('// 5. Consider redesigning this function entirely');
    }

    return suggestions.join('\n');
  }

  private detectStyleIssues(code: string): Array<{
    lineOffset: number;
    description: string;
    original: string;
    suggested: string;
  }> {
    const issues: Array<{
      lineOffset: number;
      description: string;
      original: string;
      suggested: string;
    }> = [];

    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for console.log
      if (/console\.(log|debug)\(/.test(line)) {
        issues.push({
          lineOffset: i,
          description: 'Remove or replace console.log with proper logging',
          original: line,
          suggested: line.replace(/console\.(log|debug)/, 'logger.debug')
        });
      }

      // Check for == instead of ===
      if (/[^=!]==[^=]/.test(line)) {
        issues.push({
          lineOffset: i,
          description: 'Use strict equality (===) instead of loose equality (==)',
          original: line,
          suggested: line.replace(/([^=!])={2}([^=])/g, '$1===$2')
        });
      }

      // Check for != instead of !==
      if (/!=[^=]/.test(line)) {
        issues.push({
          lineOffset: i,
          description: 'Use strict inequality (!==) instead of loose inequality (!=)',
          original: line,
          suggested: line.replace(/!=([^=])/g, '!==$1')
        });
      }

      // Check for var usage
      if (/\bvar\s+\w+/.test(line)) {
        issues.push({
          lineOffset: i,
          description: 'Use const or let instead of var',
          original: line,
          suggested: line.replace(/\bvar\b/g, 'const')
        });
      }
    }

    return issues;
  }

  private async createBranch(branchName: string): Promise<void> {
    if (!this.git) return;

    try {
      await this.git.checkoutLocalBranch(branchName);
      this.log(`Created branch: ${branchName}`);
    } catch (error) {
      this.log(`Warning: Could not create branch: ${error}`);
    }
  }

  private async applyFix(
    suggestion: FixSuggestion,
    basePath: string
  ): Promise<AppliedFix | null> {
    // Only apply high-confidence documentation fixes
    if (suggestion.type !== 'documentation' || suggestion.confidence < 0.85) {
      return null;
    }

    try {
      const filePath = resolve(basePath, suggestion.file);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Insert documentation before the target line
      const targetLine = suggestion.line - 1;
      const docLines = suggestion.suggestedCode.split('\n').slice(0, -1); // Remove the repeated first line

      lines.splice(targetLine, 0, ...docLines);

      const newContent = lines.join('\n');
      const diff = createPatch(suggestion.file, content, newContent);

      await writeFile(filePath, newContent);

      return {
        file: suggestion.file,
        line: suggestion.line,
        type: 'documentation',
        description: suggestion.description,
        diff
      };
    } catch (error) {
      this.log(`Error applying fix: ${error}`);
      return null;
    }
  }

  private async commitChanges(fixes: AppliedFix[]): Promise<void> {
    if (!this.git) return;

    try {
      const files = [...new Set(fixes.map(f => f.file))];
      await this.git.add(files);

      const message = `docs: Auto-generated documentation for ${fixes.length} items\n\n` +
        `Files modified:\n${files.map(f => `- ${f}`).join('\n')}\n\n` +
        `Generated by DocuMate v2.0`;

      await this.git.commit(message);
      this.log('Changes committed');
    } catch (error) {
      this.log(`Warning: Could not commit changes: ${error}`);
    }
  }

  private async createPullRequest(
    owner: string,
    repo: string,
    branchName: string,
    fixes: AppliedFix[]
  ): Promise<PRInfo | undefined> {
    if (!this.octokit || !this.git) return undefined;

    try {
      // Push branch
      await this.git.push('origin', branchName, ['--set-upstream']);

      // Get default branch
      const { data: repoData } = await this.octokit.repos.get({ owner, repo });
      const baseBranch = repoData.default_branch;

      // Create PR
      const title = `[DocuMate] Auto-generated documentation (${fixes.length} items)`;
      const body = this.generatePRBody(fixes);

      const { data: pr } = await this.octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head: branchName,
        base: baseBranch
      });

      this.log(`Created PR: ${pr.html_url}`);

      return {
        title,
        body,
        branch: branchName,
        baseBranch,
        files: [...new Set(fixes.map(f => f.file))],
        url: pr.html_url
      };
    } catch (error) {
      this.log(`Warning: Could not create PR: ${error}`);
      return undefined;
    }
  }

  private generatePRBody(fixes: AppliedFix[]): string {
    const fileGroups = new Map<string, AppliedFix[]>();
    for (const fix of fixes) {
      const group = fileGroups.get(fix.file) || [];
      group.push(fix);
      fileGroups.set(fix.file, group);
    }

    let body = `## Summary\n\n`;
    body += `This PR was automatically generated by DocuMate to improve code documentation.\n\n`;
    body += `### Changes\n\n`;
    body += `- Added documentation to ${fixes.length} undocumented items\n`;
    body += `- Modified ${fileGroups.size} files\n\n`;

    body += `### Files Modified\n\n`;
    for (const [file, fileFixes] of fileGroups) {
      body += `#### \`${file}\`\n`;
      for (const fix of fileFixes) {
        body += `- Line ${fix.line}: ${fix.description}\n`;
      }
      body += '\n';
    }

    body += `### Test Plan\n\n`;
    body += `- [ ] Verify documentation accuracy\n`;
    body += `- [ ] Review generated JSDoc/docstrings\n`;
    body += `- [ ] Run existing tests to ensure no regressions\n\n`;

    body += `---\n`;
    body += `*Generated by [DocuMate](https://github.com/documate) v2.0*`;

    return body;
  }
}
