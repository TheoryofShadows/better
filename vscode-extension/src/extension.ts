/**
 * DocuMate VS Code Extension
 * AI-powered code documentation, health scoring, and insights
 *
 * Few-shot example:
 * ```typescript
 * // User right-clicks on code
 * // Extension shows "DocuMate: Explain Selection"
 * // Displays explanation in popup/panel
 * ```
 */

import * as vscode from 'vscode';

// Types for DocuMate integration
interface HealthScore {
  overall: number;
  categories: {
    documentation: number;
    complexity: number;
    structure: number;
    maintainability: number;
  };
  issues: HealthIssue[];
}

interface HealthIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  rule: string;
}

interface FileAnalysis {
  path: string;
  health: number;
  issues: HealthIssue[];
  complexity: number;
  documented: boolean;
}

// Global state
let healthProvider: HealthTreeDataProvider;
let issuesProvider: IssuesTreeDataProvider;
let statusBarItem: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('DocuMate extension activated');

  // Initialize diagnostic collection for inline hints
  diagnosticCollection = vscode.languages.createDiagnosticCollection('documate');
  context.subscriptions.push(diagnosticCollection);

  // Initialize tree data providers
  healthProvider = new HealthTreeDataProvider();
  issuesProvider = new IssuesTreeDataProvider();

  // Register tree views
  vscode.window.registerTreeDataProvider('documate.health', healthProvider);
  vscode.window.registerTreeDataProvider('documate.issues', issuesProvider);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'documate.showHealth';
  context.subscriptions.push(statusBarItem);

  // Register commands
  const commands = [
    vscode.commands.registerCommand('documate.analyze', analyzeWorkspace),
    vscode.commands.registerCommand('documate.explainFile', explainFile),
    vscode.commands.registerCommand('documate.explainSelection', explainSelection),
    vscode.commands.registerCommand('documate.generateDocs', generateDocs),
    vscode.commands.registerCommand('documate.showHealth', showHealth),
    vscode.commands.registerCommand('documate.findUndocumented', findUndocumented),
    vscode.commands.registerCommand('documate.openChat', openChat)
  ];

  context.subscriptions.push(...commands);

  // Register code lens provider for complexity hints
  const codeLensProvider = new ComplexityCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', pattern: '**/*.{ts,js,tsx,jsx,py,java,go}' },
      codeLensProvider
    )
  );

  // Register hover provider for inline documentation
  const hoverProvider = new DocuMateHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*.{ts,js,tsx,jsx,py,java,go}' },
      hoverProvider
    )
  );

  // Auto-analyze on startup if configured
  const config = vscode.workspace.getConfiguration('documate');
  if (config.get('autoAnalyze')) {
    vscode.commands.executeCommand('documate.analyze');
  }

  // Show initial status
  updateStatusBar({ overall: 0, categories: { documentation: 0, complexity: 0, structure: 0, maintainability: 0 }, issues: [] });
}

export function deactivate() {
  console.log('DocuMate extension deactivated');
}

// Command implementations

async function analyzeWorkspace(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'DocuMate: Analyzing workspace...',
    cancellable: true
  }, async (progress, token) => {
    try {
      progress.report({ increment: 0, message: 'Scanning files...' });

      // Simulate analysis (would integrate with documate CLI)
      const result = await runDocuMateAnalysis(workspaceFolders[0].uri.fsPath);

      progress.report({ increment: 50, message: 'Processing results...' });

      // Update providers
      healthProvider.refresh(result.health);
      issuesProvider.refresh(result.issues);
      updateStatusBar(result.health);

      // Update diagnostics
      updateDiagnostics(result.fileAnalyses);

      progress.report({ increment: 100, message: 'Complete!' });

      vscode.window.showInformationMessage(
        `DocuMate: Health score ${result.health.overall}/100`,
        'View Details'
      ).then(selection => {
        if (selection === 'View Details') {
          vscode.commands.executeCommand('documate.showHealth');
        }
      });
    } catch (error) {
      vscode.window.showErrorMessage(`DocuMate analysis failed: ${error}`);
    }
  });
}

async function explainFile(uri?: vscode.Uri): Promise<void> {
  const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
  if (!fileUri) {
    vscode.window.showWarningMessage('No file selected');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'documateExplain',
    `DocuMate: ${fileUri.fsPath.split('/').pop()}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  panel.webview.html = getExplanationWebview('Loading...');

  try {
    const explanation = await runDocuMateExplain(fileUri.fsPath);
    panel.webview.html = getExplanationWebview(explanation);
  } catch (error) {
    panel.webview.html = getExplanationWebview(`Error: ${error}`);
  }
}

async function explainSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage('No code selected');
    return;
  }

  const selection = editor.document.getText(editor.selection);
  const language = editor.document.languageId;

  // Show inline popup with explanation
  const explanation = await runDocuMateExplainCode(selection, language);

  // Create decoration for inline display
  const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: '',
      margin: '0 0 0 1em'
    }
  });

  // Show as hover or info message
  vscode.window.showInformationMessage(explanation, { modal: false });
}

async function generateDocs(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }

  const options = await vscode.window.showQuickPick([
    { label: 'Markdown', description: 'Generate markdown documentation', value: 'markdown' },
    { label: 'HTML', description: 'Generate HTML documentation', value: 'html' },
    { label: 'JSON', description: 'Generate JSON documentation', value: 'json' }
  ], { placeHolder: 'Select output format' });

  if (!options) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'DocuMate: Generating documentation...',
    cancellable: false
  }, async (progress) => {
    try {
      const outputPath = await runDocuMateGenerate(
        workspaceFolders[0].uri.fsPath,
        options.value
      );

      vscode.window.showInformationMessage(
        `Documentation generated at ${outputPath}`,
        'Open Folder'
      ).then(selection => {
        if (selection === 'Open Folder') {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
        }
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Documentation generation failed: ${error}`);
    }
  });
}

async function showHealth(): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'documateHealth',
    'DocuMate: Health Score',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getHealthDashboardWebview(healthProvider.getHealth());
}

async function findUndocumented(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }

  const undocumented = await runDocuMateFindUndocumented(workspaceFolders[0].uri.fsPath);

  if (undocumented.length === 0) {
    vscode.window.showInformationMessage('All code is documented!');
    return;
  }

  const items = undocumented.map(item => ({
    label: item.name,
    description: `${item.file}:${item.line}`,
    detail: `${item.type} - Missing documentation`,
    item
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Found ${undocumented.length} undocumented items`,
    canPickMany: false
  });

  if (selected) {
    const uri = vscode.Uri.file(selected.item.file);
    const position = new vscode.Position(selected.item.line - 1, 0);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(position, position)
    });
  }
}

async function openChat(): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'documateChat',
    'DocuMate: Chat',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getChatWebview();

  // Handle messages from webview
  panel.webview.onDidReceiveMessage(async message => {
    if (message.type === 'chat') {
      const response = await runDocuMateChat(message.text);
      panel.webview.postMessage({ type: 'response', text: response });
    }
  });
}

// Tree Data Providers

class HealthTreeDataProvider implements vscode.TreeDataProvider<HealthTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HealthTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private health: HealthScore = { overall: 0, categories: { documentation: 0, complexity: 0, structure: 0, maintainability: 0 }, issues: [] };

  refresh(health: HealthScore): void {
    this.health = health;
    this._onDidChangeTreeData.fire(undefined);
  }

  getHealth(): HealthScore {
    return this.health;
  }

  getTreeItem(element: HealthTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HealthTreeItem): HealthTreeItem[] {
    if (!element) {
      return [
        new HealthTreeItem('Overall', this.health.overall, 'overall'),
        new HealthTreeItem('Documentation', this.health.categories.documentation, 'category'),
        new HealthTreeItem('Complexity', this.health.categories.complexity, 'category'),
        new HealthTreeItem('Structure', this.health.categories.structure, 'category'),
        new HealthTreeItem('Maintainability', this.health.categories.maintainability, 'category')
      ];
    }
    return [];
  }
}

class HealthTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly score: number,
    public readonly type: 'overall' | 'category'
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = `${score}/100`;
    this.tooltip = `${label}: ${score}/100`;
    this.iconPath = this.getIcon();
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.score >= 80) return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    if (this.score >= 60) return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  }
}

class IssuesTreeDataProvider implements vscode.TreeDataProvider<IssueTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IssueTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private issues: HealthIssue[] = [];

  refresh(issues: HealthIssue[]): void {
    this.issues = issues;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: IssueTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: IssueTreeItem): IssueTreeItem[] {
    if (!element) {
      return this.issues.map(issue => new IssueTreeItem(issue));
    }
    return [];
  }
}

class IssueTreeItem extends vscode.TreeItem {
  constructor(public readonly issue: HealthIssue) {
    super(issue.message, vscode.TreeItemCollapsibleState.None);
    this.description = issue.file ? `${issue.file}:${issue.line}` : '';
    this.tooltip = `[${issue.rule}] ${issue.message}`;
    this.iconPath = this.getIcon();

    if (issue.file && issue.line) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to Issue',
        arguments: [
          vscode.Uri.file(issue.file),
          { selection: new vscode.Range(issue.line - 1, 0, issue.line - 1, 0) }
        ]
      };
    }
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.issue.severity) {
      case 'error': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'warning': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
      default: return new vscode.ThemeIcon('info', new vscode.ThemeColor('testing.iconSkipped'));
    }
  }
}

// Code Lens Provider for complexity hints

class ComplexityCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('documate');
    if (!config.get('showInlineHints')) return [];

    const codeLenses: vscode.CodeLens[] = [];
    const threshold = config.get<number>('complexityThreshold') || 10;

    // Simple heuristic: count nesting depth and branches
    const text = document.getText();
    const functionPattern = /(?:function|async function|const\s+\w+\s*=\s*(?:async\s*)?\(|(?:public|private|protected)?\s*(?:async\s+)?[\w]+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)/g;

    let match;
    while ((match = functionPattern.exec(text)) !== null) {
      const pos = document.positionAt(match.index);
      const complexity = this.estimateComplexity(text, match.index);

      if (complexity >= threshold) {
        const range = new vscode.Range(pos, pos);
        const lens = new vscode.CodeLens(range, {
          title: `⚠️ Complexity: ${complexity}`,
          command: 'documate.explainSelection',
          tooltip: 'Click to get suggestions for reducing complexity'
        });
        codeLenses.push(lens);
      }
    }

    return codeLenses;
  }

  private estimateComplexity(text: string, startIndex: number): number {
    // Find function body
    let braceCount = 0;
    let started = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < text.length; i++) {
      if (text[i] === '{') {
        braceCount++;
        started = true;
      } else if (text[i] === '}') {
        braceCount--;
        if (started && braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    const body = text.slice(startIndex, endIndex);

    // Count complexity indicators
    let complexity = 1; // Base complexity
    complexity += (body.match(/\bif\b/g) || []).length;
    complexity += (body.match(/\belse\b/g) || []).length;
    complexity += (body.match(/\bfor\b/g) || []).length;
    complexity += (body.match(/\bwhile\b/g) || []).length;
    complexity += (body.match(/\bswitch\b/g) || []).length;
    complexity += (body.match(/\bcase\b/g) || []).length;
    complexity += (body.match(/\bcatch\b/g) || []).length;
    complexity += (body.match(/\?\?/g) || []).length;
    complexity += (body.match(/\?[^:]/g) || []).length;
    complexity += (body.match(/&&/g) || []).length;
    complexity += (body.match(/\|\|/g) || []).length;

    return complexity;
  }
}

// Hover Provider for documentation

class DocuMateHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;

    const word = document.getText(range);
    const line = document.lineAt(position.line).text;

    // Check if this is a function/method definition
    if (this.isFunctionDefinition(line, word)) {
      const docs = this.findDocumentation(document, position.line);
      if (!docs) {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**⚠️ Undocumented:** \`${word}\`\n\n`);
        markdown.appendMarkdown(`[Generate documentation](command:documate.generateDocs)`);
        markdown.isTrusted = true;
        return new vscode.Hover(markdown, range);
      }
    }

    return null;
  }

  private isFunctionDefinition(line: string, word: string): boolean {
    const patterns = [
      new RegExp(`function\\s+${word}\\s*\\(`),
      new RegExp(`${word}\\s*=\\s*(?:async\\s*)?(?:function|\\()`),
      new RegExp(`(?:public|private|protected)?\\s*(?:async\\s+)?${word}\\s*\\(`)
    ];
    return patterns.some(p => p.test(line));
  }

  private findDocumentation(document: vscode.TextDocument, lineNum: number): string | null {
    // Look for JSDoc/docstring above the function
    for (let i = lineNum - 1; i >= 0 && i > lineNum - 10; i--) {
      const line = document.lineAt(i).text.trim();
      if (line.startsWith('/**') || line.startsWith('"""') || line.startsWith("'''")) {
        return line;
      }
      if (line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('#')) {
        break;
      }
    }
    return null;
  }
}

// Helper functions

function updateStatusBar(health: HealthScore): void {
  const config = vscode.workspace.getConfiguration('documate');
  if (!config.get('showHealthBadge')) {
    statusBarItem.hide();
    return;
  }

  const icon = health.overall >= 80 ? '$(pass)' : health.overall >= 60 ? '$(warning)' : '$(error)';
  statusBarItem.text = `${icon} Health: ${health.overall}`;
  statusBarItem.tooltip = 'Click to view health details';
  statusBarItem.show();
}

function updateDiagnostics(fileAnalyses: FileAnalysis[]): void {
  diagnosticCollection.clear();

  for (const analysis of fileAnalyses) {
    const uri = vscode.Uri.file(analysis.path);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const issue of analysis.issues) {
      const line = (issue.line || 1) - 1;
      const range = new vscode.Range(line, 0, line, 100);
      const severity = issue.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : issue.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;

      const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
      diagnostic.source = 'DocuMate';
      diagnostic.code = issue.rule;
      diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(uri, diagnostics);
  }
}

// DocuMate CLI integration stubs (would use child_process to run actual CLI)

async function runDocuMateAnalysis(workspacePath: string): Promise<{
  health: HealthScore;
  issues: HealthIssue[];
  fileAnalyses: FileAnalysis[];
}> {
  // TODO: Integrate with documate CLI
  // const result = await exec(`documate analyze ${workspacePath} --format json`);
  return {
    health: { overall: 75, categories: { documentation: 80, complexity: 70, structure: 75, maintainability: 75 }, issues: [] },
    issues: [],
    fileAnalyses: []
  };
}

async function runDocuMateExplain(filePath: string): Promise<string> {
  // TODO: Integrate with documate CLI
  return `# File Explanation\n\nThis file contains code that needs to be analyzed by DocuMate CLI.`;
}

async function runDocuMateExplainCode(code: string, language: string): Promise<string> {
  // TODO: Integrate with documate CLI
  return `This ${language} code performs the following operations...`;
}

async function runDocuMateGenerate(workspacePath: string, format: string): Promise<string> {
  // TODO: Integrate with documate CLI
  return `${workspacePath}/docs`;
}

async function runDocuMateFindUndocumented(workspacePath: string): Promise<Array<{
  name: string;
  type: string;
  file: string;
  line: number;
}>> {
  // TODO: Integrate with documate CLI
  return [];
}

async function runDocuMateChat(message: string): Promise<string> {
  // TODO: Integrate with documate CLI chat mode
  return `DocuMate response to: ${message}`;
}

// Webview HTML generators

function getExplanationWebview(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; }
    h1 { color: var(--vscode-foreground); }
    pre { background: var(--vscode-editor-background); padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>📝 Code Explanation</h1>
  <div>${content}</div>
</body>
</html>`;
}

function getHealthDashboardWebview(health: HealthScore): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; }
    .score { font-size: 48px; font-weight: bold; text-align: center; }
    .category { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .bar { height: 20px; background: var(--vscode-progressBar-background); border-radius: 4px; }
    .good { color: #4caf50; }
    .medium { color: #ff9800; }
    .poor { color: #f44336; }
  </style>
</head>
<body>
  <h1>🏥 Health Dashboard</h1>
  <div class="score ${health.overall >= 80 ? 'good' : health.overall >= 60 ? 'medium' : 'poor'}">
    ${health.overall}/100
  </div>
  <h2>Categories</h2>
  <div class="category">
    <span>Documentation</span>
    <span>${health.categories.documentation}/100</span>
  </div>
  <div class="category">
    <span>Complexity</span>
    <span>${health.categories.complexity}/100</span>
  </div>
  <div class="category">
    <span>Structure</span>
    <span>${health.categories.structure}/100</span>
  </div>
  <div class="category">
    <span>Maintainability</span>
    <span>${health.categories.maintainability}/100</span>
  </div>
</body>
</html>`;
}

function getChatWebview(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; }
    .message { padding: 10px; margin: 5px 0; border-radius: 8px; }
    .user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-left: 20%; }
    .assistant { background: var(--vscode-editor-background); margin-right: 20%; }
    #input-area { display: flex; gap: 10px; padding-top: 10px; }
    #input { flex: 1; padding: 10px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    button { padding: 10px 20px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
  </style>
</head>
<body>
  <h1>💬 DocuMate Chat</h1>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="input" placeholder="Ask about your codebase..." />
    <button onclick="sendMessage()">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');

    function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;

      addMessage(text, 'user');
      vscode.postMessage({ type: 'chat', text });
      inputEl.value = '';
    }

    function addMessage(text, type) {
      const div = document.createElement('div');
      div.className = 'message ' + type;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    window.addEventListener('message', event => {
      if (event.data.type === 'response') {
        addMessage(event.data.text, 'assistant');
      }
    });

    inputEl.addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>`;
}
