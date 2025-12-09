/**
 * 命令白名单执行器
 * 严格按照 CONTRACTS.md 4.1 execute_command 规范
 *
 * TS 5.0+ 特性:
 * - 使用 satisfies 操作符确保类型安全
 * - 使用 type 导入修饰符
 * - 使用 as const 保留字面量类型
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ErrorCode, type ToolError } from './fs-sandbox.js'

/**
 * 执行配置
 */
export interface ExecutionConfig {
  /** 是否启用命令执行 */
  enabled: boolean
  /** 允许的命令列表（从 package.json 动态收集） */
  allowedCommands: readonly string[]
  /** 超时时间（毫秒） */
  timeoutMs: number
  /** 工作目录 */
  workingDir: string
  /** 需要遮蔽的环境变量 */
  redactEnv: readonly string[]
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  ok: boolean
  logs: string[]
  exitCode?: number
}

/**
 * 流式执行选项
 */
export interface StreamExecutionOptions {
  /** 匹配模式（匹配到后立即返回） */
  earlyReturnPattern?: RegExp
  /** 早返回超时（毫秒，默认 20 秒） */
  earlyReturnTimeoutMs?: number
  /** 是否保持进程运行（默认 false） */
  keepAlive?: boolean
}

/**
 * 默认允许的脚本列表
 * TS 5.0+: 使用 as const 保留字面量类型
 */
const DEFAULT_SAFE_SCRIPTS = ['dev', 'build', 'lint', 'test', 'start', 'preview'] as const

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
 * 命令执行器类
 */
export class CommandExecutor {
  private readonly config: ExecutionConfig

  constructor(config: ExecutionConfig) {
    this.config = config
  }

  /**
   * 从 package.json 收集允许的命令
   * @param projectRoot 项目根目录
   * @returns 允许的命令列表
   */
  static async collectAllowedCommands(projectRoot: string): Promise<string[]> {
    try {
      const packageJsonPath = path.join(projectRoot, 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(content) as { scripts?: Record<string, string> }

      const scripts = packageJson.scripts ?? {}

      // TS 5.5+: filter 会自动推断类型谓词
      return Object.keys(scripts).filter((script) =>
        DEFAULT_SAFE_SCRIPTS.includes(script as (typeof DEFAULT_SAFE_SCRIPTS)[number]),
      )
    } catch (err) {
      console.warn('Failed to read package.json, using default allowed commands', err)
      return ['dev', 'build', 'lint']
    }
  }

  /**
   * 执行命令
   * @param scriptName 脚本名称（必须在白名单中）
   * @param args 额外参数
   * @returns 执行结果
   */
  async execute(scriptName: string, args: readonly string[] = []): Promise<ExecutionResult> {
    // 检查是否启用
    if (!this.config.enabled) {
      throw createToolError(
        ErrorCode.E_TOOL_DISABLED,
        'Command execution is disabled',
        undefined,
        'Enable execution in policies.json',
        false,
      )
    }

    // 检查白名单
    if (!this.config.allowedCommands.includes(scriptName)) {
      throw createToolError(
        ErrorCode.E_POLICY_VIOLATION,
        `Command not in whitelist: ${scriptName}`,
        {
          scriptName,
          allowedCommands: [...this.config.allowedCommands],
        },
        `Only these commands are allowed: ${this.config.allowedCommands.join(', ')}`,
        false,
      )
    }

    return new Promise((resolve, reject) => {
      const logs: string[] = []
      let timedOut = false

      // 使用 npm/yarn run 执行脚本
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const child = spawn(command, ['run', scriptName, ...args], {
        cwd: this.config.workingDir,
        env: this.sanitizeEnv(process.env),
        shell: false,
      })

      // 设置超时
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill()
        reject(
          createToolError(
            ErrorCode.E_TIMEOUT,
            `Command execution timed out after ${this.config.timeoutMs}ms`,
            { scriptName, timeoutMs: this.config.timeoutMs },
            'Increase timeoutMs in policies.json or optimize the command',
            true,
          ),
        )
      }, this.config.timeoutMs)

      // 收集输出
      child.stdout?.on('data', (data: Buffer) => {
        const line = data.toString()
        logs.push(line)
      })

      child.stderr?.on('data', (data: Buffer) => {
        const line = data.toString()
        logs.push(`[stderr] ${line}`)
      })

      // 处理完成
      child.on('close', (code) => {
        clearTimeout(timeout)

        if (timedOut) {
          return // 已经在超时处理中 reject 了
        }

        resolve({
          ok: code === 0,
          logs,
          exitCode: code ?? undefined,
        } satisfies ExecutionResult)
      })

      // 处理错误
      child.on('error', (err) => {
        clearTimeout(timeout)

        if (timedOut) {
          return
        }

        reject(
          createToolError(
            ErrorCode.E_INTERNAL,
            `Failed to execute command: ${err.message}`,
            { scriptName, error: err.message },
            undefined,
            false,
          ),
        )
      })
    })
  }

  /**
   * 流式执行命令（支持早返回）
   * 用于 dev 服务器等长驻进程，匹配到特定日志后立即返回
   * @param scriptName 脚本名称
   * @param args 额外参数
   * @param options 流式执行选项
   * @returns 执行结果
   */
  async executeStream(
    scriptName: string,
    args: readonly string[] = [],
    options: StreamExecutionOptions = {},
  ): Promise<ExecutionResult> {
    // 检查是否启用
    if (!this.config.enabled) {
      throw createToolError(
        ErrorCode.E_TOOL_DISABLED,
        'Command execution is disabled',
        undefined,
        'Enable execution in policies.json',
        false,
      )
    }

    // 检查白名单
    if (!this.config.allowedCommands.includes(scriptName)) {
      throw createToolError(
        ErrorCode.E_POLICY_VIOLATION,
        `Command not in whitelist: ${scriptName}`,
        {
          scriptName,
          allowedCommands: [...this.config.allowedCommands],
        },
        `Only these commands are allowed: ${this.config.allowedCommands.join(', ')}`,
        false,
      )
    }

    const earlyReturnTimeout = options.earlyReturnTimeoutMs ?? 20000 // 默认 20 秒

    return new Promise((resolve, reject) => {
      const logs: string[] = []
      let resolved = false

      // 使用 npm/yarn run 执行脚本
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const child = spawn(command, ['run', scriptName, ...args], {
        cwd: this.config.workingDir,
        env: this.sanitizeEnv(process.env),
        shell: false,
      })

      // 设置早返回超时
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          // 无论 keepAlive 与否，超时属于失败场景，必须清理子进程以免挂起测试进程
          try {
            child.kill()
          } catch {
            // 忽略 kill 错误
          }
          reject(
            createToolError(
              ErrorCode.E_TIMEOUT,
              `Early return pattern not matched within ${earlyReturnTimeout}ms`,
              {
                scriptName,
                timeoutMs: earlyReturnTimeout,
                pattern: options.earlyReturnPattern?.source,
              },
              'Check if the dev server started correctly or adjust the pattern',
              true,
            ),
          )
        }
      }, earlyReturnTimeout)

      // 收集输出并检查早返回模式
      child.stdout?.on('data', (data: Buffer) => {
        const line = data.toString()
        logs.push(line)

        // 检查早返回模式
        if (!resolved && options.earlyReturnPattern?.test(line)) {
          resolved = true
          clearTimeout(timeout)

          // 如果不保持存活，杀掉进程；保持存活时让调用方自行管理
          if (!options.keepAlive) {
            try {
              child.kill()
            } catch {
              // 忽略 kill 错误
            }
          }

          resolve({
            ok: true,
            logs,
            exitCode: undefined, // 进程可能还在运行
          } satisfies ExecutionResult)
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const line = data.toString()
        logs.push(`[stderr] ${line}`)
      })

      // 如果进程意外退出
      child.on('close', (code) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)

          if (code === 0) {
            resolve({
              ok: true,
              logs,
              exitCode: code,
            } satisfies ExecutionResult)
          } else {
            reject(
              createToolError(
                ErrorCode.E_INTERNAL,
                `Command exited with code ${code}`,
                { scriptName, exitCode: code, logs },
                undefined,
                false,
              ),
            )
          }
        }
      })

      child.on('error', (err) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(
            createToolError(
              ErrorCode.E_INTERNAL,
              `Failed to execute command: ${err.message}`,
              { scriptName, error: err.message },
              undefined,
              false,
            ),
          )
        }
      })
    })
  }

  /**
   * 清理环境变量（遮蔽敏感信息）
   */
  private sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const sanitized = { ...env }

    for (const key of this.config.redactEnv) {
      if (key in sanitized) {
        delete sanitized[key]
      }
    }

    return sanitized
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<ExecutionConfig> {
    return { ...this.config }
  }
}
