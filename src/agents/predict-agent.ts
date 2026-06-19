/**
 * PredictAgent - Technical Debt Prediction Agent
 * Analyzes git history and code metrics to predict future technical debt
 */

import { BaseAgent } from './base.js';
import simpleGit, { SimpleGit, LogResult } from 'simple-git';
import { isLLMAvailable, llmComplete } from './llm.js';
import type { ParsedFile, CodeBlock } from '../types.js';
import type { DebtPrediction, DebtFactor, GitCommit } from './types.js';

export interface PredictInput {
  files: ParsedFile[];
  basePath: string;
  lookbackDays?: number;
}

export interface PredictOutput {
  predictions: DebtPrediction[];
  summary: PredictionSummary;
  trends: TrendAnalysis;
}

export interface PredictionSummary {
  totalFilesAnalyzed: number;
  criticalRiskFiles: number;
  highRiskFiles: number;
  mediumRiskFiles: number;
  lowRiskFiles: number;
  avgPredictedDebtIncrease: number;
}

export interface TrendAnalysis {
  complexityTrend: 'increasing' | 'stable' | 'decreasing';
  documentationTrend: 'improving' | 'stable' | 'declining';
  churnRate: number;
  hotspots: FileHotspot[];
}

export interface FileHotspot {
  file: string;
  changeCount: number;
  bugFixCount: number;
  riskScore: number;
}

export class PredictAgent extends BaseAgent<PredictInput, PredictOutput> {
  private git: SimpleGit | null = null;

  constructor() {
    super('PredictAgent');
  }

  protected async execute(input: PredictInput): Promise<PredictOutput> {
    this.log('Starting technical debt prediction analysis');

    // Initialize git
    this.git = simpleGit(input.basePath);

    // Get git history
    const lookbackDays = input.lookbackDays || 90;
    const history = await this.getGitHistory(lookbackDays);
    this.log(`Analyzed ${history.length} commits from the last ${lookbackDays} days`);

    // Analyze file churn
    const churnMap = this.analyzeChurn(history);

    // Generate predictions for each file
    const predictions: DebtPrediction[] = [];

    for (const file of input.files) {
      const prediction = await this.predictFileDebt(file, churnMap, history);
      predictions.push(prediction);
    }

    // Sort by risk level
    predictions.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });

    // Generate summary
    const summary = this.generateSummary(predictions);

    // Analyze trends
    const trends = this.analyzeTrends(input.files, history, churnMap);

    this.log(`Prediction complete: ${summary.criticalRiskFiles} critical, ${summary.highRiskFiles} high risk files`);

    return {
      predictions,
      summary,
      trends
    };
  }

  private async getGitHistory(days: number): Promise<GitCommit[]> {
    if (!this.git) return [];

    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const log: LogResult = await this.git.log({
        '--since': since.toISOString(),
        '--numstat': null
      });

      return log.all.map(commit => ({
        hash: commit.hash,
        author: commit.author_name,
        date: new Date(commit.date),
        message: commit.message,
        filesChanged: [], // Would need additional parsing
        insertions: 0,
        deletions: 0
      }));
    } catch (error) {
      this.log(`Warning: Could not get git history: ${error}`);
      return [];
    }
  }

  private analyzeChurn(history: GitCommit[]): Map<string, number> {
    const churnMap = new Map<string, number>();

    for (const commit of history) {
      for (const file of commit.filesChanged) {
        churnMap.set(file, (churnMap.get(file) || 0) + 1);
      }
    }

    return churnMap;
  }

  private async predictFileDebt(
    file: ParsedFile,
    churnMap: Map<string, number>,
    history: GitCommit[]
  ): Promise<DebtPrediction> {
    const factors: DebtFactor[] = [];
    let riskScore = 0;

    // Factor 1: Current complexity
    const avgComplexity = this.calculateAvgComplexity(file);
    if (avgComplexity > 15) {
      factors.push({
        name: 'High Complexity',
        impact: 25,
        description: `Average cyclomatic complexity of ${avgComplexity.toFixed(1)}`
      });
      riskScore += 25;
    } else if (avgComplexity > 10) {
      factors.push({
        name: 'Moderate Complexity',
        impact: 15,
        description: `Average cyclomatic complexity of ${avgComplexity.toFixed(1)}`
      });
      riskScore += 15;
    }

    // Factor 2: Documentation coverage
    const docCoverage = this.calculateDocCoverage(file);
    if (docCoverage < 0.3) {
      factors.push({
        name: 'Poor Documentation',
        impact: 20,
        description: `Only ${(docCoverage * 100).toFixed(0)}% of code is documented`
      });
      riskScore += 20;
    } else if (docCoverage < 0.6) {
      factors.push({
        name: 'Incomplete Documentation',
        impact: 10,
        description: `${(docCoverage * 100).toFixed(0)}% documentation coverage`
      });
      riskScore += 10;
    }

    // Factor 3: File size
    if (file.info.lines > 500) {
      factors.push({
        name: 'Large File',
        impact: 15,
        description: `File has ${file.info.lines} lines - consider splitting`
      });
      riskScore += 15;
    } else if (file.info.lines > 300) {
      factors.push({
        name: 'Growing File',
        impact: 8,
        description: `File has ${file.info.lines} lines - monitor size`
      });
      riskScore += 8;
    }

    // Factor 4: Churn rate
    const churnCount = churnMap.get(file.info.relativePath) || 0;
    if (churnCount > 10) {
      factors.push({
        name: 'High Churn',
        impact: 20,
        description: `Changed ${churnCount} times in analysis period`
      });
      riskScore += 20;
    } else if (churnCount > 5) {
      factors.push({
        name: 'Moderate Churn',
        impact: 10,
        description: `Changed ${churnCount} times in analysis period`
      });
      riskScore += 10;
    }

    // Factor 5: Number of functions
    const funcCount = file.blocks.filter(b =>
      b.type === 'function' || b.type === 'method'
    ).length;
    if (funcCount > 20) {
      factors.push({
        name: 'High Function Count',
        impact: 10,
        description: `${funcCount} functions - consider modularizing`
      });
      riskScore += 10;
    }

    // Factor 6: Deep nesting indicator
    const hasDeepNesting = file.blocks.some(b =>
      this.hasDeepNesting(b.content)
    );
    if (hasDeepNesting) {
      factors.push({
        name: 'Deep Nesting',
        impact: 15,
        description: 'Contains deeply nested code structures'
      });
      riskScore += 15;
    }

    // Determine risk level
    let riskLevel: DebtPrediction['riskLevel'];
    if (riskScore >= 60) {
      riskLevel = 'critical';
    } else if (riskScore >= 40) {
      riskLevel = 'high';
    } else if (riskScore >= 20) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    // Generate recommendation
    const recommendation = await this.generateRecommendation(factors, riskLevel, file);

    // Predict future score (simplified: assumes 10% degradation over 6 months without intervention)
    const predictedScore = Math.min(100, riskScore * 1.1);

    return {
      file: file.info.relativePath,
      currentScore: riskScore,
      predictedScore,
      riskLevel,
      factors,
      recommendation
    };
  }

  private calculateAvgComplexity(file: ParsedFile): number {
    const complexities = file.blocks
      .filter(b => b.complexity !== undefined)
      .map(b => b.complexity!);

    if (complexities.length === 0) return 0;
    return complexities.reduce((a, b) => a + b, 0) / complexities.length;
  }

  private calculateDocCoverage(file: ParsedFile): number {
    const documentable = file.blocks.filter(b =>
      ['function', 'method', 'class', 'interface'].includes(b.type)
    );

    if (documentable.length === 0) return 1;

    const documented = documentable.filter(b => b.documentation);
    return documented.length / documentable.length;
  }

  private hasDeepNesting(code: string): boolean {
    const lines = code.split('\n');
    for (const line of lines) {
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      if (indent > 10) return true; // 5+ levels of nesting at 2-space indent
    }
    return false;
  }

  private async generateRecommendation(
    factors: DebtFactor[],
    riskLevel: DebtPrediction['riskLevel'],
    file: ParsedFile
  ): Promise<string> {
    if (isLLMAvailable() && factors.length > 0) {
      try {
        return await this.generateRecommendationAI(factors, riskLevel, file);
      } catch (error) {
        this.log(`AI recommendation failed for '${file.info.relativePath}', using heuristic: ${error instanceof Error ? error.message : error}`);
      }
    }
    return this.generateRecommendationHeuristic(factors, riskLevel);
  }

  private async generateRecommendationAI(
    factors: DebtFactor[],
    riskLevel: DebtPrediction['riskLevel'],
    file: ParsedFile
  ): Promise<string> {
    const factorList = factors
      .map((f) => `- ${f.name} (impact ${f.impact}): ${f.description}`)
      .join('\n');

    const system =
      'You are a staff engineer advising on technical debt. Given a file and its ' +
      'measured risk factors, give a concise, specific, actionable recommendation ' +
      '(2-3 sentences) for what to do next. Reference the concrete factors; do not ' +
      'restate the metrics verbatim or use generic filler. Output plain prose only.';

    const prompt =
      `File: ${file.info.relativePath} (${file.info.language}, ${file.info.lines} lines)\n` +
      `Overall risk level: ${riskLevel}\n\n` +
      `Detected debt factors:\n${factorList}`;

    const recommendation = await llmComplete({
      system,
      prompt,
      maxTokens: 512,
      model: this.context?.config.aiModel
    });
    return recommendation || this.generateRecommendationHeuristic(factors, riskLevel);
  }

  private generateRecommendationHeuristic(
    factors: DebtFactor[],
    riskLevel: DebtPrediction['riskLevel']
  ): string {
    if (riskLevel === 'critical') {
      return 'Immediate refactoring recommended. Consider breaking into smaller modules and adding comprehensive documentation.';
    }

    if (riskLevel === 'high') {
      const topFactor = factors.sort((a, b) => b.impact - a.impact)[0];
      return `Priority: Address ${topFactor.name.toLowerCase()}. ${topFactor.description}`;
    }

    if (riskLevel === 'medium') {
      return 'Schedule maintenance: Add documentation and consider minor refactoring.';
    }

    return 'Low risk. Maintain current practices.';
  }

  private generateSummary(predictions: DebtPrediction[]): PredictionSummary {
    const criticalRiskFiles = predictions.filter(p => p.riskLevel === 'critical').length;
    const highRiskFiles = predictions.filter(p => p.riskLevel === 'high').length;
    const mediumRiskFiles = predictions.filter(p => p.riskLevel === 'medium').length;
    const lowRiskFiles = predictions.filter(p => p.riskLevel === 'low').length;

    const avgIncrease = predictions.length > 0
      ? predictions.reduce((sum, p) => sum + (p.predictedScore - p.currentScore), 0) / predictions.length
      : 0;

    return {
      totalFilesAnalyzed: predictions.length,
      criticalRiskFiles,
      highRiskFiles,
      mediumRiskFiles,
      lowRiskFiles,
      avgPredictedDebtIncrease: avgIncrease
    };
  }

  private analyzeTrends(
    files: ParsedFile[],
    history: GitCommit[],
    churnMap: Map<string, number>
  ): TrendAnalysis {
    // Calculate average complexity
    let totalComplexity = 0;
    let complexityCount = 0;
    for (const file of files) {
      for (const block of file.blocks) {
        if (block.complexity) {
          totalComplexity += block.complexity;
          complexityCount++;
        }
      }
    }
    const avgComplexity = complexityCount > 0 ? totalComplexity / complexityCount : 0;

    // Determine complexity trend (simplified - would need historical data)
    const complexityTrend: TrendAnalysis['complexityTrend'] =
      avgComplexity > 12 ? 'increasing' : avgComplexity < 8 ? 'decreasing' : 'stable';

    // Calculate documentation coverage
    let documented = 0;
    let documentable = 0;
    for (const file of files) {
      for (const block of file.blocks) {
        if (['function', 'method', 'class'].includes(block.type)) {
          documentable++;
          if (block.documentation) documented++;
        }
      }
    }
    const docRatio = documentable > 0 ? documented / documentable : 1;
    const documentationTrend: TrendAnalysis['documentationTrend'] =
      docRatio > 0.7 ? 'improving' : docRatio < 0.4 ? 'declining' : 'stable';

    // Calculate churn rate
    const totalChurn = Array.from(churnMap.values()).reduce((a, b) => a + b, 0);
    const churnRate = files.length > 0 ? totalChurn / files.length : 0;

    // Identify hotspots
    const hotspots: FileHotspot[] = [];
    for (const [file, changeCount] of churnMap.entries()) {
      if (changeCount >= 3) {
        const bugFixCount = history.filter(c =>
          c.message.toLowerCase().includes('fix') &&
          c.filesChanged.includes(file)
        ).length;

        hotspots.push({
          file,
          changeCount,
          bugFixCount,
          riskScore: changeCount * 10 + bugFixCount * 20
        });
      }
    }

    hotspots.sort((a, b) => b.riskScore - a.riskScore);

    return {
      complexityTrend,
      documentationTrend,
      churnRate,
      hotspots: hotspots.slice(0, 10)
    };
  }
}
