/**
 * 配置加载与合并
 *
 * 优先级：CLI 参数 > policies 文件 > 内置默认值
 */

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import type { SandboxConfig, ExecutionConfig, BrowserConfig } from '@webgal-agent/tool-bridge';
import { DEFAULT_SANDBOX_CONFIG, DEFAULT_EXECUTION_CONFIG, DEFAULT_BROWSER_CONFIG } from '@webgal-agent/tool-bridge';
import type { IdempotencyConfig } from '@webgal-agent/agent-core/tools';

// ============ 类型定义 ============

export interface PartialIdempotencyConfig {
  maxEntries?: number;
  maxAgeDays?: number;
}

export interface PolicyFile {
  snapshotRetention?: number;
  writes?: {
    snapshotRetention?: number;
  };
  idempotency?: PartialIdempotencyConfig;
  sandbox?: Partial<Omit<SandboxConfig, 'projectRoot'>>;
  execution?: Partial<ExecutionConfig> & { enabled?: boolean };
  browser?: Partial<BrowserConfig> & { enabled?: boolean };
  models?: {
    provider?: 'anthropic' | 'openai' | 'qwen' | 'deepseek';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    baseURL?: string; // 用于 OpenRouter 或自定义端点
  };
}

export interface CliOverrides {
  snapshotRetention?: number;
  idempotency?: PartialIdempotencyConfig;
  sandbox?: {
    forbiddenDirs?: string[];
    maxReadBytes?: number;
    textEncoding?: string;
  };
  execution?: {
    enabled?: boolean;
    allowedCommands?: string[];
    timeoutMs?: number;
    workingDir?: string;
    redactEnv?: string[];
  };
  browser?: {
    enabled?: boolean;
    allowedHosts?: string[];
    timeoutMs?: number;
    screenshotDir?: string;
  };
  models?: {
    provider?: 'anthropic' | 'openai' | 'qwen' | 'deepseek';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    baseURL?: string;
  };
}

export interface ResolvedConfig {
  snapshotRetention: number;
  idempotency: IdempotencyConfig;
  sandbox: Omit<SandboxConfig, 'projectRoot'>;
  execution?: ExecutionConfig;
  browser?: BrowserConfig;
  models?: {
    provider: 'anthropic' | 'openai' | 'qwen' | 'deepseek';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    baseURL?: string;
  };
}

// ============ 工具函数 ============

/**
 * 解析逗号分隔的列表
 */
export function parseListFlag(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 安全加载 JSON 文件
 */
export async function tryLoadJson<T>(file?: string): Promise<T | undefined> {
  if (!file || !existsSync(file)) {
    return undefined;
  }

  try {
    const content = await readFile(file, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    console.error(`警告: 加载策略文件失败 (${file}): ${error.message}`);
    return undefined;
  }
}

/**
 * 解析策略文件路径
 * 
 * 优先级：
 * 1. CLI 指定的路径
 * 2. <projectRoot>/configs/policies.json
 * 3. <projectRoot>/policies.json
 */
export function resolvePoliciesPath(cliPath: string | undefined, projectRoot: string): string | undefined {
  if (cliPath) {
    const resolved = resolve(cliPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    console.error(`警告: 指定的策略文件不存在: ${resolved}`);
    return undefined;
  }

  // 尝试默认位置
  const candidates = [
    join(projectRoot, 'configs', 'policies.json'),
    join(projectRoot, 'policies.json'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * 动态收集 package.json 中的脚本
 */
export async function collectAllowedCommands(projectRoot: string): Promise<string[]> {
  const pkgPath = join(projectRoot, 'package.json');
  
  if (!existsSync(pkgPath)) {
    return ['dev', 'build', 'lint']; // 默认白名单
  }

  try {
    const pkg = await tryLoadJson<{ scripts?: Record<string, string> }>(pkgPath);
    if (!pkg?.scripts) {
      return ['dev', 'build', 'lint'];
    }

    // 收集常见的安全脚本
    const safeScripts = ['dev', 'build', 'lint', 'test', 'start', 'preview'];
    const available = Object.keys(pkg.scripts).filter(name => safeScripts.includes(name));
    
    return available.length > 0 ? available : ['dev', 'build', 'lint'];
  } catch {
    return ['dev', 'build', 'lint'];
  }
}

// ============ 配置合并 ============

/**
 * 合并配置
 * 
 * 优先级：CLI > policies > defaults
 */
export function mergeConfig(options: {
  defaults: {
    snapshotRetention: number;
    idempotency: IdempotencyConfig;
    sandbox: Omit<SandboxConfig, 'projectRoot'>;
    execution: ExecutionConfig;
    browser: BrowserConfig;
  };
  policies?: PolicyFile;
  cli: CliOverrides;
}): ResolvedConfig {
  const { defaults, policies, cli } = options;

  // 快照保留数（兼容 writes.snapshotRetention）
  const snapshotRetention = cli.snapshotRetention
    ?? policies?.writes?.snapshotRetention
    ?? policies?.snapshotRetention
    ?? defaults.snapshotRetention;

  // 幂等配置
  const idempotency: IdempotencyConfig = {
    maxEntries: cli.idempotency?.maxEntries ?? policies?.idempotency?.maxEntries ?? defaults.idempotency.maxEntries ?? 500,
    maxAgeDays: cli.idempotency?.maxAgeDays ?? policies?.idempotency?.maxAgeDays ?? defaults.idempotency.maxAgeDays ?? 7,
  };

  // Sandbox 配置
  const sandbox: Omit<SandboxConfig, 'projectRoot'> = {
    forbiddenDirs: cli.sandbox?.forbiddenDirs ?? policies?.sandbox?.forbiddenDirs ?? defaults.sandbox.forbiddenDirs,
    maxReadBytes: cli.sandbox?.maxReadBytes ?? policies?.sandbox?.maxReadBytes ?? defaults.sandbox.maxReadBytes,
    textEncoding: (cli.sandbox?.textEncoding ?? policies?.sandbox?.textEncoding ?? defaults.sandbox.textEncoding) as BufferEncoding,
  };

  // Execution 配置（仅在启用时返回）
  const executionEnabled = cli.execution?.enabled ?? policies?.execution?.enabled ?? false;
  const execution: ExecutionConfig | undefined = executionEnabled
    ? {
        enabled: true,
        allowedCommands: cli.execution?.allowedCommands ?? policies?.execution?.allowedCommands ?? defaults.execution.allowedCommands,
        timeoutMs: cli.execution?.timeoutMs ?? policies?.execution?.timeoutMs ?? defaults.execution.timeoutMs,
        workingDir: cli.execution?.workingDir ?? policies?.execution?.workingDir ?? defaults.execution.workingDir,
        redactEnv: cli.execution?.redactEnv ?? policies?.execution?.redactEnv ?? defaults.execution.redactEnv,
      }
    : undefined;

  // Browser 配置（仅在启用时返回）
  const browserEnabled = cli.browser?.enabled ?? policies?.browser?.enabled ?? false;
  const browser: BrowserConfig | undefined = browserEnabled
    ? {
        enabled: true,
        allowedHosts: cli.browser?.allowedHosts ?? policies?.browser?.allowedHosts ?? defaults.browser.allowedHosts,
        timeoutMs: cli.browser?.timeoutMs ?? policies?.browser?.timeoutMs ?? defaults.browser.timeoutMs,
        screenshotDir: cli.browser?.screenshotDir ?? policies?.browser?.screenshotDir ?? defaults.browser.screenshotDir,
      }
    : undefined;

  // Models 配置（可选）
  const models: ResolvedConfig['models'] | undefined =
    cli.models?.provider || policies?.models?.provider
      ? {
          provider: (cli.models?.provider ?? policies?.models?.provider) as 'anthropic' | 'openai' | 'qwen' | 'deepseek',
          model: cli.models?.model ?? policies?.models?.model,
          temperature: cli.models?.temperature ?? policies?.models?.temperature ?? 0.4,
          maxTokens: cli.models?.maxTokens ?? policies?.models?.maxTokens ?? 4000,
          baseURL: cli.models?.baseURL ?? policies?.models?.baseURL,
        }
      : undefined;

  return {
    snapshotRetention,
    idempotency,
    sandbox,
    execution,
    browser,
    models,
  };
}

/**
 * 加载并解析完整配置
 */
export async function loadResolvedConfig(
  projectRoot: string,
  cli: CliOverrides,
  policiesPath?: string
): Promise<ResolvedConfig> {
  // 加载策略文件
  const policies = policiesPath ? await tryLoadJson<PolicyFile>(policiesPath) : undefined;

  // 内置默认值（增强 .webgal_agent 到 forbidden）
  const defaults = {
    snapshotRetention: 20,
    idempotency: {
      maxEntries: 500,
      maxAgeDays: 7,
    },
    sandbox: {
      ...DEFAULT_SANDBOX_CONFIG,
      forbiddenDirs: Array.from(new Set([...DEFAULT_SANDBOX_CONFIG.forbiddenDirs, '.webgal_agent'])),
    },
    execution: {
      ...DEFAULT_EXECUTION_CONFIG,
      enabled: false,
    },
    browser: {
      ...DEFAULT_BROWSER_CONFIG,
      enabled: false,
    },
  };

  // 合并配置
  let resolved = mergeConfig({ defaults, policies, cli });

  // 动态收集 allowedCommands（如果启用执行但未指定）
  if (resolved.execution && !cli.execution?.allowedCommands && !policies?.execution?.allowedCommands) {
    const commands = await collectAllowedCommands(projectRoot);
    resolved = {
      ...resolved,
      execution: {
        ...resolved.execution,
        allowedCommands: commands,
      },
    };
  }

  return resolved;
}

