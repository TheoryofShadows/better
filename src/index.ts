/**
 * DocuMate - Intelligent Code Documentation Generator
 *
 * Solves the #1 developer pain point: poor/missing documentation
 *
 * Features:
 * - Multi-language code parsing (TypeScript, JavaScript, Python, Java, Go, etc.)
 * - Automatic documentation generation (Markdown, HTML, JSON)
 * - Codebase health scoring and analysis
 * - Code complexity detection
 * - Undocumented code finder
 * - Code explanation and understanding tools
 *
 * @module documate
 */

export * from './types.js';
export * from './parser/index.js';
export * from './analyzer/index.js';
export * from './generator/index.js';

// Re-export commonly used functions
export { parseFile, detectLanguage } from './parser/index.js';
export { analyzeCodebase, explainCode, generateSummary } from './analyzer/index.js';
export { generateDocumentation } from './generator/index.js';
