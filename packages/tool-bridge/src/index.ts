/**
 * Tool Bridge - 工具桥主入口
 * 导出所有工具桥模块
 */

export * from './fs-sandbox.js';
export * from './exec-whitelist.js';
export * from './browser-local.js';

// 默认配置类型引用修正
import type { SandboxConfig } from './fs-sandbox.js';
import type { ExecutionConfig } from './exec-whitelist.js';
import type { BrowserConfig } from './browser-local.js';

export const DEFAULT_SANDBOX_CONFIG: Omit<SandboxConfig, 'projectRoot'> = {
  forbiddenDirs: ['.git', 'node_modules', '.env', '.webgal_agent'],
  maxReadBytes: 1048576, // 1MB
  textEncoding: 'utf-8',
};

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  enabled: true,
  allowedCommands: ['dev', 'build', 'lint'],
  timeoutMs: 180000, // 3 minutes
  workingDir: '.',
  redactEnv: ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD'],
};

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  enabled: true,
  allowedHosts: ['localhost', '127.0.0.1'],
  screenshotDir: 'test-screenshots',
  timeoutMs: 30000, // 30 seconds
};
