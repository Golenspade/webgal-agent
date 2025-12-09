/**
 * WebGAL 预览与资源工具
 * 严格按照 CONTRACTS.md 2.1 和 2.3 规范
 *
 * TS 5.0+ 特性:
 * - 使用 satisfies 操作符确保类型安全
 * - 使用 as const 保留字面量类型
 * - 使用 type 导入修饰符
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { FsSandbox, ErrorCode, type ToolError, CommandExecutor } from '@webgal-agent/tool-bridge'
import type {
  ListProjectResourcesResponse,
  PreviewSceneRequest,
  PreviewSceneResponse,
} from '../types/index.js'

/**
 * 资源目录配置
 * TS 5.0+: 使用 as const satisfies 确保类型安全
 */
const RESOURCE_DIRS = {
  backgrounds: { path: 'game/background', filter: 'image' },
  figures: { path: 'game/figure', filter: 'image' },
  bgm: { path: 'game/bgm', filter: 'audio' },
  vocals: { path: 'game/vocal', filter: 'audio' },
  scenes: { path: 'game/scene', filter: 'scene' },
} as const satisfies Record<string, { path: string; filter: 'image' | 'audio' | 'scene' }>

/**
 * 图片文件扩展名
 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'] as const

/**
 * 音频文件扩展名
 */
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.m4a', '.flac'] as const

/**
 * 场景文件扩展名
 */
const SCENE_EXTENSION = '.txt' as const

/**
 * 端口匹配模式
 * TS 5.0+: 使用 as const 保留元组类型
 */
const PORT_PATTERNS = [
  /localhost:(\d+)/i,
  /127\.0\.0\.1:(\d+)/i,
  /port\s+(\d+)/i,
  /:\s*(\d+)/,
] as const

/**
 * 默认开发服务器端口
 */
const DEFAULT_DEV_PORT = 3001 as const

/**
 * 创建工具错误
 * TS 5.0+: 使用 satisfies 确保返回类型正确
 */
function createToolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  hint?: string,
  recoverable = false,
): ToolError {
  return {
    error: {
      code,
      message,
      details,
      hint,
      recoverable,
    },
  } satisfies ToolError
}

/**
 * 检查是否为图片文件
 * TS 5.5+: 自动推断返回类型
 */
function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number])
}

/**
 * 检查是否为音频文件
 */
function isAudioFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])
}

/**
 * 检查是否为场景文件
 */
function isSceneFile(filename: string): boolean {
  return filename.endsWith(SCENE_EXTENSION)
}

/**
 * 根据过滤器类型获取过滤函数
 */
function getFileFilter(filterType: 'image' | 'audio' | 'scene'): (filename: string) => boolean {
  switch (filterType) {
    case 'image':
      return isImageFile
    case 'audio':
      return isAudioFile
    case 'scene':
      return isSceneFile
  }
}

/**
 * WebGAL 资源与预览工具类
 */
export class WebGALTools {
  private readonly sandbox: FsSandbox
  private readonly projectRoot: string
  private readonly executor?: CommandExecutor

  constructor(sandbox: FsSandbox, projectRoot: string, executor?: CommandExecutor) {
    this.sandbox = sandbox
    this.projectRoot = projectRoot
    this.executor = executor
  }

  /**
   * 2.1 list_project_resources - 列出项目资源
   * TS 5.0+: 使用 satisfies 确保返回类型正确
   */
  async listProjectResources(): Promise<ListProjectResourcesResponse> {
    // 并行获取所有资源目录
    const [backgrounds, figures, bgm, vocals, scenes] = await Promise.all([
      this.listResourceDir(RESOURCE_DIRS.backgrounds.path, RESOURCE_DIRS.backgrounds.filter),
      this.listResourceDir(RESOURCE_DIRS.figures.path, RESOURCE_DIRS.figures.filter),
      this.listResourceDir(RESOURCE_DIRS.bgm.path, RESOURCE_DIRS.bgm.filter),
      this.listResourceDir(RESOURCE_DIRS.vocals.path, RESOURCE_DIRS.vocals.filter),
      this.listResourceDir(RESOURCE_DIRS.scenes.path, RESOURCE_DIRS.scenes.filter),
    ])

    return {
      backgrounds,
      figures,
      bgm,
      vocals,
      scenes,
    } satisfies ListProjectResourcesResponse
  }

  /**
   * 列出资源目录中的文件
   */
  private async listResourceDir(
    dirPath: string,
    filterType: 'image' | 'audio' | 'scene',
  ): Promise<string[]> {
    try {
      const absolutePath = this.sandbox.validatePath(dirPath)
      const files = await fs.readdir(absolutePath)
      const filter = getFileFilter(filterType)

      // TS 5.5+: filter 自动推断类型
      return files.filter(filter)
    } catch {
      // 目录不存在，返回空数组
      return []
    }
  }

  /**
   * 2.3 preview_scene - 预览场景
   */
  async previewScene(request: PreviewSceneRequest): Promise<PreviewSceneResponse> {
    // 检查是否有 executor（dev 模式）
    if (!this.executor) {
      throw createToolError(
        ErrorCode.E_TOOL_DISABLED,
        'Preview requires dev mode with command execution enabled',
        undefined,
        'Enable execution in policies.json or use WebGAL Terre for preview',
        false,
      )
    }

    const logs: string[] = []

    try {
      // 1. 检查场景文件是否存在（如果指定了）
      if (request.scenePath) {
        await this.validateScenePath(request.scenePath)
      }

      // 2. 尝试启动 dev 服务器（流式执行，匹配到端口后立即返回）
      logs.push('Starting dev server...')

      const result = await this.executor.executeStream('dev', [], {
        earlyReturnPattern: /localhost:(\d+)|127\.0\.0\.1:(\d+)|port\s+(\d+)/i,
        earlyReturnTimeoutMs: 20000, // 20 秒超时
        keepAlive: true, // 保持 dev 服务器运行
      })

      logs.push(...result.logs)

      if (!result.ok) {
        throw createToolError(
          ErrorCode.E_PREVIEW_FAIL,
          'Failed to start dev server',
          { logs: result.logs },
          'Check the dev server logs for errors',
          true,
        )
      }

      // 3. 从日志中提取端口
      const port = this.extractPortFromLogs(result.logs)

      if (port === null) {
        throw createToolError(
          ErrorCode.E_PREVIEW_FAIL,
          'Could not determine dev server port',
          { logs: result.logs },
          'Check if dev server started correctly',
          true,
        )
      }

      // 4. 构建预览 URL
      const url = this.buildPreviewUrl(port, request.scenePath)

      return {
        url,
        logs,
      } satisfies PreviewSceneResponse
    } catch (err) {
      // 如果已经是 ToolError，直接抛出
      if (typeof err === 'object' && err !== null && 'error' in err) {
        throw err
      }

      throw createToolError(
        ErrorCode.E_PREVIEW_FAIL,
        `Preview failed: ${err instanceof Error ? err.message : String(err)}`,
        { logs },
        undefined,
        false,
      )
    }
  }

  /**
   * 验证场景路径
   */
  private async validateScenePath(scenePath: string): Promise<void> {
    const absolutePath = this.sandbox.validatePath(scenePath)
    try {
      await fs.access(absolutePath)
    } catch {
      throw createToolError(
        ErrorCode.E_NOT_FOUND,
        `Scene file not found: ${scenePath}`,
        { scenePath },
        'Check the scene file path',
        true,
      )
    }
  }

  /**
   * 构建预览 URL
   */
  private buildPreviewUrl(port: number, scenePath?: string): string {
    let url = `http://localhost:${port}`

    if (scenePath) {
      // 提取场景名（不含路径和扩展名）
      const sceneName = path.basename(scenePath, '.txt')
      url += `#scene=${sceneName}`
    }

    return url
  }

  /**
   * 从日志中提取端口号
   * TS 5.0+: 使用 for...of 遍历 as const 数组
   */
  private extractPortFromLogs(logs: readonly string[]): number | null {
    for (const log of logs) {
      // 遍历所有端口匹配模式
      for (const pattern of PORT_PATTERNS) {
        const match = log.match(pattern)
        if (match?.[1]) {
          const port = parseInt(match[1], 10)
          if (port > 0 && port < 65536) {
            return port
          }
        }
      }
    }

    // 返回默认端口
    return DEFAULT_DEV_PORT
  }
}
