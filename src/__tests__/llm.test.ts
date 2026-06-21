/**
 * Tests for the LLM integration layer and AI-agent fallback behavior.
 *
 * These tests never hit the network: they assert the gating logic and that the
 * agents degrade to their heuristic implementations when no API key is present.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isLLMAvailable, DEFAULT_AI_MODEL } from '../agents/llm.js';
import { ChatAgent } from '../agents/explain-agent.js';
import type { AgentContext } from '../agents/types.js';
import { DEFAULT_AGENT_CONFIG } from '../agents/index.js';

describe('LLM integration layer', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  describe('isLLMAvailable', () => {
    it('returns false when no API key is configured', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(isLLMAvailable()).toBe(false);
    });

    it('returns true when an API key is configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      expect(isLLMAvailable()).toBe(true);
    });

    it('treats an empty key as unavailable', () => {
      process.env.ANTHROPIC_API_KEY = '';
      expect(isLLMAvailable()).toBe(false);
    });
  });

  it('defaults to the latest Claude model', () => {
    expect(DEFAULT_AI_MODEL).toBe('claude-opus-4-8');
  });

  describe('ChatAgent fallback (no API key)', () => {
    const context: AgentContext = {
      workingDir: '/tmp/project',
      files: [],
      config: DEFAULT_AGENT_CONFIG
    };

    it('answers the help command locally without the model', async () => {
      const agent = new ChatAgent();
      agent.setContext(context);

      const result = await agent.run({
        role: 'user',
        content: 'help',
        timestamp: new Date()
      });

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain('DocuMate Chat Commands');
    });

    it('falls back to heuristic suggestions for a generic query', async () => {
      const agent = new ChatAgent();
      agent.setContext(context);

      const result = await agent.run({
        role: 'user',
        content: 'tell me something interesting',
        timestamp: new Date()
      });

      expect(result.success).toBe(true);
      // The heuristic responder offers command suggestions rather than prose.
      expect(result.data?.content).toContain('Try these commands');
    });
  });
});
