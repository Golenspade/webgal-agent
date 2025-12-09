/**
 * WebGAL 脚本校验工具
 * 严格按照 CONTRACTS.md 2.2 validate_script 规范
 *
 * TS 5.0+ 特性:
 * - 使用 as const 保留字面量类型
 * - 使用 switch(true) 进行类型收窄
 * - 使用 satisfies 操作符确保类型安全
 * - 使用自动推断的类型谓词
 */

import * as fs from 'node:fs/promises'
import { FsSandbox, ErrorCode, type ToolError } from '@webgal-agent/tool-bridge'
import type {
  ValidateScriptRequest,
  ValidateScriptResponse,
  Diagnostic,
  DiagnosticKind,
} from '../types/index.js'

/**
 * WebGAL 常用指令白名单（基于 PROMPTS.md）
 * TS 5.0+: 使用 as const 保留字面量类型
 */
const WEBGAL_COMMANDS = [
  // 对话与文本
  'intro',
  'say',

  // 背景与立绘
  'changeBg',
  'changeFigure',
  'miniAvatar',

  // 音频
  'bgm',
  'playEffect',
  'playVocal',

  // 场景与分支
  'changeScene',
  'callScene',
  'choose',
  'label',
  'jumpLabel',

  // 变量与条件
  'setVar',
  'setTextbox',

  // 特效与动画
  'pixiInit',
  'pixiPerform',
  'setAnimation',
  'setFilter',
  'setTransform',

  // 视频与模式
  'video',
  'filmMode',

  // 其他
  'comment',
  'end',
  'getUserInput',
  'setComplexAnimation',
  'unlockCg',
  'unlockBgm',
] as const

/**
 * WebGAL 指令类型
 */
type WebGALCommand = (typeof WEBGAL_COMMANDS)[number]

/**
 * 指令集合（用于快速查找）
 */
const WEBGAL_COMMANDS_SET: ReadonlySet<string> = new Set(WEBGAL_COMMANDS)

/**
 * 检查是否为有效的 WebGAL 指令
 * TS 5.5+: 自动推断类型谓词
 */
function isValidCommand(command: string): command is WebGALCommand {
  return WEBGAL_COMMANDS_SET.has(command)
}

/**
 * 资源类型配置
 * TS 5.0+: 使用 as const satisfies 确保类型安全
 */
const RESOURCE_CHECKS = [
  { pattern: /changeBg:\s*([^\s;-]+)/, dir: 'game/background', name: '背景' },
  { pattern: /changeFigure:\s*([^\s;-]+)/, dir: 'game/figure', name: '立绘' },
  { pattern: /bgm:\s*([^\s;-]+)/, dir: 'game/bgm', name: 'BGM' },
  { pattern: /playVocal:\s*([^\s;-]+)/, dir: 'game/vocal', name: '语音' },
  { pattern: /(?:changeScene|callScene):\s*([^\s;-]+)/, dir: 'game/scene', name: '场景' },
] as const satisfies readonly { pattern: RegExp; dir: string; name: string }[]

/**
 * 创建诊断对象
 * TS 5.0+: 使用 satisfies 确保返回类型正确
 */
function createDiagnostic(
  line: number,
  kind: DiagnosticKind,
  message: string,
  fixHint?: string,
): Diagnostic {
  return {
    line,
    kind,
    message,
    fixHint,
  } satisfies Diagnostic
}

/**
 * 创建工具错误
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
 * 脚本校验器类
 */
export class ScriptValidator {
  private readonly sandbox: FsSandbox
  private readonly projectRoot: string

  constructor(sandbox: FsSandbox, projectRoot: string) {
    this.sandbox = sandbox
    this.projectRoot = projectRoot
  }

  /**
   * 校验脚本
   */
  async validate(request: ValidateScriptRequest): Promise<ValidateScriptResponse> {
    const content = await this.getContent(request)
    const diagnostics: Diagnostic[] = []
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim()
      const lineNumber = i + 1

      // 跳过空行和纯注释行
      if (!line || line.startsWith(';')) {
        continue
      }

      // 检查分号结尾
      if (!line.endsWith(';')) {
        diagnostics.push(
          createDiagnostic(lineNumber, 'syntax', '语句必须以分号结尾', `在行尾添加分号: ${line};`),
        )
      }

      // 检查指令
      this.checkCommand(line, lineNumber, diagnostics)

      // 检查资源引用
      await this.checkResourceReferences(line, lineNumber, diagnostics)
    }

    return {
      valid: diagnostics.length === 0,
      diagnostics,
    } satisfies ValidateScriptResponse
  }

  /**
   * 获取脚本内容
   */
  private async getContent(request: ValidateScriptRequest): Promise<string> {
    // TS 5.3+: switch(true) 类型收窄
    switch (true) {
      case request.content !== undefined && request.content !== null: {
        return request.content
      }

      case request.path !== undefined && request.path !== null: {
        const absolutePath = this.sandbox.validatePath(request.path)
        try {
          return await fs.readFile(absolutePath, 'utf-8')
        } catch {
          throw createToolError(
            ErrorCode.E_NOT_FOUND,
            `Script file not found: ${request.path}`,
            { path: request.path },
            undefined,
            true,
          )
        }
      }

      default: {
        throw createToolError(
          ErrorCode.E_BAD_ARGS,
          'Either path or content must be provided',
          undefined,
          undefined,
          true,
        )
      }
    }
  }

  /**
   * 检查指令
   */
  private checkCommand(line: string, lineNumber: number, diagnostics: Diagnostic[]): void {
    // 提取指令部分（冒号前或整行）
    const colonIndex = line.indexOf(':')

    // TS 5.3+: switch(true) 进行条件分支
    switch (true) {
      case colonIndex > 0: {
        const beforeColon = line.substring(0, colonIndex).trim()
        // 可能是 "角色:台词" 或 "指令:参数"
        // 检查是否看起来像指令（驼峰命名）
        const looksLikeCommand = /^[a-z][a-zA-Z0-9_]*$/.test(beforeColon)

        if (looksLikeCommand && !isValidCommand(beforeColon)) {
          diagnostics.push(
            createDiagnostic(
              lineNumber,
              'syntax',
              `未知指令: ${beforeColon}`,
              '检查指令拼写或参考 WebGAL 文档',
            ),
          )
        }
        break
      }

      default: {
        // 没有冒号，可能是纯指令
        const firstWord = line.split(/[\s;]/)[0]
        if (firstWord) {
          const looksLikeCommand = /^[a-z][a-zA-Z0-9_]*$/.test(firstWord)
          if (looksLikeCommand && !isValidCommand(firstWord)) {
            diagnostics.push(
              createDiagnostic(
                lineNumber,
                'syntax',
                `未知指令: ${firstWord}`,
                '检查指令拼写或参考 WebGAL 文档',
              ),
            )
          }
        }
        break
      }
    }
  }

  /**
   * 检查资源引用
   * TS 5.0+: 使用 for...of 遍历 as const 数组
   */
  private async checkResourceReferences(
    line: string,
    lineNumber: number,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    for (const check of RESOURCE_CHECKS) {
      const match = line.match(check.pattern)
      if (match?.[1] && match[1] !== 'none') {
        const resourceFile = match[1]
        const exists = await this.checkFileExists(check.dir, resourceFile)
        if (!exists) {
          diagnostics.push(
            createDiagnostic(
              lineNumber,
              'resource',
              `${check.name}文件不存在: ${resourceFile}`,
              `检查 ${check.dir} 目录中的文件名`,
            ),
          )
        }
      }
    }
  }

  /**
   * 检查文件是否存在
   */
  private async checkFileExists(dir: string, filename: string): Promise<boolean> {
    try {
      const filePath = `${dir}/${filename}`
      const absolutePath = this.sandbox.validatePath(filePath)
      await fs.access(absolutePath)
      return true
    } catch {
      return false
    }
  }
}
