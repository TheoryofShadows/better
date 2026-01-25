#!/usr/bin/env node

/**
 * DocuMate CLI
 * Intelligent code documentation generator and understanding tool
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import Table from 'cli-table3';
import figures from 'figures';
import { readFile, access, mkdir } from 'fs/promises';
import { resolve, basename } from 'path';
import { analyzeCodebase, generateSummary, explainCode } from './analyzer/index.js';
import { generateDocumentation } from './generator/index.js';
import { parseFile, detectLanguage } from './parser/index.js';
import { DEFAULT_CONFIG } from './types.js';
import type { Config, Language } from './types.js';

const VERSION = '1.0.0';

const program = new Command();

// ASCII Art Banner
const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██████╗  ██████╗  ██████╗██╗   ██╗███╗   ███╗ █████╗ ████████║
║   ██╔══██╗██╔═══██╗██╔════╝██║   ██║████╗ ████║██╔══██╗╚══██╔══║
║   ██║  ██║██║   ██║██║     ██║   ██║██╔████╔██║███████║   ██║  ║
║   ██║  ██║██║   ██║██║     ██║   ██║██║╚██╔╝██║██╔══██║   ██║  ║
║   ██████╔╝╚██████╔╝╚██████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║   ██║  ║
║   ╚═════╝  ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝  ║
║                                                               ║
║          Intelligent Code Documentation Generator             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;

program
  .name('documate')
  .description('Intelligent code documentation generator and understanding tool')
  .version(VERSION);

// ============================================================================
// ANALYZE COMMAND
// ============================================================================
program
  .command('analyze')
  .alias('a')
  .description('Analyze codebase and generate health report')
  .option('-p, --path <path>', 'Path to analyze', '.')
  .option('-o, --output <format>', 'Output format (text, json)', 'text')
  .option('--include <patterns>', 'Glob patterns to include (comma-separated)')
  .option('--exclude <patterns>', 'Glob patterns to exclude (comma-separated)')
  .option('--min-complexity <number>', 'Minimum complexity threshold', '10')
  .action(async (options) => {
    console.log(chalk.cyan(banner));

    const spinner = ora('Analyzing codebase...').start();

    try {
      const basePath = resolve(options.path);
      const include = options.include?.split(',') || DEFAULT_CONFIG.include;
      const exclude = options.exclude?.split(',') || DEFAULT_CONFIG.exclude;

      const result = await analyzeCodebase({
        include,
        exclude,
        basePath,
        minComplexity: parseInt(options.minComplexity, 10)
      });

      spinner.succeed(`Analyzed ${result.totalFiles} files`);

      if (options.output === 'json') {
        console.log(JSON.stringify({
          totalFiles: result.totalFiles,
          totalLines: result.totalLines,
          healthScore: result.healthScore,
          languageBreakdown: Object.fromEntries(result.languageBreakdown)
        }, null, 2));
      } else {
        console.log('\n' + generateSummary(result));
      }
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// ============================================================================
// GENERATE COMMAND
// ============================================================================
program
  .command('generate')
  .alias('g')
  .description('Generate documentation for codebase')
  .option('-p, --path <path>', 'Path to analyze', '.')
  .option('-o, --output <dir>', 'Output directory', './docs')
  .option('-f, --format <format>', 'Output format (markdown, html, json)', 'markdown')
  .option('--include-source', 'Include source code in documentation', false)
  .option('--name <name>', 'Project name')
  .option('--no-toc', 'Disable table of contents')
  .action(async (options) => {
    console.log(chalk.cyan(banner));

    const spinner = ora('Generating documentation...').start();

    try {
      const basePath = resolve(options.path);
      const projectName = options.name || basename(basePath);

      spinner.text = 'Analyzing codebase...';

      const result = await analyzeCodebase({
        include: DEFAULT_CONFIG.include,
        exclude: DEFAULT_CONFIG.exclude,
        basePath,
        minComplexity: DEFAULT_CONFIG.minComplexity
      });

      spinner.text = `Generating ${options.format} documentation...`;

      const generatedFiles = await generateDocumentation(
        result.files,
        result.healthScore,
        {
          outputDir: resolve(options.output),
          format: options.format,
          generateTOC: options.toc !== false,
          includeSource: options.includeSource,
          projectName
        }
      );

      spinner.succeed(`Generated ${generatedFiles.length} documentation files`);

      console.log('\n' + boxen(
        chalk.green(`${figures.tick} Documentation generated successfully!\n\n`) +
        chalk.white(`Output directory: ${chalk.cyan(resolve(options.output))}\n\n`) +
        chalk.white('Generated files:\n') +
        generatedFiles.map(f => chalk.gray(`  ${figures.pointer} ${f}`)).join('\n'),
        {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'green'
        }
      ));
    } catch (error) {
      spinner.fail('Documentation generation failed');
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// ============================================================================
// EXPLAIN COMMAND
// ============================================================================
program
  .command('explain <file>')
  .alias('e')
  .description('Explain what a code file does')
  .option('-l, --line <number>', 'Specific line number to explain')
  .option('-f, --function <name>', 'Specific function to explain')
  .action(async (file, options) => {
    const spinner = ora('Reading file...').start();

    try {
      const filePath = resolve(file);

      // Check if file exists
      await access(filePath);

      const basePath = resolve('.');
      const parsed = await parseFile(filePath, basePath);

      spinner.succeed('File analyzed');

      console.log('\n' + boxen(
        chalk.cyan.bold(`📄 ${parsed.info.relativePath}\n`) +
        chalk.gray(`Language: ${parsed.info.language}\n`) +
        chalk.gray(`Lines: ${parsed.info.lines}\n`) +
        chalk.gray(`Size: ${formatBytes(parsed.info.size)}`),
        {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'cyan'
        }
      ));

      // If specific function requested
      if (options.function) {
        const block = parsed.blocks.find(b => b.name === options.function);
        if (block) {
          printBlockExplanation(block, parsed.info.language);
        } else {
          console.log(chalk.yellow(`\n${figures.warning} Function '${options.function}' not found`));
          console.log(chalk.gray('\nAvailable functions:'));
          for (const b of parsed.blocks.filter(b => b.type === 'function' || b.type === 'method')) {
            console.log(chalk.gray(`  ${figures.pointer} ${b.name} (line ${b.startLine})`));
          }
        }
        return;
      }

      // Print imports
      if (parsed.imports.length > 0) {
        console.log(chalk.yellow('\n📦 Dependencies:'));
        const importTable = new Table({
          head: [chalk.white('Source'), chalk.white('Items')],
          style: { head: [], border: [] }
        });
        for (const imp of parsed.imports.slice(0, 10)) {
          importTable.push([imp.source, imp.items.join(', ')]);
        }
        console.log(importTable.toString());
        if (parsed.imports.length > 10) {
          console.log(chalk.gray(`  ...and ${parsed.imports.length - 10} more`));
        }
      }

      // Print exports
      if (parsed.exports.length > 0) {
        console.log(chalk.green('\n📤 Exports:'));
        for (const exp of parsed.exports) {
          console.log(chalk.gray(`  ${figures.pointer} ${exp.name} (${exp.type})`));
        }
      }

      // Print code blocks summary
      if (parsed.blocks.length > 0) {
        console.log(chalk.magenta('\n🔧 Code Structure:'));

        const blockTable = new Table({
          head: [chalk.white('Type'), chalk.white('Name'), chalk.white('Line'), chalk.white('Documented'), chalk.white('Complexity')],
          style: { head: [], border: [] }
        });

        for (const block of parsed.blocks) {
          blockTable.push([
            block.type,
            block.name,
            block.startLine.toString(),
            block.documentation ? chalk.green(figures.tick) : chalk.red(figures.cross),
            block.complexity?.toString() || '-'
          ]);
        }

        console.log(blockTable.toString());

        // Explain undocumented or complex functions
        const needsAttention = parsed.blocks.filter(b =>
          (b.type === 'function' || b.type === 'method') &&
          (!b.documentation || (b.complexity && b.complexity > 10))
        );

        if (needsAttention.length > 0) {
          console.log(chalk.yellow('\n⚠️  Functions needing attention:'));
          for (const block of needsAttention.slice(0, 3)) {
            printBlockExplanation(block, parsed.info.language);
          }
        }
      }
    } catch (error) {
      spinner.fail('Failed to explain file');
      if (error instanceof Error && error.message.includes('ENOENT')) {
        console.error(chalk.red(`Error: File not found: ${file}`));
      } else {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
      process.exit(1);
    }
  });

// ============================================================================
// HEALTH COMMAND
// ============================================================================
program
  .command('health')
  .alias('h')
  .description('Quick health check of codebase')
  .option('-p, --path <path>', 'Path to check', '.')
  .action(async (options) => {
    const spinner = ora('Running health check...').start();

    try {
      const basePath = resolve(options.path);

      const result = await analyzeCodebase({
        include: DEFAULT_CONFIG.include,
        exclude: DEFAULT_CONFIG.exclude,
        basePath,
        minComplexity: 10
      });

      spinner.stop();

      const score = result.healthScore;
      const grade = getGrade(score.overall);

      console.log('\n' + boxen(
        chalk.bold.white('CODEBASE HEALTH CHECK\n\n') +
        `${getScoreEmoji(score.overall)} Overall Score: ${getScoreColor(score.overall)(`${score.overall}/100`)}\n` +
        chalk.gray(`Grade: ${grade}\n\n`) +
        chalk.white('Categories:\n') +
        `  Documentation:    ${getScoreBar(score.categories.documentation)}\n` +
        `  Complexity:       ${getScoreBar(score.categories.complexity)}\n` +
        `  Structure:        ${getScoreBar(score.categories.structure)}\n` +
        `  Maintainability:  ${getScoreBar(score.categories.maintainability)}\n\n` +
        chalk.gray(`Files: ${result.totalFiles} | Lines: ${result.totalLines.toLocaleString()} | Issues: ${score.issues.length}`),
        {
          padding: 1,
          borderStyle: 'double',
          borderColor: getScoreBorderColor(score.overall),
          title: '🏥 Health Report',
          titleAlignment: 'center'
        }
      ));

      // Show top issues
      if (score.issues.length > 0) {
        console.log(chalk.red('\n⚠️  Top Issues:'));
        for (const issue of score.issues.slice(0, 5)) {
          const icon = issue.severity === 'error' ? chalk.red('●') :
            issue.severity === 'warning' ? chalk.yellow('●') : chalk.blue('●');
          console.log(`  ${icon} ${issue.message}`);
          if (issue.file) {
            console.log(chalk.gray(`    └─ ${issue.file}:${issue.line}`));
          }
        }
      }

      // Show suggestions
      if (score.suggestions.length > 0) {
        console.log(chalk.cyan('\n💡 Suggestions:'));
        for (const suggestion of score.suggestions) {
          console.log(chalk.gray(`  ${figures.pointer} ${suggestion}`));
        }
      }
    } catch (error) {
      spinner.fail('Health check failed');
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// ============================================================================
// UNDOCUMENTED COMMAND
// ============================================================================
program
  .command('undocumented')
  .alias('u')
  .description('Find undocumented code')
  .option('-p, --path <path>', 'Path to check', '.')
  .option('--type <type>', 'Filter by type (function, class, method, interface)')
  .action(async (options) => {
    const spinner = ora('Scanning for undocumented code...').start();

    try {
      const basePath = resolve(options.path);

      const result = await analyzeCodebase({
        include: DEFAULT_CONFIG.include,
        exclude: DEFAULT_CONFIG.exclude,
        basePath,
        minComplexity: 10
      });

      spinner.succeed('Scan complete');

      let undocumented = result.undocumentedBlocks;
      if (options.type) {
        undocumented = undocumented.filter(b => b.type === options.type);
      }

      if (undocumented.length === 0) {
        console.log('\n' + boxen(
          chalk.green(`${figures.tick} All code is documented!`),
          { padding: 1, borderStyle: 'round', borderColor: 'green' }
        ));
        return;
      }

      console.log(chalk.yellow(`\n${figures.warning} Found ${undocumented.length} undocumented items:\n`));

      const table = new Table({
        head: [chalk.white('Type'), chalk.white('Name'), chalk.white('File'), chalk.white('Line')],
        style: { head: [], border: [] }
      });

      for (const block of undocumented) {
        const file = result.files.find(f => f.blocks.includes(block));
        table.push([
          block.type,
          block.name,
          file?.info.relativePath || 'unknown',
          block.startLine.toString()
        ]);
      }

      console.log(table.toString());
    } catch (error) {
      spinner.fail('Scan failed');
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// ============================================================================
// COMPLEX COMMAND
// ============================================================================
program
  .command('complex')
  .alias('c')
  .description('Find complex code that needs attention')
  .option('-p, --path <path>', 'Path to check', '.')
  .option('-t, --threshold <number>', 'Complexity threshold', '10')
  .action(async (options) => {
    const spinner = ora('Scanning for complex code...').start();

    try {
      const basePath = resolve(options.path);
      const threshold = parseInt(options.threshold, 10);

      const result = await analyzeCodebase({
        include: DEFAULT_CONFIG.include,
        exclude: DEFAULT_CONFIG.exclude,
        basePath,
        minComplexity: threshold
      });

      spinner.succeed('Scan complete');

      const complex = result.complexBlocks;

      if (complex.length === 0) {
        console.log('\n' + boxen(
          chalk.green(`${figures.tick} No overly complex code found!`),
          { padding: 1, borderStyle: 'round', borderColor: 'green' }
        ));
        return;
      }

      console.log(chalk.yellow(`\n${figures.warning} Found ${complex.length} complex items (threshold: ${threshold}):\n`));

      const table = new Table({
        head: [chalk.white('Complexity'), chalk.white('Type'), chalk.white('Name'), chalk.white('File'), chalk.white('Line')],
        style: { head: [], border: [] }
      });

      for (const block of complex) {
        const file = result.files.find(f => f.blocks.includes(block));
        const complexityColor = block.complexity! >= 20 ? chalk.red : chalk.yellow;
        table.push([
          complexityColor(block.complexity!.toString()),
          block.type,
          block.name,
          file?.info.relativePath || 'unknown',
          block.startLine.toString()
        ]);
      }

      console.log(table.toString());

      console.log(chalk.cyan('\n💡 Tips for reducing complexity:'));
      console.log(chalk.gray('  • Extract complex conditions into well-named helper functions'));
      console.log(chalk.gray('  • Use early returns to avoid deep nesting'));
      console.log(chalk.gray('  • Break large functions into smaller, focused functions'));
      console.log(chalk.gray('  • Consider using polymorphism instead of switch statements'));
    } catch (error) {
      spinner.fail('Scan failed');
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

// ============================================================================
// INIT COMMAND
// ============================================================================
program
  .command('init')
  .description('Initialize DocuMate configuration')
  .action(async () => {
    const configPath = resolve('.documate.json');

    try {
      await access(configPath);
      console.log(chalk.yellow(`${figures.warning} Configuration file already exists at ${configPath}`));
      return;
    } catch {
      // File doesn't exist, create it
    }

    const config: Config = {
      ...DEFAULT_CONFIG
    };

    const { writeFile } = await import('fs/promises');
    await writeFile(configPath, JSON.stringify(config, null, 2));

    console.log('\n' + boxen(
      chalk.green(`${figures.tick} Configuration initialized!\n\n`) +
      chalk.white(`Created: ${chalk.cyan(configPath)}\n\n`) +
      chalk.gray('Edit this file to customize:\n') +
      chalk.gray('  • include/exclude patterns\n') +
      chalk.gray('  • output format and directory\n') +
      chalk.gray('  • complexity thresholds'),
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green'
      }
    ));
  });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function printBlockExplanation(block: any, language: Language) {
  const explanation = explainCode(block.content, language);

  console.log('\n' + boxen(
    chalk.cyan.bold(`${block.type}: ${block.name}\n`) +
    chalk.gray(`Lines ${block.startLine}-${block.endLine}\n\n`) +
    (block.documentation
      ? chalk.green('📝 Documentation:\n') + chalk.white(block.documentation) + '\n\n'
      : chalk.yellow('⚠️  No documentation\n\n')) +
    chalk.magenta('🔍 Analysis:\n') +
    chalk.white(explanation) +
    (block.parameters && block.parameters.length > 0
      ? '\n\n' + chalk.blue('Parameters:\n') +
      block.parameters.map((p: any) =>
        chalk.gray(`  • ${p.name}${p.type ? `: ${p.type}` : ''}${p.optional ? ' (optional)' : ''}`)
      ).join('\n')
      : '') +
    (block.returnType
      ? '\n\n' + chalk.green(`Returns: ${block.returnType}`)
      : ''),
    {
      padding: 1,
      borderStyle: 'round',
      borderColor: block.documentation ? 'green' : 'yellow'
    }
  ));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getScoreEmoji(score: number): string {
  if (score >= 90) return '🌟';
  if (score >= 80) return '✨';
  if (score >= 70) return '👍';
  if (score >= 60) return '😐';
  if (score >= 40) return '😟';
  return '🚨';
}

function getScoreColor(score: number): (text: string) => string {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  if (score >= 40) return chalk.hex('#FFA500');
  return chalk.red;
}

function getScoreBorderColor(score: number): string {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return '#FFA500';
  return 'red';
}

function getScoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  const color = score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : score >= 40 ? chalk.hex('#FFA500') : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty)) + ` ${score}`;
}

function getGrade(score: number): string {
  if (score >= 90) return chalk.green.bold('A');
  if (score >= 80) return chalk.green('B');
  if (score >= 70) return chalk.yellow('C');
  if (score >= 60) return chalk.hex('#FFA500')('D');
  return chalk.red('F');
}

// Parse command line arguments
program.parse();
