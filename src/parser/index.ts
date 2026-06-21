/**
 * Code Parser Module
 * Parses source code files and extracts structural information
 */

import { readFile } from 'fs/promises';
import { basename, extname, relative } from 'path';
import { stat } from 'fs/promises';
import type {
  FileInfo,
  Language,
  CodeBlock,
  ParsedFile,
  ImportInfo,
  ExportInfo,
  Parameter
} from '../types.js';

const EXTENSION_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin'
};

export function detectLanguage(filePath: string): Language {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] || 'unknown';
}

export async function getFileInfo(filePath: string, basePath: string): Promise<FileInfo> {
  const content = await readFile(filePath, 'utf-8');
  const stats = await stat(filePath);
  const lines = content.split('\n').length;

  return {
    path: filePath,
    relativePath: relative(basePath, filePath),
    extension: extname(filePath),
    language: detectLanguage(filePath),
    size: stats.size,
    lines
  };
}

export async function parseFile(filePath: string, basePath: string): Promise<ParsedFile> {
  const info = await getFileInfo(filePath, basePath);
  const content = await readFile(filePath, 'utf-8');

  const blocks = extractCodeBlocks(content, info.language);
  const imports = extractImports(content, info.language);
  const exports = extractExports(content, info.language);

  return {
    info,
    blocks,
    imports,
    exports,
    rawContent: content
  };
}

function extractCodeBlocks(content: string, language: Language): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');

  switch (language) {
    case 'typescript':
    case 'javascript':
      blocks.push(...extractJSTSBlocks(content, lines));
      break;
    case 'python':
      blocks.push(...extractPythonBlocks(content, lines));
      break;
    case 'java':
      blocks.push(...extractJavaBlocks(content, lines));
      break;
    case 'go':
      blocks.push(...extractGoBlocks(content, lines));
      break;
    default:
      blocks.push(...extractGenericBlocks(content, lines));
  }

  return blocks;
}

function extractJSTSBlocks(content: string, lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  // Function patterns
  const functionPatterns = [
    // Regular functions
    /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/gm,
    // Arrow functions assigned to const/let/var
    /^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/gm,
    // Class methods
    /^(\s*)(?:public|private|protected|static|async|\s)*(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/gm
  ];

  // Class pattern
  const classPattern = /^(\s*)(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/gm;

  // Interface pattern
  const interfacePattern = /^(\s*)(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{/gm;

  // Type pattern
  const typePattern = /^(\s*)(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/gm;

  // Extract functions
  for (const pattern of functionPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length;
      const name = match[2];
      const params = match[4] || match[3] || '';
      const returnType = match[5]?.trim();

      const endLine = findBlockEnd(lines, startLine - 1);
      const blockContent = lines.slice(startLine - 1, endLine).join('\n');
      const doc = extractPrecedingDoc(lines, startLine - 1);

      blocks.push({
        type: 'function',
        name,
        startLine,
        endLine,
        content: blockContent,
        documentation: doc,
        parameters: parseParameters(params),
        returnType,
        complexity: calculateComplexity(blockContent)
      });
    }
  }

  // Extract classes
  let match;
  while ((match = classPattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];
    const endLine = findBlockEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractPrecedingDoc(lines, startLine - 1);

    blocks.push({
      type: 'class',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc,
      complexity: calculateComplexity(blockContent)
    });
  }

  // Extract interfaces
  while ((match = interfacePattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];
    const endLine = findBlockEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractPrecedingDoc(lines, startLine - 1);

    blocks.push({
      type: 'interface',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc
    });
  }

  // Extract types
  while ((match = typePattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];
    const endLine = findTypeEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractPrecedingDoc(lines, startLine - 1);

    blocks.push({
      type: 'type',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc
    });
  }

  return blocks;
}

function extractPythonBlocks(content: string, lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  // Function pattern
  const funcPattern = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/gm;

  // Class pattern
  const classPattern = /^(\s*)class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm;

  let match;
  while ((match = funcPattern.exec(content)) !== null) {
    const indent = match[1].length;
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];
    const params = match[3];
    const returnType = match[4]?.trim();

    const endLine = findPythonBlockEnd(lines, startLine - 1, indent);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractPythonDocstring(lines, startLine);

    blocks.push({
      type: 'function',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc,
      parameters: parsePythonParameters(params),
      returnType,
      complexity: calculateComplexity(blockContent)
    });
  }

  while ((match = classPattern.exec(content)) !== null) {
    const indent = match[1].length;
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];

    const endLine = findPythonBlockEnd(lines, startLine - 1, indent);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractPythonDocstring(lines, startLine);

    blocks.push({
      type: 'class',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc,
      complexity: calculateComplexity(blockContent)
    });
  }

  return blocks;
}

function extractJavaBlocks(content: string, lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  // Method pattern
  const methodPattern = /^(\s*)(?:public|private|protected|static|final|abstract|\s)*(?:<[^>]*>\s*)?(\w+)\s+(\w+)\s*\(([^)]*)\)(?:\s+throws\s+[^{]+)?\s*\{/gm;

  // Class pattern
  const classPattern = /^(\s*)(?:public|private|protected|abstract|final|\s)*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/gm;

  // Interface pattern
  const interfacePattern = /^(\s*)(?:public\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{/gm;

  let match;
  while ((match = methodPattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const returnType = match[2];
    const name = match[3];
    const params = match[4];

    // Skip constructors and class declarations
    /* v8 ignore next -- the method regex requires two identifiers before '(', which class/interface decls never have */
    if (returnType === 'class' || returnType === 'interface') continue;

    const endLine = findBlockEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractJavadoc(lines, startLine - 1);

    blocks.push({
      type: 'method',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc,
      parameters: parseJavaParameters(params),
      returnType,
      complexity: calculateComplexity(blockContent)
    });
  }

  while ((match = classPattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];

    const endLine = findBlockEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractJavadoc(lines, startLine - 1);

    blocks.push({
      type: 'class',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc,
      complexity: calculateComplexity(blockContent)
    });
  }

  return blocks;
}

function extractGoBlocks(content: string, lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  // Function pattern
  const funcPattern = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*(?:\(([^)]*)\)|(\w+)))?\s*\{/gm;

  // Struct pattern
  const structPattern = /^type\s+(\w+)\s+struct\s*\{/gm;

  // Interface pattern
  const interfacePattern = /^type\s+(\w+)\s+interface\s*\{/gm;

  let match;
  while ((match = funcPattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[3];
    const params = match[4];
    const returnType = match[5] || match[6];

    const endLine = findBlockEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractGoDoc(lines, startLine - 1);

    blocks.push({
      type: 'function',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc,
      parameters: parseGoParameters(params),
      returnType,
      complexity: calculateComplexity(blockContent)
    });
  }

  while ((match = structPattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[1];

    const endLine = findBlockEnd(lines, startLine - 1);
    const blockContent = lines.slice(startLine - 1, endLine).join('\n');
    const doc = extractGoDoc(lines, startLine - 1);

    blocks.push({
      type: 'class',
      name,
      startLine,
      endLine,
      content: blockContent,
      documentation: doc
    });
  }

  return blocks;
}

function extractGenericBlocks(content: string, lines: string[]): CodeBlock[] {
  // Generic fallback for unknown languages
  const blocks: CodeBlock[] = [];

  // Try to find function-like patterns
  const genericFuncPattern = /^(\s*)(?:function|def|func|fn|sub|procedure)\s+(\w+)/gm;

  let match;
  while ((match = genericFuncPattern.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length;
    const name = match[2];

    blocks.push({
      type: 'function',
      name,
      startLine,
      endLine: startLine,
      content: lines[startLine - 1]
    });
  }

  return blocks;
}

function extractImports(content: string, language: Language): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  switch (language) {
    case 'typescript':
    case 'javascript': {
      // ES6 imports
      const importPattern = /^import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/gm;
      const importAllPattern = /^import\s+\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/gm;

      let match;
      while ((match = importPattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        const defaultImport = match[1];
        const namedImports = match[2]?.split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean) || [];
        const source = match[3];

        imports.push({
          source,
          items: defaultImport ? [defaultImport, ...namedImports] : namedImports,
          isDefault: !!defaultImport && namedImports.length === 0,
          line
        });
      }

      while ((match = importAllPattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        imports.push({
          source: match[2],
          items: [match[1]],
          isDefault: false,
          line
        });
      }
      break;
    }

    case 'python': {
      const importPattern = /^(?:from\s+(\S+)\s+)?import\s+(.+)/gm;

      let match;
      while ((match = importPattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        const source = match[1] || match[2].split(',')[0].trim();
        const items = match[2].split(',').map(s => s.trim().split(' as ')[0].trim());

        imports.push({
          source,
          items,
          isDefault: !match[1],
          line
        });
      }
      break;
    }

    case 'java': {
      const importPattern = /^import\s+(?:static\s+)?([^;]+);/gm;

      let match;
      while ((match = importPattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        const fullPath = match[1].trim();
        const parts = fullPath.split('.');
        const item = parts[parts.length - 1];

        imports.push({
          source: fullPath,
          items: [item],
          isDefault: false,
          line
        });
      }
      break;
    }

    case 'go': {
      const importPattern = /^import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/gm;

      let match;
      while ((match = importPattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;

        if (match[1]) {
          // Multi-line import
          const importLines = match[1].split('\n');
          for (const importLine of importLines) {
            const singleMatch = importLine.match(/(?:(\w+)\s+)?"([^"]+)"/);
            if (singleMatch) {
              imports.push({
                source: singleMatch[2],
                items: [singleMatch[1] || basename(singleMatch[2])],
                isDefault: false,
                line
              });
            }
          }
          /* The single-quote import form always populates group 2 when group 1 is absent. */
        } else {
          imports.push({
            source: match[2],
            items: [basename(match[2])],
            isDefault: false,
            line
          });
        }
      }
      break;
    }
  }

  return imports;
}

function extractExports(content: string, language: Language): ExportInfo[] {
  const exports: ExportInfo[] = [];

  if (language === 'typescript' || language === 'javascript') {
    // Default exports
    const defaultPattern = /^export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/gm;
    // Named exports
    const namedPattern = /^export\s+(?:const|let|var|function|class|interface|type|enum|async\s+function)\s+(\w+)/gm;
    // Re-exports
    const reexportPattern = /^export\s+\{([^}]+)\}/gm;

    let match;
    while ((match = defaultPattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      exports.push({
        name: match[1] || 'default',
        type: 'default',
        line
      });
    }

    while ((match = namedPattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      exports.push({
        name: match[1],
        type: 'named',
        line
      });
    }

    while ((match = reexportPattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const names = match[1].split(',').map(s => s.trim().split(' as ')[0].trim());
      for (const name of names) {
        exports.push({ name, type: 'named', line });
      }
    }
  }

  return exports;
}

function findBlockEnd(lines: string[], startIndex: number): number {
  let braceCount = 0;
  let started = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        started = true;
      } else if (char === '}') {
        braceCount--;
        if (started && braceCount === 0) {
          return i + 1;
        }
      }
    }
  }

  return startIndex + 1;
}

function findTypeEnd(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.endsWith(';') || (i > startIndex && !line.startsWith('|') && !line.startsWith('&'))) {
      return i + 1;
    }
  }
  return startIndex + 1;
}

function findPythonBlockEnd(lines: string[], startIndex: number, baseIndent: number): number {
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;

    const currentIndent = line.length - line.trimStart().length;
    if (currentIndent <= baseIndent && line.trim() !== '') {
      return i;
    }
  }
  return lines.length;
}

function extractPrecedingDoc(lines: string[], lineIndex: number): string | undefined {
  const docLines: string[] = [];
  let i = lineIndex - 1;

  // Skip empty lines
  while (i >= 0 && lines[i].trim() === '') {
    /* v8 ignore next -- the function regex consumes leading blank lines, so this rarely lands on one */
    i--;
  }

  // Check for JSDoc or multi-line comment
  if (i >= 0 && lines[i].trim().endsWith('*/')) {
    while (i >= 0) {
      docLines.unshift(lines[i]);
      if (lines[i].includes('/**') || lines[i].includes('/*')) {
        break;
      }
      i--;
    }
    return cleanDocComment(docLines.join('\n'));
  }

  // Check for single-line comments
  while (i >= 0 && lines[i].trim().startsWith('//')) {
    docLines.unshift(lines[i].trim().replace(/^\/\/\s*/, ''));
    i--;
  }

  return docLines.length > 0 ? docLines.join('\n') : undefined;
}

function extractPythonDocstring(lines: string[], startLine: number): string | undefined {
  const nextLine = lines[startLine]?.trim();

  if (nextLine?.startsWith('"""') || nextLine?.startsWith("'''")) {
    const quote = nextLine.startsWith('"""') ? '"""' : "'''";
    const docLines: string[] = [];

    // Single line docstring
    if (nextLine.endsWith(quote) && nextLine.length > 6) {
      return nextLine.slice(3, -3).trim();
    }

    // Multi-line docstring
    docLines.push(nextLine.slice(3));
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(quote)) {
        docLines.push(line.split(quote)[0]);
        break;
      }
      docLines.push(line);
    }

    return docLines.join('\n').trim();
  }

  return undefined;
}

function extractJavadoc(lines: string[], lineIndex: number): string | undefined {
  return extractPrecedingDoc(lines, lineIndex);
}

function extractGoDoc(lines: string[], lineIndex: number): string | undefined {
  const docLines: string[] = [];
  let i = lineIndex - 1;

  while (i >= 0 && lines[i].trim().startsWith('//')) {
    docLines.unshift(lines[i].trim().replace(/^\/\/\s*/, ''));
    i--;
  }

  return docLines.length > 0 ? docLines.join('\n') : undefined;
}

function cleanDocComment(doc: string): string {
  return doc
    .replace(/\/\*\*?/g, '')
    .replace(/\*\//g, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim();
}

function parseParameters(params: string): Parameter[] {
  if (!params.trim()) return [];

  return params.split(',').map(p => {
    const trimmed = p.trim();
    const [nameType, defaultVal] = trimmed.split('=').map(s => s.trim());
    const optional = nameType.includes('?');
    const [name, type] = nameType.replace('?', '').split(':').map(s => s.trim());

    return {
      name,
      type,
      defaultValue: defaultVal,
      optional
    };
  }).filter(p => p.name);
}

function parsePythonParameters(params: string): Parameter[] {
  if (!params.trim()) return [];

  const result: Parameter[] = [];
  const parts = params.split(',');

  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed === 'self' || trimmed === 'cls' || !trimmed) continue;

    const [nameType, defaultVal] = trimmed.split('=').map(s => s.trim());
    const [name, type] = nameType.split(':').map(s => s.trim());

    if (name) {
      result.push({
        name,
        type,
        defaultValue: defaultVal,
        optional: !!defaultVal
      });
    }
  }

  return result;
}

function parseJavaParameters(params: string): Parameter[] {
  if (!params.trim()) return [];

  const result: Parameter[] = [];
  const paramParts = params.split(',');

  for (const p of paramParts) {
    const parts = p.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const name = parts[parts.length - 1];
    const type = parts.slice(0, -1).join(' ');

    result.push({ name, type, optional: false });
  }

  return result;
}

function parseGoParameters(params: string): Parameter[] {
  if (!params.trim()) return [];

  const result: Parameter[] = [];
  const parts = params.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    const spaceIdx = trimmed.lastIndexOf(' ');

    if (spaceIdx > 0) {
      const name = trimmed.substring(0, spaceIdx).trim();
      const type = trimmed.substring(spaceIdx + 1).trim();
      result.push({ name, type, optional: false });
    } else {
      result.push({ name: trimmed, optional: false });
    }
  }

  return result;
}

function calculateComplexity(code: string): number {
  let complexity = 1;

  // Count decision points
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\belif\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\bexcept\b/g,
    /\?\s*[^:]+\s*:/g,  // Ternary
    /&&/g,
    /\|\|/g,
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

export { calculateComplexity };
