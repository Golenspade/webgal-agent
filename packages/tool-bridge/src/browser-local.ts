/**
 * 浏览器本地访问控制
 * 严格按照 CONTRACTS.md 4.2 browser_action 规范
 */

import { ErrorCode } from './fs-sandbox.js';

/**
 * 浏览器配置
 */
export interface BrowserConfig {
  /** 是否启用浏览器功能 */
  enabled: boolean;
  /** 允许的主机列表 */
  allowedHosts: string[];
  /** 截图保存目录 */
  screenshotDir: string;
  /** 超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * 浏览器动作类型
 */
export type BrowserAction = 'open' | 'click' | 'screenshot';

/**
 * 浏览器动作请求
 */
export interface BrowserActionRequest {
  action: BrowserAction;
  url?: string;
  selector?: string;
  path?: string;
}

/**
 * 浏览器动作结果
 */
export interface BrowserActionResult {
  ok: boolean;
}

/**
 * 浏览器控制器类
 */
export class BrowserController {
  private config: BrowserConfig;

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  /**
   * 验证 URL 是否在允许的主机列表中
   * @param url 要验证的 URL
   * @throws 如果 URL 不在白名单中
   */
  validateUrl(url: string): void {
    if (!this.config.enabled) {
      throw {
        error: {
          code: ErrorCode.E_TOOL_DISABLED,
          message: 'Browser actions are disabled',
          hint: 'Enable browser in policies.json',
          recoverable: false,
        },
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      throw {
        error: {
          code: ErrorCode.E_BAD_ARGS,
          message: `Invalid URL: ${url}`,
          details: { url },
          hint: 'Provide a valid URL',
          recoverable: true,
        },
      };
    }

    // 检查协议
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw {
        error: {
          code: ErrorCode.E_POLICY_VIOLATION,
          message: `Only HTTP/HTTPS protocols are allowed: ${parsedUrl.protocol}`,
          details: { url, protocol: parsedUrl.protocol },
          hint: 'Use http:// or https:// URLs',
          recoverable: false,
        },
      };
    }

    // 检查主机名
    const hostname = parsedUrl.hostname;
    const isAllowed = this.config.allowedHosts.some(allowed => {
      // 精确匹配或通配符匹配
      if (allowed === hostname) return true;
      if (allowed === 'localhost' && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
      if (allowed === '127.0.0.1' && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
      return false;
    });

    if (!isAllowed) {
      throw {
        error: {
          code: ErrorCode.E_POLICY_VIOLATION,
          message: `Host not in whitelist: ${hostname}`,
          details: {
            url,
            hostname,
            allowedHosts: this.config.allowedHosts
          },
          hint: `Only these hosts are allowed: ${this.config.allowedHosts.join(', ')}`,
          recoverable: false,
        },
      };
    }
  }

  /**
   * 验证浏览器动作请求
   * @param request 动作请求
   */
  validateRequest(request: BrowserActionRequest): void {
    if (!this.config.enabled) {
      throw {
        error: {
          code: ErrorCode.E_TOOL_DISABLED,
          message: 'Browser actions are disabled',
          hint: 'Enable browser in policies.json',
          recoverable: false,
        },
      };
    }

    // 根据动作类型验证必需参数
    switch (request.action) {
      case 'open':
        if (!request.url) {
          throw {
            error: {
              code: ErrorCode.E_BAD_ARGS,
              message: 'URL is required for open action',
              hint: 'Provide a url parameter',
              recoverable: true,
            },
          };
        }
        this.validateUrl(request.url);
        break;

      case 'click':
        if (!request.selector) {
          throw {
            error: {
              code: ErrorCode.E_BAD_ARGS,
              message: 'Selector is required for click action',
              hint: 'Provide a selector parameter',
              recoverable: true,
            },
          };
        }
        break;

      case 'screenshot':
        if (!request.path) {
          throw {
            error: {
              code: ErrorCode.E_BAD_ARGS,
              message: 'Path is required for screenshot action',
              hint: 'Provide a path parameter',
              recoverable: true,
            },
          };
        }
        break;

      default:
        throw {
          error: {
            code: ErrorCode.E_BAD_ARGS,
            message: `Unknown browser action: ${request.action}`,
            details: { action: request.action },
            hint: 'Use one of: open, click, screenshot',
            recoverable: true,
          },
        };
    }
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<BrowserConfig> {
    return { ...this.config };
  }
}

/**
 * 默认浏览器配置
 */
export const DEFAULT_BROWSER_CONFIG: Omit<BrowserConfig, 'screenshotDir'> = {
  enabled: false,
  allowedHosts: ['localhost', '127.0.0.1'],
  timeoutMs: 30000,
};

