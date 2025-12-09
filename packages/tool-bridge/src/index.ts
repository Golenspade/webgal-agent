/**
 * Tool Bridge - 工具桥主入口
 * 导出所有工具桥模块
 */

export * from './fs-sandbox.js'
export * from './exec-whitelist.js'
export * from './browser-local.js'

// 默认配置类型引用修正
import type { SandboxConfig } from './fs-sandbox.js'
import type { ExecutionConfig } from './exec-whitelist.js'
import type { BrowserConfig } from './browser-local.js'

/**
 * 默认沙箱配置
 * 使用 satisfies 确保类型安全的同时保留字面量类型推断
 */
export const DEFAULT_SANDBOX_CONFIG = {
  forbiddenDirs: ['.git', 'node_modules', '.env', '.webgal_agent'],
  maxReadBytes: 1048576, // 1MB
  textEncoding: 'utf-8',
} as const satisfies Omit<SandboxConfig, 'projectRoot'>

/**
 * 默认执行配置
 */
export const DEFAULT_EXECUTION_CONFIG = {
  enabled: true,
  allowedCommands: ['dev', 'build', 'lint'],
  timeoutMs: 180000, // 3 minutes
  workingDir: '.',
  redactEnv: ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD'],
} as const satisfies ExecutionConfig

/**
 * 默认浏览器配置
 */
export const DEFAULT_BROWSER_CONFIG = {
  enabled: true,
  allowedHosts: ['localhost', '127.0.0.1'],
  screenshotDir: 'test-screenshots',
  timeoutMs: 30000, // 30 seconds
} as const satisfies BrowserConfig
