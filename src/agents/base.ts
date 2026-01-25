/**
 * Base Agent Class
 * Foundation for all specialized agents in the system
 */

import EventEmitter from 'eventemitter3';
import type {
  AgentStatus,
  AgentContext,
  AgentResult,
  AgentEvent,
  AgentEventHandler
} from './types.js';

export abstract class BaseAgent<TInput = unknown, TOutput = unknown> extends EventEmitter {
  public readonly name: string;
  public status: AgentStatus = 'idle';
  protected context: AgentContext | null = null;
  protected logs: string[] = [];
  protected startTime: number = 0;

  constructor(name: string) {
    super();
    this.name = name;
  }

  protected log(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${this.name}] ${message}`;
    this.logs.push(logEntry);
    this.emitEvent('log', message);
  }

  protected emitEvent(type: AgentEvent['type'], message: string, data?: unknown): void {
    const event: AgentEvent = {
      type,
      agent: this.name,
      message,
      data,
      timestamp: new Date()
    };
    this.emit('event', event);
  }

  public setContext(context: AgentContext): void {
    this.context = context;
  }

  public async run(input: TInput): Promise<AgentResult<TOutput>> {
    this.status = 'running';
    this.logs = [];
    this.startTime = Date.now();
    this.emitEvent('start', `Starting ${this.name}`);

    try {
      const result = await this.execute(input);
      this.status = 'completed';
      this.emitEvent('complete', `${this.name} completed successfully`, result);

      return {
        success: true,
        data: result,
        duration: Date.now() - this.startTime,
        logs: this.logs
      };
    } catch (error) {
      this.status = 'failed';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emitEvent('error', errorMessage);

      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - this.startTime,
        logs: this.logs
      };
    }
  }

  protected abstract execute(input: TInput): Promise<TOutput>;

  public onEvent(handler: AgentEventHandler): void {
    this.on('event', handler);
  }

  public pause(): void {
    if (this.status === 'running') {
      this.status = 'paused';
      this.log('Agent paused');
    }
  }

  public resume(): void {
    if (this.status === 'paused') {
      this.status = 'running';
      this.log('Agent resumed');
    }
  }
}

export class AgentOrchestrator extends EventEmitter {
  private agents: Map<string, BaseAgent> = new Map();
  private context: AgentContext | null = null;

  public registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.name, agent);
    agent.onEvent((event) => this.emit('agent-event', event));
  }

  public setContext(context: AgentContext): void {
    this.context = context;
    for (const agent of this.agents.values()) {
      agent.setContext(context);
    }
  }

  public getAgent<T extends BaseAgent>(name: string): T | undefined {
    return this.agents.get(name) as T | undefined;
  }

  public async runAgent<TInput, TOutput>(
    name: string,
    input: TInput
  ): Promise<AgentResult<TOutput>> {
    const agent = this.agents.get(name);
    if (!agent) {
      return {
        success: false,
        error: `Agent '${name}' not found`,
        duration: 0,
        logs: []
      };
    }

    return agent.run(input) as Promise<AgentResult<TOutput>>;
  }

  public async runSequence<T>(
    sequence: Array<{ agent: string; input: unknown }>
  ): Promise<AgentResult<T>[]> {
    const results: AgentResult<T>[] = [];

    for (const step of sequence) {
      const result = await this.runAgent<unknown, T>(step.agent, step.input);
      results.push(result);

      if (!result.success) {
        break; // Stop on first failure
      }
    }

    return results;
  }

  public async runParallel<T>(
    tasks: Array<{ agent: string; input: unknown }>
  ): Promise<AgentResult<T>[]> {
    const promises = tasks.map(task =>
      this.runAgent<unknown, T>(task.agent, task.input)
    );
    return Promise.all(promises);
  }
}
