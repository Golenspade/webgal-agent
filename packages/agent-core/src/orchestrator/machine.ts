/**
 * Orchestrator - Plan→Act循环核心状态机
 * 按照Cline风格实现人机协作的AI Agent
 */

import { LLMProvider, type LLMConfig } from '../providers/llm.js';
import { PromptBuilder, type PromptContext } from '../prompt/builder.js';
import { WebGALAgentTools } from '../tools/index.js';
import type { WriteToFileRequest } from '../types/index.js';
import { ErrorCode } from '@webgal-agent/tool-bridge';

export interface OrchestratorConfig {
  llmConfig: LLMConfig;
  projectRoot: string;
  tools: WebGALAgentTools;
  snapshotRetention?: number;
}

export interface ScenePlan {
  file: string;
  background: string;
  characters: string[];
  summary: string;
  resourcesNeeded: string[];
}

export interface GenerationPlan {
  scenes: ScenePlan[];
  totalScenes: number;
  missingResources: string[];
}

export type OrchestratorState =
  | 'idle'
  | 'planning'
  | 'awaiting_plan_confirmation'
  | 'generating'
  | 'validating'
  | 'previewing'
  | 'awaiting_write_confirmation'
  | 'writing'
  | 'done'
  | 'error';

export interface OrchestratorResult {
  success: boolean;
  state: OrchestratorState;
  message: string;
  data?: any;
  error?: any;
}

export class Orchestrator {
  private llm: LLMProvider;
  private promptBuilder: PromptBuilder;
  private tools: WebGALAgentTools;
  private config: OrchestratorConfig;
  private state: OrchestratorState = 'idle';
  private currentPlan?: GenerationPlan;
  private currentSceneIndex: number = 0;
  private generatedContent: Map<string, string> = new Map();
  private context: PromptContext;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.llm = new LLMProvider(config.llmConfig);
    this.promptBuilder = new PromptBuilder();
    this.tools = config.tools;
    this.context = {
      projectRoot: config.projectRoot,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): OrchestratorState {
    return this.state;
  }

  /**
   * 执行完整的Plan→Act循环
   */
  async run(userRequest: string, callbacks?: {
    onPlanGenerated?: (plan: GenerationPlan) => void;
    onPlanConfirmation?: () => Promise<boolean>;
    onSceneGenerated?: (file: string, content: string) => void;
    onValidation?: (valid: boolean, errors?: any[]) => void;
    onPreview?: (url: string) => void;
    onWriteConfirmation?: (file: string, diff: any) => Promise<boolean>;
    onComplete?: (result: OrchestratorResult) => void;
  }): Promise<OrchestratorResult> {
    try {
      // Step 1: Planning - 生成场景计划
      this.state = 'planning';
      console.log('[Orchestrator] 生成场景计划...');

      // 先获取项目资源
      const resources = await this.tools.listProjectResources();
      this.context.resources = resources;

      const planPrompt = this.promptBuilder.buildPlanPrompt(userRequest, this.context);
      const planResponse = await this.llm.call([
        { role: 'user', content: planPrompt }
      ]);

      this.currentPlan = JSON.parse(planResponse.content);
      if (!this.currentPlan) {
        throw new Error('Failed to generate valid plan');
      }
      callbacks?.onPlanGenerated?.(this.currentPlan);

      // Step 2: 等待用户确认计划
      this.state = 'awaiting_plan_confirmation';
      const planConfirmed = await callbacks?.onPlanConfirmation?.() ?? true;

      if (!planConfirmed) {
        return {
          success: false,
          state: 'done',
          message: '用户取消了计划',
        };
      }

      // Step 3: Generating - 生成每个场景
      this.state = 'generating';
      console.log('[Orchestrator] 生成场景脚本...');

      if (!this.currentPlan || !this.currentPlan.scenes.length) {
        throw new Error('No scenes to generate');
      }

      for (let i = 0; i < this.currentPlan.scenes.length; i++) {
        this.currentSceneIndex = i;
        const scene = this.currentPlan.scenes[i];

        const scriptPrompt = this.promptBuilder.buildScriptPrompt(
          {
            file: scene.file,
            background: scene.background,
            characters: scene.characters,
            summary: scene.summary,
            previousContext: i > 0 ? this.currentPlan!.scenes[i - 1].summary : undefined,
          },
          this.context
        );

        const scriptResponse = await this.llm.call([
          { role: 'system', content: this.promptBuilder.buildSystemPrompt(this.context) },
          { role: 'user', content: scriptPrompt }
        ]);

        const content = scriptResponse.content.trim();
        this.generatedContent.set(scene.file, content);
        callbacks?.onSceneGenerated?.(scene.file, content);
      }

      // Step 4: Validating - 校验所有生成的脚本
      this.state = 'validating';
      console.log('[Orchestrator] 校验脚本...');

      for (const [file, content] of this.generatedContent) {
        const validation = await this.tools.validateScript({ content });

        if (!validation.valid && validation.diagnostics.length > 0) {
          // 尝试自动修复
          const fixPrompt = this.promptBuilder.buildFixPrompt(
            content,
            validation.diagnostics
          );

          const fixResponse = await this.llm.call([
            { role: 'system', content: this.promptBuilder.buildSystemPrompt(this.context) },
            { role: 'user', content: fixPrompt }
          ]);

          const fixedContent = fixResponse.content.trim();
          this.generatedContent.set(file, fixedContent);

          // 重新校验
          const revalidation = await this.tools.validateScript({ content: fixedContent });
          callbacks?.onValidation?.(revalidation.valid, revalidation.diagnostics);
        } else {
          callbacks?.onValidation?.(true);
        }
      }

      // Step 5: Previewing - 预览第一个场景
      this.state = 'previewing';
      if (this.currentPlan && this.currentPlan.scenes.length > 0) {
        const firstScene = this.currentPlan.scenes[0];
        const previewResult = await this.tools.previewScene({
          scenePath: firstScene.file,
        });
        callbacks?.onPreview?.(previewResult.url);
      }

      // Step 6: 等待写入确认
      this.state = 'awaiting_write_confirmation';
      if (!this.currentPlan || !this.currentPlan.scenes.length) {
        throw new Error('No scenes to write');
      }

      const writeConfirmed = await callbacks?.onWriteConfirmation?.(
        this.currentPlan.scenes[0].file,
        { type: 'batch', scenes: this.currentPlan.scenes.length }
      ) ?? true;

      if (!writeConfirmed) {
        return {
          success: false,
          state: 'done',
          message: '用户取消了写入',
        };
      }

      // Step 7: Writing - 写入所有文件
      this.state = 'writing';
      console.log('[Orchestrator] 写入文件...');

      if (!this.currentPlan) {
        throw new Error('No plan available for writing');
      }

      for (const scene of this.currentPlan.scenes) {
        const content = this.generatedContent.get(scene.file);
        if (!content) continue;

        // 先dry-run获取diff
        const dryRunResult = await this.tools.writeToFile({
          path: scene.file,
          content,
          mode: 'overwrite',
          dryRun: true,
        });

        // 实际写入
        const writeResult = await this.tools.writeToFile({
          path: scene.file,
          content,
          mode: 'overwrite',
          dryRun: false,
        });

        console.log(`[Orchestrator] 写入: ${scene.file} (${writeResult.bytesWritten} bytes)`);
      }

      this.state = 'done';
      const result: OrchestratorResult = {
        success: true,
        state: 'done',
        message: `成功生成 ${this.currentPlan?.scenes.length ?? 0} 个场景`,
        data: {
          scenes: this.currentPlan?.scenes ?? [],
          totalScenes: this.currentPlan?.scenes.length ?? 0,
        },
      };

      callbacks?.onComplete?.(result);
      return result;

    } catch (error) {
      this.state = 'error';
      console.error('[Orchestrator] 执行失败:', error);

      const result: OrchestratorResult = {
        success: false,
        state: 'error',
        message: error instanceof Error ? error.message : '未知错误',
        error,
      };

      callbacks?.onComplete?.(result);
      return result;
    }
  }

  /**
   * 生成单个场景（用于交互式生成）
   */
  async generateSingleScene(
    request: string,
    context: {
      file: string;
      background?: string;
      characters?: string[];
    }
  ): Promise<string> {
    const prompt = this.promptBuilder.buildScriptPrompt(
      {
        file: context.file,
        background: context.background || 'none',
        characters: context.characters || [],
        summary: request,
      },
      this.context
    );

    const response = await this.llm.call([
      { role: 'system', content: this.promptBuilder.buildSystemPrompt(this.context) },
      { role: 'user', content: prompt }
    ]);

    return response.content.trim();
  }

  /**
   * 修复脚本
   */
  async fixScript(content: string, diagnostics: any[]): Promise<string> {
    const fixPrompt = this.promptBuilder.buildFixPrompt(content, diagnostics);

    const response = await this.llm.call([
      { role: 'system', content: this.promptBuilder.buildSystemPrompt(this.context) },
      { role: 'user', content: fixPrompt }
    ]);

    return response.content.trim();
  }

  /**
   * 询问后续问题
   */
  async askQuestion(question: string): Promise<string> {
    const prompt = this.promptBuilder.buildFollowUpPrompt(question);

    const response = await this.llm.call([
      { role: 'user', content: prompt }
    ]);

    return response.content.trim();
  }

  /**
   * 获取运行时信息
   */
  getRuntimeInfo() {
    return {
      state: this.state,
      currentPlan: this.currentPlan,
      currentSceneIndex: this.currentSceneIndex,
      generatedScenes: Array.from(this.generatedContent.keys()),
      context: this.context,
    };
  }

  /**
   * 重置状态
   */
  reset() {
    this.state = 'idle';
    this.currentPlan = undefined;
    this.currentSceneIndex = 0;
    this.generatedContent.clear();
  }
}
