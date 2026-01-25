/**
 * DocuMate - AI-Powered Code Intelligence Platform
 *
 * Solves the top developer pain points:
 * - Poor/missing documentation (38% of developers, JetBrains 2025)
 * - Context switching (28% productivity loss, Atlassian)
 * - Technical debt (23-42% of development time)
 * - Slow onboarding (4-6 weeks average)
 *
 * Features:
 * - Multi-language code parsing (TypeScript, JavaScript, Python, Java, Go, etc.)
 * - Automatic documentation generation (Markdown, HTML, JSON)
 * - Codebase health scoring and analysis
 * - Technical debt prediction with AI agents
 * - Automated fix suggestions and PR creation
 * - Context-aware code explanation with chat mode
 *
 * @module documate
 * @version 2.0.0
 */

// Type exports
export * from './types.js';

// Parser exports
export * from './parser/index.js';
export { parseFile, detectLanguage, calculateComplexity } from './parser/index.js';

// Analyzer exports
export * from './analyzer/index.js';
export { analyzeCodebase, explainCode, generateSummary } from './analyzer/index.js';

// Generator exports
export * from './generator/index.js';
export { generateDocumentation } from './generator/index.js';

// Agent system exports
export * from './agents/index.js';
export {
  createOrchestrator,
  DEFAULT_AGENT_CONFIG,
  ParseAgent,
  BlockAnalyzer,
  PredictAgent,
  FixAgent,
  ExplainAgent,
  ChatAgent,
  AgentOrchestrator,
  BaseAgent
} from './agents/index.js';
