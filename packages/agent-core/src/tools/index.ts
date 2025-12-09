/**
 * 工具集成 - 统一导出所有工具
 */

import {
  FsSandbox,
  CommandExecutor,
  BrowserController,
  type SandboxConfig,
  type ExecutionConfig,
  type BrowserConfig,
} from '@webgal-agent/tool-bridge'
import { FileSystemTools } from './fs.js'
import { ScriptValidator } from './validate.js'
import { WebGALTools } from './preview.js'
import { InteractionTools } from './interact.js'
import type { IdempotencyConfig } from './diff-snapshot.js'
import type {
  ListFilesRequest,
  ListFilesResponse,
  ReadFileRequest,
  ReadFileResponse,
  WriteToFileRequest,
  WriteToFileResponse,
  ReplaceInFileRequest,
  ReplaceInFileResponse,
  SearchFilesRequest,
  SearchFilesResponse,
  ValidateScriptRequest,
  ValidateScriptResponse,
  ListProjectResourcesResponse,
  ListSnapshotsRequest,
  ListSnapshotsResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
  PreviewSceneRequest,
  PreviewSceneResponse,
  AskFollowupQuestionRequest,
  AskFollowupQuestionResponse,
  AttemptCompletionRequest,
  AttemptCompletionResponse,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  BrowserActionRequest,
  BrowserActionResponse,
} from '../types/index.js'

/**
 * 工具集配置
 */
export interface ToolsConfig {
  projectRoot: string
  sandbox: SandboxConfig
  execution?: ExecutionConfig
  browser?: BrowserConfig
  snapshotRetention?: number
  idempotency?: IdempotencyConfig
}

/**
 * 统一工具集类
 */
export class WebGALAgentTools {
  private sandbox: FsSandbox
  private fsTools: FileSystemTools
  private validator: ScriptValidator
  private webgalTools: WebGALTools
  private interactionTools: InteractionTools
  private executor?: CommandExecutor
  private browserController?: BrowserController

  constructor(config: ToolsConfig) {
    // 初始化沙箱
    this.sandbox = new FsSandbox(config.sandbox)

    // 初始化文件系统工具
    this.fsTools = new FileSystemTools(
      this.sandbox,
      config.projectRoot,
      config.snapshotRetention || 20,
      config.idempotency,
    )

    // 初始化校验器
    this.validator = new ScriptValidator(this.sandbox, config.projectRoot)

    // 初始化命令执行器（如果启用）
    if (config.execution?.enabled) {
      this.executor = new CommandExecutor(config.execution)
    }

    // 初始化浏览器控制器（如果启用）
    if (config.browser?.enabled) {
      this.browserController = new BrowserController(config.browser)
    }

    // 初始化 WebGAL 工具
    this.webgalTools = new WebGALTools(this.sandbox, config.projectRoot, this.executor)

    // 初始化交互工具
    this.interactionTools = new InteractionTools()
  }

  // ============ 基础文件工具 ============

  async listFiles(request: ListFilesRequest): Promise<ListFilesResponse> {
    return this.fsTools.listFiles(request)
  }

  async readFile(request: ReadFileRequest): Promise<ReadFileResponse> {
    return this.fsTools.readFile(request)
  }

  async writeToFile(request: WriteToFileRequest): Promise<WriteToFileResponse> {
    return this.fsTools.writeToFile(request)
  }

  async replaceInFile(request: ReplaceInFileRequest): Promise<ReplaceInFileResponse> {
    return this.fsTools.replaceInFile(request)
  }

  async searchFiles(request: SearchFilesRequest): Promise<SearchFilesResponse> {
    return this.fsTools.searchFiles(request)
  }

  // ============ WebGAL 专用工具 ============

  async validateScript(request: ValidateScriptRequest): Promise<ValidateScriptResponse> {
    return this.validator.validate(request)
  }

  async listProjectResources(): Promise<ListProjectResourcesResponse> {
    return this.webgalTools.listProjectResources()
  }

  async previewScene(request: PreviewSceneRequest): Promise<PreviewSceneResponse> {
    return this.webgalTools.previewScene(request)
  }

  // ============ 快照工具 ============

  async listSnapshots(request: ListSnapshotsRequest): Promise<ListSnapshotsResponse> {
    return this.fsTools.listSnapshots(request)
  }

  async restoreSnapshot(request: RestoreSnapshotRequest): Promise<RestoreSnapshotResponse> {
    return this.fsTools.restoreSnapshot(request)
  }

  // ============ 交互工具 ============

  async askFollowupQuestion(
    request: AskFollowupQuestionRequest,
  ): Promise<AskFollowupQuestionResponse> {
    return this.interactionTools.askFollowupQuestion(request)
  }

  async attemptCompletion(request: AttemptCompletionRequest): Promise<AttemptCompletionResponse> {
    return this.interactionTools.attemptCompletion(request)
  }

  // ============ 命令执行（dev 模式） ============

  async executeCommand(request: ExecuteCommandRequest): Promise<ExecuteCommandResponse> {
    if (!this.executor) {
      throw {
        error: {
          code: 'E_TOOL_DISABLED',
          message: 'Command execution is disabled',
          hint: 'Enable execution in policies.json',
          recoverable: false,
        },
      }
    }

    return this.executor.execute(request.scriptName, request.args)
  }

  // ============ 浏览器动作（dev 模式） ============

  async browserAction(request: BrowserActionRequest): Promise<BrowserActionResponse> {
    if (!this.browserController) {
      throw {
        error: {
          code: 'E_TOOL_DISABLED',
          message: 'Browser actions are disabled',
          hint: 'Enable browser in policies.json',
          recoverable: false,
        },
      }
    }

    // 验证请求
    this.browserController.validateRequest(request)

    // 这里是占位实现
    // 实际应该集成真实的浏览器自动化（如 Playwright）
    console.log('[BROWSER]', request)

    return {
      ok: true,
    }
  }
}

// 导出所有类型和工具
export * from './fs.js'
export * from './validate.js'
export * from './preview.js'
export * from './interact.js'
export * from './diff-snapshot.js'
