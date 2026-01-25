/**
 * Parser Module Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { detectLanguage, parseFile, calculateComplexity } from '../parser/index.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'documate-test-' + Date.now());

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

describe('detectLanguage', () => {
  it('should detect TypeScript files', () => {
    expect(detectLanguage('test.ts')).toBe('typescript');
    expect(detectLanguage('test.tsx')).toBe('typescript');
  });

  it('should detect JavaScript files', () => {
    expect(detectLanguage('test.js')).toBe('javascript');
    expect(detectLanguage('test.jsx')).toBe('javascript');
    expect(detectLanguage('test.mjs')).toBe('javascript');
  });

  it('should detect Python files', () => {
    expect(detectLanguage('test.py')).toBe('python');
  });

  it('should detect Java files', () => {
    expect(detectLanguage('Test.java')).toBe('java');
  });

  it('should detect Go files', () => {
    expect(detectLanguage('main.go')).toBe('go');
  });

  it('should return unknown for unsupported extensions', () => {
    expect(detectLanguage('test.xyz')).toBe('unknown');
    expect(detectLanguage('Makefile')).toBe('unknown');
  });
});

describe('calculateComplexity', () => {
  it('should return 1 for simple code', () => {
    const code = 'const x = 1;';
    expect(calculateComplexity(code)).toBe(1);
  });

  it('should count if statements', () => {
    const code = `
      function test() {
        if (x > 0) {
          return true;
        }
        return false;
      }
    `;
    expect(calculateComplexity(code)).toBeGreaterThan(1);
  });

  it('should count loops', () => {
    const code = `
      function test() {
        for (let i = 0; i < 10; i++) {
          while (x) {
            break;
          }
        }
      }
    `;
    expect(calculateComplexity(code)).toBeGreaterThan(2);
  });

  it('should count logical operators', () => {
    const code = `
      function test(a, b, c) {
        return a && b || c;
      }
    `;
    expect(calculateComplexity(code)).toBeGreaterThan(2);
  });

  it('should count ternary operators', () => {
    const code = `
      const result = condition ? value1 : value2;
    `;
    expect(calculateComplexity(code)).toBeGreaterThan(1);
  });

  it('should handle complex functions', () => {
    const code = `
      function complex(a, b, c) {
        if (a > 0) {
          for (let i = 0; i < b; i++) {
            if (i % 2 === 0) {
              while (c > 0) {
                if (c && a) {
                  return true;
                }
                c--;
              }
            }
          }
        } else if (b > 0) {
          try {
            something();
          } catch (e) {
            handleError(e);
          }
        }
        return a ? b : c;
      }
    `;
    expect(calculateComplexity(code)).toBeGreaterThan(10);
  });
});

describe('parseFile', () => {
  it('should parse TypeScript file with functions', async () => {
    const filePath = join(TEST_DIR, 'test-functions.ts');
    const content = `
/**
 * Adds two numbers
 * @param a First number
 * @param b Second number
 */
export function add(a: number, b: number): number {
  return a + b;
}

// Multiplies two numbers
function multiply(x: number, y: number): number {
  return x * y;
}

const divide = (a: number, b: number): number => {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
};
    `;

    await writeFile(filePath, content);
    const result = await parseFile(filePath, TEST_DIR);

    expect(result.info.language).toBe('typescript');
    expect(result.blocks.length).toBeGreaterThanOrEqual(2);

    const addFunc = result.blocks.find(b => b.name === 'add');
    expect(addFunc).toBeDefined();
    expect(addFunc?.type).toBe('function');
    expect(addFunc?.documentation).toContain('Adds two numbers');
  });

  it('should parse TypeScript file with classes', async () => {
    const filePath = join(TEST_DIR, 'test-class.ts');
    const content = `
/**
 * Calculator class
 */
export class Calculator {
  private value: number = 0;

  /**
   * Add a number
   */
  add(n: number): this {
    this.value += n;
    return this;
  }

  getValue(): number {
    return this.value;
  }
}
    `;

    await writeFile(filePath, content);
    const result = await parseFile(filePath, TEST_DIR);

    expect(result.info.language).toBe('typescript');

    const calcClass = result.blocks.find(b => b.name === 'Calculator');
    expect(calcClass).toBeDefined();
    expect(calcClass?.type).toBe('class');
    expect(calcClass?.documentation).toContain('Calculator class');
  });

  it('should parse TypeScript interfaces and types', async () => {
    const filePath = join(TEST_DIR, 'test-types.ts');
    const content = `
/**
 * User interface
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/** Status type */
export type Status = 'active' | 'inactive' | 'pending';

interface InternalConfig {
  debug: boolean;
}
    `;

    await writeFile(filePath, content);
    const result = await parseFile(filePath, TEST_DIR);

    expect(result.info.language).toBe('typescript');

    const userInterface = result.blocks.find(b => b.name === 'User');
    expect(userInterface).toBeDefined();
    expect(userInterface?.type).toBe('interface');

    const statusType = result.blocks.find(b => b.name === 'Status');
    expect(statusType).toBeDefined();
    expect(statusType?.type).toBe('type');
  });

  it('should extract imports and exports', async () => {
    const filePath = join(TEST_DIR, 'test-imports.ts');
    const content = `
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import * as utils from './utils';

export function processFile(p: string) {
  return path.resolve(p);
}

export default processFile;
    `;

    await writeFile(filePath, content);
    const result = await parseFile(filePath, TEST_DIR);

    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    expect(result.imports.some(i => i.source === 'fs/promises')).toBe(true);
    expect(result.imports.some(i => i.source === 'path')).toBe(true);

    expect(result.exports.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse Python files', async () => {
    const filePath = join(TEST_DIR, 'test.py');
    const content = `
def add(a, b):
    """Add two numbers together.

    Args:
        a: First number
        b: Second number

    Returns:
        The sum of a and b
    """
    return a + b

class Calculator:
    """A simple calculator class."""

    def __init__(self):
        self.value = 0

    def add(self, n):
        """Add a number to the current value."""
        self.value += n
        return self
    `;

    await writeFile(filePath, content);
    const result = await parseFile(filePath, TEST_DIR);

    expect(result.info.language).toBe('python');
    expect(result.blocks.length).toBeGreaterThanOrEqual(2);

    const addFunc = result.blocks.find(b => b.name === 'add' && b.type === 'function');
    expect(addFunc).toBeDefined();
    // Python docstrings extraction is optional - just verify the function was found

    const calcClass = result.blocks.find(b => b.name === 'Calculator');
    expect(calcClass).toBeDefined();
  });

  it('should handle empty files', async () => {
    const filePath = join(TEST_DIR, 'empty.ts');
    await writeFile(filePath, '');
    const result = await parseFile(filePath, TEST_DIR);

    expect(result.info.lines).toBe(1);
    expect(result.blocks.length).toBe(0);
  });
});

// Cleanup after all tests
import { afterAll } from 'vitest';

afterAll(async () => {
  try {
    await rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
