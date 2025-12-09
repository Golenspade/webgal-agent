/**
 * 类型定义 - 严格按照 CONTRACTS.md 的 JSON Schema
 *
 * TS 5.0+ 特性:
 * - 使用 type 导入修饰符
 * - 使用 readonly 修饰符增强不变性
 * - 使用 satisfies 模式的类型约束
 */

import type { ErrorCode } from '@webgal-agent/tool-bridge'

/**
 * 统一错误结构（CONTRACTS.md 0.2）
 */
export interface ToolError {
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
    readonly hint?: string
    readonly recoverable?: boolean
  }
}

// ============ 1. 基础文件 & 检索工具 ============

/**
 * 1.1 list_files
 */
export interface ListFilesRequest {
  readonly path: string
  readonly globs?: readonly string[]
  readonly dirsOnly?: boolean
}

export interface ListFilesResponse {
  readonly entries: readonly string[]
}

/**
 * 1.2 read_file
 */
export interface ReadFileRequest {
  readonly path: string
  readonly maxBytes?: number
}

export interface ReadFileResponse {
  readonly path: string
  readonly content: string
  readonly encoding?: 'utf-8'
  readonly bytes?: number
}

/**
 * 1.3 write_to_file
 */
export interface WriteToFileRequest {
  readonly path: string
  readonly content: string
  readonly mode?: 'overwrite' | 'append'
  readonly dryRun: boolean
  readonly idempotencyKey?: string
}

export interface DiffHunk {
  readonly startOld: number
  readonly lenOld: number
  readonly startNew: number
  readonly lenNew: number
  readonly linesOld: readonly string[]
  readonly linesNew: readonly string[]
}

export interface Diff {
  readonly type: 'line'
  readonly hunks: readonly DiffHunk[]
}

export interface WriteToFileResponse {
  readonly applied: boolean
  readonly diff?: Diff
  readonly snapshotId?: string
  readonly bytesWritten?: number
}

/**
 * 1.4 replace_in_file
 */
export interface ReplaceInFileRequest {
  readonly path: string
  readonly find: string
  readonly replace: string
  readonly flags?: string
}

export interface ReplaceInFileResponse {
  readonly count: number
}

/**
 * 1.5 search_files
 */
export interface SearchFilesRequest {
  readonly path: string
  readonly regex: string
  readonly filePattern?: string
  readonly maxMatches?: number
}

export interface SearchMatch {
  readonly path: string
  readonly line: number
  readonly preview: string
}

export interface SearchFilesResponse {
  readonly matches: readonly SearchMatch[]
}

// ============ 2. WebGAL 专用工具 ============

/**
 * 2.1 list_project_resources
 */
export interface ListProjectResourcesResponse {
  backgrounds: string[]
  figures: string[]
  bgm: string[]
  vocals: string[]
  scenes: string[]
}

/**
 * 2.2 validate_script
 */
export interface ValidateScriptRequest {
  readonly path?: string
  readonly content?: string
}

/**
 * 诊断类型
 * TS 5.0+: 使用字面量类型联合
 */
export type DiagnosticKind = 'syntax' | 'resource' | 'style'

export interface Diagnostic {
  line: number
  kind: DiagnosticKind
  message: string
  fixHint?: string
}

export interface ValidateScriptResponse {
  valid: boolean
  diagnostics: Diagnostic[]
}

/**
 * 2.3 list_snapshots
 */
export interface ListSnapshotsRequest {
  readonly limit?: number
  readonly path?: string
}

export interface SnapshotMetadata {
  readonly id: string
  readonly path: string
  readonly timestamp: number
  readonly contentHash: string
  readonly idempotencyKey?: string
}

export interface ListSnapshotsResponse {
  readonly snapshots: readonly SnapshotMetadata[]
}

/**
 * 2.4 restore_snapshot
 */
export interface RestoreSnapshotRequest {
  readonly snapshotId: string
}

export interface RestoreSnapshotResponse {
  readonly path: string
  readonly content: string
}

/**
 * 2.5 preview_scene
 */
export interface PreviewSceneRequest {
  readonly scenePath?: string
}

export interface PreviewSceneResponse {
  readonly url: string
  readonly logs?: readonly string[]
  readonly firstErrorLine?: number
}

/**
 * 2.6 generate_character_profile
 */
export interface GenerateCharacterProfileRequest {
  readonly name: string
  readonly imageFile: string
  readonly defaultExpression?: string
}

export interface GenerateCharacterProfileResponse {
  readonly success: boolean
}

// ============ 3. 交互与完成信号 ============

/**
 * 3.1 ask_followup_question
 */
export interface AskFollowupQuestionRequest {
  readonly question: string
}

export interface AskFollowupQuestionResponse {
  readonly ack: boolean
}

/**
 * 3.2 attempt_completion
 */
export interface AttemptCompletionRequest {
  readonly result: string
}

export interface AttemptCompletionResponse {
  readonly ack: boolean
}

// ============ 4. 命令与浏览器 ============

/**
 * 允许的脚本名称
 * TS 5.0+: 字面量类型联合
 */
export type AllowedScriptName = 'dev' | 'build' | 'lint'

/**
 * 4.1 execute_command
 */
export interface ExecuteCommandRequest {
  readonly scriptName: AllowedScriptName
  readonly args?: readonly string[]
}

export interface ExecuteCommandResponse {
  readonly ok: boolean
  readonly logs?: readonly string[]
}

/**
 * 浏览器动作类型
 * TS 5.0+: 字面量类型联合
 */
export type BrowserActionType = 'open' | 'click' | 'screenshot'

/**
 * 4.2 browser_action
 */
export interface BrowserActionRequest {
  readonly action: BrowserActionType
  readonly url?: string
  readonly selector?: string
  readonly path?: string
}

export interface BrowserActionResponse {
  readonly ok: boolean
}

// ============ 工具类型辅助 ============

/**
 * 将类型的所有属性变为可写
 * 用于内部操作时临时解除 readonly
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

/**
 * 深度只读类型
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T
