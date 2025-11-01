/**
 * 命令白名单执行器
 * 严格按照 CONTRACTS.md 4.1 execute_command 规范
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ErrorCode } from './fs-sandbox.js';

/**
 * 执行配置
 */
export interface ExecutionConfig {
  /** 是否启用命令执行 */
  enabled: boolean;
  /** 允许的命令列表（从 package.json 动态收集） */
  allowedCommands: string[];
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 工作目录 */
  workingDir: string;
  /** 需要遮蔽的环境变量 */
  redactEnv: string[];
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  ok: boolean;
  logs: string[];
  exitCode?: number;
}

/**
 * 流式执行选项
 */
export interface StreamExecutionOptions {
  /** 匹配模式（匹配到后立即返回） */
  earlyReturnPattern?: RegExp;
  /** 早返回超时（毫秒，默认 20 秒） */
  earlyReturnTimeoutMs?: number;
  /** 是否保持进程运行（默认 false） */
  keepAlive?: boolean;
}

/**
 * 命令执行器类
 */
export class CommandExecutor {
  private config: ExecutionConfig;

  constructor(config: ExecutionConfig) {
    this.config = config;
  }

  /**
   * 从 package.json 收集允许的命令
   * @param projectRoot 项目根目录
   * @returns 允许的命令列表
   */
  static async collectAllowedCommands(projectRoot: string): Promise<string[]> {
    try {
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const scripts = packageJson.scripts || {};
      const allowedScripts = ['dev', 'build', 'lint'];

      return Object.keys(scripts).filter(script =>
        allowedScripts.includes(script)
      );
    } catch (err) {
      console.warn('Failed to read package.json, using default allowed commands', err);
      return ['dev', 'build', 'lint'];
    }
  }

  /**
   * 执行命令
   * @param scriptName 脚本名称（必须在白名单中）
   * @param args 额外参数
   * @returns 执行结果
   */
  async execute(scriptName: string, args: string[] = []): Promise<ExecutionResult> {
    // 检查是否启用
    if (!this.config.enabled) {
      throw {
        error: {
          code: ErrorCode.E_TOOL_DISABLED,
          message: 'Command execution is disabled',
          hint: 'Enable execution in policies.json',
          recoverable: false,
        },
      };
    }

    // 检查白名单
    if (!this.config.allowedCommands.includes(scriptName)) {
      throw {
        error: {
          code: ErrorCode.E_POLICY_VIOLATION,
          message: `Command not in whitelist: ${scriptName}`,
          details: {
            scriptName,
            allowedCommands: this.config.allowedCommands
          },
          hint: `Only these commands are allowed: ${this.config.allowedCommands.join(', ')}`,
          recoverable: false,
        },
      };
    }

    return new Promise((resolve, reject) => {
      const logs: string[] = [];
      let timedOut = false;

      // 设置超时
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
        reject({
          error: {
            code: ErrorCode.E_TIMEOUT,
            message: `Command execution timed out after ${this.config.timeoutMs}ms`,
            details: { scriptName, timeoutMs: this.config.timeoutMs },
            hint: 'Increase timeoutMs in policies.json or optimize the command',
            recoverable: true,
          },
        });
      }, this.config.timeoutMs);

      // 使用 npm/yarn run 执行脚本
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(command, ['run', scriptName, ...args], {
        cwd: this.config.workingDir,
        env: this.sanitizeEnv(process.env),
        shell: false,
      });

      // 收集输出
      child.stdout?.on('data', (data) => {
        const line = data.toString();
        logs.push(line);
      });

      child.stderr?.on('data', (data) => {
        const line = data.toString();
        logs.push(`[stderr] ${line}`);
      });

      // 处理完成
      child.on('close', (code) => {
        clearTimeout(timeout);

        if (timedOut) {
          return; // 已经在超时处理中 reject 了
        }

        resolve({
          ok: code === 0,
          logs,
          exitCode: code ?? undefined,
        });
      });

      // 处理错误
      child.on('error', (err) => {
        clearTimeout(timeout);

        if (timedOut) {
          return;
        }

        reject({
          error: {
            code: ErrorCode.E_INTERNAL,
            message: `Failed to execute command: ${err.message}`,
            details: { scriptName, error: err.message },
            recoverable: false,
          },
        });
      });
    });
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
    args: string[] = [],
    options: StreamExecutionOptions = {}
  ): Promise<ExecutionResult> {
    // 检查是否启用
    if (!this.config.enabled) {
      throw {
        error: {
          code: ErrorCode.E_TOOL_DISABLED,
          message: 'Command execution is disabled',
          hint: 'Enable execution in policies.json',
          recoverable: false,
        },
      };
    }

    // 检查白名单
    if (!this.config.allowedCommands.includes(scriptName)) {
      throw {
        error: {
          code: ErrorCode.E_POLICY_VIOLATION,
          message: `Command not in whitelist: ${scriptName}`,
          details: {
            scriptName,
            allowedCommands: this.config.allowedCommands
          },
          hint: `Only these commands are allowed: ${this.config.allowedCommands.join(', ')}`,
          recoverable: false,
        },
      };
    }

    const earlyReturnTimeout = options.earlyReturnTimeoutMs || 20000; // 默认 20 秒

    return new Promise((resolve, reject) => {
      const logs: string[] = [];
      let resolved = false;

      // 设置早返回超时
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (!options.keepAlive) {
            child.kill();
          }
          reject({
            error: {
              code: ErrorCode.E_TIMEOUT,
              message: `Early return pattern not matched within ${earlyReturnTimeout}ms`,
              details: {
                scriptName,
                timeoutMs: earlyReturnTimeout,
                pattern: options.earlyReturnPattern?.source,
              },
              hint: 'Check if the dev server started correctly or adjust the pattern',
              recoverable: true,
            },
          });
        }
      }, earlyReturnTimeout);

      // 使用 npm/yarn run 执行脚本
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(command, ['run', scriptName, ...args], {
        cwd: this.config.workingDir,
        env: this.sanitizeEnv(process.env),
        shell: false,
      });

      // 收集输出并检查早返回模式
      child.stdout?.on('data', (data) => {
        const line = data.toString();
        logs.push(line);

        // 检查早返回模式
        if (!resolved && options.earlyReturnPattern && options.earlyReturnPattern.test(line)) {
          resolved = true;
          clearTimeout(timeout);

          // 如果不保持存活，杀掉进程
          if (!options.keepAlive) {
            child.kill();
          }

          resolve({
            ok: true,
            logs,
            exitCode: undefined, // 进程可能还在运行
          });
        }
      });

      child.stderr?.on('data', (data) => {
        const line = data.toString();
        logs.push(`[stderr] ${line}`);
      });

      // 如果进程意外退出
      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);

          if (code === 0) {
            resolve({
              ok: true,
              logs,
              exitCode: code,
            });
          } else {
            reject({
              error: {
                code: ErrorCode.E_INTERNAL,
                message: `Command exited with code ${code}`,
                details: { scriptName, exitCode: code, logs },
                recoverable: false,
              },
            });
          }
        }
      });

      child.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject({
            error: {
              code: ErrorCode.E_INTERNAL,
              message: `Failed to execute command: ${err.message}`,
              details: { scriptName, error: err.message },
              recoverable: false,
            },
          });
        }
      });
    });
  }

  /**
   * 清理环境变量（遮蔽敏感信息）
   */
  private sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const sanitized = { ...env };

    for (const key of this.config.redactEnv) {
      if (key in sanitized) {
        delete sanitized[key];
      }
    }

    return sanitized;
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<ExecutionConfig> {
    return { ...this.config };
  }
}

