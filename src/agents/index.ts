/**
 * DocuMate Agent System
 * Multi-agent architecture for intelligent code analysis
 */

export * from './types.js';
export * from './base.js';
export { ParseAgent, BlockAnalyzer } from './parse-agent.js';
export { PredictAgent } from './predict-agent.js';
export { FixAgent } from './fix-agent.js';
export { ExplainAgent, ChatAgent } from './explain-agent.js';

import { AgentOrchestrator } from './base.js';
import { ParseAgent, BlockAnalyzer } from './parse-agent.js';
import { PredictAgent } from './predict-agent.js';
import { FixAgent } from './fix-agent.js';
import { ExplainAgent, ChatAgent } from './explain-agent.js';
import { DEFAULT_AI_MODEL } from './llm.js';
import type { AgentContext, AgentConfig } from './types.js';

export { isLLMAvailable, llmComplete, llmCompleteJSON, DEFAULT_AI_MODEL } from './llm.js';

export function createOrchestrator(config?: Partial<AgentConfig>): AgentOrchestrator {
  const orchestrator = new AgentOrchestrator();

  // Register all agents
  orchestrator.registerAgent(new ParseAgent());
  orchestrator.registerAgent(new BlockAnalyzer());
  orchestrator.registerAgent(new PredictAgent());
  orchestrator.registerAgent(new FixAgent());
  orchestrator.registerAgent(new ExplainAgent());
  orchestrator.registerAgent(new ChatAgent());

  return orchestrator;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxIterations: 100,
  timeout: 300000, // 5 minutes
  sandboxed: true,
  autoFix: false,
  createPRs: false,
  aiModel: DEFAULT_AI_MODEL
};
