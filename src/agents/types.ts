/**
 * Agent System Types
 * Defines the interfaces for the multi-agent architecture
 */

import type { ParsedFile, CodeBlock, HealthScore, Language } from '../types.js';

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused';

export interface AgentMessage {
  id: string;
  timestamp: Date;
  from: string;
  to: string;
  type: 'request' | 'response' | 'event' | 'error';
  payload: unknown;
}

export interface AgentContext {
  workingDir: string;
  files: ParsedFile[];
  healthScore?: HealthScore;
  gitHistory?: GitCommit[];
  config: AgentConfig;
}

export interface AgentConfig {
  maxIterations: number;
  timeout: number;
  sandboxed: boolean;
  autoFix: boolean;
  createPRs: boolean;
  githubToken?: string;
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  logs: string[];
}

export interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

export interface DebtPrediction {
  file: string;
  currentScore: number;
  predictedScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: DebtFactor[];
  recommendation: string;
}

export interface DebtFactor {
  name: string;
  impact: number;
  description: string;
}

export interface FixSuggestion {
  file: string;
  line: number;
  type: 'documentation' | 'refactor' | 'complexity' | 'style';
  description: string;
  originalCode: string;
  suggestedCode: string;
  confidence: number;
}

export interface CodeExplanation {
  summary: string;
  purpose: string;
  patterns: string[];
  dependencies: string[];
  complexity: {
    score: number;
    assessment: string;
  };
  suggestions?: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  context?: {
    files?: string[];
    blocks?: string[];
  };
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  context: AgentContext;
  activeFile?: string;
  activeBlock?: CodeBlock;
}

export interface PRInfo {
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  files: string[];
  url?: string;
}

export interface AgentEvent {
  type: 'start' | 'progress' | 'complete' | 'error' | 'log';
  agent: string;
  message: string;
  data?: unknown;
  timestamp: Date;
}

export type AgentEventHandler = (event: AgentEvent) => void;
