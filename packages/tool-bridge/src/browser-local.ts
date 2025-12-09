/**
 * 浏览器本地访问控制
 * 严格按照 CONTRACTS.md 4.2 browser_action 规范
 *
 * TS 5.0+ 特性:
 * - 使用 satisfies 操作符确保类型安全
 * - 使用 switch(true) 进行类型收窄
 * - 使用 as const 保留字面量类型
 */

import { ErrorCode, type ToolError } from './fs-sandbox.js'

/**
 * 浏览器配置
 */
export interface BrowserConfig {
  /** 是否启用浏览器功能 */
  enabled: boolean
  /** 允许的主机列表 */
  allowedHosts: readonly string[]
  /** 截图保存目录 */
  screenshotDir: string
  /** 超时时间（毫秒） */
  timeoutMs: number
}

/**
 * 浏览器动作类型
 * TS 5.0+: 使用 as const 定义动作常量
 */
export const BROWSER_ACTIONS = ['open', 'click', 'screenshot'] as const
export type BrowserAction = (typeof BROWSER_ACTIONS)[number]

/**
 * 浏览器动作请求
 */
export interface BrowserActionRequest {
  action: BrowserAction
  url?: string
  selector?: string
  path?: string
}

/**
 * 浏览器动作结果
 */
export interface BrowserActionResult {
  ok: boolean
}

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
 * 检查是否为有效的浏览器动作
 * TS 5.5+: 自动推断类型谓词
 */
export function isValidBrowserAction(action: string): action is BrowserAction {
  return BROWSER_ACTIONS.includes(action as BrowserAction)
}

/**
 * 浏览器控制器类
 */
export class BrowserController {
  private readonly config: BrowserConfig

  constructor(config: BrowserConfig) {
    this.config = config
  }

  /**
   * 验证 URL 是否在允许的主机列表中
   * @param url 要验证的 URL
   * @throws 如果 URL 不在白名单中
   */
  validateUrl(url: string): void {
    if (!this.config.enabled) {
      throw createToolError(
        ErrorCode.E_TOOL_DISABLED,
        'Browser actions are disabled',
        undefined,
        'Enable browser in policies.json',
        false,
      )
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw createToolError(
        ErrorCode.E_BAD_ARGS,
        `Invalid URL: ${url}`,
        { url },
        'Provide a valid URL',
        true,
      )
    }

    // 检查协议
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw createToolError(
        ErrorCode.E_POLICY_VIOLATION,
        `Only HTTP/HTTPS protocols are allowed: ${parsedUrl.protocol}`,
        { url, protocol: parsedUrl.protocol },
        'Use http:// or https:// URLs',
        false,
      )
    }

    // 检查主机名
    const hostname = parsedUrl.hostname
    const isAllowed = this.config.allowedHosts.some((allowed) => {
      // TS 5.3+: switch(true) 类型收窄
      switch (true) {
        case allowed === hostname:
          return true
        case allowed === 'localhost' && (hostname === 'localhost' || hostname === '127.0.0.1'):
          return true
        case allowed === '127.0.0.1' && (hostname === 'localhost' || hostname === '127.0.0.1'):
          return true
        default:
          return false
      }
    })

    if (!isAllowed) {
      throw createToolError(
        ErrorCode.E_POLICY_VIOLATION,
        `Host not in whitelist: ${hostname}`,
        {
          url,
          hostname,
          allowedHosts: [...this.config.allowedHosts],
        },
        `Only these hosts are allowed: ${this.config.allowedHosts.join(', ')}`,
        false,
      )
    }
  }

  /**
   * 验证浏览器动作请求
   * TS 5.3+: 使用 switch(true) 进行更清晰的条件检查
   * @param request 动作请求
   */
  validateRequest(request: BrowserActionRequest): void {
    if (!this.config.enabled) {
      throw createToolError(
        ErrorCode.E_TOOL_DISABLED,
        'Browser actions are disabled',
        undefined,
        'Enable browser in policies.json',
        false,
      )
    }

    // 根据动作类型验证必需参数
    switch (request.action) {
      case 'open': {
        if (!request.url) {
          throw createToolError(
            ErrorCode.E_BAD_ARGS,
            'URL is required for open action',
            undefined,
            'Provide a url parameter',
            true,
          )
        }
        this.validateUrl(request.url)
        break
      }

      case 'click': {
        if (!request.selector) {
          throw createToolError(
            ErrorCode.E_BAD_ARGS,
            'Selector is required for click action',
            undefined,
            'Provide a selector parameter',
            true,
          )
        }
        break
      }

      case 'screenshot': {
        if (!request.path) {
          throw createToolError(
            ErrorCode.E_BAD_ARGS,
            'Path is required for screenshot action',
            undefined,
            'Provide a path parameter',
            true,
          )
        }
        break
      }

      default: {
        // TS 5.0+: exhaustive check - 如果添加新动作会在编译时报错
        const _exhaustive: never = request.action
        throw createToolError(
          ErrorCode.E_BAD_ARGS,
          `Unknown browser action: ${_exhaustive}`,
          { action: request.action },
          `Use one of: ${BROWSER_ACTIONS.join(', ')}`,
          true,
        )
      }
    }
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<BrowserConfig> {
    return { ...this.config }
  }
}

/**
 * 默认浏览器配置
 * TS 5.0+: 使用 satisfies 确保类型安全同时保留字面量类型
 */
export const DEFAULT_BROWSER_CONFIG = {
  enabled: false,
  allowedHosts: ['localhost', '127.0.0.1'] as const,
  timeoutMs: 30000,
} satisfies Omit<BrowserConfig, 'screenshotDir'>
