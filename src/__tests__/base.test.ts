/**
 * Covers BaseAgent lifecycle (run/pause/resume/log/events) and the
 * AgentOrchestrator (register/get/runAgent/runSequence/runParallel).
 */

import { describe, it, expect } from 'vitest';
import { BaseAgent, AgentOrchestrator } from '../agents/base.js';
import { DEFAULT_AGENT_CONFIG } from '../agents/index.js';
import type { AgentContext, AgentEvent } from '../agents/types.js';

class OkAgent extends BaseAgent<number, number> {
  constructor() { super('Ok'); }
  protected async execute(n: number): Promise<number> {
    this.log('doubling');
    return n * 2;
  }
}

class FailAgent extends BaseAgent<unknown, never> {
  constructor() { super('Fail'); }
  protected async execute(): Promise<never> { throw new Error('nope'); }
}

class NonErrorAgent extends BaseAgent<unknown, never> {
  constructor() { super('NonError'); }
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  protected async execute(): Promise<never> { throw 'a string'; }
}

class DeferredAgent extends BaseAgent<unknown, string> {
  public release!: () => void;
  constructor() { super('Deferred'); }
  protected execute(): Promise<string> {
    return new Promise<string>(res => { this.release = () => res('done'); });
  }
}

const ctx: AgentContext = { workingDir: '/', files: [], config: DEFAULT_AGENT_CONFIG };

describe('BaseAgent', () => {
  it('runs successfully, emits start/log/complete and tracks status', async () => {
    const a = new OkAgent();
    const types: string[] = [];
    a.onEvent((e: AgentEvent) => types.push(e.type));
    const r = await a.run(5);
    expect(r.success).toBe(true);
    expect(r.data).toBe(10);
    expect(r.logs.some(l => l.includes('doubling'))).toBe(true);
    expect(types).toEqual(expect.arrayContaining(['start', 'log', 'complete']));
    expect(a.status).toBe('completed');
  });

  it('captures Error failures', async () => {
    const a = new FailAgent();
    const r = await a.run({});
    expect(r.success).toBe(false);
    expect(r.error).toBe('nope');
    expect(a.status).toBe('failed');
  });

  it('captures non-Error throws as Unknown error', async () => {
    const a = new NonErrorAgent();
    const r = await a.run({});
    expect(r.error).toBe('Unknown error');
  });

  it('pause/resume only transition from the matching status', async () => {
    const a = new DeferredAgent();
    // not running yet: pause/resume are no-ops
    a.pause();
    expect(a.status).toBe('idle');
    a.resume();
    expect(a.status).toBe('idle');

    const p = a.run({});
    expect(a.status).toBe('running');
    a.pause();
    expect(a.status).toBe('paused');
    a.resume();
    expect(a.status).toBe('running');
    a.release();
    await p;
    expect(a.status).toBe('completed');
  });

  it('setContext stores context', () => {
    const a = new OkAgent();
    a.setContext(ctx);
    expect(a.status).toBe('idle');
  });
});

describe('AgentOrchestrator', () => {
  it('registers, re-emits events, sets context and gets agents', async () => {
    const o = new AgentOrchestrator();
    const a = new OkAgent();
    const seen: string[] = [];
    o.on('agent-event', (e: AgentEvent) => seen.push(e.agent));
    o.registerAgent(a);
    o.setContext(ctx);
    expect(o.getAgent('Ok')).toBe(a);
    const r = await o.runAgent<number, number>('Ok', 4);
    expect(r.data).toBe(8);
    expect(seen).toContain('Ok');
  });

  it('returns an error result for a missing agent', async () => {
    const o = new AgentOrchestrator();
    const r = await o.runAgent('Missing', 1);
    expect(r.success).toBe(false);
    expect(r.error).toContain("'Missing' not found");
  });

  it('runSequence stops on the first failure', async () => {
    const o = new AgentOrchestrator();
    o.registerAgent(new OkAgent());
    o.registerAgent(new FailAgent());
    const results = await o.runSequence([
      { agent: 'Ok', input: 1 },
      { agent: 'Fail', input: 1 },
      { agent: 'Ok', input: 2 }
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });

  it('runParallel runs every task', async () => {
    const o = new AgentOrchestrator();
    o.registerAgent(new OkAgent());
    const results = await o.runParallel<number>([
      { agent: 'Ok', input: 1 },
      { agent: 'Ok', input: 2 }
    ]);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
  });
});
