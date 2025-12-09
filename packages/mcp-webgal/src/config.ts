/**
 * 配置加载与合并
 *
 * 优先级：CLI 参数 > policies 文件 > 内置默认值
 *
 * TS 5.0+ 特性:
 * - 使用 satisfies 操作符确保类型安全
 * - 使用 type 导入修饰符
 * - 使用 as const 保留字面量类型
 * - 使用 const 类型参数
 */

import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { SandboxConfig, ExecutionConfig, BrowserConfig } from '@webgal-agent/tool-bridge'
import {
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_BROWSER_CONFIG,
} from '@webgal-agent/tool-bridge'
import type { IdempotencyConfig } from '@webgal-agent/agent-core/tools'

// ============ 类型定义 ============

/**
 * 支持的模型提供商
 * TS 5.0+: 使用 as const 定义字面量类型
 */
export const MODEL_PROVIDERS = ['anthropic', 'openai', 'qwen', 'deepseek'] as const
export type ModelProvider = (typeof MODEL_PROVIDERS)[number]

/**
 * 检查是否为有效的模型提供商
 * TS 5.5+: 自动推断类型谓词
 */
export function isValidModelProvider(provider: string): provider is ModelProvider {
  return MODEL_PROVIDERS.includes(provider as ModelProvider)
}

export interface PartialIdempotencyConfig {
  readonly maxEntries?: number
  readonly maxAgeDays?: number
}

export interface PolicyFile {
  readonly snapshotRetention?: number
  readonly writes?: {
    readonly snapshotRetention?: number
  }
  readonly idempotency?: PartialIdempotencyConfig
  readonly sandbox?: Partial<Omit<SandboxConfig, 'projectRoot'>>
  readonly execution?: Partial<ExecutionConfig> & { readonly enabled?: boolean }
  readonly browser?: Partial<BrowserConfig> & { readonly enabled?: boolean }
  readonly models?: {
    readonly provider?: ModelProvider
    readonly model?: string
    readonly temperature?: number
    readonly maxTokens?: number
    readonly baseURL?: string // 用于 OpenRouter 或自定义端点
  }
}

export interface CliOverrides {
  readonly snapshotRetention?: number
  readonly idempotency?: PartialIdempotencyConfig
  readonly sandbox?: {
    readonly forbiddenDirs?: readonly string[]
    readonly maxReadBytes?: number
    readonly textEncoding?: string
  }
  readonly execution?: {
    readonly enabled?: boolean
    readonly allowedCommands?: readonly string[]
    readonly timeoutMs?: number
    readonly workingDir?: string
    readonly redactEnv?: readonly string[]
  }
  readonly browser?: {
    readonly enabled?: boolean
    readonly allowedHosts?: readonly string[]
    readonly timeoutMs?: number
    readonly screenshotDir?: string
  }
  readonly models?: {
    readonly provider?: ModelProvider
    readonly model?: string
    readonly temperature?: number
    readonly maxTokens?: number
    readonly baseURL?: string
  }
}

export interface ResolvedConfig {
  readonly snapshotRetention: number
  readonly idempotency: IdempotencyConfig
  readonly sandbox: Omit<SandboxConfig, 'projectRoot'>
  readonly execution?: ExecutionConfig
  readonly browser?: BrowserConfig
  readonly models?: {
    readonly provider: ModelProvider
    readonly model?: string
    readonly temperature?: number
    readonly maxTokens?: number
    readonly baseURL?: string
  }
}

// ============ 默认配置 ============

/**
 * 默认幂等配置
 * TS 5.0+: 使用 satisfies 确保类型安全同时保留字面量类型
 */
export const DEFAULT_IDEMPOTENCY_CONFIG = {
  maxEntries: 500,
  maxAgeDays: 7,
} as const satisfies IdempotencyConfig

/**
 * 默认快照保留数
 */
export const DEFAULT_SNAPSHOT_RETENTION = 20 as const

/**
 * 默认安全脚本列表
 */
export const DEFAULT_SAFE_SCRIPTS = ['dev', 'build', 'lint', 'test', 'start', 'preview'] as const

// ============ 工具函数 ============

/**
 * 解析逗号分隔的列表
 * TS 5.5+: filter 自动推断类型谓词
 */
export function parseListFlag(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 安全加载 JSON 文件
 * TS 5.0+: 使用泛型约束
 */
export async function tryLoadJson<T extends object>(file?: string): Promise<T | undefined> {
  if (!file || !existsSync(file)) {
    return undefined
  }

  try {
    const content = await readFile(file, 'utf-8')
    return JSON.parse(content) as T
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`警告: 加载策略文件失败 (${file}): ${message}`)
    return undefined
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
export function resolvePoliciesPath(
  cliPath: string | undefined,
  projectRoot: string,
): string | undefined {
  if (cliPath) {
    const resolved = resolve(cliPath)
    if (existsSync(resolved)) {
      return resolved
    }
    console.error(`警告: 指定的策略文件不存在: ${resolved}`)
    return undefined
  }

  // 尝试默认位置
  // TS 5.0+: 使用 as const 保留元组类型
  const candidates = [
    join(projectRoot, 'configs', 'policies.json'),
    join(projectRoot, 'policies.json'),
  ] as const

  // TS 5.5+: find 结合类型谓词
  const found = candidates.find((candidate) => existsSync(candidate))
  return found
}

/**
 * 动态收集 package.json 中的脚本
 */
export async function collectAllowedCommands(projectRoot: string): Promise<string[]> {
  const pkgPath = join(projectRoot, 'package.json')

  if (!existsSync(pkgPath)) {
    return ['dev', 'build', 'lint'] // 默认白名单
  }

  try {
    const pkg = await tryLoadJson<{ scripts?: Record<string, string> }>(pkgPath)
    if (!pkg?.scripts) {
      return ['dev', 'build', 'lint']
    }

    // 收集常见的安全脚本
    // TS 5.5+: filter 自动推断类型
    const available = Object.keys(pkg.scripts).filter((name) =>
      DEFAULT_SAFE_SCRIPTS.includes(name as (typeof DEFAULT_SAFE_SCRIPTS)[number]),
    )

    return available.length > 0 ? available : ['dev', 'build', 'lint']
  } catch {
    return ['dev', 'build', 'lint']
  }
}

// ============ 配置合并 ============

/**
 * 合并配置选项类型
 */
interface MergeConfigOptions {
  readonly defaults: {
    readonly snapshotRetention: number
    readonly idempotency: IdempotencyConfig
    readonly sandbox: Omit<SandboxConfig, 'projectRoot'>
    readonly execution: ExecutionConfig
    readonly browser: BrowserConfig
  }
  readonly policies?: PolicyFile
  readonly cli: CliOverrides
}

/**
 * 合并配置
 *
 * 优先级：CLI > policies > defaults
 * TS 5.0+: 使用 satisfies 确保返回类型正确
 */
export function mergeConfig(options: MergeConfigOptions): ResolvedConfig {
  const { defaults, policies, cli } = options

  // 快照保留数（兼容 writes.snapshotRetention）
  const snapshotRetention =
    cli.snapshotRetention ??
    policies?.writes?.snapshotRetention ??
    policies?.snapshotRetention ??
    defaults.snapshotRetention

  // 幂等配置
  const idempotency = {
    maxEntries:
      cli.idempotency?.maxEntries ??
      policies?.idempotency?.maxEntries ??
      defaults.idempotency.maxEntries,
    maxAgeDays:
      cli.idempotency?.maxAgeDays ??
      policies?.idempotency?.maxAgeDays ??
      defaults.idempotency.maxAgeDays,
  } satisfies IdempotencyConfig

  // Sandbox 配置
  const sandbox = {
    forbiddenDirs: [
      ...(cli.sandbox?.forbiddenDirs ??
        policies?.sandbox?.forbiddenDirs ??
        defaults.sandbox.forbiddenDirs),
    ],
    maxReadBytes:
      cli.sandbox?.maxReadBytes ?? policies?.sandbox?.maxReadBytes ?? defaults.sandbox.maxReadBytes,
    textEncoding: (cli.sandbox?.textEncoding ??
      policies?.sandbox?.textEncoding ??
      defaults.sandbox.textEncoding) as BufferEncoding,
  } satisfies Omit<SandboxConfig, 'projectRoot'>

  // Execution 配置（仅在启用时返回）
  const executionEnabled = cli.execution?.enabled ?? policies?.execution?.enabled ?? false
  const execution: ExecutionConfig | undefined = executionEnabled
    ? ({
        enabled: true,
        allowedCommands: [
          ...(cli.execution?.allowedCommands ??
            policies?.execution?.allowedCommands ??
            defaults.execution.allowedCommands),
        ],
        timeoutMs:
          cli.execution?.timeoutMs ??
          policies?.execution?.timeoutMs ??
          defaults.execution.timeoutMs,
        workingDir:
          cli.execution?.workingDir ??
          policies?.execution?.workingDir ??
          defaults.execution.workingDir,
        redactEnv: [
          ...(cli.execution?.redactEnv ??
            policies?.execution?.redactEnv ??
            defaults.execution.redactEnv),
        ],
      } satisfies ExecutionConfig)
    : undefined

  // Browser 配置（仅在启用时返回）
  const browserEnabled = cli.browser?.enabled ?? policies?.browser?.enabled ?? false
  const browser: BrowserConfig | undefined = browserEnabled
    ? ({
        enabled: true,
        allowedHosts: [
          ...(cli.browser?.allowedHosts ??
            policies?.browser?.allowedHosts ??
            defaults.browser.allowedHosts),
        ],
        timeoutMs:
          cli.browser?.timeoutMs ?? policies?.browser?.timeoutMs ?? defaults.browser.timeoutMs,
        screenshotDir:
          cli.browser?.screenshotDir ??
          policies?.browser?.screenshotDir ??
          defaults.browser.screenshotDir,
      } satisfies BrowserConfig)
    : undefined

  // Models 配置（可选）
  const modelsProvider = cli.models?.provider ?? policies?.models?.provider
  const models: ResolvedConfig['models'] = modelsProvider
    ? {
        provider: modelsProvider,
        model: cli.models?.model ?? policies?.models?.model,
        temperature: cli.models?.temperature ?? policies?.models?.temperature ?? 0.4,
        maxTokens: cli.models?.maxTokens ?? policies?.models?.maxTokens ?? 4000,
        baseURL: cli.models?.baseURL ?? policies?.models?.baseURL,
      }
    : undefined

  return {
    snapshotRetention,
    idempotency,
    sandbox,
    execution,
    browser,
    models,
  } satisfies ResolvedConfig
}

/**
 * 加载并解析完整配置
 */
export async function loadResolvedConfig(
  projectRoot: string,
  cli: CliOverrides,
  policiesPath?: string,
): Promise<ResolvedConfig> {
  // 加载策略文件
  const policies = policiesPath ? await tryLoadJson<PolicyFile>(policiesPath) : undefined

  // 内置默认值（增强 .webgal_agent 到 forbidden）
  // TS 5.0+: 使用 satisfies 确保类型安全
  const defaults = {
    snapshotRetention: DEFAULT_SNAPSHOT_RETENTION,
    idempotency: { ...DEFAULT_IDEMPOTENCY_CONFIG },
    sandbox: {
      forbiddenDirs: [...DEFAULT_SANDBOX_CONFIG.forbiddenDirs, '.webgal_agent'],
      maxReadBytes: DEFAULT_SANDBOX_CONFIG.maxReadBytes,
      textEncoding: DEFAULT_SANDBOX_CONFIG.textEncoding,
    },
    execution: {
      enabled: false,
      allowedCommands: [...DEFAULT_EXECUTION_CONFIG.allowedCommands],
      timeoutMs: DEFAULT_EXECUTION_CONFIG.timeoutMs,
      workingDir: DEFAULT_EXECUTION_CONFIG.workingDir,
      redactEnv: [...DEFAULT_EXECUTION_CONFIG.redactEnv],
    },
    browser: {
      enabled: false,
      allowedHosts: [...DEFAULT_BROWSER_CONFIG.allowedHosts],
      timeoutMs: DEFAULT_BROWSER_CONFIG.timeoutMs,
      screenshotDir: 'test-screenshots',
    },
  } satisfies MergeConfigOptions['defaults']

  // 合并配置
  let resolved = mergeConfig({ defaults, policies, cli })

  // 动态收集 allowedCommands（如果启用执行但未指定）
  if (
    resolved.execution &&
    !cli.execution?.allowedCommands &&
    !policies?.execution?.allowedCommands
  ) {
    const commands = await collectAllowedCommands(projectRoot)
    resolved = {
      ...resolved,
      execution: {
        ...resolved.execution,
        allowedCommands: commands,
      },
    }
  }

  return resolved
}
