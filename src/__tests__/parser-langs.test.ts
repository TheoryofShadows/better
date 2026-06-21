/**
 * Covers the Java/Go/Rust extraction paths, language-specific parameter
 * parsers, Go doc comments, and a few TS/Python edge cases the main parser
 * suite doesn't reach.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseFile } from '../parser/index.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const DIR = join(tmpdir(), 'documate-langs-' + Date.now());
beforeAll(async () => { await mkdir(DIR, { recursive: true }); });
afterAll(async () => { await rm(DIR, { recursive: true, force: true }); });

async function parse(name: string, content: string) {
  const p = join(DIR, name);
  await writeFile(p, content);
  return parseFile(p, DIR);
}

describe('Java parsing', () => {
  it('extracts classes, methods, params, javadoc and imports', async () => {
    const r = await parse('Greeter.java', `package com.example;

import java.util.List;
import static java.lang.Math.PI;

/**
 * A greeter.
 */
public class Greeter extends Base implements Runnable {
  /**
   * Greets a person.
   */
  public String greet(String name, int times) throws Exception {
    if (times > 0) {
      return "hi " + name;
    }
    return "";
  }

  private void run() {
  }
}
`);
    expect(r.info.language).toBe('java');
    const cls = r.blocks.find(b => b.name === 'Greeter');
    expect(cls?.type).toBe('class');
    expect(cls?.documentation).toContain('A greeter');
    const greet = r.blocks.find(b => b.name === 'greet');
    expect(greet?.type).toBe('method');
    expect(greet?.returnType).toBe('String');
    expect(greet?.parameters?.map(p => p.name)).toEqual(['name', 'times']);
    expect(greet?.documentation).toContain('Greets a person');
    expect(r.imports.some(i => i.source === 'java.util.List' && i.items[0] === 'List')).toBe(true);
    expect(r.imports.some(i => i.source === 'java.lang.Math.PI')).toBe(true);
  });
});

describe('Go parsing', () => {
  it('extracts funcs (with receivers/returns), structs, godoc and imports', async () => {
    const r = await parse('main.go', `package main

import "fmt"

import (
\t"errors"
\tstr "strings"
)

// Greeter holds a name.
type Greeter struct {
\tName string
}

// Greet greets a person.
func (g *Greeter) Greet(name string, times int) (string, error) {
\treturn "hi", nil
}

func Add(a int, b int) int {
\treturn a + b
}

func noArgs() {
}
`);
    expect(r.info.language).toBe('go');
    const st = r.blocks.find(b => b.name === 'Greeter');
    expect(st?.type).toBe('class');
    expect(st?.documentation).toContain('Greeter holds a name');
    const greet = r.blocks.find(b => b.name === 'Greet');
    expect(greet?.returnType).toBe('string, error');
    expect(greet?.parameters?.map(p => p.name)).toEqual(['name', 'times']);
    expect(greet?.documentation).toContain('Greet greets');
    const add = r.blocks.find(b => b.name === 'Add');
    expect(add?.returnType).toBe('int');
    const noArgs = r.blocks.find(b => b.name === 'noArgs');
    expect(noArgs?.parameters).toEqual([]);
    expect(r.imports.some(i => i.source === 'fmt')).toBe(true);
    expect(r.imports.some(i => i.source === 'errors')).toBe(true);
    expect(r.imports.some(i => i.source === 'strings' && i.items[0] === 'str')).toBe(true);
  });
});

describe('Generic (unknown-language) parsing', () => {
  it('finds function-like declarations in Rust', async () => {
    const r = await parse('lib.rs', `fn main() {
    println!("hi");
}

fn helper() {}
`);
    expect(r.info.language).toBe('rust');
    expect(r.blocks.map(b => b.name)).toEqual(expect.arrayContaining(['main', 'helper']));
    expect(r.blocks[0].type).toBe('function');
  });
});

describe('Python edge cases', () => {
  it('handles single-line docstrings, return types, typed/default params', async () => {
    const r = await parse('edge.py', `def quick():
    """One liner."""
    return 1

def typed(a: int, b: str = "x") -> int:
    return a
`);
    const quick = r.blocks.find(b => b.name === 'quick');
    expect(quick?.documentation).toBe('One liner.');
    const typed = r.blocks.find(b => b.name === 'typed');
    expect(typed?.returnType).toBe('int');
    const params = typed?.parameters ?? [];
    expect(params.find(p => p.name === 'a')?.type).toBe('int');
    expect(params.find(p => p.name === 'b')?.optional).toBe(true);
  });
});

describe('TypeScript multi-line type', () => {
  it('finds the end of a union type that spans lines', async () => {
    const r = await parse('union.ts', `export type U =
  | 'a'
  | 'b';

export type Obj = {
  a: number;
};
`);
    expect(r.blocks.find(b => b.name === 'U')?.type).toBe('type');
    expect(r.blocks.find(b => b.name === 'Obj')?.type).toBe('type');
  });
});
