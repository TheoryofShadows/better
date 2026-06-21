/**
 * OnboardingAgent - Automated Developer Onboarding Guide Generator
 * Creates role-based documentation and learning paths
 *
 * Few-shot example:
 * ```typescript
 * const agent = new OnboardingAgent();
 * const guide = await agent.run({
 *   role: { name: 'New Developer', level: 'junior', focusAreas: ['getting-started'] },
 *   context: { files: parsedFiles, basePath: '/project' }
 * });
 * // Returns: { guide: MarkdownGuide, learningPath: [...], estimatedTime: '4 hours' }
 * ```
 */

import { BaseAgent } from './base.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ParsedFile, OnboardingRole, HealthScore } from '../types.js';

export interface OnboardingInput {
  role: OnboardingRole;
  context: OnboardingContext;
  outputDir?: string;
}

export interface OnboardingContext {
  files: ParsedFile[];
  basePath: string;
  healthScore?: HealthScore;
  projectName?: string;
}

export interface OnboardingOutput {
  guide: OnboardingGuide;
  learningPath: LearningStep[];
  quickStart: string;
  estimatedTime: string;
  generatedFiles: string[];
}

export interface OnboardingGuide {
  title: string;
  overview: string;
  sections: GuideSection[];
  keyFiles: KeyFile[];
  glossary: GlossaryEntry[];
}

export interface GuideSection {
  title: string;
  content: string;
  codeExamples?: CodeExample[];
  relatedFiles?: string[];
}

export interface KeyFile {
  path: string;
  purpose: string;
  importance: 'critical' | 'important' | 'reference';
}

export interface CodeExample {
  title: string;
  code: string;
  language: string;
  explanation: string;
}

export interface LearningStep {
  order: number;
  title: string;
  description: string;
  files: string[];
  estimatedMinutes: number;
  exercises?: string[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  relatedCode?: string;
}

export class OnboardingAgent extends BaseAgent<OnboardingInput, OnboardingOutput> {
  constructor() {
    super('OnboardingAgent');
  }

  protected async execute(input: OnboardingInput): Promise<OnboardingOutput> {
    this.log(`Generating onboarding guide for ${input.role.name} (${input.role.level})`);

    const { role, context } = input;

    // Analyze codebase structure
    const structure = this.analyzeStructure(context.files);

    // Generate guide based on role level
    const guide = this.generateGuide(role, structure, context);

    // Create learning path
    const learningPath = this.generateLearningPath(role, structure, context);

    // Generate quick start
    const quickStart = this.generateQuickStart(context, structure);

    // Calculate estimated time
    const estimatedTime = this.calculateEstimatedTime(learningPath);

    // Write files if output directory specified
    const generatedFiles: string[] = [];
    if (input.outputDir) {
      const files = await this.writeGuideFiles(input.outputDir, guide, learningPath, quickStart, role);
      generatedFiles.push(...files);
    }

    this.log(`Generated ${guide.sections.length} sections, ${learningPath.length} learning steps`);

    return {
      guide,
      learningPath,
      quickStart,
      estimatedTime,
      generatedFiles
    };
  }

  private analyzeStructure(files: ParsedFile[]): CodebaseStructure {
    const structure: CodebaseStructure = {
      entryPoints: [],
      coreModules: [],
      utilities: [],
      tests: [],
      configs: [],
      patterns: []
    };

    for (const file of files) {
      const path = file.info.relativePath.toLowerCase();

      // Identify entry points
      if (path.includes('index') || path.includes('main') || path.includes('app')) {
        structure.entryPoints.push(file);
      }

      // Identify test files
      if (path.includes('test') || path.includes('spec')) {
        structure.tests.push(file);
        continue;
      }

      // Identify config files
      if (path.includes('config') || path.includes('settings')) {
        structure.configs.push(file);
        continue;
      }

      // Identify utilities
      if (path.includes('util') || path.includes('helper') || path.includes('lib')) {
        structure.utilities.push(file);
        continue;
      }

      // Rest are core modules
      structure.coreModules.push(file);
    }

    // Detect patterns
    structure.patterns = this.detectPatterns(files);

    return structure;
  }

  private detectPatterns(files: ParsedFile[]): string[] {
    const patterns: string[] = [];
    const allContent = files.map(f => f.rawContent).join('\n');

    const patternChecks = [
      { pattern: /class\s+\w+Controller/i, name: 'MVC Controllers' },
      { pattern: /class\s+\w+Service/i, name: 'Service Layer' },
      { pattern: /class\s+\w+Repository/i, name: 'Repository Pattern' },
      { pattern: /useState|useEffect|useContext/i, name: 'React Hooks' },
      { pattern: /@Component|@Injectable/i, name: 'Dependency Injection' },
      { pattern: /async\s+function|await\s+/i, name: 'Async/Await' },
      { pattern: /Observable|Subject/i, name: 'Reactive Programming' },
      { pattern: /export\s+default\s+function/i, name: 'Functional Modules' },
      { pattern: /class\s+\w+\s+extends\s+\w+/i, name: 'Class Inheritance' },
      { pattern: /interface\s+\w+/i, name: 'TypeScript Interfaces' }
    ];

    for (const check of patternChecks) {
      if (check.pattern.test(allContent)) {
        patterns.push(check.name);
      }
    }

    return patterns;
  }

  private generateGuide(
    role: OnboardingRole,
    structure: CodebaseStructure,
    context: OnboardingContext
  ): OnboardingGuide {
    const projectName = context.projectName || 'this project';
    const isJunior = role.level === 'junior';
    const isSenior = role.level === 'senior' || role.level === 'lead';

    const sections: GuideSection[] = [];

    // Section 1: Overview
    sections.push({
      title: 'Project Overview',
      content: this.generateOverviewContent(structure, context, isJunior),
      relatedFiles: structure.entryPoints.map(f => f.info.relativePath)
    });

    // Section 2: Architecture (more detail for senior)
    if (role.focusAreas.includes('architecture') || isSenior) {
      sections.push({
        title: 'Architecture',
        content: this.generateArchitectureContent(structure, isSenior),
        codeExamples: this.getArchitectureExamples(structure),
        relatedFiles: structure.coreModules.slice(0, 5).map(f => f.info.relativePath)
      });
    }

    // Section 3: Getting Started (essential for juniors)
    if (role.focusAreas.includes('getting-started') || isJunior) {
      sections.push({
        title: 'Getting Started',
        content: this.generateGettingStartedContent(structure),
        codeExamples: this.getGettingStartedExamples(structure)
      });
    }

    // Section 4: Patterns and Conventions
    if (role.focusAreas.includes('patterns') || isSenior) {
      sections.push({
        title: 'Patterns and Conventions',
        content: this.generatePatternsContent(structure),
        codeExamples: this.getPatternExamples(structure)
      });
    }

    // Section 5: Deep Dive
    if (role.focusAreas.includes('deep-dive')) {
      sections.push({
        title: 'Deep Dive',
        content: this.generateDeepDiveContent(structure, context)
      });
    }

    // Key files
    const keyFiles = this.identifyKeyFiles(structure, role);

    // Glossary
    const glossary = this.generateGlossary(structure, context.files);

    return {
      title: `${projectName} - ${role.name} Onboarding Guide`,
      overview: `Welcome to ${projectName}! This guide is tailored for your role as ${role.name}.`,
      sections,
      keyFiles,
      glossary
    };
  }

  private generateOverviewContent(
    structure: CodebaseStructure,
    context: OnboardingContext,
    detailed: boolean
  ): string {
    let content = `## What This Project Does\n\n`;

    content += `This codebase contains ${context.files.length} source files `;
    content += `organized into ${structure.coreModules.length} core modules.\n\n`;

    if (structure.patterns.length > 0) {
      content += `### Key Patterns Used\n\n`;
      content += structure.patterns.map(p => `- ${p}`).join('\n');
      content += '\n\n';
    }

    if (detailed && context.healthScore) {
      content += `### Code Health\n\n`;
      content += `The codebase has a health score of ${context.healthScore.overall}/100.\n`;
    }

    return content;
  }

  private generateArchitectureContent(structure: CodebaseStructure, detailed: boolean): string {
    let content = `## Architecture Overview\n\n`;

    content += `### Directory Structure\n\n`;
    content += '```\n';
    content += this.generateDirectoryTree(structure);
    content += '```\n\n';

    if (structure.entryPoints.length > 0) {
      content += `### Entry Points\n\n`;
      for (const entry of structure.entryPoints.slice(0, 3)) {
        content += `- \`${entry.info.relativePath}\`: Main entry point\n`;
      }
      content += '\n';
    }

    if (detailed && structure.coreModules.length > 0) {
      content += `### Core Modules\n\n`;
      for (const mod of structure.coreModules.slice(0, 5)) {
        const classes = mod.blocks.filter(b => b.type === 'class');
        const funcs = mod.blocks.filter(b => b.type === 'function');
        content += `- \`${mod.info.relativePath}\`: `;
        content += `${classes.length} classes, ${funcs.length} functions\n`;
      }
    }

    return content;
  }

  private generateGettingStartedContent(structure: CodebaseStructure): string {
    let content = `## Getting Started\n\n`;

    content += `### Prerequisites\n\n`;
    content += `- Node.js 18+ installed\n`;
    content += `- npm or yarn package manager\n\n`;

    content += `### Installation\n\n`;
    content += '```bash\n';
    content += 'npm install\n';
    content += '```\n\n';

    content += `### Running the Project\n\n`;
    content += '```bash\n';
    content += 'npm run dev  # Development mode\n';
    content += 'npm run build  # Build for production\n';
    content += 'npm test  # Run tests\n';
    content += '```\n\n';

    content += `### First Steps\n\n`;
    content += `1. Start by exploring the entry points\n`;
    content += `2. Read through the main configuration\n`;
    content += `3. Run the test suite to verify setup\n`;

    return content;
  }

  private generatePatternsContent(structure: CodebaseStructure): string {
    let content = `## Patterns and Conventions\n\n`;

    for (const pattern of structure.patterns) {
      content += `### ${pattern}\n\n`;
      content += this.explainPattern(pattern);
      content += '\n\n';
    }

    content += `### Naming Conventions\n\n`;
    content += `- Files: kebab-case (e.g., \`my-component.ts\`)\n`;
    content += `- Classes: PascalCase (e.g., \`MyComponent\`)\n`;
    content += `- Functions: camelCase (e.g., \`myFunction\`)\n`;
    content += `- Constants: UPPER_SNAKE_CASE (e.g., \`MAX_SIZE\`)\n`;

    return content;
  }

  private generateDeepDiveContent(
    structure: CodebaseStructure,
    context: OnboardingContext
  ): string {
    let content = `## Deep Dive\n\n`;

    // Find most complex modules
    const complexModules = structure.coreModules
      .filter(f => f.blocks.some(b => b.complexity && b.complexity > 10))
      .slice(0, 5);

    if (complexModules.length > 0) {
      content += `### Complex Areas to Study\n\n`;
      for (const mod of complexModules) {
        const complex = mod.blocks.filter(b => b.complexity && b.complexity > 10);
        content += `- \`${mod.info.relativePath}\`: ${complex.length} complex functions\n`;
      }
      content += '\n';
    }

    // Key integrations
    content += `### Key Dependencies\n\n`;
    const deps = new Set<string>();
    for (const file of context.files) {
      for (const imp of file.imports) {
        if (!imp.source.startsWith('.')) {
          deps.add(imp.source);
        }
      }
    }
    for (const dep of Array.from(deps).slice(0, 10)) {
      content += `- \`${dep}\`\n`;
    }

    return content;
  }

  private generateDirectoryTree(structure: CodebaseStructure): string {
    const dirs = new Set<string>();

    const allFiles = [
      ...structure.entryPoints,
      ...structure.coreModules,
      ...structure.utilities
    ];

    for (const file of allFiles) {
      const parts = file.info.relativePath.split('/');
      if (parts.length > 1) {
        dirs.add(parts[0]);
      }
    }

    let tree = '.\n';
    for (const dir of Array.from(dirs).sort()) {
      tree += `├── ${dir}/\n`;
    }
    tree += `└── package.json\n`;

    return tree;
  }

  private explainPattern(pattern: string): string {
    const explanations: Record<string, string> = {
      'MVC Controllers': 'Controllers handle HTTP requests and delegate to services.',
      'Service Layer': 'Services contain business logic, separate from controllers.',
      'Repository Pattern': 'Repositories abstract data access from business logic.',
      'React Hooks': 'Custom hooks encapsulate reusable stateful logic.',
      'Dependency Injection': 'Dependencies are injected rather than instantiated directly.',
      'Async/Await': 'Asynchronous operations are handled with async/await syntax.',
      'Reactive Programming': 'Uses Observables for event streams and async data.',
      'Functional Modules': 'Modules export functions rather than classes.',
      'Class Inheritance': 'Classes extend base classes for shared behavior.',
      'TypeScript Interfaces': 'Interfaces define contracts for type safety.'
    };

    /* v8 ignore next -- detectPatterns only ever yields names present in the map above */
    return explanations[pattern] || `The ${pattern} pattern is used throughout the codebase.`;
  }

  private getArchitectureExamples(structure: CodebaseStructure): CodeExample[] {
    const examples: CodeExample[] = [];

    if (structure.entryPoints.length > 0) {
      const entry = structure.entryPoints[0];
      const mainFunc = entry.blocks.find(b => b.type === 'function');
      if (mainFunc) {
        examples.push({
          title: 'Entry Point',
          code: mainFunc.content.slice(0, 200) + '...',
          language: entry.info.language,
          explanation: 'This is the main entry point of the application.'
        });
      }
    }

    return examples;
  }

  private getGettingStartedExamples(structure: CodebaseStructure): CodeExample[] {
    return [{
      title: 'Basic Usage',
      code: `// Import the main module
import { main } from './index';

// Run the application
main();`,
      language: 'typescript',
      explanation: 'Basic example of how to use the main module.'
    }];
  }

  private getPatternExamples(structure: CodebaseStructure): CodeExample[] {
    const examples: CodeExample[] = [];

    for (const pattern of structure.patterns.slice(0, 2)) {
      examples.push({
        title: pattern,
        code: `// Example of ${pattern} pattern`,
        language: 'typescript',
        explanation: this.explainPattern(pattern)
      });
    }

    return examples;
  }

  private identifyKeyFiles(
    structure: CodebaseStructure,
    role: OnboardingRole
  ): KeyFile[] {
    const keyFiles: KeyFile[] = [];

    // Entry points are critical
    for (const entry of structure.entryPoints.slice(0, 2)) {
      keyFiles.push({
        path: entry.info.relativePath,
        purpose: 'Main entry point',
        importance: 'critical'
      });
    }

    // Core modules are important
    for (const mod of structure.coreModules.slice(0, 3)) {
      keyFiles.push({
        path: mod.info.relativePath,
        purpose: 'Core functionality',
        importance: 'important'
      });
    }

    // Utilities for reference
    for (const util of structure.utilities.slice(0, 2)) {
      keyFiles.push({
        path: util.info.relativePath,
        purpose: 'Utility functions',
        importance: 'reference'
      });
    }

    return keyFiles;
  }

  private generateGlossary(
    structure: CodebaseStructure,
    files: ParsedFile[]
  ): GlossaryEntry[] {
    const glossary: GlossaryEntry[] = [];
    const terms = new Set<string>();

    // Extract class names
    for (const file of files) {
      for (const block of file.blocks) {
        if (block.type === 'class' && !terms.has(block.name)) {
          terms.add(block.name);
          glossary.push({
            term: block.name,
            definition: block.documentation || `A ${block.type} in ${file.info.relativePath}`,
            relatedCode: file.info.relativePath
          });
        }
      }
    }

    return glossary.slice(0, 20);
  }

  private generateLearningPath(
    role: OnboardingRole,
    structure: CodebaseStructure,
    context: OnboardingContext
  ): LearningStep[] {
    const steps: LearningStep[] = [];
    let order = 1;

    // Step 1: Setup
    steps.push({
      order: order++,
      title: 'Environment Setup',
      description: 'Install dependencies and verify the project runs',
      files: ['package.json', 'tsconfig.json'],
      estimatedMinutes: 30,
      exercises: ['Run npm install', 'Run npm test', 'Start the development server']
    });

    // Step 2: Entry Points
    if (structure.entryPoints.length > 0) {
      steps.push({
        order: order++,
        title: 'Explore Entry Points',
        description: 'Understand how the application starts',
        files: structure.entryPoints.slice(0, 3).map(f => f.info.relativePath),
        estimatedMinutes: 45
      });
    }

    // Step 3: Core Modules (adjusted by level)
    const moduleCount = role.level === 'junior' ? 2 : role.level === 'mid' ? 4 : 6;
    if (structure.coreModules.length > 0) {
      steps.push({
        order: order++,
        title: 'Study Core Modules',
        description: 'Deep dive into main functionality',
        files: structure.coreModules.slice(0, moduleCount).map(f => f.info.relativePath),
        estimatedMinutes: 60 * moduleCount / 2
      });
    }

    // Step 4: Patterns
    if (structure.patterns.length > 0) {
      steps.push({
        order: order++,
        title: 'Learn the Patterns',
        description: `Understand: ${structure.patterns.slice(0, 3).join(', ')}`,
        files: [],
        estimatedMinutes: 45
      });
    }

    // Step 5: Tests (if available)
    if (structure.tests.length > 0) {
      steps.push({
        order: order++,
        title: 'Review Test Suite',
        description: 'Understand how testing works in this project',
        files: structure.tests.slice(0, 3).map(f => f.info.relativePath),
        estimatedMinutes: 30,
        exercises: ['Run the test suite', 'Write a simple test']
      });
    }

    return steps;
  }

  private generateQuickStart(
    context: OnboardingContext,
    structure: CodebaseStructure
  ): string {
    const projectName = context.projectName || 'the project';

    let content = `# Quick Start Guide\n\n`;
    content += `## TL;DR\n\n`;
    content += '```bash\n';
    content += 'git clone <repo-url>\n';
    content += 'cd <project>\n';
    content += 'npm install\n';
    content += 'npm run dev\n';
    content += '```\n\n';

    content += `## Key Files\n\n`;
    for (const entry of structure.entryPoints.slice(0, 3)) {
      content += `- \`${entry.info.relativePath}\` - Entry point\n`;
    }

    content += `\n## Need Help?\n\n`;
    content += `- Check the full onboarding guide\n`;
    content += `- Ask the team in #dev-help\n`;

    return content;
  }

  private calculateEstimatedTime(learningPath: LearningStep[]): string {
    const totalMinutes = learningPath.reduce((sum, step) => sum + step.estimatedMinutes, 0);

    if (totalMinutes < 60) {
      return `${totalMinutes} minutes`;
    }
    /* v8 ignore next 2 -- the generated learning path tops out at ~330 minutes, never >= 480 (days) */
    if (totalMinutes >= 480) {
      return `${Math.round(totalMinutes / 480)} days`;
    }
    return `${Math.round(totalMinutes / 60)} hours`;
  }

  private async writeGuideFiles(
    outputDir: string,
    guide: OnboardingGuide,
    learningPath: LearningStep[],
    quickStart: string,
    role: OnboardingRole
  ): Promise<string[]> {
    const files: string[] = [];

    await mkdir(outputDir, { recursive: true });

    // Write main guide
    const guidePath = join(outputDir, `onboarding-${role.level}.md`);
    const guideContent = this.renderGuideToMarkdown(guide);
    await writeFile(guidePath, guideContent);
    files.push(guidePath);

    // Write quick start
    const quickStartPath = join(outputDir, 'QUICK_START.md');
    await writeFile(quickStartPath, quickStart);
    files.push(quickStartPath);

    // Write learning path
    const learningPath_Path = join(outputDir, `learning-path-${role.level}.md`);
    const learningContent = this.renderLearningPathToMarkdown(learningPath);
    await writeFile(learningPath_Path, learningContent);
    files.push(learningPath_Path);

    return files;
  }

  private renderGuideToMarkdown(guide: OnboardingGuide): string {
    let md = `# ${guide.title}\n\n`;
    md += `${guide.overview}\n\n`;

    for (const section of guide.sections) {
      md += `${section.content}\n\n`;

      if (section.codeExamples) {
        for (const example of section.codeExamples) {
          md += `**${example.title}**\n\n`;
          md += '```' + example.language + '\n';
          md += example.code + '\n';
          md += '```\n\n';
          md += `_${example.explanation}_\n\n`;
        }
      }
    }

    if (guide.keyFiles.length > 0) {
      md += `## Key Files\n\n`;
      for (const file of guide.keyFiles) {
        const icon = file.importance === 'critical' ? '🔴' :
          file.importance === 'important' ? '🟡' : '⚪';
        md += `${icon} \`${file.path}\` - ${file.purpose}\n`;
      }
      md += '\n';
    }

    if (guide.glossary.length > 0) {
      md += `## Glossary\n\n`;
      for (const entry of guide.glossary) {
        md += `**${entry.term}**: ${entry.definition}\n`;
      }
    }

    return md;
  }

  private renderLearningPathToMarkdown(learningPath: LearningStep[]): string {
    let md = `# Learning Path\n\n`;

    for (const step of learningPath) {
      md += `## ${step.order}. ${step.title}\n\n`;
      md += `_Estimated time: ${step.estimatedMinutes} minutes_\n\n`;
      md += `${step.description}\n\n`;

      if (step.files.length > 0) {
        md += `**Files to study:**\n`;
        for (const file of step.files) {
          md += `- \`${file}\`\n`;
        }
        md += '\n';
      }

      if (step.exercises) {
        md += `**Exercises:**\n`;
        for (const exercise of step.exercises) {
          md += `- [ ] ${exercise}\n`;
        }
        md += '\n';
      }
    }

    return md;
  }
}

interface CodebaseStructure {
  entryPoints: ParsedFile[];
  coreModules: ParsedFile[];
  utilities: ParsedFile[];
  tests: ParsedFile[];
  configs: ParsedFile[];
  patterns: string[];
}
