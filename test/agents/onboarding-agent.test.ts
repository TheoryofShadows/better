/**
 * OnboardingAgent tests — exercises the real role-based guide generation
 * (heuristic; no API key needed) writing artifacts into a temp directory.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { OnboardingAgent } from '../../src/agents/onboarding-agent.js';
import type { ParsedFile } from '../../src/types.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const files: ParsedFile[] = [
  {
    info: { path: 'index.ts', relativePath: 'index.ts', extension: '.ts', language: 'typescript', size: 120, lines: 20 },
    blocks: [{ type: 'function', name: 'main', startLine: 1, endLine: 10, content: 'function main() {}', complexity: 3, documentation: 'Entry point' }],
    imports: [{ source: './service', items: ['Service'], isDefault: false, line: 1 }],
    exports: [{ name: 'main', type: 'named', line: 1 }],
    rawContent: 'function main() {}'
  },
  {
    info: { path: 'service.ts', relativePath: 'service.ts', extension: '.ts', language: 'typescript', size: 200, lines: 40 },
    blocks: [{ type: 'class', name: 'Service', startLine: 1, endLine: 30, content: 'class Service {}', complexity: 6 }],
    imports: [],
    exports: [{ name: 'Service', type: 'named', line: 1 }],
    rawContent: 'class Service {}'
  }
];

const dirs: string[] = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

describe('OnboardingAgent', () => {
  it('generates a role-based onboarding guide', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onb-'));
    dirs.push(dir);

    const agent = new OnboardingAgent();
    const res = await agent.run({
      role: { name: 'Backend Engineer', level: 'junior', focusAreas: ['api', 'services'] },
      context: { files, basePath: process.cwd(), projectName: 'Demo' },
      outputDir: dir
    });

    expect(res.success).toBe(true);
    expect(res.data!.guide.title).toBeTruthy();
    expect(Array.isArray(res.data!.learningPath)).toBe(true);
    expect(res.data!.learningPath.length).toBeGreaterThan(0);
    expect(res.data!.quickStart).toBeTruthy();
    expect(typeof res.data!.estimatedTime).toBe('string');
  });

  it('adapts to a senior role', async () => {
    const agent = new OnboardingAgent();
    const res = await agent.run({
      role: { name: 'Tech Lead', level: 'lead', focusAreas: ['architecture'] },
      context: { files, basePath: process.cwd(), projectName: 'Demo' }
    });

    expect(res.success).toBe(true);
    expect(res.data!.guide.sections.length).toBeGreaterThan(0);
  });
});
