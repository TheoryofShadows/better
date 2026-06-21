/**
 * Covers FixAgent's heuristic (no-key) doc generation across languages and
 * every inferDescription branch, the style/complexity suggestion paths, and
 * the full non-dry-run apply -> commit -> PR pipeline against a real temp git
 * repo with a mocked Octokit.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import simpleGit from 'simple-git';

const reposGet = vi.fn(async () => ({ data: { default_branch: 'main' } }));
const pullsCreate = vi.fn(async () => ({ data: { html_url: 'https://github.com/o/r/pull/1' } }));
vi.mock('@octokit/rest', () => ({
  Octokit: class { repos = { get: reposGet }; pulls = { create: pullsCreate }; }
}));

import { FixAgent } from '../agents/fix-agent.js';
import type { ParsedFile, Language, CodeBlock } from '../types.js';

// Run the heuristic (offline) paths deterministically.
const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
afterAll(() => { if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey; });

function file(language: Language, name: string, blocks: CodeBlock[]): ParsedFile {
  return {
    info: { path: name, relativePath: name, extension: '.' + name.split('.').pop(), language, size: 1, lines: 1 },
    blocks,
    imports: [],
    exports: [],
    rawContent: ''
  };
}

function fn(name: string, extra: Partial<CodeBlock> = {}): CodeBlock {
  return { type: 'function', name, startLine: 1, endLine: 2, content: `function ${name}(a){ return a; }`, ...extra };
}

describe('FixAgent heuristic documentation', () => {
  it('covers every inferDescription prefix and the JSDoc generator', async () => {
    const names = ['getValue', 'setValue', 'isReady', 'hasItem', 'canRun', 'createUser',
      'makeThing', 'deleteItem', 'removeThing', 'updateRecord', 'handleClick', 'onClose',
      'renderView', 'parseInput', 'validateForm', 'fetchData', 'loadData', 'saveFile',
      'storeData', 'initApp', 'setupEnv', 'plainName', 'get'];
    const blocks = names.map(n => fn(n, { parameters: [{ name: 'a', type: 'string' }], returnType: 'string' }));
    blocks.push(fn('voidReturner', { returnType: 'void' }));
    blocks.push(fn('withPlainParam', { parameters: [{ name: 'a' }], returnType: 'string' })); // untyped, non-optional param
    blocks.push(fn('withOptionalParam', { parameters: [{ name: 'a', type: 'string', optional: true }], returnType: 'string' })); // optional param -> ' [optional]'
    blocks.push({ type: 'variable', name: 'config', startLine: 1, endLine: 1, content: 'const config = 1' }); // non-documentable type
    const r = await new FixAgent().run({ files: [file('typescript', 'a.ts', blocks)], basePath: process.cwd(), fixes: ['documentation'], dryRun: true });
    expect(r.success).toBe(true);
    const docs = r.data!.suggestions.filter(s => s.type === 'documentation');
    expect(docs.length).toBe(blocks.filter(b => b.type !== 'variable').length);
    const byName = (n: string) => docs.find(d => d.description.includes(`'${n}'`))!.suggestedCode;
    expect(byName('getValue')).toContain('Retrieves');
    expect(byName('setValue')).toContain('Sets');
    expect(byName('isReady')).toContain('Checks if');
    expect(byName('createUser')).toContain('Creates');
    expect(byName('deleteItem')).toContain('Removes');
    expect(byName('updateRecord')).toContain('Updates');
    expect(byName('handleClick')).toContain('Handles');
    expect(byName('onClose')).toContain('Event handler');
    expect(byName('renderView')).toContain('Renders');
    expect(byName('parseInput')).toContain('Parses');
    expect(byName('validateForm')).toContain('Validates');
    expect(byName('fetchData')).toContain('Fetches');
    expect(byName('saveFile')).toContain('Saves');
    expect(byName('initApp')).toContain('Initializes');
    expect(byName('get')).toContain('the value'); // camelToWords('') fallback
    expect(byName('voidReturner')).not.toContain('@returns');
  });

  it('covers python / java / go / generic doc generators', async () => {
    const py = file('python', 'a.py', [
      fn('compute', { parameters: [{ name: 'x', type: 'int' }], returnType: 'int' }),
      fn('untypedPy', { parameters: [{ name: 'y' }], returnType: 'int' }), // param with no type -> ''
      fn('noneReturner', { returnType: 'None' })
    ]);
    const java = file('java', 'A.java', [
      fn('compute', { type: 'method', parameters: [{ name: 'x', type: 'int' }], returnType: 'String' }),
      fn('runJava', { type: 'method', returnType: 'void' }) // no params, void return
    ]);
    const go = file('go', 'a.go', [fn('Compute')]);
    const ruby = file('ruby', 'a.rb', [fn('compute')]);
    const r = await new FixAgent().run({ files: [py, java, go, ruby], basePath: process.cwd(), fixes: ['documentation'], dryRun: true });
    const docs = r.data!.suggestions.filter(s => s.type === 'documentation');
    expect(docs.some(d => d.suggestedCode.includes('Args:'))).toBe(true);
    expect(docs.some(d => d.suggestedCode.includes('@param'))).toBe(true);
    expect(docs.some(d => d.suggestedCode.startsWith('//'))).toBe(true);
  });
});

describe('FixAgent style & complexity suggestions', () => {
  it('flags style issues and refactoring for complex blocks', async () => {
    const messy = fn('messy', {
      complexity: 25,
      content: ['function messy(a){', '  console.log(a);', '  var b = a == 1;', '  if (a != 2) { b = 3; }', '  var c = b;', '  return c;', '}'].join('\n')
    });
    const r = await new FixAgent().run({ files: [file('typescript', 'a.ts', [messy])], basePath: process.cwd(), fixes: ['all'], dryRun: true });
    const types = new Set(r.data!.suggestions.map(s => s.type));
    expect(types.has('style')).toBe(true);
    expect(types.has('complexity')).toBe(true);
    const complexity = r.data!.suggestions.find(s => s.type === 'complexity')!;
    expect(complexity.suggestedCode).toContain('redesigning'); // complexity > 20 branch
    expect(complexity.originalCode).toContain('// ...'); // truncateCode > 5 lines
  });
});

describe('FixAgent apply -> commit -> PR (real git + mocked Octokit)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fix-git-'));
    const bare = await mkdtemp(join(tmpdir(), 'fix-bare-'));
    await simpleGit(bare).init(true);
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test');
    await git.addRemote('origin', bare);
    await writeFile(join(dir, 'src.ts'), 'function doThing(a) {\n  return a;\n}\n');
    await git.add('.');
    await git.commit('init');
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('applies docs, commits, and opens a PR', async () => {
    const block = fn('doThing', { startLine: 1, endLine: 3, parameters: [{ name: 'a' }], content: 'function doThing(a) {\n  return a;\n}' });
    const r = await new FixAgent().run({
      files: [file('typescript', 'src.ts', [block])],
      basePath: dir,
      fixes: ['documentation'],
      dryRun: false,
      createPR: true,
      githubToken: 'tok',
      repoOwner: 'o',
      repoName: 'r'
    });
    expect(r.success).toBe(true);
    expect(r.data!.appliedFixes.length).toBe(1);
    expect(r.data!.summary.filesModified).toBe(1);
    expect(reposGet).toHaveBeenCalled();
    expect(pullsCreate).toHaveBeenCalled();
    expect(r.data!.pr?.url).toContain('/pull/1');
    expect(r.data!.pr?.body).toContain('automatically generated');
  });
});

describe('FixAgent non-dry-run branches', () => {
  async function gitRepo(withRemote: boolean): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'fix-nb-'));
    const git = simpleGit(d);
    await git.init();
    await git.addConfig('user.email', 't@e.com');
    await git.addConfig('user.name', 'T');
    if (withRemote) {
      const bare = await mkdtemp(join(tmpdir(), 'fix-nb-bare-'));
      await simpleGit(bare).init(true);
      await git.addRemote('origin', bare);
    }
    await writeFile(join(d, 'src.ts'), 'function doThing(a) {\n  console.log(a);\n  return a == 1;\n}\n');
    await git.add('.');
    await git.commit('init');
    return d;
  }

  const messyBlock = () => fn('doThing', { startLine: 1, endLine: 3, complexity: 25, parameters: [{ name: 'a' }], content: 'function doThing(a) {\n  console.log(a);\n  return a == 1;\n}' });

  it('applies the doc fix but skips non-documentation fixes', async () => {
    const dir = await gitRepo(true);
    try {
      const r = await new FixAgent().run({ files: [file('typescript', 'src.ts', [messyBlock()])], basePath: dir, fixes: ['all'], dryRun: false });
      expect(r.data!.appliedFixes.length).toBe(1); // only the documentation fix is applied
      expect(r.data!.suggestions.some(s => s.type === 'style')).toBe(true);
      expect(r.data!.suggestions.some(s => s.type === 'complexity')).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('skips the commit when no documentation fix is applied', async () => {
    const dir = await gitRepo(true);
    try {
      const r = await new FixAgent().run({ files: [file('typescript', 'src.ts', [messyBlock()])], basePath: dir, fixes: ['style'], dryRun: false });
      expect(r.data!.appliedFixes).toHaveLength(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('runs without opening a PR', async () => {
    const dir = await gitRepo(true);
    try {
      const r = await new FixAgent().run({ files: [file('typescript', 'src.ts', [messyBlock()])], basePath: dir, fixes: ['documentation'], dryRun: false });
      expect(r.data!.pr).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('returns no PR when the push fails', async () => {
    const dir = await gitRepo(false); // no remote -> push rejects -> caught
    try {
      const r = await new FixAgent().run({ files: [file('typescript', 'src.ts', [messyBlock()])], basePath: dir, fixes: ['documentation'], dryRun: false, createPR: true, githubToken: 'tok', repoOwner: 'o', repoName: 'r' });
      expect(r.success).toBe(true);
      expect(r.data!.pr).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
