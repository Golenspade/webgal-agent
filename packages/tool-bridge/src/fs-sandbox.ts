/**
 * 文件系统沙箱 - 路径安全校验
 * 严格按照 CONTRACTS.md 0.3 路径与沙箱规范
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * 错误码枚举（与 CONTRACTS.md 0.2 对齐）
 */
export enum ErrorCode {
  E_DENY_PATH = 'E_DENY_PATH',
  E_NOT_FOUND = 'E_NOT_FOUND',
  E_IO = 'E_IO',
  E_TOO_LARGE = 'E_TOO_LARGE',
  E_ENCODING = 'E_ENCODING',
  E_PARSE_FAIL = 'E_PARSE_FAIL',
  E_LINT_FAIL = 'E_LINT_FAIL',
  E_CONFLICT = 'E_CONFLICT',
  E_PREVIEW_FAIL = 'E_PREVIEW_FAIL',
  E_TIMEOUT = 'E_TIMEOUT',
  E_POLICY_VIOLATION = 'E_POLICY_VIOLATION',
  E_TOOL_DISABLED = 'E_TOOL_DISABLED',
  E_UNSUPPORTED = 'E_UNSUPPORTED',
  E_BAD_ARGS = 'E_BAD_ARGS',
  E_INTERNAL = 'E_INTERNAL',
}

/**
 * 统一错误结构（CONTRACTS.md 0.2）
 */
export interface ToolError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    hint?: string;
    recoverable?: boolean;
  };
}

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 项目根目录（绝对路径） */
  projectRoot: string;
  /** 禁止访问的目录 */
  forbiddenDirs: string[];
  /** 最大读取字节数 */
  maxReadBytes: number;
  /** 文本编码 */
  textEncoding: BufferEncoding;
}

/**
 * 默认沙箱配置
 */
export const DEFAULT_SANDBOX_CONFIG: Omit<SandboxConfig, 'projectRoot'> = {
  forbiddenDirs: ['.git', 'node_modules', '.env'],
  maxReadBytes: 1048576, // 1MB
  textEncoding: 'utf-8',
};

/**
 * 文件系统沙箱类
 */
export class FsSandbox {
  private config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  /**
   * 验证并规范化路径
   * @param relativePath 相对路径
   * @returns 规范化后的绝对路径
   * @throws ToolError 如果路径不安全
   */
  validatePath(relativePath: string): string {
    // 禁止绝对路径
    if (path.isAbsolute(relativePath)) {
      throw this.createError(
        ErrorCode.E_DENY_PATH,
        `Absolute paths are not allowed: ${relativePath}`,
        { path: relativePath },
        'Use relative paths from project root'
      );
    }

    // 规范化路径
    const absolutePath = path.resolve(this.config.projectRoot, relativePath);
    const normalizedPath = path.normalize(absolutePath);

    // 检查是否在项目根内
    if (!normalizedPath.startsWith(this.config.projectRoot + path.sep) &&
        normalizedPath !== this.config.projectRoot) {
      throw this.createError(
        ErrorCode.E_DENY_PATH,
        `Path escapes project root: ${relativePath}`,
        { path: relativePath, projectRoot: this.config.projectRoot },
        'Ensure path stays within project directory'
      );
    }

    // 检查禁止目录
    const relativeToRoot = path.relative(this.config.projectRoot, normalizedPath);
    const pathParts = relativeToRoot.split(path.sep);

    for (const forbidden of this.config.forbiddenDirs) {
      if (pathParts.includes(forbidden) || pathParts[0] === forbidden) {
        throw this.createError(
          ErrorCode.E_DENY_PATH,
          `Access to forbidden directory: ${forbidden}`,
          { path: relativePath, forbidden },
          `Avoid accessing ${forbidden} directory`
        );
      }
    }

    return normalizedPath;
  }

  /**
   * 检查文件大小
   * @param absolutePath 绝对路径
   * @throws ToolError 如果文件过大
   */
  async checkFileSize(absolutePath: string): Promise<void> {
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.size > this.config.maxReadBytes) {
        throw this.createError(
          ErrorCode.E_TOO_LARGE,
          `File exceeds maximum size: ${stats.size} > ${this.config.maxReadBytes}`,
          { path: absolutePath, size: stats.size, maxSize: this.config.maxReadBytes },
          `Try reading a smaller file or increase maxReadBytes (current: ${this.config.maxReadBytes})`
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw this.createError(
          ErrorCode.E_NOT_FOUND,
          `File not found: ${absolutePath}`,
          { path: absolutePath },
          'Check the file path and ensure it exists'
        );
      }
      throw err;
    }
  }

  /**
   * 创建标准错误对象
   */
  private createError(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    hint?: string
  ): ToolError {
    return {
      error: {
        code,
        message,
        details,
        hint,
        recoverable: code !== ErrorCode.E_INTERNAL,
      },
    };
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<SandboxConfig> {
    return { ...this.config };
  }
}
