/**
 * LLM Client - the single integration point with the Anthropic API.
 *
 * Every "AI" agent routes through these helpers. When `ANTHROPIC_API_KEY` is
 * set, the agents perform real inference with Claude; when it is absent (CI,
 * offline, tests) `isLLMAvailable()` returns false and each agent falls back to
 * its existing heuristic implementation. Network/API errors thrown here are
 * caught by the callers, which then fall back as well.
 */

import Anthropic from '@anthropic-ai/sdk';

/** Default model. Override per-call via `AgentConfig.aiModel`. */
export const DEFAULT_AI_MODEL = 'claude-opus-4-8';

let cachedClient: Anthropic | null = null;

/** True when an API key is configured and real inference can be attempted. */
export function isLLMAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!cachedClient) {
    // The SDK reads ANTHROPIC_API_KEY from the environment; never hardcode it.
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

export interface LLMCompleteOptions {
  /** System prompt establishing role/context. */
  system?: string;
  /** The user message / task. */
  prompt: string;
  /** Output ceiling; defaults to 8192 (these are short generations). */
  maxTokens?: number;
  /** Model id; defaults to {@link DEFAULT_AI_MODEL}. */
  model?: string;
}

/** Run a single completion and return the concatenated text output. */
export async function llmComplete(opts: LLMCompleteOptions): Promise<string> {
  const message = await getClient().messages.create({
    model: opts.model || DEFAULT_AI_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    thinking: { type: 'adaptive' },
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }]
  });
  return extractText(message);
}

export interface LLMCompleteJSONOptions extends LLMCompleteOptions {
  /** JSON schema the response is constrained to (structured outputs). */
  schema: Record<string, unknown>;
}

/**
 * Run a completion constrained to a JSON schema and parse the result.
 * Throws if the response cannot be parsed, letting callers fall back.
 */
export async function llmCompleteJSON<T>(opts: LLMCompleteJSONOptions): Promise<T> {
  const message = await getClient().messages.create({
    model: opts.model || DEFAULT_AI_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: opts.schema } },
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }]
  });
  return JSON.parse(extractText(message)) as T;
}

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface LLMVisionJSONOptions {
  system?: string;
  prompt: string;
  image: { mediaType: VisionMediaType; base64: string };
  schema: Record<string, unknown>;
  maxTokens?: number;
  model?: string;
}

/**
 * Analyze an image with Claude vision and parse a JSON-schema-constrained result.
 * Throws on failure so callers can fall back to heuristics.
 */
export async function llmCompleteVisionJSON<T>(opts: LLMVisionJSONOptions): Promise<T> {
  const message = await getClient().messages.create({
    model: opts.model || DEFAULT_AI_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: opts.schema } },
    ...(opts.system ? { system: opts.system } : {}),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: opts.image.mediaType, data: opts.image.base64 }
          },
          { type: 'text', text: opts.prompt }
        ]
      }
    ]
  });
  return JSON.parse(extractText(message)) as T;
}
