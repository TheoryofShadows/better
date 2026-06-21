/**
 * Full coverage of the LLM helper layer using a mocked Anthropic SDK
 * (no network). Exercises every option branch of each helper.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  }
}));

import {
  isLLMAvailable,
  llmComplete,
  llmCompleteJSON,
  llmCompleteVisionJSON,
  DEFAULT_AI_MODEL
} from '../agents/llm.js';

const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
afterAll(() => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('llm helpers (mocked SDK)', () => {
  it('isLLMAvailable reflects the key', () => {
    expect(isLLMAvailable()).toBe(true);
  });

  it('llmComplete concatenates text blocks, ignores non-text, honors options', async () => {
    create.mockResolvedValueOnce({
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' }
      ]
    });
    const out = await llmComplete({ prompt: 'hi', system: 'sys', maxTokens: 100, model: 'custom-model' });
    expect(out).toBe('hello world');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom-model', system: 'sys', max_tokens: 100 }));
  });

  it('llmComplete falls back to defaults when options omitted', async () => {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
    const out = await llmComplete({ prompt: 'hi' });
    expect(out).toBe('ok');
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: DEFAULT_AI_MODEL, max_tokens: 8192 }));
  });

  it('llmCompleteJSON parses the JSON output (with and without options)', async () => {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"a":1}' }] });
    expect((await llmCompleteJSON<{ a: number }>({ prompt: 'x', schema: { type: 'object' } })).a).toBe(1);

    create.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"a":2}' }] });
    const out = await llmCompleteJSON<{ a: number }>({ prompt: 'x', system: 's', model: 'm', maxTokens: 50, schema: { type: 'object' } });
    expect(out.a).toBe(2);
  });

  it('llmCompleteVisionJSON sends an image block and parses (with and without options)', async () => {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"type":"diagram"}' }] });
    const a = await llmCompleteVisionJSON<{ type: string }>({ prompt: 'x', image: { mediaType: 'image/png', base64: 'AAAA' }, schema: { type: 'object' } });
    expect(a.type).toBe('diagram');

    create.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"type":"flowchart"}' }] });
    const b = await llmCompleteVisionJSON<{ type: string }>({ prompt: 'x', system: 's', model: 'm', maxTokens: 50, image: { mediaType: 'image/jpeg', base64: 'AAAA' }, schema: { type: 'object' } });
    expect(b.type).toBe('flowchart');
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user' })]
    }));
  });
});
