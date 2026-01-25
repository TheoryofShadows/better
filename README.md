# DocuMate

**Intelligent Code Documentation Generator & Understanding Tool**

DocuMate solves the #1 developer pain point: **poor or missing documentation**. Research shows that developers spend significant time trying to understand undocumented code, leading to:
- 23-42% of development time consumed by technical debt
- New hires spending weeks just getting productive
- "What should take 2 hours becomes a full day of fragmented effort"

DocuMate analyzes your codebase, generates comprehensive documentation, and provides instant code understanding tools.

## Features

- **Multi-Language Support**: TypeScript, JavaScript, Python, Java, Go, Rust, C/C++, C#, Ruby, PHP, Swift, Kotlin
- **Auto Documentation**: Generate Markdown, HTML, or JSON documentation from your code
- **Health Scoring**: Get an instant health report with actionable insights
- **Complexity Analysis**: Find overly complex code that needs refactoring
- **Undocumented Code Finder**: Identify all undocumented functions and classes
- **Code Explanation**: Understand what any code file or function does

## Installation

```bash
# Clone the repository
git clone https://github.com/TheoryofShadows/better.git
cd better

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

## Quick Start

```bash
# Analyze your codebase
documate analyze --path /path/to/project

# Generate documentation
documate generate --path /path/to/project --output ./docs

# Quick health check
documate health --path /path/to/project

# Explain a file
documate explain src/app.ts

# Find undocumented code
documate undocumented --path /path/to/project

# Find complex code
documate complex --path /path/to/project --threshold 15
```

## Commands

### `analyze` (alias: `a`)
Analyze your codebase and generate a comprehensive health report.

```bash
documate analyze [options]

Options:
  -p, --path <path>           Path to analyze (default: ".")
  -o, --output <format>       Output format: text, json (default: "text")
  --include <patterns>        Glob patterns to include (comma-separated)
  --exclude <patterns>        Glob patterns to exclude (comma-separated)
  --min-complexity <number>   Minimum complexity threshold (default: "10")
```

### `generate` (alias: `g`)
Generate documentation for your codebase.

```bash
documate generate [options]

Options:
  -p, --path <path>      Path to analyze (default: ".")
  -o, --output <dir>     Output directory (default: "./docs")
  -f, --format <format>  Output format: markdown, html, json (default: "markdown")
  --include-source       Include source code in documentation
  --name <name>          Project name
  --no-toc               Disable table of contents
```

### `health` (alias: `h`)
Quick health check of your codebase.

```bash
documate health [options]

Options:
  -p, --path <path>   Path to check (default: ".")
```

### `explain` (alias: `e`)
Explain what a code file does.

```bash
documate explain <file> [options]

Options:
  -l, --line <number>      Specific line number to explain
  -f, --function <name>    Specific function to explain
```

### `undocumented` (alias: `u`)
Find all undocumented code.

```bash
documate undocumented [options]

Options:
  -p, --path <path>    Path to check (default: ".")
  --type <type>        Filter by type: function, class, method, interface
```

### `complex` (alias: `c`)
Find complex code that needs attention.

```bash
documate complex [options]

Options:
  -p, --path <path>         Path to check (default: ".")
  -t, --threshold <number>  Complexity threshold (default: "10")
```

### `init`
Initialize DocuMate configuration.

```bash
documate init
```

## Health Score Categories

DocuMate scores your codebase across four key dimensions:

| Category | Weight | What it measures |
|----------|--------|------------------|
| **Documentation** | 30% | Percentage of documented functions, methods, and classes |
| **Complexity** | 25% | Cyclomatic complexity of your code (decision points) |
| **Structure** | 20% | File sizes, function counts, module organization |
| **Maintainability** | 25% | Nesting depth, function length, code readability |

### Grading Scale

- **A (90-100)**: Excellent! Well-maintained codebase
- **B (80-89)**: Good. Minor improvements recommended
- **C (70-79)**: Fair. Several areas need attention
- **D (60-69)**: Needs work. Significant improvements needed
- **F (<60)**: Critical. Immediate attention required

## Configuration

Create a `.documate.json` file in your project root:

```json
{
  "include": [
    "**/*.ts",
    "**/*.js",
    "**/*.tsx",
    "**/*.jsx",
    "**/*.py",
    "**/*.java",
    "**/*.go"
  ],
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/vendor/**"
  ],
  "outputDir": "./docs",
  "format": "markdown",
  "minComplexity": 10,
  "generateTOC": true
}
```

## Example Output

### Health Report
```
═══════════════════════════════════════════════════════════════
                    CODEBASE ANALYSIS SUMMARY
═══════════════════════════════════════════════════════════════

📊 OVERVIEW
───────────────────────────────────────────────────────────────
  Files analyzed:     42
  Total lines:        8,547
  Languages:          typescript, javascript

🏥 HEALTH SCORE
───────────────────────────────────────────────────────────────
  Overall:            🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜ 78/100
  Documentation:      🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ 65/100
  Complexity:         🟩🟩🟩🟩🟩🟩🟩🟩🟩⬜ 92/100
  Structure:          🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜ 85/100
  Maintainability:    🟩🟩🟩🟩🟩🟩🟩⬜⬜⬜ 72/100

⚠️  ISSUES
───────────────────────────────────────────────────────────────
  🔴 Errors:          2
  🟡 Warnings:        15
  🔵 Info:            8

💡 SUGGESTIONS
───────────────────────────────────────────────────────────────
  • Add documentation to your functions and classes
  • Consider breaking down complex functions
  • Reduce nesting levels for better readability
═══════════════════════════════════════════════════════════════
```

## Programmatic API

DocuMate can also be used as a library:

```typescript
import {
  analyzeCodebase,
  generateDocumentation,
  parseFile,
  explainCode
} from 'documate';

// Analyze a codebase
const result = await analyzeCodebase({
  include: ['**/*.ts'],
  exclude: ['**/node_modules/**'],
  basePath: '/path/to/project',
  minComplexity: 10
});

console.log(`Health Score: ${result.healthScore.overall}/100`);
console.log(`Undocumented: ${result.undocumentedBlocks.length}`);

// Generate documentation
await generateDocumentation(result.files, result.healthScore, {
  outputDir: './docs',
  format: 'markdown',
  generateTOC: true,
  includeSource: false,
  projectName: 'My Project'
});

// Parse a single file
const parsed = await parseFile('/path/to/file.ts', '/path/to');
console.log(`Found ${parsed.blocks.length} code blocks`);

// Explain code
const explanation = explainCode(codeString, 'typescript');
console.log(explanation);
```

## Why DocuMate?

Based on research into developer pain points:

1. **Poor Documentation** - "Nothing makes a developer's blood pressure spike faster than trying to decipher undocumented code"

2. **Context Switching** - DocuMate helps developers quickly understand unfamiliar code, reducing context-switching overhead

3. **Onboarding** - New team members can use generated documentation and code explanations to get productive faster

4. **Technical Debt** - The health scoring system helps identify and prioritize technical debt

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

Built with ❤️ to solve real developer pain points.
