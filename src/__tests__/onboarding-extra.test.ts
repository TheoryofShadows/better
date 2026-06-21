/**
 * Covers the OnboardingAgent across role levels and focus areas: structure
 * categorization, pattern detection, every guide section, key-file/glossary
 * generation, learning-path steps, file writing, and the estimated-time bands.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OnboardingAgent } from '../agents/onboarding-agent.js';
import type { ParsedFile, CodeBlock, OnboardingRole, HealthScore, ImportInfo } from '../types.js';

const dirs: string[] = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

function file(relativePath: string, blocks: CodeBlock[], rawContent = '', imports: ImportInfo[] = []): ParsedFile {
  return {
    info: { path: relativePath, relativePath, extension: '.ts', language: 'typescript', size: 100, lines: 20 },
    blocks, imports, exports: [], rawContent
  };
}
const cls = (name: string, complexity?: number): CodeBlock => ({ type: 'class', name, startLine: 1, endLine: 5, content: 'class body '.repeat(30), complexity });
const fn = (name: string, complexity?: number): CodeBlock => ({ type: 'function', name, startLine: 1, endLine: 5, content: 'function body '.repeat(30), complexity });

const patternContent = `
class UserController {}
class UserService {}
class UserRepository {}
useState(); useEffect();
@Injectable()
async function load() { await x; }
const o: Observable<number> = null;
export default function main() {}
class Child extends Base {}
interface Shape {}
`;

const richFiles: ParsedFile[] = [
  file('src/index.ts', [fn('main')], patternContent, [{ source: 'react', items: ['useState'], isDefault: false, line: 1 }, { source: './local', items: ['x'], isDefault: false, line: 2 }]),
  file('src/app.controller.ts', [cls('AppController', 14)], 'class AppController {}'),
  file('src/user.service.ts', [cls('UserService', 18), fn('compute', 12)], 'class UserService {}'),
  file('src/dup-a.ts', [cls('Dup')], ''),
  file('src/dup-b.ts', [cls('Dup')], ''),
  file('test/app.test.ts', [fn('t')], ''),
  file('config/settings.ts', [], ''),
  file('src/utils/helper.ts', [fn('help')], '')
];

const health: HealthScore = {
  overall: 77,
  categories: { documentation: 70, complexity: 80, structure: 75, maintainability: 76 },
  issues: [], suggestions: []
};

describe('OnboardingAgent', () => {
  it('generates a full senior guide and writes files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onb-')); dirs.push(dir);
    const role: OnboardingRole = { name: 'Senior Engineer', level: 'senior', focusAreas: ['architecture', 'getting-started', 'patterns', 'deep-dive'] };
    const r = await new OnboardingAgent().run({ role, context: { files: richFiles, basePath: '/p', projectName: 'Demo' }, outputDir: dir });
    expect(r.success).toBe(true);
    const titles = r.data!.guide.sections.map(s => s.title);
    expect(titles).toEqual(expect.arrayContaining(['Project Overview', 'Architecture', 'Getting Started', 'Patterns and Conventions', 'Deep Dive']));
    expect(r.data!.guide.keyFiles.some(k => k.importance === 'critical')).toBe(true);
    expect(r.data!.guide.keyFiles.some(k => k.importance === 'important')).toBe(true);
    expect(r.data!.guide.keyFiles.some(k => k.importance === 'reference')).toBe(true);
    expect(r.data!.guide.glossary.some(g => g.term === 'UserService')).toBe(true);
    expect(r.data!.generatedFiles.length).toBe(3);
    expect(r.data!.estimatedTime).toContain('hours');

    const guideMd = await readFile(r.data!.generatedFiles[0], 'utf-8');
    expect(guideMd).toContain('Key Files');
    expect(guideMd).toContain('Glossary');
    const learnMd = await readFile(r.data!.generatedFiles.find(p => p.includes('learning-path'))!, 'utf-8');
    expect(learnMd).toContain('Exercises');
  });

  it('tailors a junior guide and surfaces health detail', async () => {
    const role: OnboardingRole = { name: 'New Dev', level: 'junior', focusAreas: ['getting-started'] };
    const r = await new OnboardingAgent().run({ role, context: { files: richFiles, basePath: '/p', healthScore: health } });
    const overview = r.data!.guide.sections.find(s => s.title === 'Project Overview')!;
    expect(overview.content).toContain('health score');
    expect(r.data!.generatedFiles).toHaveLength(0);
  });

  it('handles a mid-level role with architecture/patterns focus', async () => {
    const role: OnboardingRole = { name: 'Engineer', level: 'mid', focusAreas: ['architecture', 'patterns'] };
    const r = await new OnboardingAgent().run({ role, context: { files: richFiles, basePath: '/p' } });
    const step = r.data!.learningPath.find(s => s.title === 'Study Core Modules')!;
    expect(step.files.length).toBeLessThanOrEqual(4);
  });

  it('reports minutes for a tiny codebase', async () => {
    const role: OnboardingRole = { name: 'New Dev', level: 'junior', focusAreas: [] };
    const r = await new OnboardingAgent().run({ role, context: { files: [file('config/settings.ts', [])], basePath: '/p' } });
    expect(r.data!.estimatedTime).toContain('minutes');
    expect(r.data!.learningPath).toHaveLength(1);
  });
});
