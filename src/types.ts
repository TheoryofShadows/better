/**
 * Core type definitions for DocuMate
 */

export interface FileInfo {
  path: string;
  relativePath: string;
  extension: string;
  language: Language;
  size: number;
  lines: number;
}

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'unknown';

export interface CodeBlock {
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'import' | 'export';
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  documentation?: string;
  parameters?: Parameter[];
  returnType?: string;
  modifiers?: string[];
  complexity?: number;
}

export interface Parameter {
  name: string;
  type?: string;
  defaultValue?: string;
  optional?: boolean;
}

export interface ParsedFile {
  info: FileInfo;
  blocks: CodeBlock[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  rawContent: string;
}

export interface ImportInfo {
  source: string;
  items: string[];
  isDefault: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  type: 'default' | 'named';
  line: number;
}

export interface DocumentationEntry {
  name: string;
  type: string;
  description: string;
  parameters?: ParameterDoc[];
  returns?: string;
  example?: string;
  file: string;
  line: number;
}

export interface ParameterDoc {
  name: string;
  type: string;
  description: string;
  optional: boolean;
}

export interface HealthScore {
  overall: number;
  categories: {
    documentation: number;
    complexity: number;
    structure: number;
    maintainability: number;
  };
  issues: HealthIssue[];
  suggestions: string[];
}

export interface HealthIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  rule: string;
}

export interface AnalysisResult {
  files: ParsedFile[];
  totalFiles: number;
  totalLines: number;
  languageBreakdown: Map<Language, number>;
  healthScore: HealthScore;
  undocumentedBlocks: CodeBlock[];
  complexBlocks: CodeBlock[];
}

export interface Config {
  include: string[];
  exclude: string[];
  outputDir: string;
  format: 'markdown' | 'html' | 'json';
  languages: Language[];
  minComplexity: number;
  generateTOC: boolean;
  // v2.1 Multi-modal features
  multiModal?: MultiModalConfig;
  // v2.1 Onboarding features
  onboarding?: OnboardingConfig;
  // v2.1 Security and health features
  security?: SecurityConfig;
  // v2.1 CI/CD integration
  cicd?: CICDConfig;
}

export interface MultiModalConfig {
  enabled: boolean;
  parseImages: boolean;
  parseDiagrams: boolean;
  supportedFormats: string[];
}

export interface OnboardingConfig {
  enabled: boolean;
  roles: OnboardingRole[];
  autoUpdate: boolean;
  webhookUrl?: string;
}

export interface OnboardingRole {
  name: string;
  level: 'junior' | 'mid' | 'senior' | 'lead';
  focusAreas: string[];
}

export interface SecurityConfig {
  enabled: boolean;
  scanSecrets: boolean;
  scanVulnerabilities: boolean;
  scanDependencies: boolean;
  severityThreshold: 'low' | 'medium' | 'high' | 'critical';
}

export interface CICDConfig {
  enabled: boolean;
  failOnLowHealth: boolean;
  healthThreshold: number;
  outputFormat: 'json' | 'junit' | 'github-actions';
}

export const DEFAULT_CONFIG: Config = {
  include: ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx', '**/*.py', '**/*.java', '**/*.go'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/vendor/**'],
  outputDir: './docs',
  format: 'markdown',
  languages: ['typescript', 'javascript', 'python', 'java', 'go'],
  minComplexity: 10,
  generateTOC: true,
  multiModal: {
    enabled: false,
    parseImages: true,
    parseDiagrams: true,
    supportedFormats: ['.png', '.jpg', '.svg', '.pdf']
  },
  onboarding: {
    enabled: false,
    roles: [
      { name: 'New Developer', level: 'junior', focusAreas: ['getting-started', 'architecture'] },
      { name: 'Team Member', level: 'mid', focusAreas: ['deep-dive', 'patterns'] }
    ],
    autoUpdate: true
  },
  security: {
    enabled: true,
    scanSecrets: true,
    scanVulnerabilities: true,
    scanDependencies: true,
    severityThreshold: 'medium'
  },
  cicd: {
    enabled: false,
    failOnLowHealth: false,
    healthThreshold: 60,
    outputFormat: 'json'
  }
};
