/**
 * Covers remaining parser branches: python imports + multiline docstrings +
 * block-to-EOF, TS re-exports / default exports / brace-less arrows / unterminated
 * types, and Java/Go parameter edge cases + Go single imports.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseFile } from '../parser/index.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const DIR = join(tmpdir(), 'documate-edge-' + Date.now());
beforeAll(async () => { await mkdir(DIR, { recursive: true }); });
afterAll(async () => { await rm(DIR, { recursive: true, force: true }); });

async function parse(name: string, content: string) {
  const p = join(DIR, name);
  await writeFile(p, content);
  return parseFile(p, DIR);
}

describe('Python edge parsing', () => {
  it('extracts imports, multiline docstrings and a block that runs to EOF', async () => {
    const r = await parse('mod.py', `def documented(a, b):
    """Summary line.

    Extended description across
    multiple lines.
    """
    return a + b
import sys
from os import path, sep
def runs_to_end():
    x = 1
    return x
`);
    expect(r.imports.some(i => i.source === 'os' && i.items.includes('path'))).toBe(true);
    expect(r.imports.some(i => i.source === 'sys')).toBe(true);
    const doc = r.blocks.find(b => b.name === 'documented');
    expect(doc?.documentation).toContain('Extended description');
    expect(r.blocks.find(b => b.name === 'runs_to_end')).toBeDefined();
  });
});

describe('TypeScript edge parsing', () => {
  it('handles re-exports, default exports, brace-less arrows and unterminated types', async () => {
    const r = await parse('exports.ts', `export { foo, bar as baz } from './other';
export default function main() { return 1; }

// a single-line comment doc

export const addOne = (a: number): number => a + 1;

export type Unterminated = string`);
    expect(r.exports.some(e => e.name === 'bar')).toBe(true);
    expect(r.exports.some(e => e.type === 'default')).toBe(true);
    expect(r.blocks.find(b => b.name === 'addOne')).toBeDefined();
    expect(r.blocks.find(b => b.name === 'Unterminated' && b.type === 'type')).toBeDefined();
  });
});

describe('Java parameter edges', () => {
  it('skips malformed parameters', async () => {
    const r = await parse('Edge.java', `public class Edge {
  public void weird(int) {
  }
  public int ok(String name, int count) {
    return count;
  }
}
`);
    const ok = r.blocks.find(b => b.name === 'ok');
    expect(ok?.parameters?.map(p => p.name)).toEqual(['name', 'count']);
  });
});

describe('More edge cases', () => {
  it('finds the end of an unterminated union type at EOF', async () => {
    const r = await parse('union2.ts', "export type U =\n  | 'a'\n  | 'b'");
    expect(r.blocks.find(b => b.name === 'U' && b.type === 'type')).toBeDefined();
  });

  it("extracts single-quote python docstrings", async () => {
    const r = await parse('sq.py', "def f():\n    '''single quote doc'''\n    return 1\n");
    expect(r.blocks.find(b => b.name === 'f')?.documentation).toContain('single quote doc');
  });

  it('handles a block preceded by a blank line with no doc comment', async () => {
    const r = await parse('blank.ts', "const before = 1;\n\nfunction noDoc() { return 1; }\n");
    expect(r.blocks.find(b => b.name === 'noDoc')?.documentation).toBeUndefined();
  });

  it('handles anonymous default exports', async () => {
    const r = await parse('anon.ts', 'export default function() { return 1; }\n');
    expect(r.exports.some(e => e.type === 'default' && e.name === 'default')).toBe(true);
  });

  it('skips malformed python parameters', async () => {
    const r = await parse('badparam.py', 'def f(a, :int):\n    return a\n');
    const f = r.blocks.find(b => b.name === 'f');
    expect(f?.parameters?.some(p => p.name === 'a')).toBe(true);
  });

  it('ignores comment lines inside grouped Go imports', async () => {
    const r = await parse('imp.go', `package main

import (
\t// a comment line
\t"errors"
)

func use() {
\t_ = errors.New("x")
}
`);
    expect(r.imports.some(i => i.source === 'errors')).toBe(true);
  });
});

describe('Go parameter and import edges', () => {
  it('handles grouped params without per-name types and single imports', async () => {
    const r = await parse('edge.go', `package main

import "fmt"

func grouped(a, b int) int {
\tfmt.Println(a)
\treturn b
}
`);
    expect(r.imports.some(i => i.source === 'fmt' && i.items[0] === 'fmt')).toBe(true);
    const grouped = r.blocks.find(b => b.name === 'grouped');
    expect(grouped?.parameters?.some(p => p.name === 'a')).toBe(true);
  });
});
